/**
 * Aprovisionamiento del motor Whisper para DeepSeek Harness.
 *
 * Todo vive fuera del repositorio, en un directorio de datos del usuario
 * (`%LOCALAPPDATA%\dsh-whisper` en Windows). El paquete npm es autosuficiente:
 * trae `engine/server.py` y `engine/requirements.txt`, así que instalar por
 * nombre no depende de ninguna carpeta del proyecto.
 *
 * Flujo: uv (versión fijada) → venv con Python gestionado → faster-whisper
 * → sidecar HTTP → `/health`. La UI de DSH muestra el progreso mediante el
 * contrato `preparation` (`snapshot`, `subscribe`, `prepare`, `cancel`).
 */

import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const isWindows = process.platform === "win32"
const withExe = (name) => (isWindows ? `${name}.exe` : name)

/** Versión de uv probada y fijada (no "latest"). */
const UV_VERSION = "0.13.1"

/** Raíz del paquete: `lib/engine.js` → `lib` → `<bundle>`. */
export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export const ENGINE_DEFAULTS = {
  serviceUrl: "http://127.0.0.1:8756",
  dataDir: undefined,
  pythonVersion: "3.11",
  model: "medium",
  computeType: "int8",
  language: "es",
  healthTimeoutMs: 900_000,
}

export function dataDirectory(config = {}) {
  if (config.dataDir) return config.dataDir
  if (isWindows) {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "dsh-whisper")
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "dsh-whisper")
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "dsh-whisper")
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function run(file, args, { signal, timeout } = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 1 << 26, timeout: timeout ?? 45 * 60_000, signal },
      (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: `${stdout}${stderr}` }),
    )
  })
}

function uvAsset() {
  const arm = process.arch === "arm64"
  const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`
  if (isWindows) {
    const target = arm ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
    return { url: `${base}/uv-${target}.zip`, kind: "zip", member: "uv.exe" }
  }
  if (process.platform === "darwin") {
    const target = arm ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
    return { url: `${base}/uv-${target}.tar.gz`, kind: "tar.gz", member: "uv" }
  }
  const target = arm ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  return { url: `${base}/uv-${target}.tar.gz`, kind: "tar.gz", member: "uv" }
}

async function findFile(directory, name) {
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

async function extractArchive(archive, destination, kind) {
  const result =
    kind === "zip"
      ? isWindows
        ? await run("powershell", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destination}' -Force`,
          ])
        : await run("unzip", ["-o", archive, "-d", destination])
      : await run("tar", ["-xzf", archive, "-C", destination])
  if (result.code !== 0) throw new Error(`No se pudo descomprimir '${archive}': ${result.output.slice(-800)}`)
}

/**
 * Crea el motor y su contrato de preparación.
 *
 * @param {Partial<typeof ENGINE_DEFAULTS>} overrides
 * @param {{ log?: (message: string) => void }} [hooks]
 */
