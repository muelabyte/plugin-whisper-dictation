# Lista los micrófonos disponibles con el backend dshow de ffmpeg.
# Usa el nombre exacto entre comillas como opción "device" del plugin.
#
#   powershell -ExecutionPolicy Bypass -File scripts/list-audio-devices.ps1
#
$ErrorActionPreference = "Continue"

$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  Write-Host "ffmpeg no está en el PATH. Instálalo con:  winget install Gyan.FFmpeg"
  exit 1
}

# ffmpeg devuelve código de error a propósito al listar; capturamos el texto.
$output = & $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 | Out-String
Write-Host $output

Write-Host ""
Write-Host "Copia el nombre de tu micrófono (línea '(audio)') y úsalo así en las opciones del plugin:"
Write-Host '  "device": "Micrófono (Realtek(R) Audio)"'
