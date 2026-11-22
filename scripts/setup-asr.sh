#!/bin/bash
# Creates the Whisper venv OUTSIDE the repo (~500MB, never commit it).
# Works on Linux and on Windows Git Bash (venv layout handled by the app).
set -e
VENV="${ASR_VENV:-$HOME/workspace/vdt-whisper-venv}"
PY="$(command -v python3 || command -v python)"
echo "Using Python: $PY"
"$PY" -m venv "$VENV"
if [ -x "$VENV/bin/pip" ]; then PIP="$VENV/bin/pip"; else PIP="$VENV/Scripts/pip.exe"; fi
"$PIP" install -q faster-whisper yt-dlp curl-cffi
echo "ASR venv ready at $VENV"
echo "Note: Whisper also needs ffmpeg on PATH (https://ffmpeg.org/download.html)."
