import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';

// Headless extraction layer — the last resort of detect-video.
// Static scan + yt-dlp only see what a plain HTTP fetch can read. JS-app
// streaming sites (e.g. motphim.skin, a Next.js shell) build their player in
// the browser, often inside cross-origin iframes, and only request the
// playlist after playback starts. A real Chromium can do what the fetch
// cannot: run the page, auto-play the player, and watch the network.
//
// Two capture channels, because neither alone is enough:
//  1. NETWORK capture at page AND browser-context level (context catches
//     popups/extra pages too). Playwright request events fire for *every*
//     frame — including cross-origin and nested iframes whose DOM is
//     unreachable — so the stream URL is caught even when the player lives
//     in a third-party embed. Each hit records which frame URL issued it.
//  2. DOM harvest: the extension finder (extension/finder.js) evaluated in
//     the main frame and every same-origin child frame.
// Always honest: if the site still shows a bot-check page, the returned
// `note` says so instead of pretending the page had no video.

const MEDIA_RE = /\.(m3u8|mp4|webm|mov)(\?|#|$)/i;
const AD_HOST_RE = /(doubleclick|googlesyndication|googleadservices|google-analytics|adservice|ads\d*\.|\.ads\.|taboola|outbrain|amazon-adsystem|adnxs|pubmatic|rubiconproject|scorecardresearch)/i;
const PLAYER_FRAME_RE = /(embed|player|stream|video|play)/i;
const BOT_CHECK_RE = /(kiểm tra|dang kiem tra|checking|just a moment|attention required|verify you are human|cloudflare|bot check|ddos)/i;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PLAY_SELECTORS = [
  '.vjs-big-play-button',
  '.jw-display-icon-container',
  '.jw-icon-display',
  '.plyr__control--overlaid',
  '[class*="big-play" i]',
  'button[class*="play" i]',
  '[aria-label*="play" i]',
];

function hostOf(u){ try{ return new URL(u).hostname; }catch{ return ''; } }
const sleep = (ms) => new Promise(r=>setTimeout(r, ms));

// Managed networks (this VM included) route traffic through an HTTP proxy
// named by the standard env vars; curl/Node honour them, Chromium does not —
// without this the browser dies with ERR_TUNNEL_CONNECTION_FAILED. Such
// proxies usually also intercept TLS with a locally-trusted CA that
// Chromium's own store rejects, so cert errors are ignored when (and only
// when) a proxy is in play or VDT_HEADLESS_IGNORE_CERT=1 is set. This is a
// read-only extraction browser; no user data is ever typed into it. The
// proxy credential is read at runtime and never logged or returned.
function envProxy(){
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if(!raw) return null;
  try{
    const u = new URL(raw);
    const cfg = { server: `${u.protocol}//${u.host}` };
    if(u.username) cfg.username = decodeURIComponent(u.username);
    if(u.password) cfg.password = decodeURIComponent(u.password);
    const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s=>s.trim()).filter(Boolean);
    if(noProxy.length) cfg.bypass = noProxy.join(',');
    return cfg;
  }catch{ return null; }
}

// Chromium in this VM cannot CONNECT through the egress proxy directly
// (its tunnel handshake is rejected — ERR_TUNNEL_CONNECTION_FAILED — even
// though the proxy answers byte-identical CONNECTs from curl/Node/Python
// with 200; verified by net-log + packet-level replay). Node's own CONNECT
// *is* accepted, so when an upstream proxy exists we interpose a tiny
// loopback relay: Chromium → 127.0.0.1 relay (plain, no auth) → upstream
// proxy (CONNECT with the env credentials) → target. The browser then just
// sees a well-behaved local proxy. On machines without a proxy env this
// never runs and Chromium connects directly.
function startLocalRelay(upstream){
  const up = new URL(upstream.server);
  const upCred = (upstream.username || upstream.password)
    ? 'Proxy-Authorization: Basic ' + Buffer.from(`${upstream.username || ''}:${upstream.password || ''}`).toString('base64') + '\r\n'
    : '';
  const sockets = new Set();
  const track = (s) => { sockets.add(s); s.on('close', ()=>sockets.delete(s)); return s; };
  const server = http.createServer();
  server.on('connect', (req, clientSock, head) => {
    track(clientSock);
    const upstreamSock = track(net.connect(Number(up.port) || 3128, up.hostname));
    let buf = Buffer.alloc(0), established = false;
    upstreamSock.on('data', (chunk) => {
      if(established) return; // pipe() takes over below; this listener only handles the handshake
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if(idx === -1) return;
      const statusLine = buf.slice(0, buf.indexOf('\r\n')).toString('latin1');
      if(!/^HTTP\/1\.[01] 200/.test(statusLine)){ clientSock.destroy(); upstreamSock.destroy(); return; }
      established = true;
      clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const rest = buf.slice(idx + 4);
      if(rest.length) clientSock.write(rest);
      if(head && head.length) upstreamSock.write(head);
      upstreamSock.pipe(clientSock); clientSock.pipe(upstreamSock);
    });
    upstreamSock.on('error', ()=>clientSock.destroy());
    clientSock.on('error', ()=>upstreamSock.destroy());
    upstreamSock.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n${upCred}Proxy-Connection: keep-alive\r\n\r\n`);
  });
  // Plain-HTTP proxy requests (absolute URI): forward through the upstream too.
  server.on('request', (req, res) => {
    const fwd = http.request({ host: up.hostname, port: Number(up.port) || 3128, method: req.method, path: req.url, headers: { ...req.headers, ...(upCred ? { 'Proxy-Authorization': upCred.trim() } : {}) } }, (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers); upRes.pipe(res);
    });
    fwd.on('error', ()=>{ try{ res.writeHead(502); res.end(); }catch{ /* gone */ } });
    req.pipe(fwd);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server: `http://127.0.0.1:${server.address().port}`,
      close(){ for(const s of sockets) { try{ s.destroy(); }catch{ /* ignore */ } } try{ server.close(); }catch{ /* ignore */ } },
    }));
  });
}

