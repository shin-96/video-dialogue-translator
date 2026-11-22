import { currentUser } from '@/lib/auth';
import { readDB, mutate, uid } from '@/lib/store';

// POST /api/import-stream — used by the VDT Companion browser extension.
// Streaming sites with anti-bot walls / JS players hide their stream URL
// from the server, but the user's own browser already loaded it; the
// extension harvests that URL and posts it here. Auth: the session cookie
// OR an Authorization: Bearer <importToken> (see /api/import-token).
// CORS is open on purpose: the caller is the user's own extension popup.
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST',
};

export async function OPTIONS(){
  return new Response(null, { status: 204, headers: CORS });
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// Same probe as the link-creation path in /api/videos: fetch the stream the
// way a bare <video> tag would (no Referer). If that is refused but the
// embedding page as Referer works, the video must play via /api/proxy-stream.
async function probeStream(src, referer){
  const attempt = async (ref) => {
    try{
      const headers = { 'User-Agent': BROWSER_UA, 'Range': 'bytes=0-1023' };
      if(ref) headers['Referer'] = ref;
      const r = await fetch(src, { headers, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      try{ r.body?.cancel(); }catch{}
      return r.status;
    }catch{ return 0; }
  };
  const direct = await attempt(null);
  if(direct === 200 || direct === 206) return { needsProxy: false, proxyReferer: null };
  if(referer){
    const viaRef = await attempt(referer);
    if(viaRef === 200 || viaRef === 206) return { needsProxy: true, proxyReferer: referer };
  }
  return { needsProxy: false, proxyReferer: null };
}

function bearerUser(req){
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if(!m) return null;
  const token = m[1].trim();
  if(!token) return null;
  const db = readDB();
  return db.users.find(u=>u.importToken && u.importToken === token) || null;
}

export async function POST(req){
  const user = (await currentUser()) || bearerUser(req);
  if(!user) return Response.json({ error:'login required or valid import token' }, { status:401, headers: CORS });

  const body = await req.json().catch(()=>({}));
  const src = typeof body.src === 'string' ? body.src.trim() : '';
  if(!/^https?:\/\//i.test(src)) return Response.json({ error:'src must be an http(s) stream URL' }, { status:400, headers: CORS });
  const pageUrl = typeof body.pageUrl === 'string' && /^https?:\/\//i.test(body.pageUrl.trim()) ? body.pageUrl.trim() : null;
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 300) : 'Video';

  // Record shape mirrors kind:'link' creation in /api/videos.
  const base = { id: uid(), userId: user.id, progress: 0, createdAt: Date.now(), translated: false, sentences: [] };
  Object.assign(base, { title, kind: 'link', src, thumb: null, duration: 0, sentences: [], transcriptSource: 'none', needsProxy: false, proxyReferer: null, pageUrl });
  const pageRef = pageUrl || (()=>{ try{ return new URL(src).origin + '/'; }catch{ return null; } })();
  const probe = await probeStream(src, pageRef);
  base.needsProxy = probe.needsProxy;
  base.proxyReferer = probe.proxyReferer;

  mutate(d=>{ d.videos.push(base); });
  return Response.json({ id: base.id, confirmUrl: `/confirm/${base.id}` }, { headers: CORS });
}
