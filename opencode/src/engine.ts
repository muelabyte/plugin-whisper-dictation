/**
 * Aprovisionamiento automático del motor de transcripción.
 *
 * Para que instalar el plugin sea UNA sola línea (`opencode plugin add ...`),
 * el plugin no asume que el usuario tenga Python ni faster-whisper. La primera
 * vez que se usa, este módulo:
 *
 *   1. descarga `uv` (un único binario, portable) en el directorio de datos,
 *   2. crea un entorno Python gestionado (`uv venv --python 3.11`),
 *   3. instala `faster-whisper` (CT2 + INT8),
 *   4. arranca `whisper/server.py` como sidecar y espera a que esté sano.
 *
 * El modelo (`medium`, ~1.5 GB) lo descarga faster-whisper en el primer uso.
 * Todo queda cacheado en el directorio de datos, así que solo ocurre una vez.
 *
 * Si el usuario configura `serviceCommand`, se respeta y no se aprovisiona nada.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, createWriteStream, existsSync, openSync } from "node:fs"
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import type { PluginConfig } from "./config"

const isWindows = process.platform === "win32"
const withExe = (name: string) => (isWindows ? `${name}.exe` : name)

export type LogFn = (message: string) => void

/** Raíz del paquete del plugin (`<root>/src/engine.ts` → `<root>`). */
function packageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/**
 * Localiza un archivo del paquete aunque OpenCode reubique el módulo.
 * Sube por el árbol desde la ubicación del propio archivo hasta encontrarlo.
 */
function locate(relative: string): string {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(directory, relative)
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return join(packageRoot(), relative)
}

/** Directorio de datos donde vive el motor (venv, modelos, binarios). */
export function dataDirectory(config: PluginConfig): string {
  if (config.dataDir) return config.dataDir
  if (isWindows) {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    return join(base, "opencode-whisper-dictation")
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "opencode-whisper-dictation")
  }
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(base, "opencode-whisper-dictation")
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function run(
  file: string,
  args: readonly string[],
  options: { timeout?: number } = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args as string[],
      { windowsHide: true, maxBuffer: 1 << 26, timeout: options.timeout ?? 5 * 60_000 },
      (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: `${stdout}${stderr}` }),
    )
  })
}

/** Comprueba si el sidecar está escuchando y con el modelo cargado. */
export async function serviceHealthy(serviceUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(1_500) })
    if (!response.ok) return false
    const body = (await response.json().catch(() => undefined)) as { status?: string } | undefined
    return !body || body.status === "ok"
  } catch {
    return false
  }
}

// --- Descarga y descompresión -----------------------------------------------

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok || !response.body) throw new Error(`Descarga fallida (HTTP ${response.status}): ${url}`)
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination))
}

async function extractArchive(archive: string, destination: string, kind: "zip" | "tar.gz"): Promise<void> {
  const result =
    kind === "zip"
      ? await run("powershell", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destination}' -Force`,
        ])
      : await run("tar", ["-xzf", archive, "-C", destination])
  if (result.code !== 0) throw new Error(`No se pudo descomprimir '${archive}': ${result.output}`)
}

async function findFile(directory: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = await findFile(full, name)
      if (found) return found
    }
  }
  return undefined
}

function uvAsset(): { url: string; kind: "zip" | "tar.gz"; member: string } {
  // Node reporta "arm64" (nunca "aarch64"). Comparar con "aarch64" era código muerto.
  const arm = process.arch === "arm64"
  const release = "https://github.com/astral-sh/uv/releases/latest/download"
  if (isWindows) {
    const target = arm ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
    return { url: `${release}/uv-${target}.zip`, kind: "zip", member: withExe("uv") }
  }
  if (process.platform === "darwin") {
    const target = arm ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
    return { url: `${release}/uv-${target}.tar.gz`, kind: "tar.gz", member: "uv" }
  }
  const target = arm ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  return { url: `${release}/uv-${target}.tar.gz`, kind: "tar.gz", member: "uv" }
}

async function ensureUv(config: PluginConfig, log: LogFn): Promise<string> {
  if (config.uvPath) return config.uvPath

  const binary = join(dataDirectory(config), "bin", withExe("uv"))
  if (await exists(binary)) return binary

  await mkdir(dirname(binary), { recursive: true })
  const asset = uvAsset()
  const staging = await mkdtemp(join(tmpdir(), "whisper-uv-"))
  const archive = join(staging, asset.kind === "zip" ? "uv.zip" : "uv.tar.gz")

  log("Preparando el motor (descargando uv)…")
  await download(asset.url, archive)
  await extractArchive(archive, staging, asset.kind)

  const found = await findFile(staging, asset.member)
  if (!found) throw new Error("No se encontró el binario 'uv' tras descomprimir el archivo.")
  await copyFile(found, binary)
  if (!isWindows) await chmod(binary, 0o755)
  await rm(staging, { recursive: true, force: true }).catch(() => {})
  return binary
}

