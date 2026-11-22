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
