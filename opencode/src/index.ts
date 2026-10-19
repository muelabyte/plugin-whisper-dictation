import { Plugin } from "@opencode/plugin"

/**
 * Entrada estándar del plugin (lado servidor).
 *
 * La funcionalidad de dictado vive en el entrypoint de TUI (`./tui`), pero se
 * declara este plugin para que OpenCode reconozca el paquete y cargue el
 * componente de terminal asociado.
 */
export default Plugin.define({
  id: "whisper-dictation",
  setup() {
    // Sin comportamiento en el servidor: toda la lógica es de interfaz.
  },
})
