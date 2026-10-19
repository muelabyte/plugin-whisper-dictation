# 📋 ESTADO DEL PROYECTO — plugin-whisper-dictation

> **Documento de traspaso para agentes de IA y programadores.**
> Léelo completo antes de tocar nada: contiene lo investigado, lo decidido, lo
> validado y lo que falta. Si algo de aquí contradice al código, manda el código:
> **actualiza este documento**.
>
> 🔄 **REGLA DE MANTENIMIENTO:** actualiza este archivo en **cambio relevante**
> (nuevo estado, decisión, bug resuelto o tarea pendiente) y añade una línea al
> final en *Historial de cambios*.

- **Última actualización:** 2026-10-19
- **Estado global:** 🟢 **Publicado y en uso.** OpenCode funciona con el paquete
  npm `0.2.1`; DeepSeek Harness tiene el bundle `0.2.0` instalado y funcionando
  contra el sidecar compartido. Quedan pruebas de máquina limpia y macOS/Linux.
- **Plataforma probada:** Windows 11 · OpenCode `2.0.32` · DSH `0.2.1-rc.2` ·
  Node `22.23.3` · npm `10.4.0`.
- **Publicado:**
  - npm `opencode-whisper-dictation@0.2.1` (latest; `0.2.0` deprecada).
  - npm `dsh-whisper-provider@0.2.0` (latest).
  - GitHub `muelabyte/plugin-whisper-dictation` — `main` en `679b617`,
    **repositorio todavía privado**.

---

## 📊 Tabla de estado rápida

| Área | Estado | Notas |
|---|---|---|
| OpenCode: botón 🎤, grabación y transcripción | ✅ Hecho | Probado por el usuario con `0.2.1` |
| OpenCode: auto-instalación del motor | ✅ **Validada** | `uv`→Python 3.11→faster-whisper→sidecar→`/health` en 24 s (modelo `tiny`) |
| OpenCode: paquete npm | ✅ Publicado | `0.2.1`; incluye `tsconfig.json` y el pragma JSX |
| DSH: proveedor `whisper-local` | ✅ Publicado | `dsh-whisper-provider@0.2.0` |
| DSH: UI de voz con inserción al cursor | ✅ Hecho | Vendorizada (MIT), sin aviso *"Your draft changed"* |
| DSH: instalado en esta máquina | 🟡 Desde tarball | El perfil apunta a `file:…dsh-whisper-provider-0.2.0.tgz`; falta reinstalar por nombre |
| DSH: motor propio (`%LOCALAPPDATA%\dsh-whisper`) | ✅ Validado aislado | 37 s, 347 MB con `tiny`. En esta máquina **no** existe: se reutiliza el sidecar de OpenCode |
| Tests | 🟡 Parcial | DSH: 9 pruebas. OpenCode: ninguna (typecheck + CI) |
| CI (`.github/workflows/ci.yml`) | 🟡 Configurada | Sin ejecución verificada desde aquí (repo privado, sin `gh`) |
| Typecheck OpenCode | ✅ Hecho | `cd opencode && npm run typecheck` |
| Licencia | ✅ Hecho | MIT, `muelabyte` |
| GitHub | 🟡 Subido y privado | Falta cambiar la visibilidad a pública |
| macOS / Linux | ⬜ Sin probar | Captura `avfoundation` / `pulse` implementada, no ejecutada |

---

## 🎯 1. Qué es este proyecto

Monorepo con **dos paquetes independientes** de dictado **100 % local** con
Whisper. Comparten el sidecar `whisper/server.py` (faster-whisper), pero se
instalan y se publican por separado:

| Paquete | Host | Carpeta | Instalación para el usuario |
|---|---|---|---|
| `opencode-whisper-dictation` | OpenCode v2 (TUI) | `opencode/` | `opencode plugin add opencode-whisper-dictation` |
| `dsh-whisper-provider` | DeepSeek Harness (Web/Escritorio) | `dsh-whisper-provider/` | Plugins → Add plugin → `dsh-whisper-provider` |

