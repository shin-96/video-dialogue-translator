import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveVenv, venvPython, ytDlpBaseArgs, pythonEnv } from '@/lib/venv';

const run = promisify(execFile);

// Parse a WebVTT document into timed sentences [{text,start,end}].
// Handles both timestamp shapes (HH:MM:SS.mmm and MM:SS.mmm), strips cue
// settings/tags/entities, and undoes "rolling caption" duplication used by
// auto-generated tracks (each cue repeats the previous line and appends the
// next fragment): a cue that merely extends the previous one contributes
// only its new tail, a cue fully contained in the previous one is dropped.
function tsToSec(ts){
  const parts = ts.trim().split(':').map(Number);
  if(parts.some(Number.isNaN)) return null;
  if(parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if(parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}
export function parseVttToSentences(vtt){
  const blocks = String(vtt || '').replace(/\r\n?/g, '\n').split(/\n\n+/);
  const out = [];
  for(const block of blocks){
    const lines = block.split('\n').filter(l => l.trim() !== '');
    const ti = lines.findIndex(l => l.includes('-->'));
    if(ti < 0) continue;
    const m = lines[ti].match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/);
    if(!m) continue;
    const start = tsToSec(m[1].replace(',', '.'));
    const end = tsToSec(m[2].replace(',', '.'));
    if(start === null || end === null || end <= start) continue;
    const text = lines.slice(ti + 1).join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if(!text) continue;
    const prev = out[out.length - 1];
    if(prev){
      if(text === prev.text) continue;                    // exact duplicate cue
      if(prev.text.startsWith(text)) continue;            // cue is a prefix of prev
      if(text.startsWith(prev.text)){                     // rolling caption: keep only the new tail
        const tail = text.slice(prev.text.length).trim();
        if(!tail) continue;
        out.push({ text: tail, start, end });
        continue;
      }
    }
    out.push({ text, start, end });
  }
  return out;
}

// Best-effort site-subtitle fetch for link/generic videos, via the venv's
// yt-dlp (`--write-subs --write-auto-subs --sub-format vtt --skip-download`).
// Tries each target (page URL first, then the stream URL) inside one shared
// ~90s budget. Returns { sentences, lang } or null on ANY failure — callers
// must treat subtitles as a bonus, never a creation blocker.
export async function fetchSiteSubtitles(targets, root){
  const venv = resolveVenv(root);
  if(!venv) return null;
  const py = venvPython(venv);
  if(!py) return null;
  const list = [...new Set((targets || []).filter(u => /^https?:\/\//i.test(u || '')))];
  if(!list.length) return null;
  const deadline = Date.now() + 90000;
  for(const target of list){
    const remaining = deadline - Date.now();
    if(remaining < 5000) break;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdt-subs-'));
    try{
      // A non-zero exit must NOT discard tracks that already downloaded:
      // with --sub-langs all, platforms (YouTube especially) rate-limit the
      // long tail of auto-translated tracks (HTTP 429) after the real ones
      // are safely on disk. So: run, tolerate failure, then scan the dir.
      await run(py, [...ytDlpBaseArgs(venv),
        '--write-subs', '--write-auto-subs', '--sub-langs', 'all', '--sub-format', 'vtt',
        '--skip-download', '--no-playlist', '--socket-timeout', '15',
        '-o', path.join(tmpDir, '%(id)s.%(ext)s'), target],
        { timeout: remaining, maxBuffer: 32 * 1024 * 1024, env: pythonEnv() }).catch(() => {});
      const vtts = fs.readdirSync(tmpDir).filter(f => f.toLowerCase().endsWith('.vtt'));
      if(!vtts.length) continue;
      // Largest track wins (fullest transcript); language code comes from the
      // yt-dlp filename shape "<id>.<lang>.vtt".
      vtts.sort((a, b) => fs.statSync(path.join(tmpDir, b)).size - fs.statSync(path.join(tmpDir, a)).size);
      const file = vtts[0];
      const stem = file.slice(0, -4);
      const lang = stem.includes('.') ? stem.split('.').pop() : null;
      const sentences = parseVttToSentences(fs.readFileSync(path.join(tmpDir, file), 'utf8'));
      if(sentences.length) return { sentences, lang };
    }catch{ /* best-effort: try the next target / give up quietly */ }
    finally{ try{ fs.rmSync(tmpDir, { recursive: true, force: true }); }catch{} }
  }
  return null;
}
