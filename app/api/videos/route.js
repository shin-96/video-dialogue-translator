import { requireUser } from '@/lib/api';
import { readDB, mutate, uid } from '@/lib/store';
import { SAMPLE } from '@/lib/sample';
import { splitSentences, mergeSegmentsToSentences } from '@/lib/text';
import { fetchSiteSubtitles } from '@/lib/vtt';

// Creation of a link video may spend up to ~90s trying to fetch the site's
// own subtitles (best-effort bonus) — allow the route enough time.
export const maxDuration = 180;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// Probe a remote stream the way a bare <video> tag would (no Referer). Some
// CDNs 403 that but happily serve when the embedding page is the Referer —
// those streams must be played through /api/proxy-stream instead.
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
export async function GET(){
  const { user, error } = await requireUser(); if(error) return error;
  const db = readDB();
  const saves = db.saves.filter(s=>s.userId===user.id);
  const list = db.videos.filter(v=>v.userId===user.id).map(v=>({
    id:v.id, title:v.title, kind:v.kind, thumb:v.thumb, duration:v.duration,
    progress:v.progress||0, translated:!!v.translated, target:v.target||null,
    savedCount: saves.filter(s=>s.videoId===v.id).length, createdAt:v.createdAt,
  })).sort((a,b)=>b.createdAt-a.createdAt);
  return Response.json({ videos:list });
}
export async function POST(req){
  const { user, error } = await requireUser(); if(error) return error;
  const body = await req.json().catch(()=>({}));
  const base = { id: uid(), userId: user.id, progress:0, createdAt: Date.now(), translated:false, sentences:[] };
  if(body.kind === 'sample'){
    Object.assign(base, { title: SAMPLE.title, kind:'sample', src: SAMPLE.src, thumb:null, duration: SAMPLE.duration, sentences: SAMPLE.sentences, transcriptSource: SAMPLE.transcriptSource });
  } else if(body.kind === 'youtube'){
    const idm = String(body.url||'').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/);
    if(!idm) return Response.json({ error:'not a valid YouTube link' }, { status:400 });
    const ytId = idm[1];
    let sentences = [], source = 'none', timed = false;
    try{
      const { YoutubeTranscript } = await import('youtube-transcript');
      const items = await YoutubeTranscript.fetchTranscript(ytId);
      if(items?.length){
        const clean = (txt)=> String(txt || '').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
        const raw = items.filter(it=>clean(it.text).trim());
        // Timed path: the captions API gives every segment an offset and a
        // duration — keep them. Segments are merged into real sentences
        // whose words inherit the segment spans, so a caption-sourced
        // video has REAL timings for phrase sync instead of word-less
        // fragments that only Whisper Align could rescue.
        if(raw.length && raw.every(it=>Number.isFinite(it.offset) && Number.isFinite(it.duration))){
          const segments = raw.map(it=>({ text: clean(it.text), start: it.offset/1000, end: (it.offset + it.duration)/1000 }));
          const merged = mergeSegmentsToSentences(segments);
          if(merged.length){ sentences = merged; source = 'YouTube captions'; timed = true; }
        }
        if(!sentences.length){
          // Plain fallback: a transcript source with no usable timing info
          // keeps the legacy per-segment sentences (no words, no timing
          // source) exactly as before.
          sentences = items.map(it=>({ text: clean(it.text), start: it.offset/1000, end: (it.offset + it.duration)/1000 }));
          source = 'YouTube captions';
        }
      }
    }catch{ /* no captions available */ }
    Object.assign(base, { title: body.title || `YouTube ${ytId}`, kind:'youtube', ytId, src: body.url, thumb:`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`, duration: sentences.length? sentences[sentences.length-1].end : 0, sentences, transcriptSource: source, ...(timed ? { timingSource: 'captions' } : {}) });
  } else if(body.kind === 'link' || body.kind === 'generic' || body.kind === 'upload'){
    const isLink = body.kind !== 'upload';
    const storedKind = body.kind === 'upload' ? 'upload' : 'link';
    Object.assign(base, { title: body.title || 'Video', kind: storedKind, src: body.src, thumb: body.thumb||null, duration: body.duration || 0, sentences: [], transcriptSource:'none', needsProxy: false, proxyReferer: null, pageUrl: isLink ? (body.pageUrl || null) : null });
    if(isLink && /^https?:\/\//i.test(body.src || '')){
      const pageRef = body.pageUrl || (()=>{ try{ return new URL(body.src).origin + '/'; }catch{ return null; } })();
      const probe = await probeStream(body.src, pageRef);
      base.needsProxy = probe.needsProxy;
      base.proxyReferer = probe.proxyReferer;
    }
    if(body.transcriptText){
      const texts = splitSentences(body.transcriptText);
      const per = 5;
      base.sentences = texts.map((t,i)=>({ text:t, start:i*per, end:(i+1)*per }));
      base.duration = texts.length*per; base.transcriptSource = 'manual paste';
    }
    // No transcript yet on a web-link video: try the SITE's own subtitles via
    // yt-dlp before falling back to "none" (the confirm page can still run
    // Whisper). Best-effort inside a ~90s budget — any failure just leaves
    // transcriptSource 'none', creation is never blocked by it.
    if(isLink && !base.sentences.length){
      const subs = await fetchSiteSubtitles([body.pageUrl, body.src], process.cwd()).catch(()=>null);
      if(subs?.sentences?.length){
        base.sentences = subs.sentences;
        base.transcriptSource = 'site subtitles (yt-dlp)';
        // Parsed VTT sentences carry caption-derived word timings.
        if(subs.sentences.some(s=>Array.isArray(s.words) && s.words.length)) base.timingSource = 'captions';
        base.subLang = subs.lang || null;
        const lastEnd = subs.sentences[subs.sentences.length-1].end;
        if(lastEnd > (base.duration || 0)) base.duration = lastEnd;
      }
    }
  } else return Response.json({ error:'unknown kind' }, { status:400 });
  mutate(d=>{ d.videos.push(base); });
  return Response.json({ video:{ id:base.id, title:base.title, sentenceCount: base.sentences.length, transcriptSource: base.transcriptSource } });
}