- 🔒 100 % local: el audio no sale de la máquina y se borra.
- 🪶 CPU, sin GPU; whisper `medium` INT8 por defecto.
- 🚀 Sin Python previo: `uv` aprovisiona Python + `faster-whisper` + modelo.
- **El motor no vive en el repositorio**: se cachea en datos de usuario, así que
  mover o renombrar la carpeta del proyecto no rompe la instalación.

---

## 🏗️ 2. Arquitectura

### 2.1 OpenCode (TUI)

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
┌── opencode/whisper/server.py (sidecar: autoinstalado con uv o serviceCommand) ──┐
│  WhisperModel("medium", device="cpu", compute_type="int8")  ×1     │
│  GET /health   ·   POST /transcribe { path, language } → { text }  │
└───────────────────────────────────────────────────────────────────┘
```

**Backends:** `faster-whisper` (defecto, sidecar) y `whisper.cpp` (GGUF, sin Python).

> El núcleo (`opencode/src/dictation.ts`) **no depende de OpenCode**: graba,
> transcribe y lleva la máquina de estados. `opencode/src/tui.tsx` es solo el
> adaptador (slot, keymap, toasts y pegado). Cualquier otro host puede reutilizar
> el núcleo con `opencode-whisper-dictation/dictation`.

### 2.2 DeepSeek Harness (Web y Escritorio)

```
Navegador (Web GUI / Electron)
  micrófono ─► WAV PCM16 16 kHz ─► base64
     ─► remote "speech" autenticado ─► ctx.speechToText (Host)
        ─► proveedor whisper-local (dsh-whisper-provider)
           ─► sidecar Python (uv + faster-whisper) ─► texto
              ─► UI de voz (client.js) inserta en el cursor del borrador
```

- El **Host** ejecuta `lib/index.js` (proveedor + preparación del motor); la
  **página** ejecuta `client.js` (UI de voz vendorizada).
- Si ya hay un sidecar sano en `serviceUrl` (el de OpenCode), **se reutiliza** y
  no se aprovisiona nada. Es lo que ocurre ahora en esta máquina.

---

## 🧠 3. Decisiones clave (¡no volver a investigar!)

### 3.1 OpenCode: inserción con portapapeles + `prompt.paste`
El API público de plugins **no permite escribir en el composer**. Único puente
soportado: escribir la transcripción en el **portapapeles del OS** y disparar
`context.keymap.dispatch("prompt.paste")` (OpenCode lee el portapapeles y pega).
- Los textos largos se colapsan a `[Pasted ~N lines]` **salvo** que
  `cli.json` tenga `{"prompt":{"paste":"full"}}`.

### 3.2 Entrypoints (crítico)
- **Directorio local** (`"package": "file:///ruta"`): OpenCode **NO** usa
  `package.json#exports`. Usa `Host.resolve`, que prueba `<dir>/server.*` y luego
  **`<dir>/index.*`**; para la TUI, **`<dir>/tui.*`**. → De ahí los **shims**
  `index.ts` / `tui.tsx` (en `opencode/` y, para el registro del repo completo,
  también en la raíz).
- **Paquete** (npm/Git): sí usa `exports` → `"."`, `"./tui"` y `"./dictation"`.

### 3.3 Recarga de plugins (OpenCode)
- Editar **archivos del plugin** → recarga en caliente (Watcher).
- Editar **config** (`opencode.jsonc`) → **NO** recarga; hace falta
  `opencode service restart` (⚠️ mata procesos hijos, incluido el sidecar).
- ⚠️ Cualquier escritura dentro del proyecto dispara la recarga: al ejecutar
  `npm install` se observaron ~26 recargas de `index.ts` en 13 s. Si aparecen
  recargas en bucle, busca un proceso escribiendo (`npm install`, builds, logs).

