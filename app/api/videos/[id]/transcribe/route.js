import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { requireUser } from '@/lib/api';
import { readDB, mutate } from '@/lib/store';
import { resolveVenv, venvPython, pythonEnv } from '@/lib/venv';
import { resolveAudioFile } from '@/lib/asrAudio';

const run = promisify(execFile);
export const maxDuration = 600;

// POST /api/videos/[id]/transcribe — give ANY video a transcript by actually
// listening to it: resolve its audio (local file, yt-dlp download, or a
// direct stream pull), run Whisper with word timestamps, and REPLACE the
// sentences with the real segments. This is the unlock for link/generic
// videos that arrived with no captions and no site subtitles.
// On "no speech" the old sentences are kept and the caller gets a 422.
export async function POST(req, { params }){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await params;
  const body = await req.json().catch(()=>({}));
  const db = readDB();
  const v = db.videos.find(x=>x.id===id && x.userId===user.id);
  if(!v) return Response.json({ error:'not found' }, { status:404 });

  const root = process.cwd();
  const venv = resolveVenv(root);
  const py = venv ? venvPython(venv) : null;
  const script = path.join(root,'scripts','asr_words.py');
  if(!py || !fs.existsSync(script)){
    return Response.json({ error:'ASR not installed on server: run scripts/setup-asr.sh (creates the Whisper venv outside the repo)' }, { status:500 });
  }

  let resolved;
  try{
    resolved = await resolveAudioFile(v, root);
  }catch(e){
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
  const inputFile = resolved.file;
  if(!inputFile || !fs.existsSync(inputFile)){
    resolved.cleanup();
    return Response.json({ error:'no local audio source for this video' }, { status:400 });
  }

  const lang = body.language || v.sourceLang || 'auto';
  // Model choice: an explicit per-request pick from the confirm page wins,
  // then the server env, then 'base' (tiny proved too rough for real use).
  const MODELS = ['tiny','base','small','medium'];
  const model = MODELS.includes(body.model) ? body.model : (process.env.WHISPER_MODEL || 'base');
  let asr;
  try{
    const { stdout } = await run(py, [script,'--input',inputFile,'--language',String(lang)],
      { timeout: 600000, maxBuffer: 64*1024*1024, env: pythonEnv({ WHISPER_MODEL: model }) });
    const start = stdout.indexOf('{');
    asr = JSON.parse(stdout.slice(start));
  }catch(e){
    resolved.cleanup();
    return Response.json({ error:'Whisper failed: '+((e.stderr?.toString().slice(-400)) || e.message) }, { status:500 });
  }
  resolved.cleanup();

  const segments = (asr.sentences || []).filter(s => s.text && s.text.trim());
  const wordCount = segments.reduce((n, s) => n + (s.words?.length || 0), 0);
  if(!segments.length || !wordCount){
    return Response.json({ error:'Whisper found no speech in this video — nothing was changed. (Music-only or silent videos cannot be transcribed.)' }, { status:422 });
  }

  let sentenceCount = 0;
  mutate(d=>{
    const vid = d.videos.find(x=>x.id===id && x.userId===user.id);
    if(!vid) return;
    vid.sentences = segments.map(s=>({ text: s.text, start: s.start, end: s.end, words: s.words || [] }));
    sentenceCount = vid.sentences.length;
    vid.duration = vid.sentences[vid.sentences.length-1].end || vid.duration;
    vid.transcriptSource = 'whisper-asr';
    vid.timingSource = 'whisper';
    vid.whisperLanguage = asr.language || null;
    if(asr.language) vid.sourceLang = asr.language;
    // Old translations were aligned to the old sentences — they no longer
    // belong to this transcript.
    vid.translated = false; vid.target = null; vid.partialCount = undefined;
  });

  return Response.json({ ok:true, transcriptSource:'whisper-asr', timingSource:'whisper', language: asr.language || null, sentences: sentenceCount, words: wordCount });
}
