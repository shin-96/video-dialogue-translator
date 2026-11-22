#!/bin/bash
# Creates the Whisper venv OUTSIDE the repo (~500MB, never commit it).
set -e
VENV="${ASR_VENV:-$HOME/workspace/vdt-whisper-venv}"
python3 -m venv "$VENV"
"$VENV/bin/pip" install -q faster-whisper yt-dlp
echo "ASR venv ready at $VENV"