### 3.4 OpenCode Desktop vs TUI
**OpenCode Desktop es Electron + React**; **no** admite plugins de UI. El botón
solo existe en la **TUI de terminal**. No pierdas tiempo intentándolo en Desktop.

### 3.5 Emojis en la TUI
Muchas fuentes de terminal **no** dibujan 🎤 → el botón parece invisible. Por eso
la etiqueta incluye texto ASCII: `🎤 mic`.

### 3.6 Auto-instalación con `uv` (OpenCode)
El plugin **no asume Python instalado**: descarga `uv` (binario único), crea un
Python gestionado, instala `faster-whisper` y arranca el sidecar. Todo cacheado
en `dataDir`. Validado de extremo a extremo (§8.1).

### 3.7 Empaquetado npm de OpenCode: el `tsconfig` importa
La TUI se compila **en el host** (el paquete no incluye JavaScript). Si el
paquete npm no lleva `tsconfig.json`, el JSX se compila sin
`jsxImportSource: @opentui/solid` y OpenCode **crashea** con
`remove expects a renderable child object`. Por eso `0.2.1`:
- incluye `tsconfig.json` en `files`;
- `src/tui.tsx` empieza con `/** @jsxImportSource @opentui/solid */`.
No quites ninguna de las dos cosas al publicar.

### 3.8 DSH: distribución sin carpetas enlazadas
El Plugin Manager instala **por nombre** y pnpm **copia** el paquete al perfil
(`~/.dsh/profiles/<perfil>/node_modules`). El `link:` solo se usa en desarrollo.
Consecuencia: mover el repositorio no afecta al bundle instalado, y reinstalar
exige **reiniciar DSH desde la bandeja** (la UI del cliente solo se carga al
arrancar).

### 3.9 DSH: contrato `Transcript` estricto
DSH exige un objeto `{ text, audioSeconds, inferenceSeconds }`. Devolver un
string hacía que la UI recibiera `text: undefined` y fallara al insertar con
`Cannot read properties of undefined (reading 'replace')`. Lo construye
`buildTranscript` en `lib/index.js` (corregido en `0.1.1`).

### 3.10 DSH: UI de voz vendorizada
La mitad cliente parte de `@deepseek-ai/dsh-experimental-client-ui-voice-input`
(MIT, © DeepSeek), fijada a `0.2.1-rc.2`, con **un** cambio: al terminar inserta
en el **cursor actual** (`captureInsertion()`), no en el span capturado al
empezar. Así se puede escribir o mover el cursor durante el dictado sin el aviso
*"Your draft changed"*. Licencia original en `client.LICENSE`. Si DSH actualiza
su UI de voz, hay que **reaplicar el parche**.

---

## 📁 4. Mapa de archivos

```
plugin-whisper-dictation/
├─ opencode/                     # paquete de OpenCode (npm: opencode-whisper-dictation)
│  ├─ package.json              # exports ".", "./tui", "./dictation"
│  ├─ index.ts / tui.tsx        # shims para registro local en directorio
│  ├─ tsconfig.json             # SE PUBLICA (ver §3.7)
│  ├─ src/
│  │  ├─ index.ts               # plugin lado servidor (id: whisper-dictation)
│  │  ├─ tui.tsx                # adaptador OpenCode: botón + keymap + pegado
│  │  ├─ dictation.ts           # núcleo: grabar→transcribir (sin OpenCode)
│  │  └─ config.ts, engine.ts, ffmpeg.ts, recorder.ts, transcribe.ts, clipboard.ts
│  ├─ whisper/
│  │  ├─ server.py              # sidecar HTTP faster-whisper
│  │  └─ requirements.txt       # faster-whisper==1.2.1
│  ├─ scripts/, examples/
│  └─ README.md, CHANGELOG.md, LICENSE
├─ dsh-whisper-provider/         # paquete de DSH (npm: dsh-whisper-provider)
│  ├─ package.json, cordis.patch.yml
│  ├─ lib/index.js, lib/engine.js
│  ├─ engine/server.py          # copia de opencode/whisper/server.py
│  ├─ engine/requirements.txt   # faster-whisper==1.2.1
│  ├─ client.js, client.LICENSE
│  ├─ test/provider.test.mjs    # 9 pruebas
│  ├─ locale/{en,es}.json, icon.svg
│  └─ README.md, CHANGELOG.md, LICENSE
├─ index.ts / tui.tsx           # shims raíz → opencode/src (registro del repo entero)
├─ package.json                 # envoltorio privado para instalación desde Git
├─ README.md                    # índice del monorepo
├─ PUBLICAR.md                  # guía de publicación (mantenedor)
├─ LICENSE
├─ .github/workflows/ci.yml     # typecheck (OpenCode) + tests/pack (DSH)
└─ estado-proyecto/
   └─ ESTADO-PROYECTO.md        # este documento
```

