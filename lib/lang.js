import { franc } from 'franc';
const MAP = { eng:'en', vie:'vi', cmn:'zh', zho:'zh', jpn:'ja', kor:'ko', fra:'fr', deu:'de', spa:'es', rus:'ru', tha:'th', und:null };
export function detectSentence(text){ return MAP[franc(text||'')] || null; }
export function detectLanguages(sentences){
  const counts = {}; let known = 0;
  for(const s of sentences){
    const l = detectSentence(s.text);
    if(l){ counts[l]=(counts[l]||0)+1; known++; }
  }
  const total = known || sentences.length || 1;
  const voted = Object.entries(counts).map(([code,n])=>({ code, pct: Math.round(n/total*100) })).sort((a,b)=>b.pct-a.pct);
  if(voted.length) return voted;
  // franc returns 'und' for very short strings, and Whisper segments are
  // often short phrases — per-sentence voting can come back empty even on a
  // full transcript. Fall back to detecting on the joined text, where franc
  // has enough signal.
  const joined = sentences.map(s=>s.text).join(' ').slice(0, 4000);
  const l = detectSentence(joined);
  return l ? [{ code: l, pct: 100 }] : [];
}
