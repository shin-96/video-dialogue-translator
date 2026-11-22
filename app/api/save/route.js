import { requireUser } from '@/lib/api';
import { readDB, mutate, uid } from '@/lib/store';
export async function GET(){
  const { user, error } = await requireUser(); if(error) return error;
  const db = readDB();
  return Response.json({ saves: db.saves.filter(s=>s.userId===user.id).sort((a,b)=>b.createdAt-a.createdAt) });
}
export async function POST(req){
  const { user, error } = await requireUser(); if(error) return error;
  const b = await req.json().catch(()=>({}));
  if(!b.videoId || !b.text) return Response.json({ error:'videoId and text required' }, { status:400 });
  // Enrich from the video's translated sentences when the client did not send
  // a translation/sentence — a save without its translation is useless in the
  // notebook and silently produces zero exercises.
  let sentence = b.sentence||'', translation = b.translation||'';
  const vid = readDB().videos.find(v=>v.id===b.videoId && v.userId===user.id);
  if(vid && Array.isArray(vid.sentences)){
    const match = vid.sentences.find(s=> (sentence && s.text===sentence) || s.text===b.text)
      || vid.sentences.find(s=> s.text.toLowerCase().includes((b.text||'').toLowerCase()));
    if(match){ sentence = sentence || match.text; translation = translation || match.translation || ''; }
  }
  if((b.kind||'word')==='sentence' && !sentence) sentence = b.text;
  const item = { id: uid(), userId: user.id, videoId: b.videoId, kind: b.kind||'word', text: b.text,
    sentence, translation, timestamp: b.timestamp||0,
    createdAt: Date.now(), stage: 0, nextReview: Date.now(), lastReviewed: null };
  mutate(d=>{ d.saves.push(item); });
  return Response.json({ save: item });
}
export async function PATCH(req){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await req.json().catch(()=>({}));
  const intervals = [1,3,7,14,30];
  mutate(d=>{
    const s = d.saves.find(x=>x.id===id && x.userId===user.id);
    if(s){ s.stage = Math.min(s.stage+1, intervals.length-1); s.lastReviewed = Date.now(); s.nextReview = Date.now() + intervals[s.stage]*86400000; }
  });
  return Response.json({ ok:true });
}
export async function DELETE(req){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await req.json().catch(()=>({}));
  mutate(d=>{ d.saves = d.saves.filter(x=>!(x.id===id && x.userId===user.id)); });
  return Response.json({ ok:true });
}