---

## ⚙️ 5. Opciones del plugin de OpenCode

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

Opciones del bundle de DSH (`cordis.patch.yml`): `serviceUrl`, `dataDir`,
`model`, `computeType`, `language`, `pythonVersion`, `healthTimeoutMs`,
`timeoutMs`. Ver `dsh-whisper-provider/README.md`.

---

## ✅ 6. Qué está VALIDADO (con evidencias)

| Prueba | Resultado |
|---|---|
| Transcripción real en español (audio TTS, voz es-MX) | ✅ correcta (~12 s para ~9 s) |
| Captura ffmpeg `dshow` (Windows) | ✅ WAV mono 16 kHz válido |
| Portapapeles con acentos/ñ (PowerShell UTF-8) | ✅ exacto |
| Plugin carga en OpenCode 2.0.32 | ✅ `state: active`, `server:true, tui:true` |
| OpenCode `opencode-whisper-dictation@0.2.1` desde npm | ✅ confirmado por el usuario |
| `cd opencode && npm run typecheck` (tsc 5.9) | ✅ sin errores |
| Núcleo `createDictation` (sin deps de OpenCode) | ✅ 6 escenarios con deps inyectadas (`tsx`) |
| Auto-instalación OpenCode (`uv`→venv→faster-whisper→sidecar) | ✅ 24 s, `/health` OK (`tiny`, `dataDir` temporal) |
| `npm pack --dry-run` (en `opencode/`) | ✅ 24 archivos, 23,0 kB (incluye `tsconfig.json` y README) |
| Publicación en npm y verificación con `npm view` | ✅ `0.2.1` / `0.2.0` |
| Aprovisionamiento DSH (uv→Python 3.11→faster-whisper→`tiny`→`/health`) | ✅ 37 s, 347 MB |
| Pruebas del bundle DSH (registro, cleanup, preparación, rutas, paquete, hash, UI) | ✅ 9/9 |
| `npm pack` del bundle DSH | ✅ 14 archivos, 37,7 kB |
| Puente DSH ↔ sidecar real (audio TTS en español) | ✅ texto correcto (~11–12 s) |
| Sidecar compartido en `127.0.0.1:8756` (`medium`, int8, cpu) | ✅ `/health` = `ok` |

---

## 🐞 7. Errores ya resueltos (no repetir)

1. **`spawn` con `WriteStream`** → `TypeError: stdio invalid`. Solución: abrir con
   `fs.openSync` y pasar el **fd**; cerrar el fd del padre tras `spawn`.
2. **Doble arranque del sidecar**: `provisioning` se liberaba antes de esperar
   salud. Solución: una única promesa compartida que envuelve *aprovisionar + esperar*.
3. **Guardia de sesión** que obligaba a abrir una conversación → eliminada.
4. **Botón invisible** por emoji no soportado → etiqueta con `mic` ASCII.
5. **Entrada local no encontrada** (`package.json#exports` no se usa en local) →
   shims `index.ts` / `tui.tsx`.
