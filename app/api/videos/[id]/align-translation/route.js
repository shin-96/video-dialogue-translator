import { requireUser } from '@/lib/api';
import { readDB, mutate } from '@/lib/store';
import { alignTranslation } from '@/lib/align';

export const maxDuration = 600;

// POST /api/videos/[id]/align-translation — (re)compute phrase-aligned
// translation word timings (sentence.twords, lib/align.js) for every
// translated sentence that carries REAL Whisper word timings. This is the
// repair path for videos translated before translation timing sync existed,
// or re-transcribed since: without twords the watch page falls back to a
// uniform progress sweep that desyncs from pauses in the speech.
export async function POST(req, { params }){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await params;
  const db = readDB();
  const v = db.videos.find(x=>x.id===id && x.userId===user.id);
  if(!v) return Response.json({ error:'not found' }, { status:404 });
  if(!v.translated || !v.target || !v.sourceLang) return Response.json({ error:'video is not translated yet — translate it first' }, { status:400 });

  const updates = new Map();
  let considered = 0;
  for(let i=0;i<v.sentences.length;i++){
    const s = v.sentences[i];
    if(!s.translation || !Array.isArray(s.words) || !s.words.length) continue;
    considered++;
    try{
      const tw = await alignTranslation(s, v.sourceLang, v.target);
      if(tw) updates.set(i, tw);
    }catch{ /* leave this sentence on the proportional fallback */ }
  }
  if(updates.size){
    mutate(d=>{
      const vid = d.videos.find(x=>x.id===id && x.userId===user.id);
      if(!vid) return;
      for(const [i, tw] of updates) vid.sentences[i].twords = tw;
      vid.translationTimingSource = 'phrase-align';
    });
  }
  return Response.json({ ok:true, aligned: updates.size, considered });
}
