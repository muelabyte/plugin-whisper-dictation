# 🎤 Dictado por voz para OpenCode (Whisper local, medium cuantizado)

Plugin de **OpenCode v2** que agrega un **botón de micrófono** a la barra de
entrada del chat. Graba el micrófono, **transcribe localmente con Whisper
medium cuantizado** (`faster-whisper`, INT8) y **vuelca el texto en la caja de
entrada**, listo para editar y enviar.

- 🔒 **100% local**: el audio nunca sale de tu máquina.
- 🪶 **Cuantizado INT8 en CPU**: buena precisión en español sin GPU.
- 🚀 **Instalación de una línea**: el motor (Python + `faster-whisper` + modelo)
  se instala solo la primera vez usando [`uv`](https://docs.astral.sh/uv/).

> ### ⚠️ Avisos antes de instalar
>
> - **Solo OpenCode v2 en la TUI.** OpenCode Desktop/web no admite plugins de interfaz.
> - **Primera vez:** descarga ~2 GB (Python gestionado, `faster-whisper` y modelo
>   `medium`). Hace falta internet, espacio en disco y unos minutos.
> - **Todo es local:** el audio se procesa en tu equipo y se borra; no se envía a
>   ningún servidor.
> - **DeepSeek Harness es otra integración** (`dsh-whisper-provider`), experimental
>   y fijada a DSH 0.2.1-rc.2. No actives a la vez el bundle oficial *Voice Input*.
> - En DSH, si el micrófono no aparece tras instalar, cierra la aplicación **desde
>   la bandeja del sistema** y vuelve a abrirla: la interfaz solo se recarga al arrancar.

---

## ⚡ Instalación (una línea)

```bash
# Opción A — desde GitHub (no requiere publicar nada)
opencode plugin add github:muelabyte/opencode-whisper-dictation

# Opción B — desde npm (más rápido de instalar)
opencode plugin add opencode-whisper-dictation
```

Eso es todo. La **primera vez** que abras OpenCode, el plugin prepara el motor
en segundo plano y te muestra avisos de progreso:

1. descarga `uv` (instalador portable, ~30 MB),
2. crea un entorno Python gestionado,
3. instala `faster-whisper` (~200 MB),
4. descarga el modelo Whisper `medium` (~1.5 GB) al usarlo por primera vez.

Todo queda cacheado, así que **solo ocurre una vez**. Después, cada dictado es
casi instantáneo (el modelo queda cargado y caliente).

Luego **reinicia OpenCode** (`opencode service restart`) y abre una sesión.

### Requisitos

| Componente | ¿Hace falta instalarlo? |
|---|---|
| OpenCode v2 | Sí (probado con `2.0.32`). |
| `ffmpeg` | **No**: se usa `ffmpeg-static` automáticamente. Si prefieres el tuyo, ponlo en el `PATH` o usa la opción `ffmpegPath`. |
| Python | **No**: lo gestiona `uv` automáticamente. |
| Modelo Whisper | **No**: se descarga solo. |
| Espacio en disco | ~2 GB (venv + modelo). |

---

## 🖥️ Plataformas

| SO | Captura de audio | Estado |
|---|---|---|
| **Windows** | `dshow` | ✅ Probado. |
| **macOS** | `avfoundation` | ✅ Soportado (pide permiso de micrófono a ffmpeg la 1.ª vez). |
| **Linux** | `pulse` | ✅ Soportado (requiere PulseAudio). |

---

## ▶️ Uso

1. Abre (o crea) una sesión en OpenCode.
2. Pulsa el botón **`🎤 mic`** de la barra de entrada, o el atajo
   **`ctrl+alt+v`**, o escribe **`/dictar`**.
3. El botón cambia a **`● REC`** (rojo, parpadeante) mientras graba. Habla.
4. Vuelve a pulsar para detener. Verás **`… dictando`** mientras transcribe y,
   al terminar, **el texto aparece en la caja de entrada**.

> En la TUI, `Ctrl+P` abre la paleta: busca **"Dictado por voz (Whisper)"**.

---

## 🧠 Cómo funciona

```
┌────────────────────────── OpenCode TUI (plugin) ──────────────────────────┐
│  slot "prompt.footer.status"  ──►  🎤 mic / ● REC / … dictando            │
│  keymap layer                 ──►  ctrl+alt+v · paleta · /dictar          │
│                                                                           │
│  toggle()                                                                 │
│   ├─ start(): ffmpeg ─► WAV mono 16 kHz (temp)                            │
│   └─ stop():  transcribe() ─► HTTP POST /transcribe ─► sidecar            │
│               writeClipboard(texto)                                       │
│               keymap.dispatch("prompt.paste")  ─► texto en el input       │
└───────────────────────────────────────────────────────────────────────────┘
                                │ HTTP 127.0.0.1:8756
                                ▼
┌──────────────── whisper/server.py (sidecar, autoinstalado) ────────────────┐
│  WhisperModel("medium", device="cpu", compute_type="int8")  ← 1 sola vez   │
│  GET /health   ·   POST /transcribe { path, language } → { text }          │
└───────────────────────────────────────────────────────────────────────────┘
```

### ¿Por qué portapapeles + `prompt.paste`?

El API **público** de plugins de OpenCode v2 permite slots, keymaps, diálogos,
toasts, storage, router y el cliente HTTP, pero **no expone una escritura
directa sobre el composer**. El puente soportado es el comando interno
`prompt.paste`, que lee el **portapapeles del sistema** e inserta el texto.
Por eso el plugin escribe la transcripción en el portapapeles y dispara
`context.keymap.dispatch("prompt.paste")`.

> Para que los textos largos no se colapsen a `[Pasted ~N lines]`, añade en
> `cli.json` (`~/.config/opencode/cli.json`):
>
> ```json
> { "prompt": { "paste": "full" } }
> ```

---

## ⚙️ Opciones del plugin

Se configuran en `opencode.json(c)` dentro de `"options"`:

| Opción | Defecto | Descripción |
|---|---|---|
| `backend` | `"faster-whisper"` | `"faster-whisper"` o `"whisper.cpp"`. |
| `autoInstall` | `true` | Instala el motor (uv + Python + faster-whisper) la 1.ª vez. |
| `dataDir` | `%LOCALAPPDATA%\opencode-whisper-dictation` (Win) | Dónde cachear venv/modelos/binarios. |
| `pythonVersion` | `"3.11"` | Versión de Python que gestiona `uv`. |
| `warmup` | `true` | Precalienta el motor al cargar el plugin. |
| `serviceUrl` | `http://127.0.0.1:8756` | URL del sidecar. |
| `serviceCommand` | `[]` | Comando manual para arrancar el sidecar (tiene prioridad). |
| `healthTimeoutMs` | `900000` | Espera máxima a que el motor esté listo (ms). |
| `transcribeTimeoutMs` | `180000` | Tiempo máximo por transcripción (ms). |
| `ffmpegPath` | `"auto"` | `"auto"`, una ruta, o el nombre del ejecutable. |
| `device` | autodetectado | Nombre (Win) o índice (macOS) del micrófono. |
| `language` | `"es"` | Idioma ISO-639-1. |
| `model` | `"medium"` | Modelo Whisper (`tiny`…`large-v3`). |
| `computeType` | `"int8"` | Cuantización CTranslate2. |
| `whisperCppPath` | `"whisper-cli"` | Binario de whisper.cpp (backend alternativo). |
| `whisperCppModel` | `""` | Ruta al `.bin` GGUF (backend alternativo). |
| `keybind` | `"ctrl+alt+v"` | Atajo para grabar/detener. |

Ejemplo para **usar un motor ya instalado** (sin auto-setup):

```jsonc
{
  "plugins": [
    {
      "package": "opencode-whisper-dictation",
      "options": {
        "autoInstall": false,
        "serviceCommand": [
          "C:/ruta/.venv/Scripts/python.exe",
          "C:/ruta/whisper/server.py",
          "--model", "medium", "--compute-type", "int8"
        ]
      }
    }
  ]
}
```

---

## 🧩 Usarlo fuera de OpenCode (avanzado)

El núcleo de grabación/transcripción no depende de OpenCode y se puede importar
desde cualquier host (un CLI, una extensión de editor, un script):

```ts
import { createDictation } from "opencode-whisper-dictation/dictation"

const dictation = await createDictation({ language: "es", model: "medium" })

await dictation.toggle()                 // empieza a grabar
const result = await dictation.toggle()  // detiene y transcribe

if (result.status === "transcribed") {
  console.log(result.text)               // el host decide qué hacer con el texto
}
```

- `result.status` es `"started"`, `"transcribed"`, `"empty"` (no se detectó voz)
  o `"noop"` (no había nada que hacer).
- El núcleo **no** escribe en ninguna app: en OpenCode, el adaptador copia al
  portapapeles y dispara `prompt.paste`; otro host hará lo suyo.
- `dispose()` detiene y limpia una grabación en curso.
- Requiere un runtime que ejecute TypeScript (`bun`, `tsx` o el loader de
  OpenCode): el paquete no incluye JavaScript compilado.

---

## 🤖 DeepSeek Harness

El repositorio incluye además **`dsh-whisper-provider/`**: un paquete npm que
aporta dictado Whisper en español a la UI de voz de **DeepSeek Harness
0.2.1-rc.2** (Escritorio y Web). Reutiliza el micrófono y la inserción en el
borrador de DSH y aprovisiona su motor en `%LOCALAPPDATA%\dsh-whisper`, sin
depender de ninguna carpeta del repositorio.

### Instalar desde npm

1. **Plugins** → **Add plugin** → escribe `dsh-whisper-provider` → **Install**.
2. **Enable now**.
3. Abre la tarjeta del bundle → **Download and prepare** (solo la primera vez).
4. El micrófono aparece entre el selector de modelo y **Enviar**.

### Instalar desde GitHub

En **Add plugin** pega:

```
git+https://github.com/muelabyte/opencode-whisper-dictation.git#path:/dsh-whisper-provider
```

o `github:muelabyte/opencode-whisper-dictation#path:/dsh-whisper-provider`.
El `#path:/dsh-whisper-provider` es obligatorio: el paquete vive en un
subdirectorio; instalar solo el repositorio daría el plugin de OpenCode.

> ⚠️ **Avisos de DSH**
> - Integración **experimental**, fijada a DSH **0.2.1-rc.2**.
> - **No actives** el bundle oficial *Voice Input* a la vez: usa las mismas filas.
> - El motor se guarda en `%LOCALAPPDATA%\dsh-whisper`; borra esa carpeta para
>   reiniciarlo. Desinstalar el bundle no la borra.
> - Tras instalar o reemplazar el paquete, cierra DSH **desde la bandeja** y
>   vuelve a abrirlo para cargar la interfaz.

Instalación, configuración y desinstalación:
[dsh-whisper-provider/README.md](dsh-whisper-provider/README.md).

---

## 🧰 Instalación manual del motor (alternativa)

Si prefieres gestionar Python tú mismo:

```powershell
# 1) Motor de transcripción
powershell -ExecutionPolicy Bypass -File scripts/install-whisper.ps1

# 2) Arrancarlo (deja esta terminal abierta) o usa 'serviceCommand'
powershell -ExecutionPolicy Bypass -File scripts/run-whisper.ps1
```

---

## 🔁 Alternativa: whisper.cpp (GGUF, sin Python)

```jsonc
{
  "backend": "whisper.cpp",
  "whisperCppPath": "C:/tools/whisper.cpp/whisper-cli.exe",
  "whisperCppModel": "C:/models/ggml-medium-q5_0.bin"
}
```

El plugin ejecuta:
`whisper-cli -m <modelo> -f <wav> -l es -nt -otxt -of <salida>`.
Ver `examples/whisper-cpp.ps1`.

---

## 🩺 Solución de problemas

- **`No se encontró ningún micrófono`** → comprueba que hay un micrófono y que
  ffmpeg lo ve. Define `device` con el nombre/índice exacto.
- **El motor tarda mucho la 1.ª vez** → está descargando `faster-whisper`
  (~200 MB) y el modelo `medium` (~1.5 GB). Es normal; solo ocurre una vez.
- **`El motor Whisper no respondió…`** → mira el log del motor en
  `<dataDir>/whisper-server.log` (el propio mensaje de error incluye sus
  últimas líneas).
- **El texto no aparece en el input** → revisa que `prompt.paste` sea `"full"`
  en `cli.json`. La transcripción también queda en el portapapeles: pega con
  `ctrl+v`.
- **Acentos/ñ raros** → el plugin escribe el portapapeles en UTF-8 vía
  PowerShell en Windows.
- **El botón no aparece** → este plugin es de **TUI de terminal**. La app
  **OpenCode Desktop / web UI** no admite plugins de interfaz, así que el botón
  solo se ve en la TUI (`opencode` en una terminal).

---

## 🚀 Publicar (para quien mantiene el repo)

Guía completa: [PUBLICAR.md](PUBLICAR.md). Resumen:

1. **GitHub**: crea `muelabyte/opencode-whisper-dictation` y sube `main`.
2. **npm**: publica los dos paquetes (primero el de DSH):
   ```powershell
   cd dsh-whisper-provider; npm publish
   cd ..; npm publish
   ```
3. Verifica con `npm view` y prueba la instalación por nombre en DSH y OpenCode.

La auto-instalación del motor ya está validada: `uv` → Python 3.11 →
`faster-whisper` → sidecar → `/health`.

> **Nota sobre entrypoints:** al instalar **como paquete** (npm/Git), OpenCode
> resuelve `./tui` y `.` desde `exports`. Al registrar un **directorio local**,
> en cambio, busca `<dir>/index.*` y `<dir>/tui.*`. Este repo incluye los shims
> `index.ts` y `tui.tsx` en la raíz para cubrir ambos casos.

---

## 🗂️ Estructura

```
opencode-whisper-dictation/
├─ index.ts / tui.tsx          # shims de raíz para registro local
├─ src/
│  ├─ index.ts                 # plugin lado servidor
│  ├─ tui.tsx                  # adaptador OpenCode: botón 🎤 + keymap + pegado
│  ├─ dictation.ts             # núcleo: grabar→transcribir (sin OpenCode)
│  ├─ config.ts                # opciones y valores por defecto
│  ├─ engine.ts                # auto-instalación y arranque del sidecar
│  ├─ ffmpeg.ts                # resolución de ffmpeg (ffmpeg-static / PATH)
│  ├─ recorder.ts              # captura multiplataforma (dshow/avfoundation/pulse)
│  ├─ transcribe.ts            # cliente del sidecar / backend whisper.cpp
│  └─ clipboard.ts             # escritura al portapapeles multiplataforma
├─ whisper/                    # sidecar HTTP (faster-whisper)
├─ scripts/                    # instalación/arranque manual (fallback)
├─ examples/                   # opencode.jsonc, cli.json, whisper-cpp.ps1
├─ dsh-whisper-provider/       # paquete npm para DeepSeek Harness
├─ .github/workflows/ci.yml    # typecheck + tests + pack
└─ estado-proyecto/            # documento de traspaso
```

## 📄 Licencia

MIT. Ver [LICENSE](LICENSE).
