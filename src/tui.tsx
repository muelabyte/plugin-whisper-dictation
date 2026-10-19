import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { writeClipboard } from "./clipboard"
import { resolveConfig } from "./config"
import { createDictation, type DictationState } from "./dictation"

/**
 * Adaptador de OpenCode para el núcleo de dictado (`./dictation`).
 *
 * Aquí vive solo lo específico del host: el botón de la barra de entrada, el
 * atajo/paleta, los toasts y la inserción del texto en el prompt (portapapeles
 * + comando interno `prompt.paste`, el único puente que expone el API de
 * plugins). Grabar, transcribir y la máquina de estados son del núcleo.
 */
export default Plugin.define({
  id: "whisper-dictation.tui",
  async setup(context) {
    const [state, setState] = createSignal<DictationState>("idle")
    const [pulse, setPulse] = createSignal(false)
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

    const dictation = await createDictation(context.options, {
      onStateChange: (next) => {
        setState(next)
        if (next === "recording") startPulse()
        else stopPulse()
      },
    })

    const runToggle = async () => {
      try {
        const outcome = await dictation.toggle()
        if (outcome.status === "empty") {
          context.ui.toast.show({ title: "Dictado", message: "No se detectó voz.", variant: "warning" })
        } else if (outcome.status === "transcribed") {
          await writeClipboard(outcome.text)
          context.keymap.dispatch("prompt.paste")
          context.ui.toast.show({ title: "Dictado", message: "Texto insertado en el chat.", variant: "success" })
        }
      } catch (cause) {
        fail(cause)
      }
    }

    // --- Preparar el motor en segundo plano (descarga única la 1.ª vez) ---
    void dictation
      .prepare((message) =>
        context.ui.toast.show({ title: "Dictado: preparando motor", message, variant: "info", duration: 6_000 }),
      )
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        context.ui.toast.show({ title: "Dictado: motor", message, variant: "error", duration: 12_000 })
      })

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
            <text fg={color} onMouseUp={() => void runToggle()}>
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
          bind: resolveConfig(context.options).keybind,
          palette: true,
          slash: { name: "dictar" },
          run: () => void runToggle(),
        },
      ],
      bindings: ["whisper-dictation.toggle"],
    }))

    return () => {
      stopPulse()
      return dictation.dispose()
    }
  },
})
