import { requireUser } from '@/lib/api';
import { readDB, mutate } from '@/lib/store';
import { alignTranslation, mapLimit } from '@/lib/align';

export const maxDuration = 600;

// POST /api/videos/[id]/align-translation — (re)compute phrase-aligned
// translation word timings (sentence.twords, lib/align.js) for translated
// sentences that carry REAL Whisper word timings. This is the repair path
// for videos translated before translation timing sync existed, or
// re-transcribed since: without twords the watch page falls back to a
// uniform progress sweep that desyncs from pauses in the speech.
//
// CHUNKED by design: aligning a whole long video in ONE request meant
// hundreds of sequential phrase-translation calls — the fetch died before
// finishing and nothing was saved (real user failure). The caller passes
// { from, limit } to sync a window of sentences per request; each window
// is saved before responding, so an interrupted sync resumes cheaply.
// With no body the whole video is processed (backward compatible).
//
// Response stats describe the PROCESSED WINDOW (except `total`, which is
// the video's full sentence count):
//   aligned               sentences that received (new) twords
//   skippedNoWords        translated sentences with no real Whisper
//                         `words` (phrase sync is impossible for them —
//                         the voice timings simply do not exist yet)
//   skippedNoTranslation  sentences with no translation to sync
//   processedUntil        first sentence index NOT processed
//   done                  processedUntil >= total
// Never a silent no-op: the counts always say what happened.
export async function POST(req, { params }){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await params;
  const body = await req.json().catch(()=>({}));
  const db = readDB();
  const v = db.videos.find(x=>x.id===id && x.userId===user.id);
  if(!v) return Response.json({ error:'not found' }, { status:404 });
  if(!v.translated || !v.target || !v.sourceLang) return Response.json({ error:'video is not translated yet — translate it first' }, { status:400 });

  const total = v.sentences.length;
  const from = Number.isInteger(body.from) ? Math.max(0, Math.min(body.from, total)) : 0;
  const limit = Number.isInteger(body.limit) && body.limit > 0 ? body.limit : total;
  const until = Math.min(total, from + limit);

  const idx = [];
  for(let i=from;i<until;i++) idx.push(i);
  // Sentences in the window are aligned concurrently (bounded); the
  // translation engine itself is capped at 4 calls in flight inside
  // lib/align.js, and single-phrase sentences cost no call at all.
  const outcomes = await mapLimit(idx, 4, async (i)=>{
    const s = v.sentences[i];
    if(!s.translation) return 'noTranslation';
    if(!Array.isArray(s.words) || !s.words.length) return 'noWords';
    try{
      const tw = await alignTranslation(s, v.sourceLang, v.target);
      return tw ? { tw } : 'failed';
    }catch{ return 'failed'; /* leave this sentence on the proportional fallback */ }
  });

  const updates = new Map();
  let aligned = 0, skippedNoWords = 0, skippedNoTranslation = 0;
  outcomes.forEach((o, k)=>{
    if(o === 'noTranslation') skippedNoTranslation++;
    else if(o === 'noWords') skippedNoWords++;
    else if(o && typeof o === 'object'){ updates.set(idx[k], o.tw); aligned++; }
  });
  if(updates.size){
    mutate(d=>{
      const vid = d.videos.find(x=>x.id===id && x.userId===user.id);
      if(!vid) return;
      for(const [i, tw] of updates) vid.sentences[i].twords = tw;
      vid.translationTimingSource = 'phrase-align';
    });
  }
  const processedUntil = until;
  const considered = aligned + skippedNoWords; // translated sentences examined for sync
  return Response.json({ ok:true, aligned, skippedNoWords, skippedNoTranslation, total, considered, from, processedUntil, done: processedUntil >= total });
}