6. **`createWriteStream` sin importar** en `src/engine.ts` (`download()`): era un
   `ReferenceError` en el primer paso de la auto-instalación. Añadido el import
   desde `node:fs`.
7. **`process.arch === "aarch64"`** en `uvAsset()`: código muerto (Node reporta
   `arm64`). Eliminado; en ARM se elige el binario correcto.
8. **`LICENSE` con `Copyright (c) 2026 TU NOMBRE`** → `muelabyte`.
9. **TUI de OpenCode crasheaba** con `remove expects a renderable child object`
   al instalar desde npm: el paquete no llevaba `tsconfig.json` y el JSX se
   compilaba sin `@opentui/solid`. Corregido en `0.2.1` (§3.7). `0.2.0` está
   deprecada en npm.
10. **DSH: `Cannot read properties of undefined (reading 'replace')`** al
    insertar: el proveedor devolvía un string en vez del objeto `Transcript`
    estricto. Corregido en `0.1.1` (§3.9).
11. **DSH: aviso "Your draft changed"** al escribir mientras se dictaba: la UI
    oficial rechaza insertar si el borrador cambió. Corregido en `0.2.0` con la
    UI vendorizada que captura la inserción al terminar (§3.10).
12. **DSH: el micrófono no aparecía** tras instalar/actualizar → no era el
    paquete: la UI cliente solo se genera/reemplaza al arrancar. Hay que cerrar
    DSH **desde la bandeja** y volver a abrirlo.
13. **`npm publish` → E403 de 2FA**: token granular de npm con *bypass 2FA* o
    `--otp`. El token se configura en local; no se comparte por el chat.

> **Lección:** `transpileModule` solo verifica sintaxis. El gate real es
> `cd opencode && npm run typecheck` (y la CI), más una ejecución real del
> paquete instalado. No des por validado nada que no haya pasado por ahí.

---

## 🚧 8. Qué FALTA (por prioridad)

### 8.1 P0 — pruebas de instalación real (casi todo hecho)

- [x] OpenCode: publicar `0.2.1` y confirmar que la TUI funciona (hecho por el usuario).
- [ ] **DSH: reinstalar por nombre** (`dsh-whisper-provider`) en lugar del
      tarball, para que la ficha muestre la versión y quede independiente de la
      carpeta del repo. El perfil actual apunta a
      `file:C:/…/dsh-whisper-provider/dsh-whisper-provider-0.2.0.tgz`, un archivo
      que ya no está en el repo (está en `.gitignore`): reinstalar por nombre
      elimina esa dependencia rota.
- [ ] **Hacer público el repositorio** de GitHub (hoy responde 404 en anónimo).
      Es requisito para instalar desde GitHub en DSH (`#path:/dsh-whisper-provider`).
- [ ] Probar en **máquina limpia** (sin Python ni ffmpeg) con el modelo `medium`
      (la descarga de ~1,5 GB no se midió).
- [ ] macOS (`avfoundation`) y Linux (`pulse`): sin probar.
- [ ] Etiquetar `v0.2.1` (el tag `v0.2.0` apunta a `f1b59d4`, el commit de la
      reestructuración; `679b617` —donde vive `0.2.1`— no tiene tag).

### 8.2 P1 — calidad

- **Tests de OpenCode**: no hay ninguno. Candidatos: `config.ts`
  (`inputArguments`), `engine.ts` (`uvAsset`), protocolo del sidecar.
- **CI**: `.github/workflows/ci.yml` está escrita pero **no se ha verificado su
  ejecución** en GitHub (repo privado; sin `gh` ni token en esta máquina). Al
  hacerlo público, revisar la pestaña *Actions*.
- **`serviceCommand`**: arranca con `stdio: "ignore"` → si falla, el error no
  dice nada (el `tailLog` solo lee el log del sidecar autogestionado). Además
  `stopService()` no se llama nunca → el sidecar autogestionado queda huérfano.
