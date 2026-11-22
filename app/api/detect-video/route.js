export async function POST(req){
  const { url } = await req.json().catch(()=>({}));
  if(!url) return Response.json({ error:'url required' }, { status:400 });
  let html = '';
  try{
    const r = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0 (compatible; VDT/1.0)' }, signal: AbortSignal.timeout(15000), redirect:'follow' });
    html = await r.text();
  }catch(e){ return Response.json({ error:'could not fetch page: '+e.message, candidates:[] }, { status:200 }); }
  const cands = [];
  const push = (src, kind, score, extra={}) => { if(src && !cands.some(c=>c.src===src)) cands.push({ src, kind, score, ...extra }); };
  // og:video
  for(const m of html.matchAll(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) push(m[1], 'og:video', 90);
  for(const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/gi)) push(m[1], 'og:video', 90);
  // <video> tags
  for(const m of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)){
    const attrs = m[1], inner = m[2];
    const w = parseInt((attrs.match(/width=["']?(\d+)/)||[])[1]||'0');
    const poster = (attrs.match(/poster=["']([^"']+)["']/)||[])[1] || null;
    const srcM = attrs.match(/src=["']([^"']+)["']/);
    let score = 40 + (w>=640?25:w>=320?12:0) + (poster?10:0) + (/autoplay/.test(attrs)?-15:0);
    if(srcM) push(new URL(srcM[1], url).href, 'video-tag', score, { poster });
    for(const s of inner.matchAll(/<source[^>]+src=["']([^"']+)["']/gi)) push(new URL(s[1], url).href, 'video-tag', score, { poster });
  }
  for(const m of html.matchAll(/<source[^>]+src=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi)) push(new URL(m[1], url).href, 'source', 35);
  cands.sort((a,b)=>b.score-a.score);
  const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)||html.match(/<title>([^<]+)<\/title>/i)||[])[1] || url;
  return Response.json({ title, candidates: cands, ambiguous: cands.length>1 && (cands[0].score - (cands[1]?.score??0)) < 20 });
}
