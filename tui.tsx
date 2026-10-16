/**
 * Entrypoint de TUI para plugins locales en directorio.
 *
 * OpenCode resuelve la entrada de TUI buscando `<dir>/tui.*`. Este shim
 * reexporta la implementación real de `src/tui.tsx`.
 */
export { default } from "./src/tui.tsx"
