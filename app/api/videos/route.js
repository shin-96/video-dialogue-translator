import { requireUser } from '@/lib/api';
import { readDB, mutate, uid } from '@/lib/store';
import { SAMPLE } from '@/lib/sample';
import { splitSentences } from '@/lib/text';
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
    let sentences = [], source = 'none';
    try{
      const { YoutubeTranscript } = await import('youtube-transcript');
      const items = await YoutubeTranscript.fetchTranscript(ytId);
      if(items?.length){
        sentences = items.map(it=>({ text: it.text.replace(/&amp;/g,'&').replace(/&#39;/g,"'"), start: it.offset/1000, end: (it.offset + it.duration)/1000 }));
        source = 'YouTube captions';
      }
    }catch{ /* no captions available */ }
    Object.assign(base, { title: body.title || `YouTube ${ytId}`, kind:'youtube', ytId, src: body.url, thumb:`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`, duration: sentences.length? sentences[sentences.length-1].end : 0, sentences, transcriptSource: source });
  } else if(body.kind === 'generic' || body.kind === 'upload'){
    Object.assign(base, { title: body.title || 'Video', kind: body.kind, src: body.src, thumb: body.thumb||null, duration: 0, sentences: [], transcriptSource:'none' });
    if(body.transcriptText){
      const texts = splitSentences(body.transcriptText);
      const per = 5;
      base.sentences = texts.map((t,i)=>({ text:t, start:i*per, end:(i+1)*per }));
      base.duration = texts.length*per; base.transcriptSource = 'manual paste';
    }
  } else return Response.json({ error:'unknown kind' }, { status:400 });
  mutate(d=>{ d.videos.push(base); });
  return Response.json({ video:{ id:base.id, title:base.title, sentenceCount: base.sentences.length, transcriptSource: base.transcriptSource } });
}
