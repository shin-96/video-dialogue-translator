#!/usr/bin/env python3
"""Transcribe speech with REAL word-level timestamps (faster-whisper).

Usage:
  asr_words.py --input <audio-or-video-file> [--language en|auto] [--model tiny]

Prints ONE JSON object on stdout:
  {"language": "en",
   "sentences": [{"text": ..., "start": ..., "end": ...,
                  "words": [{"w": ..., "start": ..., "end": ...}, ...]}, ...]}
All diagnostics go to stderr; exit code non-zero on failure.
Model size can also be set with env WHISPER_MODEL (default "tiny").
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import wave

# Windows consoles/pipes default to a legacy code page (cp1252/cp1258) that
# cannot encode Vietnamese/Chinese transcript text — json.dump below would
# die with UnicodeEncodeError. Force UTF-8 on both output streams.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass


def load_audio_16k(path):
    """Decode any audio/video file to a float32 16kHz mono numpy array via
    ffmpeg. This avoids faster-whisper's PyAV decoding path, which breaks
    with newer PyAV versions (av>=15 removed the metadata_errors kwarg)."""
    import numpy as np

    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", path,
             "-ac", "1", "-ar", "16000", "-f", "wav", tmp],
            check=True, capture_output=True, text=True,
        )
        with wave.open(tmp) as wf:
            frames = wf.readframes(wf.getnframes())
        return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--language", default=os.environ.get("WHISPER_LANG", "auto"))
    ap.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "tiny"))
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        print(f"input file not found: {args.input}", file=sys.stderr)
        return 1

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    lang = None if not args.language or args.language == "auto" else args.language
    audio = load_audio_16k(args.input)
    segments, info = model.transcribe(
        audio,
        language=lang,
        word_timestamps=True,
        beam_size=1,
        vad_filter=False,
    )

    sentences = []
    for seg in segments:
        words = []
        for w in (seg.words or []):
            text = (w.word or "").strip()
            if text:
                words.append({"w": text, "start": round(w.start, 3), "end": round(w.end, 3)})
        sentences.append({
            "text": seg.text.strip(),
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "words": words,
        })

    json.dump({"language": info.language, "sentences": sentences}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
