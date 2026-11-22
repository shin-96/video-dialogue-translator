import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { requireUser } from '@/lib/api';
import { readDB, mutate } from '@/lib/store';
import { resolveVenv, venvPython } from '@/lib/venv';
import { resolveAudioFile } from '@/lib/asrAudio';

const run = promisify(execFile);
export const maxDuration = 600;

// POST /api/videos/[id]/align — align sentence timings to the REAL voice using
// Whisper word timestamps (scripts/asr_words.py, faster-whisper).
// Audio resolution is shared with the transcribe route (lib/asrAudio.js):
// local file for sample/upload, yt-dlp download for YouTube and web links.
// If the video already has caption sentences, Whisper words are MAPPED onto
// them (caption text kept); otherwise Whisper segments become the sentences.
// On any failure the video keeps its proportional fallback timings untouched.
export async function POST(req, { params }){
  const { user, error } = await requireUser(); if(error) return error;
  const { id } = await params;
  const body = await req.json().catch(()=>({}));
  const db = readDB();
  const v = db.videos.find(x=>x.id===id && x.userId===user.id);
  if(!v) return Response.json({ error:'not found' }, { status:404 });

  const root = process.cwd();
  // Venv lives OUTSIDE the repo by default (it is ~500MB and must never be
  // committed): $ASR_VENV, else ~/workspace/vdt-whisper-venv, else legacy
  // scripts/.venv. Create it with scripts/setup-asr.sh.
  const venv = resolveVenv(root);
  const py = venv ? venvPython(venv) : null;
  const script = path.join(root,'scripts','asr_words.py');
  if(!py || !fs.existsSync(script)){
    return Response.json({ error:'ASR not installed on server: run scripts/setup-asr.sh (creates the Whisper venv outside the repo)' }, { status:500 });
  }

  // --- resolve an audio/video file Whisper can read (shared with the
  // transcribe route: sample / upload / YouTube / web-link all supported) ---
  let resolved;
  try{
    resolved = await resolveAudioFile(v, root);
  }catch(e){
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
  const inputFile = resolved.file;
  const cleanup = resolved.cleanup;
  if(!inputFile || !fs.existsSync(inputFile)){
    cleanup();
    return Response.json({ error:'no local audio source for this video' }, { status:400 });
  }

  // --- run Whisper ------------------------------------------------------------
  const lang = body.language || v.sourceLang || 'auto';
  let asr;
  try{
    const { stdout } = await run(py, [script,'--input',inputFile,'--language',String(lang)],
      { timeout: 600000, maxBuffer: 64*1024*1024, env:{ ...process.env, WHISPER_MODEL: process.env.WHISPER_MODEL || 'tiny' } });
    const start = stdout.indexOf('{');
    asr = JSON.parse(stdout.slice(start));
  }catch(e){
    cleanup();
    return Response.json({ error:'Whisper failed: '+((e.stderr?.toString().slice(-400)) || e.message) }, { status:500 });
  }
  cleanup();

  const whisperWords = [];
  for(const seg of (asr.sentences||[])) for(const w of (seg.words||[])) whisperWords.push(w);
  if(!whisperWords.length){
    return Response.json({ error:'Whisper found no speech in this video — keeping previous timings' }, { status:500 });
  }

  // --- map words onto caption sentences, or adopt Whisper segments -----------
  let sentenceCount = 0, wordCount = 0;
  mutate(d=>{
    const vid = d.videos.find(x=>x.id===id && x.userId===user.id);
    if(!vid) return;
    if(Array.isArray(vid.sentences) && vid.sentences.length){
      for(const s of vid.sentences) delete s.words;
      for(const w of whisperWords){
        const mid = (w.start + w.end) / 2;
        let target = vid.sentences.find(s=> mid >= s.start && mid < s.end);
        if(!target){ // gap between captions: nearest sentence wins
          let best = Infinity;
          for(const s of vid.sentences){
            const dist = mid < s.start ? s.start - mid : mid - s.end;
            if(dist < best){ best = dist; target = s; }
          }
        }
        if(target){ (target.words ||= []).push({ w:w.w, start:w.start, end:w.end }); wordCount++; }
      }
      for(const s of vid.sentences) if(s.words) s.words.sort((a,b)=>a.start-b.start);
      sentenceCount = vid.sentences.length;
    } else {
      vid.sentences = asr.sentences.map(s=>({ text:s.text, start:s.start, end:s.end, words:s.words }));
      sentenceCount = vid.sentences.length;
      wordCount = whisperWords.length;
      vid.duration = vid.sentences.length ? vid.sentences[vid.sentences.length-1].end : vid.duration;
      vid.transcriptSource = 'Whisper (word timestamps)';
    }
    vid.timingSource = 'whisper';
    vid.whisperLanguage = asr.language || null;
    if(!vid.sourceLang && asr.language) vid.sourceLang = asr.language;
  });

  return Response.json({ ok:true, timingSource:'whisper', language: asr.language || null, sentences: sentenceCount, words: wordCount });
}