async function ensureVenv(config: PluginConfig, uv: string, log: LogFn): Promise<string> {
  const venv = join(dataDirectory(config), "venv")
  const python = isWindows ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python")
  if (await exists(python)) return python

  log(`Creando el entorno Python ${config.pythonVersion}…`)
  const result = await run(uv, ["venv", venv, "--python", config.pythonVersion], { timeout: 15 * 60_000 })
  if (result.code !== 0 || !(await exists(python))) {
    throw new Error(`No se pudo crear el entorno Python:\n${result.output.slice(-2_000)}`)
  }
  return python
}

async function ensureDependencies(config: PluginConfig, uv: string, python: string, log: LogFn): Promise<void> {
  const requirements = locate("whisper/requirements.txt")
  const content = await readFile(requirements, "utf8")
  const hash = createHash("sha256").update(content).update(config.pythonVersion).digest("hex")
  const marker = join(dataDirectory(config), "requirements.sha256")

  if ((await exists(marker)) && (await readFile(marker, "utf8")).trim() === hash) return

  log("Instalando faster-whisper (una sola vez, ~200 MB)…")
  const result = await run(uv, ["pip", "install", "--python", python, "-r", requirements], {
    timeout: 45 * 60_000,
  })
  if (result.code !== 0) throw new Error(`No se pudieron instalar las dependencias:\n${result.output.slice(-2_000)}`)
  await writeFile(marker, hash)
}

// --- Arranque del sidecar ----------------------------------------------------

let serviceChild: ChildProcess | undefined

async function startManagedService(config: PluginConfig, python: string, log: LogFn): Promise<void> {
  const server = locate("whisper/server.py")
  const url = new URL(config.serviceUrl)
  const logPath = join(dataDirectory(config), "whisper-server.log")

  const args = [
    server,
    "--host",
    url.hostname || "127.0.0.1",
    "--port",
    url.port || "8756",
    "--model",
    config.model,
    "--compute-type",
    config.computeType,
    "--language",
    config.language,
    "--cache-dir",
    join(dataDirectory(config), "models"),
  ]

  log("Iniciando el motor de transcripción…")
  // Redirigimos la salida del sidecar a un archivo de log para poder
  // diagnosticar fallos. `spawn` necesita un descriptor de archivo real.
  const logFd = openSync(logPath, "a")
  let child: ChildProcess
  try {
    child = spawn(python, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    })
  } finally {
    closeSync(logFd)
  }
  child.unref()
  serviceChild = child
  child.once("exit", () => {
    if (serviceChild === child) serviceChild = undefined
  })
}

async function tailLog(config: PluginConfig, maxChars = 1_500): Promise<string> {
  try {
    const content = await readFile(join(dataDirectory(config), "whisper-server.log"), "utf8")
    return content.slice(-maxChars).trim()
  } catch {
    return ""
  }
}

async function waitForHealth(config: PluginConfig): Promise<void> {
  const deadline = Date.now() + config.healthTimeoutMs
  while (Date.now() < deadline) {
    if (await serviceHealthy(config.serviceUrl)) return
    await delay(500)
  }
  const log = await tailLog(config)
  throw new Error(
    `El motor Whisper no respondió en ${Math.round(config.healthTimeoutMs / 1000)}s.` +
      (log ? `\n\nÚltimas líneas del motor:\n${log}` : ""),
  )
}

// --- API pública -------------------------------------------------------------

let ensuring: Promise<void> | undefined

async function provision(config: PluginConfig, log: LogFn): Promise<void> {
  // 1) Comando manual: el usuario manda.
  if (config.serviceCommand.length > 0) {
    const [command, ...args] = config.serviceCommand
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
    child.unref()
    return
  }

  // 2) Backend whisper.cpp: no hay sidecar que arrancar.
  if (config.backend === "whisper.cpp") return

  if (!config.autoInstall) {
    throw new Error(
      "El motor Whisper no está instalado y 'autoInstall' está desactivado. " +
        "Actívalo, define 'serviceCommand', o instálalo a mano con scripts/install-whisper.ps1.",
    )
  }

  await mkdir(dataDirectory(config), { recursive: true })
  const uv = await ensureUv(config, log)
  const python = await ensureVenv(config, uv, log)
  await ensureDependencies(config, uv, python, log)
  await startManagedService(config, python, log)
}

/**
 * Garantiza que el sidecar de faster-whisper esté operativo.
 *
 * Idempotente y seguro ante llamadas concurrentes: todas comparten la misma
 * promesa (aprovisionar + esperar salud), de modo que nunca se arrancan dos
 * sidecars. `log` recibe mensajes de progreso (p. ej. para mostrarlos como toasts).
 */
export async function ensureService(config: PluginConfig, log: LogFn = () => {}): Promise<void> {
  if (await serviceHealthy(config.serviceUrl)) return

  if (!ensuring) {
    ensuring = (async () => {
      await provision(config, log)
      await waitForHealth(config)
    })().finally(() => {
      ensuring = undefined
    })
  }

  await ensuring
}

/** Detiene el sidecar arrancado por este plugin (no afecta a uno externo). */
export function stopService(): void {
  if (serviceChild) {
    try {
      serviceChild.kill()
    } catch {
      // ignorado
    }
    serviceChild = undefined
  }
}
