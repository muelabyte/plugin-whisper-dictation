import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import type { PluginConfig } from "./config"
import { ensureService } from "./engine"

async function viaService(wavPath: string, config: PluginConfig): Promise<string> {
  await ensureService(config)

  const response = await fetch(`${config.serviceUrl}/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: wavPath, language: config.language, model: config.model }),
    signal: AbortSignal.timeout(config.transcribeTimeoutMs),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Whisper respondió ${response.status}: ${detail}`)
  }

  const payload = (await response.json()) as { text?: string; error?: string }
  if (payload.error) throw new Error(payload.error)
  return payload.text ?? ""
}

async function viaWhisperCpp(wavPath: string, config: PluginConfig): Promise<string> {
  if (!config.whisperCppModel) {
    throw new Error("Backend whisper.cpp: define 'whisperCppModel' con la ruta al archivo GGUF.")
  }

  const outputPrefix = wavPath.replace(/\.wav$/i, "")

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      config.whisperCppPath,
      [
        "-m",
        config.whisperCppModel,
        "-f",
        wavPath,
        "-l",
        config.language,
        "-nt",
        "-otxt",
        "-of",
        outputPrefix,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    )
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once("error", (error) => reject(new Error(`No se pudo ejecutar whisper.cpp: ${error.message}`)))
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `whisper.cpp terminó con código ${code}.`)),
    )
  })

  return (await readFile(`${outputPrefix}.txt`, "utf8")).trim()
}

/** Transcribe un WAV local con el backend configurado. */
export async function transcribe(wavPath: string, config: PluginConfig): Promise<string> {
  return config.backend === "whisper.cpp"
    ? viaWhisperCpp(wavPath, config)
    : viaService(wavPath, config)
}
