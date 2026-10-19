/**
 * Proveedor de dictado Whisper local para DeepSeek Harness.
 *
 * No añade interfaz: se registra en el servicio `speechToText` de DSH y la UI
 * de voz que ya viene con Harness (micrófono, niveles, cancelar, inserción en
 * el borrador) lo usa como un reconocedor más.
 *
 * El motor (uv + Python + faster-whisper + modelo) se aprovisiona en un
 * directorio de datos del usuario, nunca en el repositorio:
 *   Windows  %LOCALAPPDATA%\dsh-whisper
 *   macOS    ~/Library/Application Support/dsh-whisper
 *   Linux    $XDG_DATA_HOME/dsh-whisper
 *
 * Contrato verificado en DSH 0.2.1-rc.2:
 *   ctx.speechToText.register({
 *     info: { id, name, location: "host-local", languages, setupEstimate },
 *     preparation: { prepare, cancel, snapshot, subscribe },
 *     transcribe: async ({ audio, language }, signal) => string,
 *   })
 */

import { randomUUID } from "node:crypto"
import { rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ENGINE_DEFAULTS, createEngine } from "./engine.js"

export const name = "whisper-provider"
export const inject = ["speechToText"]

export const DEFAULTS = {
  ...ENGINE_DEFAULTS,
  providerId: "whisper-local",
  timeoutMs: 180_000,
  languages: ["es", "en", "pt", "fr", "de", "it"],
  maxAudioBytes: 4 * 1024 * 1024,
}

/** Acepta Buffer, Uint8Array o base64 (por si el contrato cambia de forma). */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === "string") return Buffer.from(value, "base64")
  return undefined
}

/**
 * Construye el `Transcript` que exige DSH: un objeto estricto, no un string.
 * `audioSeconds` se deriva de un WAV canónico PCM16 mono 16 kHz (cabecera de 44 bytes).
 *
 * @param {{ text?: unknown }} payload
 * @param {number} audioBytes
 * @param {number} inferenceSeconds
 */
export function buildTranscript(payload, audioBytes, inferenceSeconds) {
  return {
    text: typeof payload?.text === "string" ? payload.text : "",
    audioSeconds: Math.max(0, (audioBytes - 44) / (16_000 * 2)),
    inferenceSeconds: Math.max(0, inferenceSeconds),
  }
}

/**
 * Crea el proveedor: el motor aprovisionable y la transcripción.
 *
 * @param {Partial<typeof DEFAULTS>} overrides
 * @param {{ warn?: (message: string, error?: unknown) => void, info?: (message: string) => void }} [log]
 */
export function createWhisperProvider(overrides = {}, log = {}) {
  const config = { ...DEFAULTS, ...overrides }
  const warn = log.warn ?? (() => {})
  const engine = createEngine(config, { log: log.info ?? (() => {}) })
  const baseUrl = String(config.serviceUrl).replace(/\/+$/, "")

  /** @param {{ audio: Buffer, language?: string }} input */
  async function transcribe(input, signal) {
    const audio = toBuffer(input?.audio)
    if (!audio || audio.length === 0) throw new Error("La grabación llegó vacía.")
    if (audio.length > config.maxAudioBytes) {
      throw new Error(`La grabación supera el límite de ${Math.round(config.maxAudioBytes / 1024 / 1024)} MB.`)
    }

    // Nunca descarga ni instala dentro de la petición: eso es de `preparation`.
    await engine.ensureReady()

    const file = join(tmpdir(), `dsh-whisper-${randomUUID()}.wav`)
    await writeFile(file, audio)

    const timeout = AbortSignal.timeout(config.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const language = input.language && input.language !== "auto" ? input.language : undefined
    const startedAt = Date.now()

    try {
      const response = await fetch(`${baseUrl}/transcribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(language ? { path: file, language } : { path: file }),
        signal: combined,
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        throw new Error(`El motor Whisper respondió ${response.status}: ${detail.slice(0, 500)}`)
      }

      const payload = await response.json().catch(() => ({}))
      if (payload?.error) throw new Error(String(payload.error))
      return buildTranscript(payload, audio.length, (Date.now() - startedAt) / 1000)
    } finally {
      await rm(file, { force: true }).catch(() => {})
    }
  }

  async function inspect() {
    try {
      await engine.inspect()
    } catch (error) {
      warn("No se pudo inspeccionar el motor Whisper", error)
    }
  }

  return {
    registration: {
      info: {
        id: config.providerId,
        name: "Whisper local (faster-whisper)",
        location: "host-local",
        languages: config.languages,
        setupEstimate: {
          recommendedDiskBytes: 2_200_000_000,
          expectedMemoryBytes: 2_000_000_000,
          minimumMinutes: 5,
          maximumMinutes: 20,
        },
      },
      preparation: engine.preparation,
      transcribe,
    },
    inspect,
    dispose: () => engine.dispose(),
  }
}

/**
 * Punto de entrada del plugin Host.
 * @param {any} ctx
 * @param {Partial<typeof DEFAULTS>} [config]
 */
export function apply(ctx, config = {}) {
  const warn = (message, error) => {
    try {
      ctx.logger?.warn?.(message, error)
    } catch {
      // el logger es opcional
    }
  }

  const provider = createWhisperProvider(config, {
    warn,
    info: (message) => {
      try {
        ctx.logger?.info?.(message)
      } catch {
        // el logger es opcional
      }
    },
  })

  ctx.effect(() => {
    const unregister = ctx.speechToText.register(provider.registration)
    // Inspección pasiva: no descarga nada, solo decide ready/standby/unprepared.
    void provider.inspect()

    return async () => {
      await provider.dispose()
      await unregister()
    }
  })
}
