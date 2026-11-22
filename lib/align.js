import { translateSentence } from './translate';

// Phrase-level alignment between a sentence's REAL Whisper word timings and
// its translation. The old karaoke mapped translation words by overall voice
// progress (a uniform sweep by character length), so pauses and fast/slow
// stretches desynced the highlighted meaning from the speech. Here the
// translation instead inherits REAL time spans: the source words are cut
// into phrases at speech pauses / punctuation, each phrase is translated on
// its own, and the phrase's tokens are located inside the full translation —
// those tokens then light inside the phrase's spoken span.

export const PHRASE_GAP_SECONDS = 0.30;
const PUNCT_RE = /[,，、;；:：—…]/;
const CJK_RE = /[㐀-䶿一-鿿぀-ヿ가-힯]/; // CJK + kana + hangul ranges

// Cut real word timings into phrases: a new phrase starts after a pause of
// >= PHRASE_GAP_SECONDS or after sentence-internal punctuation.
export function segmentPhrases(words){
  const phrases = [];
  let cur = [];
  (words || []).forEach((w, i, arr) => {
    cur.push(w);
    const next = arr[i + 1];
    if(!next || next.start - w.end >= PHRASE_GAP_SECONDS || PUNCT_RE.test(w.w)){
      phrases.push(cur);
      cur = [];
    }
  });
  if(cur.length) phrases.push(cur);
  return phrases;
}

function phraseText(words){
  const joined = words.some(w => CJK_RE.test(w.w))
    ? words.map(w => w.w).join('')
    : words.map(w => w.w).join(' ');
  return joined.replace(/\s+([,.;:!?…—])/g, '$1').trim();
}

// Matching is forgiving: case, punctuation and Vietnamese diacritics are
// stripped so a phrase translation produced in isolation still matches the
// same words inside the full-sentence translation.
export function normToken(tok){
  return String(tok).toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const round3 = (x) => Math.round(x * 1000) / 1000;

// Distribute one phrase's translation tokens over its source words. Equal
// counts pair 1:1 in order; otherwise tokens are mapped to source words by
// proportional duration position and subdivide that word's span by length.
function distribute(pwords, toks){
  const out = [];
  if(pwords.length === toks.length){
    toks.forEach((tok, j) => out.push({ w: tok, start: round3(pwords[j].start), end: round3(pwords[j].end) }));
    return out;
  }
  const durs = pwords.map(w => Math.max(0.01, w.end - w.start));
  const total = durs.reduce((a, b) => a + b, 0);
  const cum = [0];
  durs.forEach(d => cum.push(cum[cum.length - 1] + d / total));
  const groups = pwords.map(() => []);
  toks.forEach((tok, j) => {
    const c = (j + 0.5) / toks.length;
    let wi = -1;
    for(let i = 0; i < pwords.length; i++){ if(c >= cum[i] && c < cum[i + 1]){ wi = i; break; } }
    if(wi < 0) wi = pwords.length - 1;
    groups[wi].push(tok);
  });
  groups.forEach((gtoks, wi) => {
    if(!gtoks.length) return;
    const ws = pwords[wi];
    const tl = gtoks.reduce((a, t) => a + [...t].length, 0) || 1;
    let tt = ws.start;
    gtoks.forEach(tok => {
      const d = (ws.end - ws.start) * ([...tok].length / tl);
      out.push({ w: tok, start: round3(tt), end: round3(tt + d) });
      tt += d;
    });
  });
  return out;
}

// Full alignment with internals exposed (phrase segmentation + the token
// range each phrase was assigned) — the measurement scripts use this as the
// reference segmentation. Returns null when alignment is impossible.
export async function alignTranslationDetailed(sentence, source, target){
  const words = sentence?.words;
  if(!Array.isArray(words) || !words.length || !sentence?.translation) return null;
  const phrases = segmentPhrases(words);
  if(!phrases.length) return null;

  // Per-phrase translations. A single-phrase sentence needs no extra call:
  // its phrase translation IS the sentence translation.
  let phraseTrs;
  if(phrases.length === 1){
    phraseTrs = [sentence.translation];
  } else {
    phraseTrs = await Promise.all(phrases.map(async (p) => {
      const txt = phraseText(p);
      if(!txt) return '';
      try { return (await translateSentence(txt, source, target)) || ''; }
      catch { return ''; }
    }));
  }

  const fullTokens = sentence.translation.split(/\s+/).filter(Boolean);
  if(!fullTokens.length) return null;
  const normFull = fullTokens.map(normToken);

  // Assign each phrase a contiguous token range [a, b) of the full
  // translation. Ranges partition the token list in order.
  const ranges = new Array(phrases.length).fill(null);
  let pos = 0;
  for(let k = 0; k < phrases.length; k++){
    if(k === phrases.length - 1){ ranges[k] = [pos, fullTokens.length]; pos = fullTokens.length; break; }
    const ptoks = (phraseTrs[k] || '').split(/\s+/).filter(Boolean).map(normToken).filter(Boolean);
    let found = -1;
    if(ptoks.length){
      outer:
      for(let i = pos; i + ptoks.length <= fullTokens.length; i++){
        for(let j = 0; j < ptoks.length; j++){
          if(normFull[i + j] !== ptoks[j]) continue outer;
        }
        found = i;
        break;
      }
    }
    if(found >= 0){
      // Tokens skipped before the match are leftovers of the translation:
      // they join the previous phrase (or this one, if it is the first).
      if(k > 0 && ranges[k - 1]) ranges[k - 1][1] = found;
      ranges[k] = [k > 0 ? found : pos, found + ptoks.length];
      pos = found + ptoks.length;
    } else {
      // No contiguous match (the engine reworded the phrase inside the full
      // sentence): fall back to a proportional slice of the remaining
      // tokens, weighted by phrase-translation character length.
      const remTokens = fullTokens.length - pos;
      const remChars = phraseTrs.slice(k).reduce((a, t) => a + [...(t || '')].length, 0) || 1;
      const share = [...(phraseTrs[k] || '')].length / remChars;
      const n = Math.max(0, Math.min(remTokens, Math.round(remTokens * share)));
      ranges[k] = [pos, pos + n];
      pos += n;
    }
  }

  const twords = [];
  phrases.forEach((pwords, k) => {
    const [a, b] = ranges[k] || [0, 0];
    const toks = fullTokens.slice(a, b);
    if(toks.length) twords.push(...distribute(pwords, toks));
  });
  if(!twords.length) return null;
  return { twords, phrases, ranges, phraseTrs };
}

export async function alignTranslation(sentence, source, target){
  const d = await alignTranslationDetailed(sentence, source, target);
  return d ? d.twords : null;
}
