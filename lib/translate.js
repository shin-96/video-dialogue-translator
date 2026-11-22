import { readDB, mutate } from './store';
// Free translation: MyMemory (no key) primary, LibreTranslate public fallback.
// Per-sentence cache in db.translations. Failures return null, never throw.
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
async function openRouter(text, source, target){
  const key = process.env.OPENROUTER_API_KEY;
  if(!key) return null;
  try{
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST', headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'openai/gpt-4o-mini', messages:[{role:'user', content:`Translate to ${target}, return only the translation:\n${text}`}] }),
      signal: AbortSignal.timeout(20000),
    });
    if(!r.ok) return null;
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() || null;
  }catch{ return null; }
}
export async function translateSentence(text, source, target){
  if(source === target) return text;
  const key = `${source}|${target}|${text}`;
  const db = readDB();
  if(db.translations[key]) return db.translations[key];
  let out = null;
  try{ out = await openRouter(text, source, target) || await myMemory(text, source, target) || await libre(text, source, target); }catch{ out = null; }
  if(out) mutate(d=>{ d.translations[key]=out; });
  return out;
}
