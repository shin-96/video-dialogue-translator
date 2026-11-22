import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveVenv, venvPython, ytDlpBaseArgs, pythonEnv } from '@/lib/venv';

const run = promisify(execFile);
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function fail(status, message){
  const e = new Error(message);
  e.status = status;
  return e;
}

// Download just the audio of a page/watch URL with the venv's yt-dlp into a
// fresh temp dir. Returns { file, cleanup }; throws a status-carrying Error.
async function ytDlpAudio(target, root, errPrefix){
  const venv = resolveVenv(root);
  const py = venv ? venvPython(venv) : null;
  if(!py) throw fail(500, 'yt-dlp engine unavailable (Whisper venv not installed — run scripts/setup-asr.sh)');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdt-audio-'));
  const cleanup = () => { try{ fs.rmSync(tmpDir, { recursive: true, force: true }); }catch{} };
  try{
    await run(py, [...ytDlpBaseArgs(venv), '-x', '--audio-format', 'wav', '--no-playlist',
      '-o', path.join(tmpDir, 'audio.%(ext)s'), target],
      { timeout: 300000, maxBuffer: 16 * 1024 * 1024, env: pythonEnv() });
  }catch(e){
    cleanup();
    throw fail(500, errPrefix + ((e.stderr?.toString().slice(-300)) || e.message));
  }
  const f = fs.readdirSync(tmpDir).find(x => x.startsWith('audio.'));
  if(!f){ cleanup(); throw fail(500, errPrefix + 'audio download produced no file'); }
  return { file: path.join(tmpDir, f), cleanup };
}

