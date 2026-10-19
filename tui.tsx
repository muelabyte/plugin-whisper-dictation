/**
 * Shim de TUI para registrar el repositorio como plugin local.
 * El paquete real vive en `opencode/`; este archivo solo mantiene compatibilidad
 * con un registro `file:///.../plugin-whisper-dictation` (raíz del repo).
 */
export { default } from "./opencode/src/tui.tsx"
