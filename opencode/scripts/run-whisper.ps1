# Arranca el servidor local de transcripción (Whisper medium, INT8).
#
#   powershell -ExecutionPolicy Bypass -File scripts/run-whisper.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/run-whisper.ps1 -Port 8756 -Model medium
#
param(
  [int]$Port = 8756,
  [string]$Model = "medium",
  [string]$ComputeType = "int8",
  [string]$Language = "es",
  [string]$Device = "cpu"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $root ".venv/Scripts/python.exe"
if (-not (Test-Path $venvPython)) { $venvPython = Join-Path $root ".venv/bin/python" }

if (-not (Test-Path $venvPython)) {
  Write-Error "No se encontró el entorno virtual. Ejecuta primero scripts/install-whisper.ps1"
  exit 1
}

& $venvPython (Join-Path $root "whisper/server.py") `
  --host 127.0.0.1 --port $Port `
  --model $Model --compute-type $ComputeType --language $Language --device $Device
