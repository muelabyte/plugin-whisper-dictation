import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { DEFAULTS, apply, buildTranscript, createWhisperProvider } from "../lib/index.js"
import { createEngine, dataDirectory } from "../lib/engine.js"

const here = dirname(fileURLToPath(import.meta.url))
const bundle = dirname(here)
const missingData = join(bundle, ".test-data-never-created")

test("expone el contrato de plugin y el idioma por defecto", () => {
  assert.equal(typeof apply, "function")
  assert.ok(DEFAULTS.languages.includes("es"))
})

test("registra el proveedor y el cleanup lo retira", async () => {
  let registered
  let cleanup
  let unregistered = false

  const ctx = {
    speechToText: {
      register(provider) {
        registered = provider
        return async () => {
          unregistered = true
        }
      },
    },
    effect(fn) {
      cleanup = fn()
    },
    logger: { warn() {}, info() {} },
  }

  apply(ctx, { dataDir: missingData, serviceUrl: "http://127.0.0.1:59999" })

  assert.equal(registered.info.id, "whisper-local")
  assert.equal(registered.info.location, "host-local")
  assert.ok(registered.info.languages.includes("es"))
  assert.equal(typeof registered.transcribe, "function")
  assert.equal(typeof registered.preparation.prepare, "function")
  assert.equal(typeof registered.preparation.cancel, "function")
  assert.equal(typeof registered.preparation.snapshot, "function")

  await cleanup()
  assert.equal(unregistered, true)
})

test("la preparación arranca sin preparar y notifica a los suscriptores", async () => {
  const engine = createEngine({ dataDir: missingData, serviceUrl: "http://127.0.0.1:59999" })
  assert.equal(engine.preparation.snapshot().phase, "unprepared")

  let calls = 0
  const off = engine.preparation.subscribe(() => {
    calls += 1
  })
  await engine.inspect()
  off()
  assert.ok(calls >= 1)
  assert.equal(engine.preparation.snapshot().phase, "unprepared")
})

test("dataDirectory respeta dataDir y no apunta al repositorio", () => {
  assert.equal(dataDirectory({ dataDir: "C:/tmp/whisper" }), "C:/tmp/whisper")
  const fallback = dataDirectory({})
  assert.ok(fallback.length > 0)
  assert.ok(!fallback.includes("proyecto-addtranscripcion"))
})

test("buildTranscript devuelve el objeto estricto que exige DSH", () => {
  const result = buildTranscript({ text: "hola" }, 16_000 * 2 + 44, 1.5)
  assert.deepEqual(result, { text: "hola", audioSeconds: 1, inferenceSeconds: 1.5 })
  assert.equal(typeof result.text, "string")
  assert.ok(result.audioSeconds >= 0)
  assert.ok(result.inferenceSeconds >= 0)

  const empty = buildTranscript({}, 44, 0)
  assert.equal(empty.text, "")
  assert.equal(empty.audioSeconds, 0)

  const clamped = buildTranscript({ text: "x" }, 10, -1)
  assert.equal(clamped.audioSeconds, 0)
  assert.equal(clamped.inferenceSeconds, 0)
})

test("transcribe rechaza una grabación vacía sin tocar el motor", async () => {
  const provider = createWhisperProvider({ dataDir: missingData })
  await assert.rejects(() => provider.registration.transcribe({ audio: Buffer.alloc(0) }), /vacía/)
  await provider.dispose()
})

test("el paquete incluye todo lo necesario en tiempo de ejecución", () => {
  for (const file of [
    "lib/index.js",
    "lib/engine.js",
    "engine/server.py",
    "engine/requirements.txt",
    "cordis.patch.yml",
    "icon.svg",
    "locale/es.json",
    "locale/en.json",
    "LICENSE",
  ]) {
    assert.ok(existsSync(join(bundle, file)), `falta ${file}`)
  }
})

test("engine/server.py no diverge del original del repositorio", async () => {
  const original = join(bundle, "..", "whisper", "server.py")
  if (!existsSync(original)) return // instalado como paquete: no aplica

  const digest = async (path) =>
    createHash("sha256").update(await readFile(path)).digest("hex")

  assert.equal(await digest(join(bundle, "engine", "server.py")), await digest(original))
})
