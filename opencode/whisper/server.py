"""
Sidecar local de transcripción con faster-whisper (Whisper medium cuantizado).

Carga el modelo UNA sola vez al arrancar y lo mantiene caliente para que cada
dictado sea rápido. Expone una API HTTP mínima que consume el plugin de OpenCode:

    GET  /health      -> { "status": "ok", "model": "...", "compute_type": "..." }
    POST /transcribe  -> body JSON { "path": "<ruta al .wav>", "language": "es" }
                         respuesta { "text": "..." }

Uso típico (Windows, CPU):

    python whisper/server.py --model medium --compute-type int8 --language es
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# --- Estado global del modelo (cargado una vez) -----------------------------
_model = None
_model_lock = threading.Lock()
_settings: "Settings" = None  # type: ignore[assignment]


class Settings:
    def __init__(self, args: argparse.Namespace) -> None:
        self.model = args.model
        self.device = args.device
        self.compute_type = args.compute_type
        self.language = args.language
        self.cache_dir = args.cache_dir


def load_model() -> None:
    global _model
    with _model_lock:
        if _model is not None:
            return
        from faster_whisper import WhisperModel  # import diferido: falla claro si falta

        print(f"[whisper] cargando modelo '{_settings.model}' "
              f"(device={_settings.device}, compute_type={_settings.compute_type})...", flush=True)
        _model = WhisperModel(
            _settings.model,
            device=_settings.device,
            compute_type=_settings.compute_type,
            download_root=_settings.cache_dir,
        )
        # Calentamiento para forzar la compilación de kernels (una vez).
        try:
            _model.transcribe(_warmup_audio(), language=_settings.language, beam_size=1)
        except Exception:
            pass
        print("[whisper] modelo listo.", flush=True)


def _warmup_audio():
    import numpy as np

    return np.zeros(16_000, dtype=np.float32)


def transcribe(path: str, language: str | None) -> str:
    assert _model is not None
    # El modelo no es seguro ante llamadas concurrentes: serializamos.
    with _model_lock:
        segments, _info = _model.transcribe(
            path,
            language=language or _settings.language,
            beam_size=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,
        )
        return "".join(segment.text for segment in segments).strip()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # silenciar logs por defecto
        if _settings and getattr(_settings, "verbose", False):
            super().log_message(fmt, *args)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/health":
            ready = _model is not None
            self._send(200, {
                "status": "ok" if ready else "loading",
                "model": _settings.model,
                "compute_type": _settings.compute_type,
                "device": _settings.device,
            })
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/transcribe":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
            path = payload.get("path")
            if not path:
                self._send(400, {"error": "falta 'path' del archivo de audio"})
                return
            text = transcribe(path, payload.get("language"))
            self._send(200, {"text": text})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send(500, {"error": f"{type(exc).__name__}: {exc}"})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Servidor local de transcripción (faster-whisper).")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8756)
    parser.add_argument("--model", default="medium", help="medium (recomendado), small, large-v3, ...")
    parser.add_argument("--device", default="cpu", help="cpu o cuda")
    parser.add_argument("--compute-type", default="int8", help="int8 (cuantizado), int8_float32, float16, ...")
    parser.add_argument("--language", default="es")
    parser.add_argument("--cache-dir", default=None, help="Directorio donde cachear el modelo descargado")
    parser.add_argument("--no-preload", action="store_true", help="No cargar el modelo al arrancar")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def main() -> int:
    global _settings
    args = parse_args()
    _settings = Settings(args)
    _settings.verbose = args.verbose  # type: ignore[attr-defined]

    if not args.no_preload:
        load_model()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[whisper] escuchando en http://{args.host}:{args.port} (POST /transcribe)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[whisper] detenido.", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