export function createEngine(overrides = {}, hooks = {}) {
  const config = { ...ENGINE_DEFAULTS, ...overrides }
  const log = hooks.log ?? (() => {})
  const dataDir = dataDirectory(config)
  const baseUrl = String(config.serviceUrl).replace(/\/+$/, "")
  const url = new URL(baseUrl)
  const host = url.hostname || "127.0.0.1"
  const port = url.port || "8756"

  const listeners = new Set()
  const stepState = { check: "pending", model: "pending" }

  let state = { phase: "unprepared", steps: steps() }
  let preparing
  let starting
  let controller
  let child
  let cancelled = false
  let spawnError
  let exited = false

  function steps() {
    return Object.entries(stepState).map(([kind, status]) => ({ kind, status }))
  }

  function publish(next) {
    state = next
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // un observador roto no debe tumbar la preparación
      }
    }
  }

  function phase(next, extra = {}) {
    publish({ ...next, steps: steps(), ...extra })
  }

  function setStep(kind, status) {
    stepState[kind] = status
  }

  const venvPython = () => join(dataDir, "venv", isWindows ? "Scripts/python.exe" : "bin/python")
  const uvBinary = () => join(dataDir, "bin", withExe("uv"))
  const marker = () => join(dataDir, "requirements.sha256")
  const logPath = () => join(dataDir, "whisper-server.log")
  const engineFile = () => join(packageRoot, "engine", "server.py")
  const requirementsFile = () => join(packageRoot, "engine", "requirements.txt")

  async function healthy() {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_500) })
      if (!response.ok) return false
      const body = await response.json().catch(() => undefined)
      return body?.status === "ok"
    } catch {
      return false
    }
  }

  async function requirementsHash() {
    const content = await readFile(requirementsFile(), "utf8")
    return createHash("sha256").update(content).update(config.pythonVersion).digest("hex")
  }

  async function installed() {
    try {
      if (!existsSync(venvPython()) || !existsSync(uvBinary()) || !existsSync(engineFile())) return false
      const expected = await requirementsHash()
      return (await readFile(marker(), "utf8")).trim() === expected
    } catch {
      return false
    }
  }

  /** Comprueba el estado sin descargar nada (al activar el bundle). */
  async function inspect() {
    if (preparing || state.phase === "ready") return
    // Un sidecar ya sano (p. ej. el de OpenCode) se reutiliza sin preparar nada.
    if (await healthy()) {
      publish({ phase: "ready", steps: steps() })
      return
    }
    if (!(await installed())) {
      publish({ phase: "unprepared", steps: steps() })
      return
    }
    publish({ phase: "standby", steps: steps() })
  }

  async function download(urlToGet, destination, signal) {
    const response = await fetch(urlToGet, { redirect: "follow", signal })
    if (!response.ok || !response.body) throw new Error(`Descarga fallida (HTTP ${response.status}): ${urlToGet}`)

    const total = Number(response.headers.get("content-length")) || undefined
    let completed = 0
    let last = 0
    const body = Readable.fromWeb(response.body)
    body.on("data", (chunk) => {
      completed += chunk.length
      const now = Date.now()
      if (now - last < 120) return
      last = now
      publish({
        phase: "downloading",
        resource: "uv",
        completedBytes: completed,
        ...(total === undefined ? {} : { totalBytes: total }),
        step: "check",
        steps: steps(),
      })
    })
    await pipeline(body, createWriteStream(destination))
  }

  async function ensureUv(signal) {
    const binary = uvBinary()
    if (existsSync(binary)) return binary

    await mkdir(dirname(binary), { recursive: true })
    const asset = uvAsset()
    const staging = await mkdtemp(join(tmpdir(), "dsh-whisper-uv-"))
    const archive = join(staging, asset.kind === "zip" ? "uv.zip" : "uv.tar.gz")
    try {
      log("Descargando uv…")
      await download(asset.url, archive, signal)
      await extractArchive(archive, staging, asset.kind)
      const found = await findFile(staging, asset.member)
      if (!found) throw new Error("No se encontró el binario 'uv' tras descomprimir.")
      await copyFile(found, binary)
      if (!isWindows) await chmod(binary, 0o755)
      return binary
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function ensureVenv(uv, signal) {
    const python = venvPython()
    if (existsSync(python)) return python
    log(`Creando el entorno Python ${config.pythonVersion}…`)
    const result = await run(uv, ["venv", join(dataDir, "venv"), "--python", config.pythonVersion], {
      signal,
      timeout: 15 * 60_000,
    })
    if (result.code !== 0 || !existsSync(python)) {
      throw new Error(`No se pudo crear el entorno Python:\n${result.output.slice(-2_000)}`)
    }
    return python
  }

  async function ensureDependencies(uv, python, signal) {
    const expected = await requirementsHash()
    if (existsSync(marker()) && (await readFile(marker(), "utf8")).trim() === expected) return

    log("Instalando faster-whisper (una sola vez, ~200 MB)…")
    const result = await run(uv, ["pip", "install", "--python", python, "-r", requirementsFile()], {
      signal,
      timeout: 45 * 60_000,
    })
    if (result.code !== 0) throw new Error(`No se pudieron instalar las dependencias:\n${result.output.slice(-2_000)}`)
    await writeFile(marker(), expected)
  }

  function startSidecar() {
    if (child) return
    mkdirSync(dataDir, { recursive: true })
    const logFd = openSync(logPath(), "a")
    try {
      exited = false
      spawnError = undefined
      child = spawn(
        venvPython(),
        [
          engineFile(),
          "--host",
          host,
          "--port",
          port,
          "--model",
          config.model,
          "--compute-type",
          config.computeType,
          "--language",
          config.language,
          "--cache-dir",
          join(dataDir, "models"),
        ],
        { detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true },
      )
    } finally {
      closeSync(logFd)
    }
    child.once("error", (error) => {
      spawnError = error
      child = undefined
      exited = true
    })
    child.once("exit", () => {
      child = undefined
      exited = true
    })
    child.unref()
  }

  function logTail(max = 1_500) {
    try {
      return readFileSync(logPath(), "utf8").slice(-max).trim()
    } catch {
      return ""
    }
  }

  async function waitForHealth(deadline) {
    while (Date.now() < deadline) {
      if (cancelled) throw Object.assign(new Error("Preparación cancelada"), { cancelled: true })
      if (spawnError) throw new Error(`No se pudo arrancar el motor: ${spawnError.message}`)
      if (await healthy()) return
      if (exited) {
        const tail = logTail()
        throw new Error("El motor terminó al arrancar." + (tail ? `\n\nÚltimas líneas:\n${tail}` : ""))
      }
      await sleep(500)
    }
    const tail = logTail()
    throw new Error(
      `El motor Whisper no respondió en ${Math.round(config.healthTimeoutMs / 1000)} s.` +
        (tail ? `\n\nÚltimas líneas del motor:\n${tail}` : ""),
    )
  }

  async function startAndWait() {
    if (await healthy()) return
    if (!starting) {
      starting = (async () => {
        startSidecar()
        await waitForHealth(Date.now() + config.healthTimeoutMs)
      })().finally(() => {
        starting = undefined
      })
    }
    return starting
  }

  async function runPrepare() {
    cancelled = false
    controller = new AbortController()
    const signal = controller.signal

    setStep("check", "running")
    setStep("model", "pending")
    phase({ phase: "checking", startedAt: Date.now(), step: "check" })

    const uv = await ensureUv(signal)
    const python = await ensureVenv(uv, signal)
    await ensureDependencies(uv, python, signal)
    setStep("check", "complete")

    setStep("model", "running")
    phase({ phase: "loading", startedAt: Date.now(), step: "model" })
    await startAndWait()
    setStep("model", "complete")

    phase({ phase: "ready" })
  }

  function prepare() {
    if (preparing) return
    preparing = runPrepare()
      .catch((error) => {
        if (cancelled || error?.cancelled || error?.name === "AbortError") {
          phase({ phase: "cancelled" })
          return
        }
        const running = stepState.check === "running" ? "check" : "model"
        setStep(running, "failed")
        phase({ phase: "failed", message: messageOf(error), step: running })
      })
      .finally(() => {
        preparing = undefined
        controller = undefined
      })
  }

  async function cancel() {
    cancelled = true
    controller?.abort(new Error("Preparación cancelada"))
    if (child) {
      try {
        child.kill()
      } catch {
        // ya terminó
      }
      child = undefined
    }
    phase({ phase: "cancelling", startedAt: Date.now() })
    await (preparing ?? Promise.resolve()).catch(() => {})
  }

  /** Para `transcribe`: exige preparación previa; nunca descarga dentro de la petición. */
  async function ensureReady() {
    if (await healthy()) return
    if (state.phase === "unprepared" || state.phase === "failed" || state.phase === "cancelled") {
      throw new Error(
        "El motor Whisper no está preparado. Abre los detalles del bundle y pulsa «Download and prepare».",
      )
    }
    if (preparing) {
      await preparing
      if (await healthy()) return
    }
    if (state.phase === "standby" || state.phase === "ready") {
      await startAndWait()
      return
    }
    throw new Error(`El motor Whisper no está disponible (estado: ${state.phase}).`)
  }

  async function dispose() {
    cancelled = true
    controller?.abort(new Error("Plugin desactivado"))
  }

  return {
    dataDir,
    packageRoot,
    preparation: {
      prepare,
      cancel,
      snapshot: () => state,
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
    inspect,
    ensureReady,
    healthy,
    dispose,
  }
}
