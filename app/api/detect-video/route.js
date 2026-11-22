import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveVenv, venvPython, venvHasCurlCffi, pythonEnv } from '@/lib/venv';
import { extractWithHeadless } from '@/lib/headless';

const run = promisify(execFile);
export const maxDuration = 240;

// detect-video v2 — find the main video on an arbitrary page.
// Pipeline: (1) direct media URL short-circuit, (2) deep static scan of the
// page HTML *including <script> bodies and JS player configs*, (3) scan up to
// 5 <iframe> embeds one level deep, (4) yt-dlp extractor engine as fallback,
// (5) headless Chromium (lib/headless.js) as the LAST resort: renders the
// page, auto-plays the player and captures media requests from all frames —
// the only stage that can see JS-app players (e.g. motphim.skin). It is slow
// (tens of seconds), so it runs only when no stage above found playable media.
// Honest failure: bot-walled pages (e.g. anti-bot 403 checks) may defeat even
// the headless browser; in that case we return an `engineNote` explaining
// exactly that instead of pretending nothing was there.

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_HEADERS = {
  'User-Agent': BROWSER_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
};
const MEDIA_RE = /\.(?:mp4|webm|mov|m3u8)$/i;

function abs(u, base){
  if(!u) return null;
  try{ return new URL(u, base).href; }catch{ return null; }
}
function isHttp(u){ return /^https?:\/\//i.test(u || ''); }

// Scan one HTML document for media candidates. Returns [{src,kind,score,...}].
function scanHtml(html, baseUrl){
  const cands = [];
  const push = (src, kind, score, extra={}) => {
    const href = abs(src, baseUrl);
    if(!href || !isHttp(href)) return;
    if(!cands.some(c=>c.src===href)) cands.push({ src: href, kind, score, ...extra });
  };
  // og:video (either attribute order). A media-file URL scores 90; a URL with
  // no media extension is usually an embed/player *page* (e.g. Vimeo) that a
  // <video> tag cannot play, so it only scores 60 and the engine gets a say.
  const ogScore = (u) => MEDIA_RE.test(String(u).split(/[?#]/)[0]) ? 90 : 60;
  for(const m of html.matchAll(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) push(m[1], 'og:video', ogScore(m[1]));
  for(const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/gi)) push(m[1], 'og:video', ogScore(m[1]));
  // <video> tags with nested <source>
  for(const m of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)){
    const attrs = m[1], inner = m[2];
    const w = parseInt((attrs.match(/width=["']?(\d+)/)||[])[1]||'0');
    const poster = (attrs.match(/poster=["']([^"']+)["']/)||[])[1] || null;
    const srcM = attrs.match(/src=["']([^"']+)["']/);
    let score = 40 + (w>=640?25:w>=320?12:0) + (poster?10:0) + (/autoplay/.test(attrs)?-15:0);
    if(srcM) push(srcM[1], 'video-tag', score, { poster });
    for(const s of inner.matchAll(/<source[^>]+src=["']([^"']+)["']/gi)) push(s[1], 'video-tag', score, { poster });
  }
  // JS player configs anywhere in the raw text (scripts included). Unescape
  // `\/` first so JSON-style URLs like https:\/\/cdn\/x.m3u8 are visible.
  const text = html.replace(/\\\//g, '/');
  for(const m of text.matchAll(/(?:file|source|src)\s*:\s*["']([^"']+?\.(?:mp4|webm|mov|m3u8)(?:\?[^"']*)?)["']/gi)){
    const isHls = /\.m3u8/i.test(m[1]);
    push(m[1], 'js-config', isHls ? 55 : 50);
  }
  // Bare media URLs anywhere in the document (script bodies included).
  for(const m of text.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:mp4|webm|mov|m3u8)(?:\?[^\s"'<>\\]*)?/gi)){
    const isHls = /\.m3u8/i.test(m[0]);
    push(m[0], 'script-url', isHls ? 55 : 45);
  }
  // data-src / data-file lazy-load attributes
  for(const m of html.matchAll(/(?:data-src|data-file)=["']([^"']+)["']/gi)){
    if(MEDIA_RE.test(m[1].split(/[?#]/)[0])) push(m[1], 'data-attr', 35);
  }
  // any src="....media" attribute (v1 behaviour)
  for(const m of html.matchAll(/<source[^>]+src=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi)) push(m[1], 'source', 35);
  for(const m of html.matchAll(/\bsrc=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi)) push(m[1], 'source', 35);
  return cands;
}

function pageTitle(html, fallback){
  return (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title>([^<]+)<\/title>/i) || [])[1] || fallback;
}

async function fetchText(url, timeoutMs){
  const r = await fetch(url, { headers: PAGE_HEADERS, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  return { status: r.status, ok: r.ok, text: await r.text() };
}

// HEAD (then ranged GET) content-type probe for the direct-media short-circuit.
async function probeContentType(url){
  try{
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    const ct = r.headers.get('content-type');
    if(ct) return ct;
  }catch{ /* fall through to GET probe */ }
  try{
    const r = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, 'Range': 'bytes=0-0' }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    try{ r.body?.cancel(); }catch{}
    return r.headers.get('content-type');
  }catch{ return null; }
}



// yt-dlp extractor engine. Invoked via `python -m yt_dlp` because the venv's
// console script can carry a stale shebang after the venv is moved.
// Two environment realities are handled here:
// - TLS-intercepting proxies (common on managed networks) present a chain
//   that yt-dlp's pinned certifi bundle rejects for several major sites
//   ("self-signed certificate in certificate chain"), while the OS store
//   trusts it. --no-check-certificates keeps the engine usable there; it
//   only affects these metadata requests, and verification can be forced
//   back on with VDT_YTDLP_CHECK_CERT=1.
// - Some extractors (Dailymotion, Cloudflare-walled sites) need browser
//   impersonation; enabled automatically when curl_cffi is in the venv.
// If the page URL itself extracts nothing, embed/player URLs discovered by
// the static scan are tried next (e.g. Vimeo watch pages refuse extraction
// but their player.vimeo.com embeds extract fine).
async function ytDlpExtract(url, fallbacks = []){
  const venv = resolveVenv(process.cwd());
  if(!venv) return { candidates: [], error: 'yt-dlp engine unavailable (Whisper venv not installed)' };
  const py = venvPython(venv);
  const baseArgs = ['-m', 'yt_dlp', '-j', '--no-download', '--no-playlist', '--socket-timeout', '15'];
  if(process.env.VDT_YTDLP_CHECK_CERT !== '1') baseArgs.push('--no-check-certificates');
  if(venvHasCurlCffi(venv)) baseArgs.push('--impersonate', 'chrome');

  async function runOnce(target){
    let stdout;
    try{
      ({ stdout } = await run(py, [...baseArgs, target], { timeout: 45000, maxBuffer: 32 * 1024 * 1024, env: pythonEnv() }));
    }catch(e){
      const errText = (e.stderr?.toString() || e.message || '').trim();
      const lastLine = errText.split('\n').filter(Boolean).pop() || 'unknown error';
      return { candidates: [], error: lastLine.slice(-300) };
    }
    let info;
    try{
      const start = stdout.indexOf('{');
      info = JSON.parse(stdout.slice(start));
    }catch{ return { candidates: [], error: 'yt-dlp returned unparseable output' }; }
    const formats = Array.isArray(info.formats) ? info.formats : [];
    const out = [];
    const push = (src, score, extra={}) => { if(src && isHttp(src) && !out.some(c=>c.src===src)) out.push({ src, kind: 'yt-dlp', score, ...extra }); };
    const meta = { thumb: info.thumbnail || null, duration: info.duration || null };
    // (a) best single file with BOTH audio+video over plain http(s) (mp4 preferred)
    const combined = formats.filter(f => f.url && isHttp(f.url)
      && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none'
      && (!f.protocol || f.protocol === 'http' || f.protocol === 'https'));
    combined.sort((a,b)=> ((b.ext==='mp4') - (a.ext==='mp4')) || ((b.height||0) - (a.height||0)));
    if(combined.length) push(combined[0].url, 85, meta);
    // (b) HLS: prefer a combined audio+video rendition, else the highest
    // video rendition, else any m3u8 format; info.url wins when it is one.
    const isHls = (f) => f.url && (f.protocol === 'm3u8_native' || f.protocol === 'm3u8' || /\.m3u8(\?|$)/i.test(f.url));
    const hlsAll = formats.filter(isHls);
    const hlsCombined = hlsAll.find(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none');
    const hlsVideo = hlsAll.filter(f => f.vcodec && f.vcodec !== 'none').sort((a,b)=>(b.height||0)-(a.height||0))[0];
    const hlsPick = hlsCombined || hlsVideo || hlsAll[0];
    if(info.url && (/m3u8/i.test(info.protocol || '') || /\.m3u8(\?|$)/i.test(info.url))) push(info.url, 80, meta);
    else if(hlsPick) push(hlsPick.url, 80, meta);
    return { candidates: out, title: info.title || null, error: out.length ? null : 'yt-dlp found no playable formats' };
  }

  const targets = [url, ...fallbacks.filter(u=>u && u !== url)].slice(0, 3);
  let lastError = null;
  for(const target of targets){
    const res = await runOnce(target);
    if(res.candidates.length) return res;
    lastError = res.error;
  }
  return { candidates: [], error: lastError };
}

export async function POST(req){
  const { url: rawUrl } = await req.json().catch(()=>({}));
  if(!rawUrl) return Response.json({ error: 'url required' }, { status: 400 });
  let url = String(rawUrl).trim();
  if(!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let parsed;
  try{ parsed = new URL(url); }catch{ return Response.json({ error: 'invalid url', candidates: [] }, { status: 200 }); }
  url = parsed.href;

  // (1) Direct media short-circuit — by extension, then by content-type.
  if(MEDIA_RE.test(parsed.pathname)){
    return Response.json({ title: url, candidates: [{ src: url, kind: 'direct', score: 100 }], ambiguous: false });
  }
  const ct = await probeContentType(url);
  if(ct && (/^video\//i.test(ct) || /mpegurl/i.test(ct))){
    return Response.json({ title: url, candidates: [{ src: url, kind: 'direct', score: 100 }], ambiguous: false });
  }

  // (2)+(3) Static scan of the page, then of up to 5 iframe embeds (depth 1).
  let title = url, fetchStatus = 0, fetchError = null, html = '';
  const frameUrls = [];
  const cands = [];
  const merge = (list) => { for(const c of list) if(!cands.some(x=>x.src===c.src)) cands.push(c); };
  try{
    const page = await fetchText(url, 15000);
    fetchStatus = page.status; html = page.text;
    if(page.ok){
      title = pageTitle(html, url);
      merge(scanHtml(html, url));
      const iframes = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)]
        .map(m=>abs(m[1], url)).filter(u=>u && isHttp(u)).slice(0, 5);
      frameUrls.push(...iframes);
      for(const frameUrl of iframes){
        try{
          const fr = await fetchText(frameUrl, 10000);
          if(!fr.ok) continue;
          const playerish = /jwplayer|video\.js|plyr|flowplayer|<video/i.test(fr.text) || /player/i.test(pageTitle(fr.text, ''));
          for(const c of scanHtml(fr.text, frameUrl)){
            merge([{ ...c, kind: 'iframe-embed', score: c.score + (playerish ? 5 : 0), fromIframe: frameUrl }]);
          }
        }catch{ /* one bad iframe must not sink the page scan */ }
      }
    }
  }catch(e){ fetchError = e.message; }

  // (4) yt-dlp engine fallback: when the static scan found nothing, the fetch
  // failed, or nothing found is an actual media file (only embed pages etc.).
  let engineNote = null, engineError = null;
  const hasMedia = cands.some(c=>MEDIA_RE.test(c.src.split(/[?#]/)[0]));
  if(!hasMedia || !fetchStatus || fetchStatus >= 400){
    const fallbacks = [...cands.filter(c=>c.kind === 'og:video').map(c=>c.src), ...frameUrls];
    const eng = await ytDlpExtract(url, fallbacks);
    if(eng.candidates.length){
      merge(eng.candidates);
      if(eng.title && (title === url)) title = eng.title;
    } else if(eng.error){
      engineError = eng.error;
      engineNote = `yt-dlp: ${eng.error}`;
    }
  }

  // (5) Headless browser — last resort, only when no stage above produced a
  // playable media file (an embed-page candidate alone does not count).
  let headlessNote = null, headlessFound = false;
  const hasMediaNow = cands.some(c=>MEDIA_RE.test(c.src.split(/[?#]/)[0]));
  if(!hasMediaNow){
    const head = await extractWithHeadless(url, { timeoutMs: 60000 });
    if(head.candidates.length){
      merge(head.candidates);
      headlessFound = head.candidates.some(c=>MEDIA_RE.test(c.src.split(/[?#]/)[0]));
      if(head.title && (title === url)) title = head.title;
    }
    if(head.note) headlessNote = head.note;
  }

  if(!cands.length){
    const botWall = fetchStatus === 403 || /403|anti-bot|cloudflare/i.test(engineError || '') || /bot-check/i.test(headlessNote || '');
    if(botWall){
      engineNote = `This site appears to block automated access (anti-bot protection${fetchStatus === 403 ? ': the server fetch got HTTP 403' : ': the extractor hit an HTTP 403 anti-bot challenge'}), so its video player cannot be reached from the server.${engineNote ? ' ' + engineNote : ''}${headlessNote ? ' Headless browser: ' + headlessNote + '.' : ''} Workaround: paste the direct video/embed link if you can copy it from the player, or download the episode and upload the file instead.`;
    } else if(fetchError){
      engineNote = `Could not fetch that page from the server (${fetchError}).${engineNote ? ' ' + engineNote : ''}${headlessNote ? ' Headless browser: ' + headlessNote + '.' : ''} Try pasting the direct video link, or download the file and upload it instead.`;
    } else {
      engineNote = `No playable video was found by the page scan or the extractor engine.${engineNote ? ' ' + engineNote : ''}${headlessNote ? ' Headless browser: ' + headlessNote + '.' : ''}`;
    }
  }

  if(cands.length && !headlessFound) engineNote = null; // found by a fast stage: no note needed
  if(headlessFound) engineNote = 'Found by rendering the page in a headless browser and capturing the player\'s network requests (the page builds its player with JavaScript, so a plain fetch sees nothing).';
  cands.sort((a,b)=>b.score-a.score);
  const ambiguous = cands.length > 1 && (cands[0].score - (cands[1]?.score ?? 0)) < 20;
  return Response.json({ title, candidates: cands, ambiguous, ...(engineNote ? { engineNote } : {}) });
}
