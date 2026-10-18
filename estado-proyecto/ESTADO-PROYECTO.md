# 📋 ESTADO DEL PROYECTO — opencode-whisper-dictation

> **Documento de traspaso para agentes de IA.**
> Léelo completo antes de tocar nada: contiene lo que ya se investigó, lo que se
> decidió, lo que está validado y lo que falta.
>
> 🔄 **REGLA DE MANTENIMIENTO:** actualiza este archivo en **cada cambio relevante**
> del proyecto (nuevo estado, decisión, bug resuelto o tarea pendiente). Añade una
> línea al final en *Historial de cambios*.

- **Última actualización:** 2026-10-18
- **Estado global:** 🟢 **Funcionando y empaquetado.** Solo falta **publicar** (GitHub + npm).
- **Plataforma probada:** Windows 11 + OpenCode v2 `2.0.31`

---

## 🟢 Tabla de estado rápida

| Área | Estado | Notas |
|---|---|---|
| Botón 🎤 en la TUI | ✅ Hecho | Probado por el usuario |
| Grabación (ffmpeg) | ✅ Hecho | `dshow` en Windows |
| Transcripción (Whisper local) | ✅ Hecho | `faster-whisper` medium INT8 |
| Inserción en el input | ✅ Hecho | portapapeles + `prompt.paste` |
| Auto-instalación del motor | ✅ Hecho | vía `uv`, prueba real superada |
| Multiplataforma (captura) | 🟡 Best-effort | macOS/Linux sin probar |
| Paquete npm | ✅ Listo | `npm publish --dry-run` OK |
| Repo git local | ✅ Hecho | 2 commits en `main` |
| Subir a GitHub | ⬜ **Pendiente** | requiere al usuario |
| Publicar en npm | ⬜ **Pendiente** | requiere al usuario |

---

## 🎯 1. Qué es este proyecto

Plugin de **OpenCode v2** que añade un **botón de micrófono** a la barra de
entrada de la TUI. Graba el micrófono, **transcribe localmente** con Whisper
`medium` cuantizado (INT8) y **vuelca el texto en la caja de entrada**.

- 🔒 100 % local (el audio no sale de la máquina).
- 🪶 CPU, sin GPU.
- 🚀 Instalación de **una línea** para el usuario final.

---

## 🏗️ 2. Arquitectura

```
┌──────────────── OpenCode TUI (proceso del plugin) ────────────────┐
│  slot "prompt.footer.status"  ─►  🎤 mic / ● REC / … dictando     │
│  keymap layer                 ─►  ctrl+alt+v · paleta · /dictar   │
│                                                                   │
│  toggle()                                                         │
│   ├─ start(): ffmpeg ─► WAV mono 16 kHz (temp)                    │
│   └─ stop():  transcribe() ─► POST /transcribe ─► sidecar         │
│               writeClipboard(texto)                               │
│               keymap.dispatch("prompt.paste")  ─► texto al input  │
└───────────────────────────────────────────────────────────────────┘
                            │ HTTP 127.0.0.1:8756
                            ▼
┌───────── whisper/server.py (sidecar, autoinstalado con uv) ───────┐
│  WhisperModel("medium", device="cpu", compute_type="int8")  ×1     │
│  GET /health   ·   POST /transcribe { path, language } → { text }  │
└───────────────────────────────────────────────────────────────────┘
```

**Backends soportados:** `faster-whisper` (defecto, sidecar) y `whisper.cpp` (GGUF, sin Python).

---

## 🧠 3. Decisiones clave (¡no volver a investigar!)

### 3.1 Inserción de texto: portapapeles + `prompt.paste`
El API público de plugins **no permite escribir en el composer**. Único puente
soportado: escribir la transcripción en el **portapapeles del OS** y disparar
`context.keymap.dispatch("prompt.paste")` (OpenCode lee el portapapeles y pega).
- Los textos largos se colapsan a `[Pasted ~N lines]` **salvo** que
  `cli.json` tenga `{"prompt":{"paste":"full"}}`.

### 3.2 Entrypoints (crítico)
- **Directorio local** (`"package": "file:///ruta"`): OpenCode **NO** usa
  `package.json#exports`. Usa `Host.resolve`, que prueba `<dir>/server.*` y luego
  **`<dir>/index.*`**; para la TUI, **`<dir>/tui.*`**. → De ahí los **shims raíz**
  `index.ts` y `tui.tsx`.
- **Paquete** (npm/Git): sí usa `exports` → `"."` y `"./tui"`.

### 3.3 Recarga de plugins
- Editar **archivos del plugin** → recarga en caliente (Watcher).
- Editar **config** (`opencode.jsonc`) → **NO** recarga; hace falta
  `opencode service restart` (⚠️ mata procesos hijos, incluido el sidecar).

### 3.4 Desktop vs TUI
**OpenCode Desktop es Electron + React**; **no** admite plugins de UI. El botón
solo existe en la **TUI de terminal**. No pierdas tiempo intentándolo en Desktop.