- **Empaquetado**: `locate()` resuelve rutas de fichero; probado sobre todo como
  directorio local. La instalación npm ya se ejecutó en OpenCode y funciona.
- **Riesgos de publicación**: dependencias fijadas (`@opencode/plugin ^2.0.32`,
  `faster-whisper==1.2.1`); `ffmpeg-static` es opcional (si falla su postinstall
  se cae a `ffmpeg` del PATH, que el usuario medio no tiene).

### 8.3 P2 — limpieza y mejoras opcionales

- Revocar el token granular de npm usado para publicar.
- Valorar `npm deprecate dsh-whisper-provider@0.0.0-stage` y el resto de
  marcadores `0.0.0-stage` que dejó el publish por etapas (no afectan a `latest`).
- Badges y metadatos en las páginas de npm.
- Icono/emoji configurable en la etiqueta del botón de OpenCode.
- Cancelación de la transcripción y límite de duración de grabación.
- Evaluar versiones nuevas de DSH: si cambia la UI de voz hay que reaplicar el
  parche (§3.10) y volver a probar el contrato `Transcript`.

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
| venv manual (del usuario) | `<proyecto>\.venv` → Python 3.11.9 + faster-whisper 1.2.1 |
| OpenCode CLI | `2.0.32` (`@opencode/plugin` 2.0.32) |
| DSH | `0.2.1-rc.2` (Electron, `DSH_PROFILE=desktop`) |
| Node / npm | `v22.23.3` / `10.4.0` (pnpm no está en el PATH) |
| git | `2.56.0.windows.1` (identidad: `muelabyte`) |
| `node_modules` | Raíz (para el registro local) y `opencode/` (typecheck); ignorados por git |
| Sidecar en uso | `http://127.0.0.1:8756` (modelo `medium`, INT8, cpu) |
| Datos del motor DSH | `%LOCALAPPDATA%\dsh-whisper` — **no existe** en esta máquina: DSH reutiliza el sidecar de OpenCode |

> ⚠️ Si los comandos del agente fallan con `SetNamedSecurityInfoW failed ... grantWrite`,
> es el sandbox de DSH, no el proyecto: hay que reparar los permisos de Windows del
> workspace antes de seguir. Ocurrió el 2026-10-18 y se resolvió con el script de
> diagnóstico de ACL (copia de seguridad en `C:\DESARROLLO AGENTES\dsh-acl-recovery-20261018`).

### Registro actual de OpenCode (en la config del usuario)

```jsonc
{
  "plugins": ["opencode-whisper-dictation@0.2.1"]
}
```

> Ya no usa `serviceCommand` ni el `file:///` local: instala el paquete npm y el
> plugin arranca el motor con `uv`. Para volver a usar el `.venv` manual, ver la
> sección «motor ya instalado» de `opencode/README.md`.

### Registro actual de DSH (perfil `desktop`)

```json
// ~/.dsh/profiles/desktop/package.json
{
  "dependencies": {
    "dsh-whisper-provider": "file:C:/…/dsh-whisper-provider/dsh-whisper-provider-0.2.0.tgz"
  }
}
```

> Este `file:` es el tarball de pruebas; se sustituye al reinstalar por nombre
> (§8.1). El perfil `web` no tiene el bundle instalado.

---

## 🔎 10. Cómo verificar rápido (comandos útiles)

```powershell
# Tipos, pruebas y empaquetado
cd opencode; npm run typecheck; npm run pack:check; cd ..
npm --prefix dsh-whisper-provider test
npm --prefix dsh-whisper-provider run pack:check

# ¿El motor responde?
Invoke-RestMethod http://127.0.0.1:8756/health

# ¿Qué versión hay publicada?
npm view opencode-whisper-dictation version
npm view dsh-whisper-provider version

# ¿El plugin está activo en OpenCode?
opencode api get /api/plugin | ConvertFrom-Json | % data | ? id -match whisper

# ¿El repo es público? (debe funcionar sin credenciales)
$env:GIT_TERMINAL_PROMPT=0; git -c credential.helper= ls-remote https://github.com/muelabyte/plugin-whisper-dictation.git

# En la TUI: Ctrl+P → "Dictado por voz (Whisper)"; botón "🎤 mic",
# ctrl+alt+v o /dictar.
# Log del motor autoinstalado:
#   %LOCALAPPDATA%\opencode-whisper-dictation\whisper-server.log
```

