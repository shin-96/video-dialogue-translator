import { requireUser } from '@/lib/api';
import { readDB, mutate, DAILY_QUOTA, quotaUsed, addQuota } from '@/lib/store';
import { estimateTranslation, countTokens } from '@/lib/text';
import { translateSentence } from '@/lib/translate';
export async function POST(req, { params }){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await params;
  const { target, source, partial } = await req.json().catch(()=>({}));
  if(!target || !source) return Response.json({ error:'source and target required' }, { status:400 });
  const db0 = readDB();
  const v0 = db0.videos.find(x=>x.id===id && x.userId===user.id);
  if(!v0) return Response.json({ error:'not found' }, { status:404 });
  if(!v0.sentences.length) return Response.json({ error:'no transcript to translate (ASR is not configured — paste a transcript or use the sample / a captioned YouTube video)' }, { status:400 });
  const remaining = DAILY_QUOTA - quotaUsed(db0, user.id);
  // Work out how many sentences fit the remaining quota (unless same language).
  let fit = v0.sentences.length, cost = 0;
  if(source !== target){
    fit = 0;
    for(const s of v0.sentences){
      const c = Math.ceil(countTokens(s.text) * 1.3);
      if(cost + c > remaining) break;
      cost += c; fit++;
    }
    if(fit === 0) return Response.json({ error:'quota exhausted for today', remaining }, { status:402 });
    if(fit < v0.sentences.length && !partial) return Response.json({ error:'insufficient quota for full translation', fit, total: v0.sentences.length, remaining, need: estimateTranslation(v0.sentences.map(s=>s.text).join(' ')).totalEstimate }, { status:402 });
  } else { cost = 0; fit = v0.sentences.length; }
  const results = [];
  for(let i=0;i<fit;i++){
    const s = v0.sentences[i];
    const tr = source===target ? s.text : await translateSentence(s.text, source, target);
    results.push(tr);
  }
  let failed = 0;
  mutate(d=>{
    const v = d.videos.find(x=>x.id===id && x.userId===user.id);
    results.forEach((tr,i)=>{ if(tr) v.sentences[i].translation = tr; else failed++; });
    v.translated = true; v.target = target; v.sourceLang = source; v.partialCount = fit;
    if(source!==target) addQuota(d, user.id, cost);
  });
  return Response.json({ ok:true, translatedCount: results.filter(Boolean).length, requested: fit, failed, charged: source===target?0:cost, partial: fit < v0.sentences.length });
}
