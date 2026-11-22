import { requireUser } from '@/lib/api';

export const maxDuration = 300;

// GET /api/proxy-stream?u=<stream url>&r=<referer>
// Some CDNs only serve a stream when the request carries the Referer of the
// page that embeds it — a browser <video> tag cannot set that header, so the
// server fetches on its behalf. HLS playlists are rewritten so every segment
// and key URL also comes back through this proxy (same referer preserved).
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function GET(req){
  const { user, error } = await requireUser(); if(error) return error;
  const sp = new URL(req.url).searchParams;
  const u = sp.get('u') || '';
  const r = sp.get('r') || '';
  if(!/^https?:\/\//i.test(u)) return Response.json({ error: 'bad url' }, { status: 400 });

  const headers = { 'User-Agent': BROWSER_UA, 'Accept': '*/*' };
  if(r) headers['Referer'] = r;
  const range = req.headers.get('range');
  if(range) headers['Range'] = range;

  let up;
  try{
    up = await fetch(u, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  }catch(e){
    return Response.json({ error: 'upstream fetch failed: ' + e.message }, { status: 502 });
  }

  const ct = up.headers.get('content-type') || '';
  const isPlaylist = /mpegurl/i.test(ct) || /\.m3u8(\?|#|$)/i.test(u);
  if(isPlaylist && up.ok){
    const text = await up.text();
    const proxied = (target) => `/api/proxy-stream?u=${encodeURIComponent(target)}&r=${encodeURIComponent(r)}`;
    const out = text.split('\n').map(line=>{
      const trimmed = line.trim();
      if(!trimmed) return line;
      if(trimmed.startsWith('#')){
        // #EXT-X-KEY / #EXT-X-MEDIA / #EXT-X-I-FRAME-STREAM-INF carry URI="..."
        return line.replace(/URI="([^"]+)"/g, (m, uri)=>{
          try{ return `URI="${proxied(new URL(uri, u).href)}"`; }catch{ return m; }
        });
      }
      try{ return proxied(new URL(trimmed, u).href); }catch{ return line; }
    }).join('\n');
    return new Response(out, { status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' } });
  }

  const outHeaders = new Headers();
  for(const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']){
    const val = up.headers.get(h);
    if(val) outHeaders.set(h, val);
  }
  return new Response(up.body, { status: up.status, headers: outHeaders });
}
