# 📋 ESTADO DEL PROYECTO — opencode-whisper-dictation

> **Documento de traspaso para agentes de IA.**
> Léelo completo antes de tocar nada: contiene lo que ya se investigó, lo que se
> decidió, lo que está validado y lo que falta.
>
> 🔄 **REGLA DE MANTENIMIENTO:** actualiza este archivo en **cambio relevante**
> del proyecto (nuevo estado, decisión, bug resuelto o tarea pendiente). Añade una
> línea al final en *Historial de cambios*.

- **Última actualización:** 2026-10-18 (auditoría + correcciones)
- **Estado global:** 🟡 **Funciona en local; NO está listo para publicar.** El flujo
  diario (sidecar del `.venv` manual vía `serviceCommand`) está validado y en uso.
  La **auto-instalación de una línea (`uv`) nunca se ha ejecutado** y tenía un bug
  bloqueante (ver §7.1). Antes de publicar hay que probarla de verdad desde cero (§8.1).
- **Plataforma probada:** Windows 11 + OpenCode v2 `2.0.32`

---

## 📊 Tabla de estado rápida

| Área | Estado | Notas |
|---|---|---|
| Botón 🎤 en la TUI | ✅ Hecho | Probado por el usuario |
| Grabación (ffmpeg) | ✅ Hecho | `dshow` en Windows |
| Transcripción (Whisper local) | ✅ Hecho | `faster-whisper` 1.2.1 medium INT8 (`.venv` manual) |
| Inserción en el input | ✅ Hecho | portapapeles + `prompt.paste` |
| Auto-instalación del motor | ❌ **No validada** | Nunca se ejecutó (`dataDir` no existe). Bug `createWriteStream` corregido el 2026-10-18 (§7.1); falta prueba real desde cero |
| Multiplataforma (captura) | 🟡 Best-effort | macOS/Linux sin probar |
| Paquete npm | ✅ Listo | `npm pack` → 22 archivos, 21,1 kB |
| Typecheck (`tsc --noEmit`) | ✅ Hecho | `npm run typecheck` sin errores (incluye shims raíz) |
| Tests / CI | 🟡 Parcial | No hay tests; `.github/workflows/ci.yml` valida tipos y empaquetado |
| Licencia | ✅ Hecho | Copyright corregido a `muelabyte` |
| Repo git local | ✅ Hecho | **3** commits en `main` |
| Subir a GitHub | ⬜ **Pendiente** | requiere al usuario |
| Publicar en npm | ⬜ **Pendiente** | **bloqueado** hasta validar la auto-instalación (§8.1) |

---

## 🎯 1. Qué es este proyecto

Plugin de **OpenCode v2** que añade un **botón de micrófono** a la barra de
entrada de la TUI. Graba el micrófono, **transcribe localmente** con Whisper
`medium` cuantizado (INT8) y **vuelca el texto en la caja de entrada**.

- 🔒 100 % local (el audio no sale de la máquina).
- 🪶 CPU, sin GPU.
- 🚀 Instalación de **una línea** para el usuario final (ruta aún no validada, §8.1).

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
┌── whisper/server.py (sidecar: autoinstalado con uv o serviceCommand) ──┐
│  WhisperModel("medium", device="cpu", compute_type="int8")  ×1     │
│  GET /health   ·   POST /transcribe { path, language } → { text }  │
└───────────────────────────────────────────────────────────────────┘
```

**Backends soportados:** `faster-whisper` (defecto, sidecar) y `whisper.cpp` (GGUF, sin Python).

> El núcleo (`src/dictation.ts`) **no depende de OpenCode**: graba, transcribe y
> lleva la máquina de estados. `src/tui.tsx` es solo el adaptador de la TUI
> (slot, keymap, toasts y pegado). Cualquier otro host puede reutilizar el núcleo.

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
- ⚠️ Cualquier escritura dentro del proyecto dispara la recarga, no solo editar
  el código: al ejecutar `npm install` se observaron ~26 recargas de `index.ts`
  en 13 s. Si el agente ve recargas en bucle, busque un proceso escribiendo
  (`npm install`, builds, logs).

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

> ⚠️ Esta ruta es la **única sin validar** (ver §7.1 y §8.1). No la des por buena
> porque el README la anuncie.

---

## 📁 4. Mapa de archivos

```
proyecto-addtranscripcion-deepseek/
├─ index.ts                     # shim SERVIDOR para registro local (reexporta src/index.ts)
├─ tui.tsx                      # shim TUI para registro local (reexporta src/tui.tsx)
├─ package.json                 # paquete npm (exports ".", "./tui", "./dictation"; files; scripts)
├─ LICENSE                      # MIT (muelabyte)
├─ README.md                    # doc de cara al usuario (instalación 1 línea + uso del núcleo)
├─ tsconfig.json                # typecheck de src/ + shims raíz
├─ .github/workflows/ci.yml     # CI: typecheck en Ubuntu/Windows + pack:check
├─ src/
│  ├─ index.ts                  # plugin lado servidor (id: whisper-dictation)
│  ├─ tui.tsx                   # adaptador OpenCode: 🎤 botón + keymap + toasts + pegado
│  ├─ dictation.ts              # ⭐ núcleo: grabar→transcribir + estados (sin OpenCode)
│  ├─ config.ts                 # opciones + defaults
│  ├─ engine.ts                 # auto-instalación y arranque del sidecar (uv)
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
├─ estado-proyecto/
│  └─ ESTADO-PROYECTO.md        # 👈 este documento
└─ dsh-whisper-provider/        # paquete npm: proveedor Whisper para DSH
   ├─ package.json              # dsh.bundle.patch, files, publishConfig
   ├─ cordis.patch.yml          # inserta servicio + proveedor + remote + UI de voz
   ├─ lib/index.js              # registra whisper-local; transcripción
   ├─ lib/engine.js             # uv fijado → venv → faster-whisper → sidecar
   ├─ engine/server.py          # copia de whisper/server.py (test de hash)
   ├─ engine/requirements.txt   # faster-whisper==1.2.1
   ├─ test/provider.test.mjs    # pruebas del proveedor y del paquete
   ├─ locale/{en,es}.json, icon.svg
   └─ LICENSE
