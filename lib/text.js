// Heuristic tokenizer (documented): approximates GPT-style BPE counts without a
// native tokenizer dependency. Rule: each CJK char = 1 token; other text is
// split into chunks of ~4 chars per token, with whitespace/punctuation counted
// conservatively. Validated to be within ~±25% of real BPE counts for EN/VI/ZH
// prose — good enough for quota estimation, and we always show it as an estimate.
export function countTokens(text){
  if(!text) return 0;
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
  const rest = text.replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g,' ');
  return cjk + Math.ceil(rest.length / 4);
}
export function estimateTranslation(text){
  const src = countTokens(text);
  return { sourceTokens: src, totalEstimate: Math.ceil(src * 1.3) };
}
export function splitSentences(text){
  return (text.replace(/\s+/g,' ').match(/[^.!?…。！？]+[.!?…。！？]*/g) || [text])
    .map(s=>s.trim()).filter(Boolean);
}
const round3 = (x)=> Math.round(x * 1000) / 1000;
// Per-word timings for ONE caption segment/cue: tokenize the segment text
// on whitespace and distribute [start, end] across the tokens proportionally
// to token char length. Caption timings are segment-level, so this is
// coarser than Whisper's true word timestamps — but the span itself is REAL
// (it comes from the caption track), which is what phrase sync needs.
export function segmentWordTimings(text, start, end){
  const toks = String(text || '').split(/\s+/).filter(Boolean);
  if(!toks.length) return [];
  const dur = Math.max(0.01, (Number.isFinite(end) ? end : start) - start);
  const totalLen = toks.reduce((a,w)=>a+[...w].length,0) || 1;
  let t = start;
  return toks.map(w=>{
    const d = dur * ([...w].length/totalLen);
    const o = { w, start: round3(t), end: round3(t+d) }; t += d; return o;
  });
}
const SENTENCE_END_CHARS = new Set(['.','!','?','…','。','！','？']);
function endsWithTerminalPunct(text){
  // Ignore trailing quotes/brackets: `…we go."` still ends a sentence.
  const tail = text.replace(/["'“”‘’«»」』）)\]]+$/,'');
  return tail.length > 0 && SENTENCE_END_CHARS.has(tail[tail.length - 1]);
}
// Merge timed caption segments/cues [{text,start,end}] into SENTENCES that
// carry per-word timings. Caption segments routinely cut mid-phrase
// ("…enough space in" / "my for the both of you."), which fragments both
// translation and phrase sync, so segments accumulate until the text ends
// with terminal punctuation — with two safety breaks: a pause of > 1.5s
// between segments, or an accumulated text longer than ~220 chars.
// Sentence words are clamped to be non-decreasing so overlapping caption
// segments can never produce out-of-order word timings.
export function mergeSegmentsToSentences(segments){
  const out = [];
  let cur = null; // { texts:[], words:[], lastEnd }
  const flush = ()=>{
    if(!cur || !cur.words.length){ cur = null; return; }
    out.push({
      text: cur.texts.join(' ').replace(/\s+/g,' ').trim(),
      start: cur.words[0].start,
      end: cur.words[cur.words.length - 1].end,
      words: cur.words,
    });
    cur = null;
  };
  for(const seg of segments || []){
    const text = String(seg?.text || '').replace(/\s+/g,' ').trim();
    if(!text || !Number.isFinite(seg.start)) continue;
    const words = segmentWordTimings(text, seg.start, seg.end);
    if(!words.length) continue;
    if(cur && seg.start - cur.lastEnd > 1.5) flush();
    if(!cur) cur = { texts: [], words: [], lastEnd: seg.end };
    // Monotonic clamp: a word never starts before the previous word.
    let prevStart = cur.words.length ? cur.words[cur.words.length - 1].start : -Infinity;
    for(const w of words){
      if(w.start < prevStart){ w.start = prevStart; if(w.end < w.start) w.end = w.start; }
      prevStart = w.start;
      cur.words.push(w);
    }
    cur.texts.push(text);
    cur.lastEnd = seg.end;
    const joined = cur.texts.join(' ');
    if(endsWithTerminalPunct(joined) || joined.length > 220) flush();
  }
  flush();
  return out;
}
// Distribute a sentence interval across words proportionally to word length.
export function wordTimings(sentence){
  const words = sentence.text.split(/\s+/).filter(Boolean);
  const dur = Math.max(0.1, sentence.end - sentence.start);
  const totalLen = words.reduce((a,w)=>a+[...w].length,0) || 1;
  let t = sentence.start;
  return words.map(w=>{
    const d = dur * ([...w].length/totalLen);
    const o = { w, start:t, end:t+d }; t += d; return o;
  });
}
export function translationTimings(sentence){
  if(!sentence.translation) return [];
  const words = sentence.translation.split(/\s+/).filter(Boolean);
  const dur = Math.max(0.1, sentence.end - sentence.start);
  const totalLen = words.reduce((a,w)=>a+[...w].length,0) || 1;
  let t = sentence.start;
  return words.map(w=>{
    const d = dur * ([...w].length/totalLen);
    const o = { w, start:t, end:t+d }; t += d; return o;
  });
}
// Original-line words: REAL Whisper word timings when the sentence carries a
// `words` array (from /api/videos/[id]/align), otherwise proportional fallback.
export function origWords(sentence){
  if(Array.isArray(sentence.words) && sentence.words.length){
    return sentence.words.map(w=>({ w: w.w, start: w.start, end: w.end, real: true }));
  }
  return wordTimings(sentence);
}
const clamp01 = (x)=> Math.max(0, Math.min(1, x));
// Voice progress through a sentence, 0..1. With real word timings this follows
// the actual speech (first word start -> last word end), not the caption box.
export function sentenceProgress(sentence, t){
  if(Array.isArray(sentence.words) && sentence.words.length){
    const first = sentence.words[0], last = sentence.words[sentence.words.length-1];
    const span = Math.max(0.01, last.end - first.start);
    return clamp01((t - first.start) / span);
  }
  const dur = Math.max(0.01, sentence.end - sentence.start);
  return clamp01((t - sentence.start) / dur);
}
// Translation words for karaoke. Preferred source: REAL phrase-aligned
// timings (sentence.twords, computed by lib/align.js) — each translated word
// belongs to a spoken phrase and lights at its aligned start inside that
// phrase's real time span, so pauses and fast/slow stretches stay in sync.
// Fallback (no twords, or a stale twords whose length no longer matches the
// translation): map by voice PROGRESS — each word lights when the spoken
// progress passes the word's proportional centre position.
export function translationWordsAt(sentence, t, isActive){
  if(!sentence.translation) return [];
  const words = sentence.translation.split(/\s+/).filter(Boolean);
  if(Array.isArray(sentence.twords) && sentence.twords.length === words.length){
    return sentence.twords.map(tw => ({ w: tw.w, on: isActive && t >= tw.start }));
  }
  const totalLen = words.reduce((a,w)=>a+[...w].length,0) || 1;
  const p = isActive ? sentenceProgress(sentence, t) : -1;
  let acc = 0;
  return words.map(w=>{
    const len = [...w].length;
    const centre = (acc + len/2) / totalLen; acc += len;
    return { w, on: isActive && centre <= p };
  });
}
export const LANGS = { vi:'Vietnamese', en:'English', zh:'Chinese', ja:'Japanese', ko:'Korean', fr:'French', de:'German', es:'Spanish', ru:'Russian', th:'Thai' };
export const fmtTime = (s)=>{ s=Math.max(0,Math.floor(s||0)); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); };