export async function extractWithHeadless(pageUrl, { timeoutMs = 60000 } = {}){
  if(process.env.VDT_HEADLESS === '0'){
    return { title: null, candidates: [], mediaRequests: [], note: 'headless extraction disabled (VDT_HEADLESS=0)' };
  }
  let pw;
  try{ pw = await import('playwright'); }
  catch{ return { title: null, candidates: [], mediaRequests: [], note: 'headless browser not installed (run scripts/setup-browser.sh)' }; }

  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  const bySrc = new Map();       // media URL -> candidate
  const mediaRequests = [];      // every media request seen {src, frameUrl}

  function noteRequest(req){
    try{
      const u = req.url();
      if(!MEDIA_RE.test(u)) return;                       // .ts segments never match
      if(AD_HOST_RE.test(hostOf(u))) return;
      let frameUrl = '';
      try{ frameUrl = req.frame()?.url() || ''; }catch{ /* frame may be gone */ }
      if(!bySrc.has(u)){
        const isHls = /\.m3u8(\?|#|$)/i.test(u);
        let score = isHls ? 85 : 75;
        if(PLAYER_FRAME_RE.test(frameUrl)) score += 10;
        bySrc.set(u, { src: u, kind: 'headless-network', score, frameUrl: frameUrl || undefined });
        mediaRequests.push({ src: u, frameUrl });
      }
    }catch{ /* a weird request must not sink the run */ }
  }
  // Response statuses prove whether a captured URL actually plays — some
  // pages carry a session-bound playlist URL in their payload that 404s on
  // any direct fetch, while the live player fetches a fresh signed one.
  function noteResponse(res){
    try{
      const u = res.url();
      if(!MEDIA_RE.test(u) || AD_HOST_RE.test(hostOf(u))) return;
      const status = res.status();
      const cand = bySrc.get(u);
      if(cand) cand.status = status;
      const seen = mediaRequests.find(m=>m.src===u);
      if(seen) seen.status = status;
    }catch{ /* ignore */ }
  }
  // A media request that never gets a response (CDN refuses the connection,
  // session-bound URL rejected, …) is marked status 0 so callers can tell a
  // captured-but-dead URL apart from a playing one.
  function noteRequestFailed(req){
    try{
      const u = req.url();
      if(!MEDIA_RE.test(u) || AD_HOST_RE.test(hostOf(u))) return;
      const cand = bySrc.get(u);
      if(cand && cand.status === undefined) cand.status = 0;
      const seen = mediaRequests.find(m=>m.src===u);
      if(seen && seen.status === undefined) seen.status = 0;
    }catch{ /* ignore */ }
  }

  let browser = null, title = null, navError = null, relay = null;
  try{
    browser = await pw.chromium.launch({
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required', // players must start without a user gesture
        '--mute-audio',
        '--no-sandbox',                               // required inside this VM/container
        '--disable-dev-shm-usage',
      ],
    });
    const upstreamProxy = envProxy();
    let proxyOpt = null;
    if(upstreamProxy){
      relay = await startLocalRelay(upstreamProxy);
      proxyOpt = { server: relay.server };
    }
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      viewport: { width: 1280, height: 800 },
      locale: 'vi-VN',
      ...(proxyOpt ? { proxy: proxyOpt } : {}),
      ignoreHTTPSErrors: !!upstreamProxy || process.env.VDT_HEADLESS_IGNORE_CERT === '1',
    });
    const page = await context.newPage();
    // Belt and braces: page-level fires for all frames of this page;
    // context-level also covers popups / auxiliary pages the site opens.
    page.on('request', noteRequest);
    context.on('request', noteRequest);
    page.on('response', noteResponse);
    context.on('response', noteResponse);
    page.on('requestfailed', noteRequestFailed);
    context.on('requestfailed', noteRequestFailed);

    try{
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(30000, remaining()) });
    }catch(e){ navError = e.message; }
    await sleep(Math.min(3000, remaining()));

    // ---- auto-play routine -------------------------------------------------
    // Many players only fetch the playlist/segments AFTER play starts, so
    // poke every accessible frame: mute+play every <video>, click the usual
    // big-play overlays, and click the centre of the largest iframe (where
    // a cross-origin player's own overlay usually sits).
    async function autoplayInFrame(frame){
      try{
        await frame.evaluate(() => {
          document.querySelectorAll('video').forEach(v => {
            try{ v.muted = true; v.defaultMuted = true; const p = v.play(); if(p && p.catch) p.catch(()=>{}); }catch(e){}
          });
        });
      }catch{ /* cross-origin frame: DOM unreachable, network still captured */ }
      for(const sel of PLAY_SELECTORS){
        if(remaining() <= 0) break;
        try{ await frame.click(sel, { timeout: 1200 }); break; }catch{ /* try next selector */ }
      }
      try{ await frame.click('video', { timeout: 1200 }); }catch{ /* no direct <video> here */ }
    }
    for(const frame of page.frames()){
      if(remaining() <= 0) break;
      await autoplayInFrame(frame);
    }
    try{
      const centre = await page.evaluate(() => {
        let best = null, bestArea = 0;
        document.querySelectorAll('iframe').forEach(f => {
          const r = f.getBoundingClientRect();
          const area = r.width * r.height;
          if(area > bestArea){ bestArea = area; best = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
        });
        return best;
      });
      if(centre) await page.mouse.click(centre.x, centre.y);
    }catch{ /* page may have navigated */ }
    // Second pass after clicks: overlays often swap in a fresh <video>.
    await sleep(Math.min(1500, remaining()));
    for(const frame of page.frames()){
      if(remaining() <= 0) break;
      try{
        await frame.evaluate(() => {
          document.querySelectorAll('video').forEach(v => {
            try{ v.muted = true; const p = v.play(); if(p && p.catch) p.catch(()=>{}); }catch(e){}
          });
        });
      }catch{ /* cross-origin */ }
    }

    // ---- wait for media, then a settle window for alternate renditions ----
    let foundAt = bySrc.size ? Date.now() : 0;
    while(remaining() > 0){
      if(bySrc.size && !foundAt) foundAt = Date.now();
      if(foundAt && Date.now() - foundAt >= 5000) break;
      await sleep(500);
    }

    try{ title = await page.title(); }catch{ /* ignore */ }

    // ---- DOM harvest (extension finder) in every accessible frame ---------
    let finderCode = '';
    try{ finderCode = fs.readFileSync(path.join(process.cwd(), 'extension', 'finder.js'), 'utf8'); }catch{ /* finder optional */ }
    if(finderCode){
      for(const frame of page.frames()){
        try{
          await frame.evaluate(finderCode);
          const res = await frame.evaluate(() => window.__vdtResult || null);
          if(res && Array.isArray(res.candidates)){
            for(const c of res.candidates){
              if(!c?.src || bySrc.has(c.src)) continue;
              bySrc.set(c.src, { src: c.src, kind: 'headless-dom', score: c.score, via: c.kind });
            }
          }
          if(!title && res?.title) title = res.title;
        }catch{ /* cross-origin frame: skip — network capture already covered it */ }
      }
    }

    const candidates = [...bySrc.values()].sort((a,b)=>b.score-a.score);
    let note = null;
    if(!candidates.length){
      let finalUrl = '';
      try{ finalUrl = page.url(); }catch{ /* ignore */ }
      if((title && BOT_CHECK_RE.test(title)) || BOT_CHECK_RE.test(finalUrl)){
        note = `headless browser also hit a bot-check page (title: "${title || '?'}") — the site's anti-bot wall stops automated browsers too`;
      } else if(navError){
        note = `headless browser could not load the page (${String(navError).split('\n')[0].slice(0, 160)})`;
      } else {
        note = `headless browser loaded the page (title: "${title || '?'}") and auto-played it, but no media stream was requested — the player may need a server/episode selection click or a login`;
      }
    }
    return { title: title || null, candidates, mediaRequests, note };
  }catch(e){
    return { title, candidates: [...bySrc.values()], mediaRequests, note: `headless extraction failed: ${String(e.message || e).split('\n')[0].slice(0, 200)}` };
  }finally{
    if(browser){ try{ await browser.close(); }catch{ /* already gone */ } }
    if(relay){ try{ relay.close(); }catch{ /* already gone */ } }
  }
}