```

---

## ⚙️ 5. Opciones del plugin

| Opción | Defecto | Descripción |
|---|---|---|
| `backend` | `"faster-whisper"` | o `"whisper.cpp"` |
| `autoInstall` | `true` | Instala el motor (uv+Python+faster-whisper) la 1.ª vez |
| `dataDir` | `%LOCALAPPDATA%\opencode-whisper-dictation` (Win) | Caché del motor |
| `pythonVersion` | `"3.11"` | Python que gestiona `uv` |
| `uvPath` | — | Binario `uv` ya instalado (si se omite se descarga uno) |
| `warmup` | `true` | Precalienta el motor al cargar |
| `serviceUrl` | `http://127.0.0.1:8756` | URL del sidecar |
| `serviceCommand` | `[]` | Arranque manual (tiene prioridad sobre autoInstall) |
| `healthTimeoutMs` | `900000` | Espera a que el motor esté listo |
| `transcribeTimeoutMs` | `180000` | Tiempo por transcripción |
| `ffmpegPath` | `"auto"` | `ffmpeg-static` o PATH |
| `device` | autodetectado | Nombre (Win) / índice (macOS) |
| `deviceIndex` | — | Índice de micrófono en macOS (avfoundation) |
| `language` | `"es"` | ISO-639-1 (no usar `"auto"`: se pasa literal a Whisper) |
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
| Plugin carga en OpenCode 2.0.32 | ✅ `state: active`, `server:true, tui:true` |
| Botón 🎤 en la TUI + grabar/detener | ✅ confirmado por el usuario |
| Sidecar del `.venv` manual | ✅ `/health` → `ok` (medium, int8, cpu) |
| `npm run typecheck` (tsc 5.9, incluye shims) | ✅ sin errores |
| Núcleo `createDictation` (sin deps de OpenCode) | ✅ 6 escenarios con deps inyectadas (`tsx`) |
| `npm pack --dry-run` | ✅ 22 archivos, 21,1 kB |
| Nombre `opencode-whisper-dictation` libre en npm | ✅ (404) |
| Patrón de descarga `fetch`→`pipeline`→`createWriteStream` | ✅ probado aislado (HTTP 200, 4,8 kB) |
| **Auto-instalación `uv`→venv→`faster-whisper`→sidecar** | ❌ **Nunca ejecutada** (ver §7.1) |

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

### 7.1 Auditoría del 2026-10-18: lo que estaba mal (ya corregido)

`src` se había validado solo con `transpileModule`, que **no comprueba tipos**; por
eso estos dos errores viajaron hasta el commit inicial:

1. **`createWriteStream` sin importar** en `src/engine.ts` (`download()`): era un
   `ReferenceError` en el primer paso de la auto-instalación. Añadido el import que
   faltaba desde `node:fs`.
2. **`process.arch === "aarch64"`** en `uvAsset()`: código muerto (Node reporta
   `arm64`). Eliminada la comparación; en ARM se elige ya el binario correcto.

Además:

3. `LICENSE` decía `Copyright (c) 2026 TU NOMBRE` → corregido a `muelabyte`.
4. No había `scripts` npm, ni tests, ni CI: añadidos `typecheck`/`pack:check` y
   `.github/workflows/ci.yml`. `tsconfig` ahora incluye también los shims raíz.