// Stage 2 for page URLs whose media CDN refuses yt-dlp's own downloader:
// ask yt-dlp only for the format list (-j), then pull the best audio format
// with plain ranged GETs. Some CDNs (Bilibili's bilivideo mirrors are the
// proven case) 403 any full-file GET and 403 yt-dlp's browser-style download
// headers, but happily serve byte ranges to a request carrying just
// Referer + User-Agent — exactly what a real player sends. The downloaded
// file is handed to ffmpeg (via the ASR script), which sniffs its container.
async function ytDlpAudioViaRanges(pageTarget, root){
  const venv = resolveVenv(root);
  const py = venv ? venvPython(venv) : null;
  if(!py) throw fail(500, 'yt-dlp engine unavailable (Whisper venv not installed — run scripts/setup-asr.sh)');
  let info;
  try{
    const { stdout } = await run(py, [...ytDlpBaseArgs(venv), '-j', '--no-download', '--no-playlist', pageTarget],
      { timeout: 120000, maxBuffer: 32 * 1024 * 1024, env: pythonEnv() });
    info = JSON.parse(stdout.slice(stdout.indexOf('{')));
  }catch(e){
    throw fail(500, 'could not list formats for the ranged audio pull: ' + ((e.stderr?.toString().slice(-200)) || e.message));
  }
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const audioOnly = formats.filter(f => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  audioOnly.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  const combined = formats.filter(f => f.url && f.acodec && f.acodec !== 'none' && f.vcodec && f.vcodec !== 'none');
  const pick = audioOnly[0] || combined[0] || (info.url ? { url: info.url, http_headers: info.http_headers } : null);
  if(!pick) throw fail(500, 'the extractor found no audio format to pull');
  let referer = pick.http_headers?.Referer || null;
  if(!referer){ try{ referer = new URL(pageTarget).origin + '/'; }catch{} }
  const headers = { 'User-Agent': BROWSER_UA };
  if(referer) headers['Referer'] = referer;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdt-audio-'));
  const cleanup = () => { try{ fs.rmSync(tmpDir, { recursive: true, force: true }); }catch{} };
  const out = path.join(tmpDir, 'audio.media');
  try{
    const probe = await fetch(pick.url, { headers: { ...headers, 'Range': 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if(probe.status === 200){
      // Server ignores Range — take the whole body in one go.
      fs.writeFileSync(out, Buffer.from(await probe.arrayBuffer()));
    } else if(probe.status === 206){
      const total = Number((probe.headers.get('content-range') || '').split('/')[1]);
      try{ await probe.body?.cancel(); }catch{}
      if(!total || total > 500 * 1024 * 1024) throw new Error('audio stream missing size or unreasonably large');
      const CHUNK = 1024 * 1024;
      const fd = fs.openSync(out, 'w');
      try{
        for(let start = 0; start < total; start += CHUNK){
          const end = Math.min(total - 1, start + CHUNK - 1);
          const r = await fetch(pick.url, { headers: { ...headers, 'Range': `bytes=${start}-${end}` }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
          if(r.status !== 206) throw new Error(`ranged pull failed at byte ${start}: HTTP ${r.status}`);
          const buf = Buffer.from(await r.arrayBuffer());
          fs.writeSync(fd, buf);
        }
      } finally { fs.closeSync(fd); }
    } else {
      throw new Error(`audio stream refused the pull: HTTP ${probe.status}`);
    }
  }catch(e){
    cleanup();
    throw fail(500, 'ranged audio pull failed: ' + e.message);
  }
  if(!fs.existsSync(out) || fs.statSync(out).size < 10000){
    cleanup();
    throw fail(500, 'ranged audio pull produced no audio');
  }
  return { file: out, cleanup };
}

// Resolve a playable local audio/video file for Whisper from any video
// record. Returns { file, cleanup } (cleanup is a no-op for files we own).
// Throws an Error with `.status` for HTTP mapping on failure.
// - sample:  public/sample.mp4 (bundled file)
// - upload:  data/uploads/<file> (src is /api/uploads/<file>)
// - youtube: yt-dlp audio download by video id
// - link:    yt-dlp audio download from the ORIGINAL PAGE URL (or the stream
//            URL when there is no page); if the extractor cannot handle it,
//            ffmpeg pulls the stream directly, sending the Referer the
//            stream's CDN expects (proxyReferer captured at creation, else
//            the stream origin).
export async function resolveAudioFile(video, root){
  const noop = () => {};
  if(video.kind === 'sample'){
    return { file: path.join(root, 'public', 'sample.mp4'), cleanup: noop };
  }
  if(video.src && video.src.startsWith('/api/uploads/')){
    return { file: path.join(root, 'data', 'uploads', path.basename(video.src)), cleanup: noop };
  }
  if(video.kind === 'youtube' && video.ytId){
    return ytDlpAudio(`https://www.youtube.com/watch?v=${video.ytId}`, root, 'could not download YouTube audio: ');
  }
  if(video.kind === 'link' || video.kind === 'generic'){
    const pageTarget = video.pageUrl || video.src;
    let pageError = null;
    if(pageTarget && /^https?:\/\//i.test(pageTarget)){
      try{
        return await ytDlpAudio(pageTarget, root, 'could not download audio from the video page: ');
      }catch(e){
        // Extractor download refused (bot wall, CDN header checks, login
        // gate…). Try the ranged pull of the extractor's audio format next.
        pageError = e;
        try{
          return await ytDlpAudioViaRanges(pageTarget, root);
        }catch(e2){
          pageError = e2;
          if(!video.src || !/^https?:\/\//i.test(video.src)) throw e2;
        }
      }
    }
    if(video.src && /^https?:\/\//i.test(video.src)){
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdt-audio-'));
      const cleanup = () => { try{ fs.rmSync(tmpDir, { recursive: true, force: true }); }catch{} };
      const out = path.join(tmpDir, 'audio.wav');
      let referer = video.proxyReferer || null;
      if(!referer){ try{ referer = new URL(video.src).origin + '/'; }catch{} }
      const headers = `Referer: ${referer || ''}\r\nUser-Agent: ${BROWSER_UA}\r\n`;
      try{
        await run('ffmpeg', ['-y', '-v', 'error', '-headers', headers, '-i', video.src,
          '-vn', '-ar', '16000', '-ac', '1', out],
          { timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
      }catch(e){
        cleanup();
        const streamErr = 'could not pull audio from the stream: ' + ((e.stderr?.toString().slice(-300)) || e.message);
        throw fail(500, pageError ? `${pageError.message} | ${streamErr}` : streamErr);
      }
      if(!fs.existsSync(out) || fs.statSync(out).size < 1000){
        cleanup();
        throw fail(500, 'stream audio pull produced no audio');
      }
      return { file: out, cleanup };
    }
  }
  throw fail(400, 'no local audio source for this video (only uploads, the sample, YouTube and web-link videos can be transcribed)');
}