### 3.5 Emojis en la TUI
Muchas fuentes de terminal **no** dibujan 🎤 → el botón parece invisible. Por eso
la etiqueta incluye texto ASCII: `🎤 mic`.

### 3.6 Auto-instalación con `uv`
Para que la instalación sea de una línea, el plugin **no asume Python instalado**:
descarga `uv` (binario único), crea un Python gestionado, instala `faster-whisper`
y arranca el sidecar. Todo cacheado en el directorio de datos.

---

## 📁 4. Mapa de archivos

```
proyecto-addtranscripcion-deepseek/
├─ index.ts                     # shim SERVIDOR para registro local (reexporta src/index.ts)
├─ tui.tsx                      # shim TUI para registro local (reexporta src/tui.tsx)
├─ package.json                 # paquete npm (exports ".", "./tui"; files; publishConfig)
├─ LICENSE                      # MIT
├─ README.md                    # doc de cara al usuario (instalación 1 línea)
├─ tsconfig.json
├─ src/
│  ├─ index.ts                  # plugin lado servidor (id: whisper-dictation)
│  ├─ tui.tsx                   # 🎤 botón + keymap + flujo grabar/transcribir
│  ├─ config.ts                 # opciones + defaults
│  ├─ engine.ts                 # ⭐ auto-instalación y arranque del sidecar (uv)
│  ├─ ffmpeg.ts                 # resolución de ffmpeg (ffmpeg-static / PATH)
│  ├─ recorder.ts               # captura multiplataforma (dshow/avfoundation/pulse)
│  ├─ transcribe.ts             # cliente del sidecar / backend whisper.cpp
│  └─ clipboard.ts              # escritura al portapapeles multiplataforma
├─ whisper/
│  ├─ server.py                 # sidecar HTTP faster-whisper
│  └─ requirements.txt          # faster-whisper>=1.0.0
├─ scripts/                     # instalación/arranque MANUAL (fallback)
│  ├─ install-whisper.ps1
│  ├─ run-whisper.ps1
│  └─ list-audio-devices.ps1
├─ examples/                    # opencode.jsonc, cli.json, whisper-cpp.ps1
└─ estado-proyecto/
   └─ ESTADO-PROYECTO.md        # 👈 este documento
```

---

## ⚙️ 5. Opciones del plugin

| Opción | Defecto | Descripción |
|---|---|---|
| `backend` | `"faster-whisper"` | o `"whisper.cpp"` |
| `autoInstall` | `true` | Instala el motor (uv+Python+faster-whisper) la 1.ª vez |
| `dataDir` | `%LOCALAPPDATA%\opencode-whisper-dictation` (Win) | Caché del motor |
| `pythonVersion` | `"3.11"` | Python que gestiona `uv` |
| `warmup` | `true` | Precalienta el motor al cargar |
| `serviceUrl` | `http://127.0.0.1:8756` | URL del sidecar |
| `serviceCommand` | `[]` | Arranque manual (tiene prioridad sobre autoInstall) |
| `healthTimeoutMs` | `900000` | Espera a que el motor esté listo |
| `transcribeTimeoutMs` | `180000` | Tiempo por transcripción |
| `ffmpegPath` | `"auto"` | `ffmpeg-static` o PATH |
| `device` | autodetectado | Nombre (Win) / índice (macOS) |
| `language` | `"es"` | ISO-639-1 |
| `model` | `"medium"` | Modelo Whisper |
| `computeType` | `"int8"` | Cuantización CTranslate2 |
| `whisperCppPath` / `whisperCppModel` | `"whisper-cli"` / `""` | Backend alternativo |
| `keybind` | `"ctrl+alt+v"` | Atajo |

---

## ✅ 6. Qué está VALIDADO (con evidencias)

| Prueba | Resultado |
|---|---|
| Transcripción real en español (audio TTS, voz es-MX) | ✅ correcta (~12 s para ~9 s) |
| Captura ffmpeg `dshow` (Windows) | ✅ WAV mono 16 kHz válido |
| Portapapeles con acentos/ñ (PowerShell UTF-8 `Set-Clipboard`) | ✅ exacto |
| Plugin carga en OpenCode | ✅ `state: active`, `server:true, tui:true` |
| Botón 🎤 en la TUI + grabar/detener | ✅ confirmado por el usuario |
| Auto-instalación real (`uv`→venv→`faster-whisper`→sidecar) | ✅ `HEALTH: true` |
| Sintaxis/JSX de todo `src` (transpileModule tsc 5.9) | ✅ sin errores |
| Contenido del paquete npm (`npm publish --dry-run`) | ✅ 21 archivos, válido |
| Nombre `opencode-whisper-dictation` libre en npm | ✅ |

---

## 🐞 7. Errores ya resueltos (no repetir)

1. **`spawn` con `WriteStream`** → `TypeError: stdio invalid`. Solución: abrir con
   `fs.openSync` y pasar el **fd**; cerrar el fd del padre tras `spawn`.