> **Lección:** `transpileModule` solo verifica sintaxis. El gate real es
> `npm run typecheck` (y la CI). No dar por validado nada que no haya pasado por ahí.

---

## 🚧 8. Qué FALTA

### 8.1 Bloqueante antes de publicar (P0): probar la auto-instalación desde cero

Es la promesa del README y la única ruta que **nunca se ha ejecutado**. Procedimiento:

1. Renombrar o borrar `%LOCALAPPDATA%\opencode-whisper-dictation`.
2. Quitar `serviceCommand` de las opciones y parar el sidecar manual (dejar libre el 8756).
3. Abrir la TUI y dictar: debe descargar `uv`, crear el venv, instalar
   `faster-whisper`, arrancar el sidecar y transcribir. Revisar
   `<dataDir>\whisper-server.log` si algo falla.
4. Repetir en una máquina **sin Python ni ffmpeg en el PATH**: es la prueba real
   de la instalación de una línea.

Sin este paso, publicar en npm expone a los usuarios a un fallo en el primer arranque.

### 8.2 Calidad pendiente (P1)

- **Tests**: no hay ni uno (config, `inputArguments`, `uvAsset`, protocolo del sidecar).
- **CI**: creada, pero aún no se ha ejecutado en GitHub (no hay remoto).
- **`serviceCommand`**: arranca con `stdio: "ignore"` → si falla, el error no dice
  nada (el `tailLog` solo lee el log del sidecar autogestionado). Además
  `stopService()` no se llama nunca → el sidecar autogestionado queda huérfano.
- **Empaquetado**: `locate()` resuelve rutas de fichero; probado solo como
  directorio local, no con el paquete instalado.
- **macOS/Linux**: sin probar.
- **Riesgos de publicación**: `@opencode/plugin: "latest"` (no reproducible),
  `faster-whisper>=1.0.0` sin pin, `ffmpeg-static` opcional (si falla su
  postinstall, se cae a `ffmpeg` del PATH, que el usuario medio no tiene).

### 8.3 Publicación (solo tras cerrar 8.1)

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
- `CHANGELOG.md` y badges en el README.
- Probar captura en macOS (`avfoundation`) y Linux (`pulse`).
- Icono/emoji configurable en la etiqueta del botón.
- Cancelación de la transcripción y límite de duración de grabación.

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
| venv manual (usuario) | `<proyecto>\.venv` → Python 3.11.9 + faster-whisper 1.2.1 |
| OpenCode CLI | `2.0.32` (`@opencode/plugin` 2.0.32) |
| Node | `v22.23.3` |
| git | `2.56.0.windows.1` (identidad: `muelabyte`) |
| `node_modules` | Instalado con `--ignore-scripts` solo para `npm run typecheck` (ignorado por git) |
| Sidecar en uso | `http://127.0.0.1:8756` (modelo `medium`, INT8) |

> ⚠️ Si los comandos del agente fallan con `SetNamedSecurityInfoW failed ... grantWrite`,
> es el sandbox de DSH, no el proyecto: hay que reparar los permisos de Windows del
> workspace antes de seguir. Ocurrió el 2026-10-18 y se resolvió con el script de
> diagnóstico de ACL (copia de seguridad en `C:\DESARROLLO AGENTES\dsh-acl-recovery-20261018`).

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
> Este registro usa `serviceCommand`, por eso el flujo diario no toca la auto-instalación.
> Para pasar a usar el paquete publicado, sustituir esa entrada por `"opencode-whisper-dictation"`.

---

## 🔎 10. Cómo verificar rápido (comandos útiles)

```powershell
# Tipos y empaquetado (lo primero tras cualquier cambio)
npm run typecheck
npm run pack:check

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

## 🤖 11. Integración con DeepSeek Harness (DSH)

DSH también puede dictar. Aplicable a **Escritorio y Web**: los plugins de UI se
declaran `dsh.client.platform: "web"` y el Escritorio es Electron sirviendo la
misma aplicación (aquí, `DSH_PROFILE=desktop` y `DSH_WEB_URL=http://127.0.0.1:61381`).

- DSH **0.2.1-rc.2** ya trae un dictado experimental basado en **SenseVoice**,
  desactivado por defecto. Sus idiomas son `auto, zh, en, yue, ja, ko`: **no español**.
- Para español se publica el paquete npm **`dsh-whisper-provider`** (nombre
  libre verificado): registra `whisper-local` en `ctx.speechToText` y reutiliza
  el micrófono, la grabación y la inserción en el borrador de DSH. No
  reimplementa interfaz.
- **Distribución sin carpetas enlazadas**: el Plugin Manager instala por nombre
  y pnpm **copia** el paquete al perfil. Mover o renombrar el repositorio deja
  de afectar al plugin (el `link:` era solo el modo de desarrollo).
