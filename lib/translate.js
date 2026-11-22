import { readDB, mutate } from './store';
// Free translation chain (no key): Google Translate "gtx" endpoint first —
// markedly better quality than MyMemory, esp. zh→vi — then MyMemory, then
// LibreTranslate public. gtx is an unofficial endpoint: any failure (non-200,
// parse error, empty result) falls through to the next engine silently.
// Per-sentence cache in db.translations. Failures return null, never throw.
function gtxCode(code){ return code === 'zh' ? 'zh-CN' : code; }
async function googleGtx(text, source, target){
  try{
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${gtxCode(source)}&tl=${gtxCode(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if(!r.ok) return null;
    const j = await r.json();
    const segs = j?.[0];
    if(!Array.isArray(segs)) return null;
    const out = segs.map(s => (Array.isArray(s) ? s[0] : '') || '').join('');
    return out.trim() ? out : null;
  }catch{ return null; }
}
async function myMemory(text, source, target){
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if(!r.ok) return null;
  const j = await r.json();
  const out = j?.responseData?.translatedText;
  if(!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out)) return null;
  return out;
}
async function libre(text, source, target){
  const r = await fetch('https://libretranslate.com/translate', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ q:text, source, target, format:'text' }),
    signal: AbortSignal.timeout(12000),
  });
  if(!r.ok) return null;
  const j = await r.json();
  return j?.translatedText || null;
}
export async function translateSentence(text, source, target){
  if(source === target) return text;
  const key = `${source}|${target}|${text}`;
  const db = readDB();
  if(db.translations[key]) return db.translations[key];
  let out = null;
  try{ out = await googleGtx(text, source, target) || await myMemory(text, source, target) || await libre(text, source, target); }catch{ out = null; }
  if(out) mutate(d=>{ d.translations[key]=out; });
  return out;
}
