/**
 * Núcleo del dictado: grabación, transcripción y máquina de estados.
 *
 * Este módulo **no depende de OpenCode** (ni de Solid): solo de Node y del
 * sidecar local de Whisper. Cualquier host — la TUI de OpenCode, un CLI, una
 * extensión de editor — puede crear una instancia, disparar `toggle()` y
 * decidir qué hacer con el texto resultante.
 *
 * Lo específico del host (dibujar un botón, registrar un atajo, pegar en el
 * input) vive en el adaptador; ver `src/tui.tsx` para el caso de OpenCode.
 */

import { resolveConfig, type PluginConfig } from "./config"
import { ensureService } from "./engine"
import { resolveFfmpegPath } from "./ffmpeg"
import { Recorder } from "./recorder"
import { transcribe as transcribeAudio } from "./transcribe"

export type DictationState = "idle" | "recording" | "transcribing"

/** Resultado de `toggle()`, para que el host reaccione sin conocer los estados internos. */
export type DictationOutcome =
  | { status: "started" }
  | { status: "transcribed"; text: string }
  | { status: "empty" } // paró la grabación pero no se detectó voz
  | { status: "noop" } // no había nada que hacer (p. ej. ya estaba transcribiendo)

/** Lo mínimo que el núcleo necesita de un grabador (permite inyectar uno falso en pruebas). */
export interface RecorderLike {
  readonly wavPath: string
  stop(): Promise<void>
  cleanup(): Promise<void>
}

export interface DictationHooks {
  /** Se invoca en cada transición de estado (síncrono). */
  onStateChange?(state: DictationState): void
}

/** Puntos de inyección para probar el núcleo sin micrófono ni ffmpeg. */
export interface DictationDeps {
  startRecorder?(config: PluginConfig): Promise<RecorderLike>
  transcribe?(wavPath: string, config: PluginConfig): Promise<string>
}

export interface Dictation {
  readonly state: DictationState
  /** Precalienta/instala el motor si la configuración lo permite. */
  prepare(onProgress?: (message: string) => void): Promise<void>
  /** Empieza a grabar. No-op si ya no está en `idle`. */
  start(): Promise<void>
  /** Detiene y transcribe. Devuelve `null` si no había grabación o no hubo voz. */
  stop(): Promise<string | null>
  /** Alterna grabar/detener y describe lo ocurrido. */
  toggle(): Promise<DictationOutcome>
  /** Detiene y limpia la grabación en curso (para el teardown del host). */
  dispose(): Promise<void>
}

export async function createDictation(
  options: Readonly<Record<string, any>> = {},
  hooks: DictationHooks = {},
  deps: DictationDeps = {},
): Promise<Dictation> {
  const base = resolveConfig(options)
  const config: PluginConfig = { ...base, ffmpegPath: await resolveFfmpegPath(base.ffmpegPath) }

  const startRecorder = deps.startRecorder ?? ((current: PluginConfig) => Recorder.start(current))
  const transcribe = deps.transcribe ?? transcribeAudio

  let current: DictationState = "idle"
  let recorder: RecorderLike | undefined

  const setState = (next: DictationState) => {
    if (current === next) return
    current = next
    hooks.onStateChange?.(next)
  }

  const prepare = async (onProgress?: (message: string) => void): Promise<void> => {
    if (!config.warmup) return
    if (config.backend !== "faster-whisper") return
    if (!config.autoInstall && config.serviceCommand.length === 0) return
    await ensureService(config, (message) => onProgress?.(message))
  }

  const start = async (): Promise<void> => {
    if (current !== "idle") return
    const active = await startRecorder(config)
    recorder = active
    setState("recording")
  }

  const stop = async (): Promise<string | null> => {
    const active = recorder
    if (!active) return null

    recorder = undefined
    setState("transcribing")
    try {
      await active.stop()
      const text = (await transcribe(active.wavPath, config)).trim()
      return text.length > 0 ? text : null
    } finally {
      // Pase lo que pase, el temporal se borra y el estado vuelve a `idle`.
      await active.cleanup()
      setState("idle")
    }
  }

  const toggle = async (): Promise<DictationOutcome> => {
    if (current === "recording") {
      const text = await stop()
      return text ? { status: "transcribed", text } : { status: "empty" }
    }
    if (current === "idle") {
      await start()
      return { status: "started" }
    }
    return { status: "noop" }
  }

  const dispose = async (): Promise<void> => {
    const active = recorder
    recorder = undefined
    if (!active) return
    try {
      await active.stop()
    } catch {
      // La captura pudo haber terminado ya; la limpieza es lo que importa.
    } finally {
      await active.cleanup().catch(() => {})
    }
  }

  return {
    get state() {
      return current
    },
    prepare,
    start,
    stop,
    toggle,
    dispose,
  }
}
