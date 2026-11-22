import { requireUser } from '@/lib/api';
import { readDB } from '@/lib/store';
// Exercises generated deterministically FROM saved items (easy -> medium -> hard).
export async function GET(){
  const { user, error } = await requireUser(); if(error) return error;
  const db = readDB();
  // Enrich older saves that lack a translation from their video's sentences.
  const saves = db.saves.filter(s=>s.userId===user.id).map(s=>{
    if(s.translation) return s;
    const vid = db.videos.find(v=>v.id===s.videoId);
    const match = vid && Array.isArray(vid.sentences)
      ? vid.sentences.find(x=>x.text===s.sentence || x.text===s.text) : null;
    return match && match.translation ? { ...s, translation: match.translation, sentence: s.sentence || match.text } : s;
  }).filter(s=>s.translation);
  if(saves.length < 1) return Response.json({ exercises: [], note:'Save at least 1 translated word/sentence first.' });
  const ex = [];
  // EASY: multiple choice — what does X mean (answer = its sentence translation)
  saves.slice(0,4).forEach((s,i)=>{
    const others = saves.filter(x=>x.id!==s.id).map(x=>x.translation);
    const opts = [s.translation, ...others.slice(0,2), '— none of the above —'].slice(0,3 + (others.length?1:0));
    // deterministic shuffle by index
    const shuffled = opts.map((o,k)=>[((k*7+i*3)%opts.length), o]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    ex.push({ id:'e'+i, level:'easy', type:'mcq', prompt:`What does “${s.text}” mean in context?`, context: s.sentence, options: shuffled, answer: s.translation, explain:`“${s.text}” appears in: “${s.sentence}” → “${s.translation}”.` });
  });
  // MEDIUM: fill in the blank from the original sentence
  saves.slice(0,3).forEach((s,i)=>{
    if(!s.sentence || !s.sentence.toLowerCase().includes(s.text.toLowerCase().split(' ')[0])) return;
    const blanked = s.sentence.replace(new RegExp(s.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i'), '_____');
    if(blanked !== s.sentence) ex.push({ id:'m'+i, level:'medium', type:'fill', prompt:'Fill in the blank:', context: blanked, hint: s.translation, answer: s.text, explain:`The missing part is “${s.text}” — full sentence: “${s.sentence}”.` });
  });
  // HARD: reorder + translate-back
  saves.slice(0,2).forEach((s,i)=>{
    const words = (s.sentence||s.text).split(/\s+/).filter(Boolean);
    if(words.length >= 3){
      const shuffled = [...words].reverse();
      ex.push({ id:'h'+i, level:'hard', type:'reorder', prompt:'Reorder the words into the original sentence:', words: shuffled, answer: s.sentence, explain:`Original: “${s.sentence}” → “${s.translation}”.` });
    }
    ex.push({ id:'ht'+i, level:'hard', type:'translate', prompt:`Translate back into the original language: “${s.translation}”`, answer: s.sentence || s.text, keywords: (s.sentence||s.text).toLowerCase().split(/\s+/).filter(w=>w.length>3), explain:`Reference: “${s.sentence||s.text}”. Grading is by keyword overlap (deterministic approximation, not an AI judge).` });
  });
  const order = { easy:0, medium:1, hard:2 };
  ex.sort((a,b)=>order[a.level]-order[b.level]);
  return Response.json({ exercises: ex });
}