---

## 🤖 11. Integración con DeepSeek Harness (detalles)

Aplicable a **Escritorio y Web**: los plugins de UI se declaran
`dsh.client.platform: "web"` y el Escritorio es Electron sirviendo la misma
aplicación (aquí, `DSH_PROFILE=desktop`).

- DSH **0.2.1-rc.2** ya trae un dictado experimental basado en **SenseVoice**,
  desactivado por defecto. Sus idiomas son `auto, zh, en, yue, ja, ko`: **no
  español**. Por eso existe `dsh-whisper-provider`.
- El paquete registra `whisper-local` en `ctx.speechToText` y aporta su propia UI
  de micrófono (mitad cliente).
- **Motor fuera del repositorio**: `%LOCALAPPDATA%\dsh-whisper` (Windows),
  `~/Library/Application Support/dsh-whisper` (macOS),
  `${XDG_DATA_HOME:-~/.local/share}/dsh-whisper` (Linux), con `uv` **0.13.1**
  fijado, Python 3.11 gestionado, `faster-whisper==1.2.1` y el modelo. `dataDir`
  es configurable.
- **Preparación visible en la UI**: contrato `preparation` de DSH
  (`unprepared → checking → downloading → loading → ready`, cancelable). La UI
  ofrece "Download and prepare"; `transcribe` nunca descarga dentro de la
  petición.
- El paquete es autosuficiente: incluye `engine/server.py` y
  `engine/requirements.txt`; un test de hash falla si divergen del original.
- El audio llega como WAV PCM16 16 kHz (`Buffer`); se escribe en un temporal y
  se borra siempre.
- Contrato del proveedor:
  `register({ info, preparation, transcribe({ audio, language }, signal) })`.
- El micrófono exige HTTPS o loopback en el navegador; en Escritorio, permiso de
  Windows para *DeepSeek Harness*.
- **Instalación desde GitHub** (cuando el repo sea público):
  `git+https://github.com/muelabyte/plugin-whisper-dictation.git#path:/dsh-whisper-provider`.
  El `#path:` es obligatorio: el paquete vive en un subdirectorio.

> ⚠️ No activar a la vez el bundle oficial **Voice Input**: inserta las mismas
> filas (`speech-to-text`, `api-speech-to-text`) y hay conflicto de ids.
> `dsh-whisper-provider` es autosuficiente.

---

## 🚀 12. Cómo retomar el proyecto (onboarding rápido)

1. **Lee** este documento entero (10 min) y `PUBLICAR.md`.
2. **Entorno**: Node ≥ 20 y npm. Python y ffmpeg **no** hacen falta: `uv` los
   aprovisiona (ffmpeg-static cubre la captura).
3. **Instala dependencias** solo donde hacen falta:
   ```powershell
   cd opencode; npm install --ignore-scripts; cd ..
   # el bundle de DSH no tiene dependencias: `npm test` funciona sin instalar nada
   ```
4. **Comprueba** que todo sigue verde:
   ```powershell
   cd opencode; npm run typecheck; cd ..
   npm --prefix dsh-whisper-provider test
   ```
5. **Para desarrollar el plugin de OpenCode**: registra el directorio con
   `file:///…/opencode` o instala el paquete npm y edita `opencode/src` (el
   Watcher recarga). Para DSH: `link:` al directorio `dsh-whisper-provider` en el
   perfil de desarrollo (modo no soportado para usuarios finales).