2. **Doble arranque del sidecar**: `provisioning` se liberaba antes de esperar
   salud. Solución: una única promesa compartida que envuelve *aprovisionar + esperar*.
3. **Guardia de sesión** que obligaba a abrir una conversación → eliminada.
4. **Botón invisible** por emoji no soportado → etiqueta con `mic` ASCII.
5. **Entrada local no encontrada** (`package.json#exports` no se usa en local) →
   shims `index.ts` / `tui.tsx` en la raíz.

---

## 🚧 8. Qué FALTA (acciones del usuario)

> El repo ya tiene 2 commits en `main`. Falta **subirlo** y **publicarlo**.

**1. Crear repo vacío en GitHub** (`opencode-whisper-dictation`, sin README/license).

**2. Subir:**
```powershell
cd "C:\DESARROLLO AGENTES\proyecto-addtranscripcion-deepseek"
git remote add origin https://github.com/muelabyte/opencode-whisper-dictation.git
git push -u origin main
```

**3. Publicar en npm:**
```powershell
npm login
npm publish
```

**Resultado para el usuario final:**
```bash
opencode plugin add opencode-whisper-dictation
# o:  opencode plugin add github:muelabyte/opencode-whisper-dictation
```

### Mejoras opcionales (no bloqueantes)
- `CHANGELOG.md` y `GitHub Actions` que valide el código en cada push.
- Probar captura en macOS (`avfoundation`) y Linux (`pulse`).
- Icono/emoji configurable en la etiqueta del botón.

---

## ⚙️ 9. Entorno de desarrollo (esta máquina)

| Recurso | Valor |
|---|---|
| Proyecto | `C:\DESARROLLO AGENTES\proyecto-addtranscripcion-deepseek` |
| Config de OpenCode | `C:\Users\muela\.config\opencode\opencode.jsonc` |
| Config de la TUI | `C:\Users\muela\.config\opencode\cli.json` → `{"prompt":{"paste":"full"}}` |
| Log de OpenCode | `C:\Users\muela\.local\share\opencode\log\opencode.log` |
| Python del sistema | `C:\Python311\python.exe` |
| ffmpeg del sistema | `C:\ffmpeg\bin\ffmpeg.exe` |
| venv manual (usuario) | `<proyecto>\.venv` |
| OpenCode CLI | `npm` global `@opencode/cli` `2.0.31` |
| Node | `v22.23.3` |
| git | `2.56.0.windows.1` (identidad: `muelabyte`) |
| Sidecar en uso | `http://127.0.0.1:8756` (modelo `medium`, INT8) |

### Registro actual del plugin (local, en la config del usuario)
```jsonc
{
  "plugins": [{
    "package": "file:///C:/DESARROLLO AGENTES/proyecto-addtranscripcion-deepseek",
    "options": {
      "backend": "faster-whisper",
      "serviceUrl": "http://127.0.0.1:8756",
      "language": "es", "model": "medium", "computeType": "int8",
      "keybind": "ctrl+alt+v", "healthTimeoutMs": 180000,
      "serviceCommand": [".../.venv/Scripts/python.exe", ".../whisper/server.py",
                         "--host","127.0.0.1","--port","8756",
                         "--model","medium","--compute-type","int8","--language","es"]
    }
  }]
}
```
> Para pasar a usar el paquete publicado, sustituir esa entrada por `"opencode-whisper-dictation"`.

---

## 🔎 10. Cómo verificar rápido (comandos útiles)

```powershell
# ¿El motor responde?
Invoke-RestMethod http://127.0.0.1:8756/health

# ¿El plugin está activo?
opencode api get /api/plugin | ConvertFrom-Json | % data | ? id -match whisper

# Ver el estado del plugin en la TUI: Ctrl+P → "Dictado por voz (Whisper)"
# Grabar/detener: botón "🎤 mic", tecla ctrl+alt+v o /dictar

# Log del motor autoinstalado (cuando usa autoInstall):
#   %LOCALAPPDATA%\opencode-whisper-dictation\whisper-server.log
```

---

## 📚 11. Referencias (fuentes de la verdad)

- Docs OpenCode V2: <https://opencode.ai/v2/docs/>
- Plugins (config): <https://opencode.ai/v2/docs/plugins/>
- Plugins CLI (slots/keymap): <https://opencode.ai/v2/docs/build/plugins/cli>
- Keybinds: <https://opencode.ai/v2/docs/cli/keybinds>
- Schema CLI: <https://opencode.ai/v2/cli.json>
- `uv` (Astral): <https://docs.astral.sh/uv/>
- faster-whisper: <https://github.com/SYSTRAN/faster-whisper>

---

## 🧾 12. Historial de cambios de este documento

| Fecha | Cambio |
|---|---|
| 2026-10-18 | Creación inicial del documento (proyecto funcional y empaquetado; pendiente publicar). |
