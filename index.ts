/**
 * Entrypoint de servidor para plugins locales en directorio.
 *
 * OpenCode resuelve la entrada de servidor de un plugin local en directorio
 * buscando `<dir>/server.*` o `<dir>/index.*` (no usa `package.json#exports`
 * para rutas locales). Este shim reexporta la implementación real de `src/`.
 */
export { default } from "./src/index.ts"
