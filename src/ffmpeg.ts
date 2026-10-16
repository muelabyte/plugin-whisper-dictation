/**
 * Resolución del ejecutable de ffmpeg.
 *
 * Prioridad:
 *   1. La ruta configurada explícitamente en `ffmpegPath`.
 *   2. El binario incluido por la dependencia opcional `ffmpeg-static`
 *      (así el usuario no tiene que instalar ffmpeg a mano).
 *   3. `ffmpeg` del PATH.
 */

import { existsSync } from "node:fs"

export async function resolveFfmpegPath(configured: string): Promise<string> {
  if (configured && configured !== "auto") return configured

  try {
    const module = (await import("ffmpeg-static")) as { default?: unknown }
    const path = module.default
    if (typeof path === "string" && existsSync(path)) return path
  } catch {
    // ffmpeg-static no está instalado o no tiene binario para esta plataforma.
  }

  return "ffmpeg"
}
