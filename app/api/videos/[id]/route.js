import { requireUser } from '@/lib/api';
import { readDB, mutate } from '@/lib/store';
import { detectLanguages } from '@/lib/lang';
import { estimateTranslation } from '@/lib/text';
import { DAILY_QUOTA, quotaUsed } from '@/lib/store';
export async function GET(req, { params }){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await params;
  const db = readDB();
  const v = db.videos.find(x=>x.id===id && x.userId===user.id);
  if(!v) return Response.json({ error:'not found' }, { status:404 });
  const fullText = v.sentences.map(s=>s.text).join(' ');
  const est = estimateTranslation(fullText);
  const used = quotaUsed(db, user.id);
  return Response.json({ video: v, detection: detectLanguages(v.sentences), estimate: est, quota:{ used, limit: DAILY_QUOTA, remaining: DAILY_QUOTA-used } });
}
export async function PATCH(req, { params }){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await params;
  const body = await req.json().catch(()=>({}));
  mutate(d=>{
    const v = d.videos.find(x=>x.id===id && x.userId===user.id);
    if(!v) return;
    if(typeof body.progress === 'number') v.progress = body.progress;
    if(typeof body.duration === 'number' && body.duration>0) v.duration = body.duration;
    if(body.defaultTarget) { const u = d.users.find(x=>x.id===user.id); if(u) u.defaultTarget = body.defaultTarget; }
  });
  return Response.json({ ok:true });
}
