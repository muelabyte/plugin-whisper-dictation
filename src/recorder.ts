import { execFile, spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginConfig } from "./config"

/** Ejecuta un proceso y captura salida; nunca rechaza (el código de salida va en `code`). */
function capture(file: string, args: readonly string[]): Promise<{ output: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args as string[],
      { windowsHide: true, maxBuffer: 1 << 24 },
      (error, stdout, stderr) => {
        resolve({ output: `${stdout}${stderr}`, code: error ? 1 : 0 })
      },
    )
  })
}

/** Opciones de entrada (`-f <backend> -i <spec>`) para la plataforma actual. */
export function inputArguments(device: string): string[] {
  if (process.platform === "win32") return ["-f", "dshow", "-i", `audio=${device}`]
  if (process.platform === "darwin") return ["-f", "avfoundation", "-i", `:${device}`]
  // Linux: PulseAudio es el backend más común en escritorios.
  return ["-f", "pulse", "-i", device]
}

/**
 * Detecta el primer micrófono disponible.
 *
 * - Windows: enumera dispositivos dshow y devuelve el nombre.
 * - macOS: enumera dispositivos avfoundation y devuelve el índice.
 * - Linux: usa el dispositivo por defecto de PulseAudio.
 */
export async function detectAudioDevice(config: PluginConfig): Promise<string> {
  if (process.platform === "win32") {
    const { output } = await capture(config.ffmpegPath, [
      "-hide_banner",
      "-list_devices",
      "true",
      "-f",
      "dshow",
      "-i",
      "dummy",
    ])
    const names = [...output.matchAll(/"([^"]+)"\s*\(audio\)/gi)].map((match) => match[1])
    const unique = [...new Set(names)]
    if (unique.length === 0) throw new Error(missingDeviceError())
    return unique[0]
  }

  if (process.platform === "darwin") {
    const { output } = await capture(config.ffmpegPath, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""])
    const section = output.split(/AVFoundation audio devices:/i)[1] ?? ""
    const match = section.match(/\[(\d+)\]\s*(.+)/)
    if (!match) throw new Error(missingDeviceError())
    return match[1]
  }

  // Linux
  return config.device ?? "default"
}

function missingDeviceError(): string {
  return (
    "No se encontró ningún micrófono. Revisa que ffmpeg esté instalado y que haya " +
    "un micrófono conectado, o define la opción 'device' con el nombre/índice exacto."
  )
}

/**
 * Graba el micrófono a un WAV mono 16 kHz (formato óptimo para Whisper)
 * usando ffmpeg. El backend de captura depende de la plataforma
 * (dshow en Windows, avfoundation en macOS, pulse en Linux).
 */
export class Recorder {
  private stopped = false

  private constructor(
    private readonly child: ChildProcess,
    readonly directory: string,
    readonly wavPath: string,
  ) {}

  static async start(config: PluginConfig): Promise<Recorder> {
    const device =
      config.device ??
      (process.platform === "darwin" && config.deviceIndex !== undefined ? String(config.deviceIndex) : undefined) ??
      (await detectAudioDevice(config))

    const directory = await mkdtemp(join(tmpdir(), "whisper-dictation-"))
    const wavPath = join(directory, "recording.wav")

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      ...inputArguments(device),
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-y",
      wavPath,
    ]

    const child = spawn(config.ffmpegPath, args, {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    })

    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    // ffmpeg no avisa cuando la captura está lista; esperamos un instante y
    // fallamos rápido si el dispositivo no existe.
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        action()
      }
      child.once("error", (error) => settle(() => reject(new Error(`No se pudo iniciar ffmpeg: ${error.message}`))))
      child.once("exit", (code) => {
        settle(() => reject(new Error(stderr.trim() || `ffmpeg terminó con código ${code}.`)))
      })
      setTimeout(() => settle(() => resolve()), 500)
    })

    return new Recorder(child, directory, wavPath)
  }

  /** Detiene la captura finalizando correctamente la cabecera del WAV. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true

    if (this.child.exitCode !== null || this.child.signalCode !== null) return

    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      this.child.once("close", finish)
      // "q" hace que ffmpeg finalice el archivo; si no responde lo matamos.
      try {
        this.child.stdin?.write("q")
      } catch {
        // ignorado: el proceso pudo haber terminado
      }
      setTimeout(() => {
        try {
          this.child.kill()
        } catch {
          // ignorado
        }
        finish()
      }, 5_000)
    })
  }

  /** Borra el directorio temporal con la grabación. */
  async cleanup(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true }).catch(() => {})
  }
}
