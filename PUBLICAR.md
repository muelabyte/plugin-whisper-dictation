# Publicar y mantener los paquetes (mantenedor)

Guía para publicar en npm y GitHub. La **primera publicación ya está hecha**
(2026-10-19): `opencode-whisper-dictation@0.2.1` y `dsh-whisper-provider@0.2.0`.
Esta guía sirve ya sobre todo para **sacar una versión nueva**.

## Antes de publicar

- [ ] `cd opencode; npm run typecheck` y `npm run pack:check`.
- [ ] `npm --prefix dsh-whisper-provider test` y `npm run pack:check`.
- [ ] Versiones revisadas en **el `package.json` del paquete que cambia** (no en
      la raíz: es privada). Hoy: `opencode-whisper-dictation` `0.2.1`,
      `dsh-whisper-provider` `0.2.0`.
- [ ] `CHANGELOG.md` actualizado en ese paquete (fecha y cambios).
- [ ] `estado-proyecto/ESTADO-PROYECTO.md`: estado y una línea nueva en el historial.
- [ ] Probado el paquete instalado de verdad (no vale solo el typecheck).

## 1. Publicar una versión nueva en npm

```powershell
# Desde la carpeta del paquete que cambia
cd "C:\DESARROLLO AGENTES\proyecto-addtranscripcion-deepseek\opencode"
npm version patch --no-git-tag-version   # o minor/major, según el cambio
npm publish                              # token con bypass de 2FA o: npm publish --otp=123456

cd "..\dsh-whisper-provider"
npm version patch --no-git-tag-version
npm publish
```

Notas:

- La raíz es un **envoltorio privado** (`"private": true`): nunca `npm publish`
  ahí.
- Si npm responde **E403 de 2FA**, usa un token granular con *bypass 2FA* o
  `--otp`. No pegues tokens en el chat ni en commits.
- Si una versión sale mal: `npm deprecate <paquete>@<versión> "motivo"` y publica
  un parche. `npm unpublish` solo dentro de las 72 h y con cuidado.
- Verifica siempre:

```powershell
npm view opencode-whisper-dictation version
npm view dsh-whisper-provider version
```

## 2. GitHub

El repositorio `muelabyte/plugin-whisper-dictation` ya existe y tiene `origin`
configurado. **Hoy está privado**: para instalar desde GitHub (y para el badge
de CI) hay que ponerlo **público** en *Settings → General → Danger Zone*.

```powershell
cd "C:\DESARROLLO AGENTES\proyecto-addtranscripcion-deepseek"
git push origin main
git tag -a v<versión> -m "v<versión>"   # p. ej. v0.2.1
git push origin v<versión>
```

- El tag `v0.2.0` apunta a `f1b59d4` (commit de la reestructuración); `0.2.1`
  vive en `679b617` y **aún no tiene tag**.
- Los paquetes tienen versiones independientes: si solo cambia uno, etiqueta con
  la versión de ese paquete y dilo en el mensaje del tag.
- Tras el push, revisa **Actions**: typecheck (Ubuntu/Windows, Node 20/22),
  pruebas del bundle de DSH y `npm pack`. La CI está escrita, pero todavía no se
  ha verificado una ejecución real desde aquí (repo privado, sin `gh`).

## 3. Comprobar la instalación de usuario

- **OpenCode**: `opencode plugin add opencode-whisper-dictation`, reiniciar y
  dictar en una sesión de la TUI.
- **DSH**: Plugins → Add plugin → `dsh-whisper-provider` → Install →
  Enable now → Download and prepare → dictar. Tras instalar o actualizar, cierra
  DSH **desde la bandeja** y vuelve a abrirlo.
- **Desde GitHub** (solo si el repo es público):
  `opencode plugin add github:muelabyte/plugin-whisper-dictation` o, en DSH,
  `git+https://github.com/muelabyte/plugin-whisper-dictation.git#path:/dsh-whisper-provider`.
  El `#path:` es obligatorio para DSH: el paquete vive en un subdirectorio.

## 4. Rollback

- **npm**: deprecar la versión mala y publicar un parche; `npm unpublish` solo
  en las primeras 72 h.
- **GitHub**: revierte el commit o etiqueta la versión anterior.
- **DSH**: desinstala el bundle y reinstala la versión anterior; el motor queda
  en caché (no se borra al desinstalar).
- **OpenCode**: cambia la versión en `opencode.jsonc`
  (`"opencode-whisper-dictation@<versión>"`) y reinicia el servicio.

## Estado de la primera publicación (referencia)

| Elemento | Valor |
|---|---|
| npm OpenCode | `0.2.1` (latest); `0.2.0` deprecada por el crash de TUI |
| npm DSH | `0.2.0` (latest) |
| Repo | `muelabyte/plugin-whisper-dictation`, `main` = `679b617` |
| Tag | `v0.2.0` → `f1b59d4` |
| Visibilidad | **privado** (pendiente de hacer público) |