- **Motor fuera del repositorio**: se aprovisiona en datos de usuario
  (`%LOCALAPPDATA%\dsh-whisper` en Windows, `~/Library/Application Support` en
  macOS, `$XDG_DATA_HOME` en Linux) con `uv` **0.13.1 fijado**, Python 3.11
  gestionado, `faster-whisper==1.2.1` y el modelo. `dataDir` es configurable.
- **Preparación visible en la UI**: contrato `preparation` de DSH
  (`unprepared → checking → downloading → loading → ready`, cancelable). La UI
  ofrece "Download and prepare"; `transcribe` nunca descarga dentro de la
  petición.
- El paquete es autosuficiente: incluye `engine/server.py` y
  `engine/requirements.txt`; un test de hash falla si divergen del original.
- Si ya hay un sidecar sano en `serviceUrl` (el de OpenCode), se reutiliza y no
  se aprovisiona nada.
- El audio llega como WAV PCM16 16 kHz (`Buffer`); se escribe en un temporal y
  se borra siempre.
- **Contrato del resultado**: DSH exige `Transcript` como objeto estricto
  `{ text, audioSeconds, inferenceSeconds }`. Devolver un string hacía que la UI
  recibiera `text: undefined` y fallara al insertar con
  *"Cannot read properties of undefined (reading 'replace')"*. Corregido en
  **0.1.1** (`buildTranscript`).
- Contrato del proveedor verificado en el código de DSH:
  `register({ info, preparation, transcribe({ audio, language }, signal) })`.
- El micrófono exige HTTPS o loopback en el navegador; en Escritorio, permiso de
  Windows para *DeepSeek Harness*.

| Prueba | Resultado |
|---|---|
| Aprovisionamiento limpio (uv→Python 3.11→faster-whisper→modelo tiny→`/health`) | ✅ 37 s, 347 MB |
| Pruebas del bundle (registro, cleanup, preparación, rutas, paquete, hash) | ✅ 7/7 |
| Puente contra el sidecar real (audio TTS en español) | ✅ texto correcto (~11–12 s) |
| `npm pack` del bundle | ✅ 11 archivos, 12,5 kB |
| Contrato `Transcript` (objeto estricto) | ✅ 0.1.1, verificado con audio real |
| Instalación por nombre y botón real en la UI | ⏳ pendiente de publicar en npm |

**Pendiente:** `npm publish` (requiere tus credenciales), instalar por nombre
desde Plugins y verificar el micrófono en Escritorio y Web. No se publicó desde
esta sesión.

> ⚠️ No activar a la vez el bundle oficial **Voice Input**: inserta las mismas
> filas (`speech-to-text`, `api-speech-to-text`, `ui-voice-input`) y hay conflicto
> de ids. `dsh-whisper-provider` es autosuficiente.

---

## 📚 12. Referencias (fuentes de la verdad)

- Docs OpenCode V2: <https://opencode.ai/v2/docs/>
- Plugins (config): <https://opencode.ai/v2/docs/plugins/>
- Plugins CLI (slots/keymap): <https://opencode.ai/v2/docs/build/plugins/cli>
- Keybinds: <https://opencode.ai/v2/docs/cli/keybinds>
- Schema CLI: <https://opencode.ai/v2/cli.json>
- `uv` (Astral): <https://docs.astral.sh/uv/>
- faster-whisper: <https://github.com/SYSTRAN/faster-whisper>

---

## 🧾 13. Historial de cambios de este documento

| Fecha | Cambio |
|---|---|
| 2026-10-18 | Creación inicial del documento (proyecto funcional y empaquetado; pendiente publicar). |
| 2026-10-18 | Auditoría: se corrige el estado global (auto-instalación **no** validada), 2→3 commits, errores de tipos corregidos (§7.1), se añaden typecheck/CI y el bloqueante §8.1. |
| 2026-10-18 | Se extrae el núcleo `src/dictation.ts` (sin dependencias de OpenCode) y `src/tui.tsx` queda como adaptador; nuevo export `./dictation`. |
| 2026-10-18 | Se añade `dsh-whisper-provider/`: proveedor Whisper para la UI de voz de DeepSeek Harness 0.2.1-rc.2 (Web y Escritorio). Puente verificado; instalación en el perfil pendiente. |
| 2026-10-18 | DSH pasa a paquete npm (`dsh-whisper-provider`) con motor en `%LOCALAPPDATA%\dsh-whisper` y preparación visible en la UI. Aprovisionamiento limpio verificado (uv 0.13.1 → Python 3.11 → faster-whisper 1.2.1 → modelo) en 37 s. Pendiente: `npm publish`. |
| 2026-10-18 | Fix 0.1.1: `transcribe` devuelve `Transcript` `{ text, audioSeconds, inferenceSeconds }`; el string provocaba el error `reading 'replace'` en la UI al insertar. 8/8 tests. |
