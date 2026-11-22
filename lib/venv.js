import fs from 'fs';
import os from 'os';
import path from 'path';

// The Whisper / yt-dlp venv lives OUTSIDE the repo (~500MB, never commit it).
// Its layout differs by OS: POSIX venvs use bin/python, Windows venvs use
// Scripts/python.exe. Resolve both so the same code runs on Linux and on the
// user's Windows machine (Git Bash + Node).
export function venvPython(venv){
  const candidates = [
    path.join(venv, 'bin', 'python'),
    path.join(venv, 'Scripts', 'python.exe'),
    path.join(venv, 'Scripts', 'python'),
  ];
  return candidates.find(p=>fs.existsSync(p)) || null;
}

export function resolveVenv(root){
  const candidates = [
    process.env.ASR_VENV,
    path.join(os.homedir(), 'workspace', 'vdt-whisper-venv'),
    path.join(root, 'scripts', '.venv'),
  ].filter(Boolean);
  return candidates.find(p=>venvPython(p)) || null;
}

// Base args for every `python -m yt_dlp` invocation (module form because a
// venv console script can carry a stale shebang after the venv is moved, and
// Windows venvs use the Scripts layout). Mirrors the detect-video engine:
// - TLS-intercepting proxies present a chain yt-dlp's pinned certifi bundle
//   rejects; --no-check-certificates keeps the engine usable there and can be
//   turned back on with VDT_YTDLP_CHECK_CERT=1.
// - Browser impersonation is enabled when curl_cffi is installed in the venv
//   (some extractors refuse non-browser TLS fingerprints).
export function ytDlpBaseArgs(venv){
  const args = ['-m', 'yt_dlp'];
  if(process.env.VDT_YTDLP_CHECK_CERT !== '1') args.push('--no-check-certificates');
  if(venv && venvHasCurlCffi(venv)) args.push('--impersonate', 'chrome');
  return args;
}

export function venvHasCurlCffi(venv){
  try{
    // Windows layout
    if(fs.existsSync(path.join(venv, 'Lib', 'site-packages', 'curl_cffi'))) return true;
    // POSIX layout: lib/pythonX.Y/site-packages/curl_cffi
    const libDir = path.join(venv, 'lib');
    for(const pyDir of fs.readdirSync(libDir)){
      if(fs.existsSync(path.join(libDir, pyDir, 'site-packages', 'curl_cffi'))) return true;
    }
  }catch{ /* no venv lib dir */ }
  return false;
}
