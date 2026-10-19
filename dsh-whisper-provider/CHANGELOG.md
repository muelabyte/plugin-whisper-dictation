# Changelog

## 0.2.0 — 2026-10-18

- La mitad cliente incluye su propia UI de voz (adaptación MIT de
  `@deepseek-ai/dsh-experimental-client-ui-voice-input`, fijada a DSH
  0.2.1-rc.2): inserta la transcripción en el **cursor actual** al terminar, así
  que escribir o mover el cursor durante el dictado ya no muestra el aviso
  *"Your draft changed"*.
- El motor se aprovisiona en `%LOCALAPPDATA%\dsh-whisper` (Windows), con `uv`
  **0.13.1** fijado, Python 3.11 gestionado y `faster-whisper==1.2.1`.
- Preparación visible y cancelable en la UI; `transcribe` nunca descarga.
- Se devuelve el objeto estricto `Transcript` (`text`, `audioSeconds`,
  `inferenceSeconds`).
- Las claves de configuración del bundle apuntan a `dsh-whisper-provider`; ya no
  se inserta la fila oficial `ui-voice-input`.

## 0.1.1 — 2026-10-18

- Corregido el contrato de `transcribe`: devolvía un string y la UI fallaba con
  `Cannot read properties of undefined (reading 'replace')`.

## 0.1.0 — 2026-10-18

- Primera versión: proveedor `whisper-local` para `ctx.speechToText`, puente al
  sidecar de faster-whisper y preparación del motor.
