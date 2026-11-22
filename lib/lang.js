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
  return Object.entries(counts).map(([code,n])=>({ code, pct: Math.round(n/total*100) })).sort((a,b)=>b.pct-a.pct);
}
