/**
 * Configuración del plugin de dictado por voz.
 *
 * Todas las opciones se pasan desde `opencode.json(c)` en la forma:
 *
 *   { "package": "<nombre o ruta del plugin>", "options": { ...PluginOptions } }
 *
 * Si una opción no se indica se usa un valor por defecto sensato para
 * Windows + CPU (Whisper medium en INT8 mediante faster-whisper).
 */

export type WhisperBackend = "faster-whisper" | "whisper.cpp"

export interface PluginConfig {
  /** Motor de transcripción. */
  readonly backend: WhisperBackend
  /** URL base del sidecar HTTP de faster-whisper. */
  readonly serviceUrl: string
  /** Comando opcional para arrancar el sidecar manualmente (tiene prioridad sobre el auto-setup). */
  readonly serviceCommand: readonly string[]
  /** Tiempo máximo de espera a que el sidecar esté listo (ms). */
  readonly healthTimeoutMs: number
  /** Tiempo máximo de una transcripción (ms). */
  readonly transcribeTimeoutMs: number
  /** Ejecutable de ffmpeg (captura de micrófono). "auto" usa ffmpeg-static o el del PATH. */
  readonly ffmpegPath: string
  /** Nombre exacto del dispositivo de entrada. Si se omite se autodetecta. */
  readonly device: string | undefined
  /** Índice del dispositivo de entrada en macOS (avfoundation). */
  readonly deviceIndex: number | undefined
  /** Idioma de la transcripción (ISO-639-1). */
  readonly language: string
  /** Nombre del modelo Whisper. */
  readonly model: string
  /** Tipo de cuantización de CTranslate2 (int8 = más rápido y liviano). */
  readonly computeType: string
  /** Ejecutable de whisper.cpp (backend alternativo). */
  readonly whisperCppPath: string
  /** Ruta al archivo GGUF de whisper.cpp (backend alternativo). */
  readonly whisperCppModel: string
  /** Atajo de teclado para iniciar/detener la grabación. */
  readonly keybind: string
  /** Instala automáticamente el motor (uv + Python + faster-whisper) la primera vez. */
  readonly autoInstall: boolean
  /** Directorio de datos del motor (venv, modelos, binarios). */
  readonly dataDir: string | undefined
  /** Versión de Python que gestiona `uv`. */
  readonly pythonVersion: string
  /** Ruta a un binario `uv` ya instalado (si se omite se descarga uno). */
  readonly uvPath: string | undefined
  /** Precalienta el motor al cargar el plugin. */
  readonly warmup: boolean
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function command(value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value as string[]
  if (typeof value === "string" && value.trim().length > 0) return value.trim().split(/\s+/)
  return []
}

export function resolveConfig(options: Readonly<Record<string, any>> = {}): PluginConfig {
  return {
    backend: options.backend === "whisper.cpp" ? "whisper.cpp" : "faster-whisper",
    serviceUrl: text(options.serviceUrl, "http://127.0.0.1:8756").replace(/\/+$/, ""),
    serviceCommand: command(options.serviceCommand),
    healthTimeoutMs: number(options.healthTimeoutMs, 900_000),
    transcribeTimeoutMs: number(options.transcribeTimeoutMs, 180_000),
    ffmpegPath: text(options.ffmpegPath, "auto"),
    device: optionalText(options.device),
    deviceIndex: typeof options.deviceIndex === "number" ? options.deviceIndex : undefined,
    language: text(options.language, "es"),
    model: text(options.model, "medium"),
    computeType: text(options.computeType, "int8"),
    whisperCppPath: text(options.whisperCppPath, "whisper-cli"),
    whisperCppModel: text(options.whisperCppModel, ""),
    keybind: text(options.keybind, "ctrl+alt+v"),
    autoInstall: bool(options.autoInstall, true),
    dataDir: optionalText(options.dataDir),
    pythonVersion: text(options.pythonVersion, "3.11"),
    uvPath: optionalText(options.uvPath),
    warmup: bool(options.warmup, true),
  }
}
