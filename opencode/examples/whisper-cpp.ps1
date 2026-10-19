# Alternativa con whisper.cpp + modelo GGUF cuantizado (Whisper medium q5_0).
# No requiere Python: usa el binario nativo whisper-cli.
#
#   1) Descarga/compila whisper.cpp:  https://github.com/ggml-org/whisper.cpp
#   2) Descarga un modelo GGUF cuantizado, p. ej.:
#        models/download-ggml-model.cmd medium-q5_0
#      Genera: models/ggml-medium-q5_0.bin
#   3) Configura el plugin:
#        "backend": "whisper.cpp",
#        "whisperCppPath": "<ruta>/whisper-cli.exe",
#        "whisperCppModel": "<ruta>/ggml-medium-q5_0.bin"
#
# El plugin llama internamente a:
#   whisper-cli -m <modelo> -f <wav> -l es -nt -otxt -of <salida>
#
Write-Host "Consulta los comentarios de este archivo para configurar el backend whisper.cpp."
Write-Host "Recomendado: ggml-medium-q5_0.bin (~1.0 GB) para CPU en Windows."
