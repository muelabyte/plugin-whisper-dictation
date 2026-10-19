import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

function run(file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args as string[], { windowsHide: true }, (error) => (error ? reject(error) : resolve()))
  })
}

/**
 * Copia texto al portapapeles del sistema operativo.
 *
 * OpenCode lee el portapapeles nativo en su comando integrado `prompt.paste`,
 * por lo que este es el puente que permite "escribir" la transcripción dentro
 * de la caja de entrada del chat sin una API de inserción directa.
 */
export async function writeClipboard(value: string): Promise<void> {
  const file = join(tmpdir(), `whisper-dictation-clip-${randomUUID()}.txt`)
  await writeFile(file, value, "utf8")

  try {
    if (process.platform === "win32") {
      // -Encoding UTF8 preserva tildes y la ñ del español.
      await run("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-Content -Raw -Encoding UTF8 -LiteralPath '${file}' | Set-Clipboard`,
      ])
      return
    }

    if (process.platform === "darwin") {
      await run("sh", ["-c", `pbcopy < '${file}'`])
      return
    }

    await run("sh", [
      "-c",
      `if command -v wl-copy >/dev/null 2>&1; then wl-copy < '${file}'; ` +
        `elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard < '${file}'; ` +
        `elif command -v xsel >/dev/null 2>&1; then xsel --clipboard --input < '${file}'; ` +
        `else echo "no clipboard tool (wl-copy/xclip/xsel)" >&2; exit 1; fi`,
    ])
  } finally {
    await rm(file, { force: true }).catch(() => {})
  }
}