6. **Antes de tocar la UI de OpenCode**, recuerda el `tsconfig` + pragma (§3.7).
   **Antes de tocar la UI de DSH**, recuerda que está vendorizada (§3.10).
7. **Al terminar**: typecheck, pruebas, `npm pack --dry-run`, subir la versión en
   el `package.json` correspondiente, actualizar el `CHANGELOG.md` de ese paquete,
   publicar y **actualizar este documento** con una línea en el historial.

---

## 📚 13. Referencias (fuentes de la verdad)

- Docs OpenCode V2: <https://opencode.ai/v2/docs/>
- Plugins (config): <https://opencode.ai/v2/docs/plugins/>
- Plugins CLI (slots/keymap): <https://opencode.ai/v2/docs/build/plugins/cli>
- Keybinds: <https://opencode.ai/v2/docs/cli/keybinds>
- Schema CLI: <https://opencode.ai/v2/cli.json>
- `uv` (Astral): <https://docs.astral.sh/uv/>
- faster-whisper: <https://github.com/SYSTRAN/faster-whisper>
- DSH Voice Input (origen de la UI vendorizada):
  `@deepseek-ai/dsh-experimental-client-ui-voice-input` (MIT, © DeepSeek)

---

## 🧾 14. Historial de cambios de este documento

| Fecha | Cambio |
|---|---|
| 2026-10-18 | Creación inicial del documento (proyecto funcional y empaquetado; pendiente publicar). |
| 2026-10-18 | Auditoría: se corrige el estado global (auto-instalación **no** validada), 2→3 commits, errores de tipos corregidos, se añaden typecheck/CI y el bloqueante §8.1. |
| 2026-10-18 | Se extrae el núcleo `src/dictation.ts` (sin dependencias de OpenCode) y `src/tui.tsx` queda como adaptador; nuevo export `./dictation`. |
| 2026-10-18 | Se añade `dsh-whisper-provider/`: proveedor Whisper para la UI de voz de DeepSeek Harness 0.2.1-rc.2 (Web y Escritorio). Puente verificado. |
| 2026-10-18 | DSH pasa a paquete npm (`dsh-whisper-provider`) con motor en `%LOCALAPPDATA%\dsh-whisper` y preparación visible en la UI. Aprovisionamiento limpio verificado (37 s). |
| 2026-10-18 | Fix 0.1.1: `transcribe` devuelve `Transcript` `{ text, audioSeconds, inferenceSeconds }`; el string provocaba el error `reading 'replace'`. 8/8 tests. |
| 2026-10-18 | 0.2.0: UI de voz vendorizada (MIT) con inserción en el cursor al terminar; desaparece el aviso de borrador cambiado. 9/9 tests; 13 archivos, 36,5 kB. |
| 2026-10-18 | Preparación del release: avisos en ambos README, CHANGELOGs, `PUBLICAR.md`, deps fijadas y auto-instalación de OpenCode validada (24 s). |
| 2026-10-18 | Reestructuración: OpenCode pasa a `opencode/`; la raíz conserva shims y un `package.json` privado para que la instalación desde Git siga funcionando. |
| 2026-10-19 | Publicado en npm: `opencode-whisper-dictation@0.2.0` y `dsh-whisper-provider@0.2.0`. Verificada la instalación desde el registro. |
| 2026-10-19 | Fix 0.2.1 (OpenCode): el paquete npm no incluía `tsconfig.json`, el JSX se compilaba sin `@opentui/solid` y la TUI crasheaba con `remove expects a renderable child object`. Se publica el tsconfig y el pragma; 0.2.0 deprecada. |
| 2026-10-19 | Revisión completa de la documentación: estado global y tabla al día (publicado y en uso), config actual de OpenCode (npm `0.2.1`), estado real de DSH (tarball → pendiente reinstalar por nombre), repo aún privado, motor DSH no aprovisionado en esta máquina (reutiliza el sidecar), nuevas secciones de decisiones §3.7–§3.10, errores §7.6–§7.13 y onboarding §12. |
