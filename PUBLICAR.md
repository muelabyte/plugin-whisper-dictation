# Publicar el proyecto (mantenedor)

Guía para publicar en GitHub y npm. Requiere tus cuentas y credenciales.

## Antes de publicar

- [ ] `npm run typecheck` y `npm test` en verde.
- [ ] `npm run pack:check` y, en `dsh-whisper-provider/`, `npm run pack:check`.
- [ ] Versiones revisadas: raíz `0.2.0`, `dsh-whisper-provider` `0.2.0`.
- [ ] `CHANGELOG.md` actualizado en ambos paquetes.
- [ ] Repo de GitHub creado, público y vacío.

## 1. GitHub

Crea el repositorio **`muelabyte/plugin-whisper-dictation`** (sin README, sin
licencia, sin `.gitignore`) y sube:

```powershell
cd "C:\DESARROLLO AGENTES\proyecto-addtranscripcion-deepseek"
git remote add origin https://github.com/muelabyte/plugin-whisper-dictation.git
git push -u origin main
```

Comprueba la pestaña **Actions**: debe pasar el typecheck (Ubuntu/Windows),
las pruebas del bundle de DSH y el `npm pack`.

## 2. npm

Inicia sesión (2FA incluida) y publica **primero** el paquete de DSH y después
el de OpenCode:

```powershell
cd "C:\DESARROLLO AGENTES\proyecto-addtranscripcion-deepseek\dsh-whisper-provider"
npm login
npm publish

cd "C:\DESARROLLO AGENTES\proyecto-addtranscripcion-deepseek"
npm publish
```

Nombres comprobados como libres: `dsh-whisper-provider` y
`opencode-whisper-dictation`.

Verifica:

```powershell
npm view dsh-whisper-provider version
npm view opencode-whisper-dictation version
```

## 3. Prueba posterior a la publicación

- **DSH**: Plugins → Add plugin → `dsh-whisper-provider` → Install → Enable now
  → Download and prepare → dictar.
- **OpenCode**: `opencode plugin add opencode-whisper-dictation`, reiniciar y
  dictar en una sesión.

## 4. Si algo sale mal

- **npm**: `npm deprecate <paquete>@<versión> "motivo"`; `npm unpublish` solo
  dentro de las 72 h y con cuidado.
- **GitHub**: revierte el commit o crea un tag de la versión anterior.
- **DSH**: desinstala el bundle; la versión anterior se reinstala desde su
  tarball o desde npm si sigue publicada.

## Datos que hacen falta

1. Confirmación de los nombres y versiones (`dsh-whisper-provider@0.2.0`,
   `opencode-whisper-dictation@0.2.0`).
2. Tu cuenta de npm con 2FA (el `npm login` lo ejecutas tú; no compartas tokens
   por el chat).
3. El repositorio de GitHub creado y su URL.
4. Decidir si se publica también el plugin de OpenCode en esta misma tanda.
