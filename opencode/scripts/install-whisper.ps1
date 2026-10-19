# Crea un entorno virtual e instala el motor de transcripción (faster-whisper).
#
#   powershell -ExecutionPolicy Bypass -File scripts/install-whisper.ps1
#
param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv"

Write-Host "==> Creando entorno virtual en $venv"
& $Python -m venv $venv

$venvPython = Join-Path $venv "Scripts/python.exe"
if (-not (Test-Path $venvPython)) { $venvPython = Join-Path $venv "bin/python" }

Write-Host "==> Instalando dependencias"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $root "whisper/requirements.txt")

Write-Host ""
Write-Host "Listo. El modelo 'medium' se descargará (~1.5 GB) la primera vez que arranques el servidor."
Write-Host "Inicia el motor con:  powershell -ExecutionPolicy Bypass -File scripts/run-whisper.ps1"
