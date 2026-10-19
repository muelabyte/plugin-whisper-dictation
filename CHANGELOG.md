# Changelog

## 0.2.0 — 2026-10-18

Primera versión pública del plugin de OpenCode.

### Añadido

- Núcleo de dictado reutilizable (`src/dictation.ts`) sin dependencias de
  OpenCode; `src/tui.tsx` queda como adaptador de la TUI.
- Export `./dictation` para usar el motor desde otros hosts.
- CI de GitHub Actions (typecheck en Ubuntu/Windows con Node 20 y 22, pruebas
  del paquete de DSH y comprobación de `npm pack`).
- Scripts `typecheck` y `pack:check`.
- Integración con DeepSeek Harness como paquete npm independiente
  (`dsh-whisper-provider/`).

### Corregido

- La auto-instalación del motor fallaba al descargar `uv`: faltaba importar
  `createWriteStream`.
- `process.arch === "aarch64"` era código muerto; en ARM se elige bien el
  binario.
- El `LICENSE` tenía un copyright de relleno.
- La auto-instalación se validó de extremo a extremo: `uv` → Python 3.11 →
  `faster-whisper` → sidecar → `/health` (24 s con el modelo `tiny`).

### Notas

- Probado en Windows 11 con OpenCode 2.0.32.
- macOS/Linux: captura `avfoundation`/`pulse` sin probar.
