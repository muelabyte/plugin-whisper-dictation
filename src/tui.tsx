import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { writeClipboard } from "./clipboard"
import { resolveConfig, type PluginConfig } from "./config"
import { ensureService } from "./engine"
import { resolveFfmpegPath } from "./ffmpeg"
import { Recorder } from "./recorder"
import { transcribe } from "./transcribe"

type DictationState = "idle" | "recording" | "transcribing"

/**
 * Plugin de TUI: agrega un botón de micrófono en la barra de entrada del chat,
 * graba el micrófono, transcribe con Whisper local y vuelca el texto en la caja
 * de entrada.
 *
 * La inserción se hace copiando la transcripción al portapapeles y disparando
 * el comando integrado `prompt.paste` (OpenCode lee el portapapeles del sistema
 * e inserta el texto en el prompt). Es el puente soportado, ya que el API
 * público de plugins no expone una escritura directa sobre el input.
 */
export default Plugin.define({
  id: "whisper-dictation.tui",
  async setup(context) {
    const base = resolveConfig(context.options)
    const config: PluginConfig = { ...base, ffmpegPath: await resolveFfmpegPath(base.ffmpegPath) }

    const [state, setState] = createSignal<DictationState>("idle")
    const [pulse, setPulse] = createSignal(false)
    let recorder: Recorder | undefined
    let pulseTimer: ReturnType<typeof setInterval> | undefined

    const startPulse = () => {
      if (pulseTimer) return
      pulseTimer = setInterval(() => setPulse((value) => !value), 600)
    }

    const stopPulse = () => {
      if (pulseTimer) {
        clearInterval(pulseTimer)
        pulseTimer = undefined
      }
      setPulse(false)
    }

    const fail = (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      context.ui.toast.show({ title: "Dictado", message, variant: "error", duration: 8_000 })
    }

    const start = async () => {
      if (state() !== "idle") return
      try {
        recorder = await Recorder.start(config)
        setState("recording")
        startPulse()
      } catch (cause) {
        recorder = undefined
        fail(cause)
      }
    }

    const stop = async () => {
      const active = recorder
      if (!active) return
      recorder = undefined
      stopPulse()
      setState("transcribing")
      try {
        await active.stop()
        const transcript = (await transcribe(active.wavPath, config)).trim()
        if (!transcript) {
          context.ui.toast.show({ title: "Dictado", message: "No se detectó voz.", variant: "warning" })
        } else {
          await writeClipboard(transcript)
          context.keymap.dispatch("prompt.paste")
          context.ui.toast.show({ title: "Dictado", message: "Texto insertado en el chat.", variant: "success" })
        }
      } catch (cause) {
        fail(cause)
      } finally {
        await active.cleanup()
        setState("idle")
      }
    }

    const toggle = () => {
      if (state() === "recording") void stop()
      else if (state() === "idle") void start()
    }

    // --- Preparar el motor en segundo plano (descarga única la 1.ª vez) ---
    if (config.warmup && config.backend === "faster-whisper" && (config.autoInstall || config.serviceCommand.length > 0)) {
      void ensureService(config, (message) =>
        context.ui.toast.show({ title: "Dictado: preparando motor", message, variant: "info", duration: 6_000 }),
      ).catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        context.ui.toast.show({ title: "Dictado: motor", message, variant: "error", duration: 12_000 })
      })
    }

    // --- Interfaz: botón de micrófono en la barra de entrada ---
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const plugin = usePlugin()
        const current = state()
        const recording = current === "recording"
        const color = recording
          ? pulse()
            ? "#ff4d4d"
            : "#ffb3b3"
          : current === "transcribing"
            ? plugin.theme.text.muted
            : plugin.theme.text.base

        // Etiqueta con texto ASCII además del emoji: muchas terminales/fuentes
        // no renderizan 🎤 y el botón quedaría invisible.
        const label = recording ? "● REC" : current === "transcribing" ? "… dictando" : "🎤 mic"

        return (
          <box flexShrink={0}>
            <text fg={color} onMouseUp={toggle}>
              {label}
            </text>
          </box>
        )
      },
    })

    // --- Atajo de teclado + comando de paleta/slash ---
    context.keymap.layer(() => ({
      mode: "global",
      priority: 20,
      commands: [
        {
          id: "whisper-dictation.toggle",
          title: "Dictado por voz (Whisper)",
          description: "Iniciar o detener la grabación y transcribir con Whisper local",
          group: "Dictado",
          bind: config.keybind,
          palette: true,
          slash: { name: "dictar" },
          run: () => toggle(),
        },
      ],
      bindings: ["whisper-dictation.toggle"],
    }))

    return () => {
      stopPulse()
      const active = recorder
      recorder = undefined
      if (active) void active.stop().then(() => active.cleanup())
    }
  },
})
