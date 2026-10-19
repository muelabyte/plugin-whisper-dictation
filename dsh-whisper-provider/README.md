# Dictado Whisper para DeepSeek Harness

Proveedor de transcripción **Whisper local** (faster-whisper) para DSH. No añade
interfaz: reutiliza el botón de micrófono, la grabación, los niveles y la
inserción en el borrador que ya trae Harness, y solo aporta el reconocedor.

> ### ⚠️ Avisos importantes
>
> - Integración **experimental** de DSH: fijada a **0.2.1-rc.2**; una
>   actualización de Harness puede requerir recompilar el paquete.
> - **Primera vez:** ~2,2 GB de descarga (uv, Python gestionado, `faster-whisper`
>   y modelo). Hace falta internet y espacio en disco.
> - **Todo es local:** el audio se transcribe en tu equipo y se borra; no se
>   envía a ningún servidor.
> - **No actives** el bundle oficial *Voice Input* a la vez.
> - Si el micrófono no aparece tras instalar o actualizar, cierra DSH **desde la
>   bandeja del sistema** y vuelve a abrirlo.

## Por qué existe

DSH ya incluye un dictado experimental basado en **SenseVoice**, pero sus
idiomas son `auto, zh, en, yue, ja, ko`: **no cubre español**. Este paquete
registra `whisper-local` en el servicio `speechToText` con Whisper
`medium` INT8, que sí transcribe español.

## Instalación

Requisitos: DSH **0.2.1-rc.2**, conexión a internet la primera vez (~2,2 GB) y
permiso de micrófono.

### Desde npm

1. **Plugins** en la barra lateral → **Add plugin**.
2. Escribe el nombre del paquete: `dsh-whisper-provider`
   (o `dsh-whisper-provider@0.2.0` para fijar la versión).
3. **Install** → **Enable now**.
4. Abre los detalles del bundle → **Download and prepare**.
5. El micrófono aparece entre el selector de modelo y **Enviar**.

### Desde GitHub

En **Add plugin** pega:

```
git+https://github.com/muelabyte/opencode-whisper-dictation.git#path:/dsh-whisper-provider
```

o la forma corta `github:muelabyte/opencode-whisper-dictation#path:/dsh-whisper-provider`.
El `#path:/dsh-whisper-provider` es **obligatorio**: el paquete vive en un
subdirectorio del repositorio; instalar solo el repo daría el plugin de OpenCode.
El repositorio debe ser público.

> ⚠️ No actives a la vez el bundle oficial **Voice Input**: inserta las mismas
> filas (`speech-to-text`, `api-speech-to-text`) y hay conflicto de ids.

## Dónde vive el motor

Nada se instala en el repositorio ni queda enlazado a una carpeta que puedas
mover. El motor se aprovisiona en datos de usuario:

| SO | Ruta |
|---|---|
| Windows | `%LOCALAPPDATA%\dsh-whisper` |
| macOS | `~/Library/Application Support/dsh-whisper` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/dsh-whisper` |

Contiene `bin/uv`, `venv/`, `models/` y `whisper-server.log`. Se puede mover o
borrar; para reiniciar el aprovisionamiento, borra esa carpeta y vuelve a
pulsar **Download and prepare**.

## Datos y privacidad

- El audio se graba en el navegador, viaja al Host local por el remote
  autenticado y se escribe en un WAV temporal que se borra tras transcribir.
- El motor y el modelo viven en la carpeta de datos; **no se sube nada a la nube**.
- El paquete no incluye telemetría ni scripts de instalación.
- Desinstalar el bundle **no borra** el motor; elimina la carpeta de datos si
  quieres liberar ~2 GB.

## Cómo funciona

```
Micrófono (navegador) → WAV PCM16 16 kHz → base64
  → remote "speech" autenticado → ctx.speechToText
  → proveedor whisper-local (Host)
  → sidecar Python (uv + faster-whisper) → texto → borrador
```

- **Preparación**: descarga `uv` (versión fijada), crea un Python gestionado,
  instala `faster-whisper` y arranca el sidecar. La UI muestra el progreso y
  permite cancelar.
- **Resultado**: devuelve el objeto estricto `Transcript` de DSH
  (`text`, `audioSeconds`, `inferenceSeconds`). Un string simple hace que la UI
  reciba `text: undefined` y falle al insertar.
- **Transcripción**: exige el motor preparado; nunca descarga dentro de la
  petición. El WAV se escribe en un temporal y se borra siempre.
- Si ya hay un sidecar sano en `serviceUrl` (por ejemplo el del plugin de
  OpenCode), se reutiliza: no se descarga nada.

## 🎛️ Interfaz de voz

La mitad cliente de este paquete incluye una adaptación de
`@deepseek-ai/dsh-experimental-client-ui-voice-input` (MIT, © DeepSeek), fijada a
DSH 0.2.1-rc.2, con un cambio: al terminar la transcripción inserta en el
**cursor actual**, no en la posición que había al empezar a grabar. Así puedes
escribir o mover el cursor mientras dictas sin que aparezca el aviso de
*"Your draft changed"*.

- Se conservan micrófono, niveles, cancelación, preparación y ajustes.
- Si DSH actualiza su UI de voz, hay que reaplicar el parche sobre la nueva.
- Licencia original en `client.LICENSE`.

## Configuración (`cordis.patch.yml`)

| Opción | Defecto | Descripción |
|---|---|---|
| `serviceUrl` | `http://127.0.0.1:8756` | Sidecar |
| `dataDir` | datos de usuario (tabla anterior) | Dónde aprovisionar |
| `model` | `medium` | `tiny`, `small`, `medium`, `large-v3`… |
| `computeType` | `int8` | Cuantización CTranslate2 |
| `language` | `es` | Idioma por defecto del sidecar |
| `pythonVersion` | `3.11` | Python que gestiona `uv` |
| `healthTimeoutMs` | `900000` | Espera de carga/preparación |
| `timeoutMs` | `180000` | Timeout por transcripción |

## Web y Escritorio

Funciona en las dos: los plugins de UI se ejecutan en la página y el Escritorio
es Electron sirviendo la misma aplicación.

- En Escritorio, concede el micrófono a *DeepSeek Harness* en Windows.
- En Web, el navegador solo da micrófono en HTTPS o loopback (`127.0.0.1`).

## Desinstalar

Quita el bundle desde **Plugins**. El motor queda en caché; para borrarlo del
todo, elimina la carpeta de datos de usuario.

## Problemas

- **"El motor Whisper no está preparado"**: abre los detalles del bundle y
  pulsa **Download and prepare**.
- **La preparación falla**: revisa el mensaje (red, disco, permisos) y
  `whisper-server.log` dentro de la carpeta de datos.
- **No aparece el micrófono**: comprueba que el bundle está *On* y que no hay
  otro proveedor de voz activo.
- **Aparece "Your draft changed"**: estás con la UI oficial de DSH. Desinstala
  el bundle, instala la 0.2.0 o superior y reinicia.
- **Primera transcripción lenta**: el modelo `medium` tarda en cargar; tras la
  preparación queda caliente.

## Desarrollo

```bash
npm test          # pruebas del proveedor y del paquete
npm run pack:check
```

`engine/server.py` debe ser idéntico a `whisper/server.py` del repositorio; la
prueba falla si divergen.
