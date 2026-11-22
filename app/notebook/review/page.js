'use client';
import { useEffect, useState } from 'react';
export default function Review(){
  const [ex,setEx] = useState(null); const [note,setNote] = useState('');
  const [ans,setAns] = useState({}); const [result,setResult] = useState(null);
  useEffect(()=>{ fetch('/api/exercises').then(r=>r.json()).then(j=>{ setEx(j.exercises||[]); setNote(j.note||''); }).catch(()=>setEx([])); },[]);
  if(!ex) return <p className="muted">Loading…</p>;
  function grade(){
    let score=0; const detail = ex.map(e=>{
      const a = ans[e.id];
      let ok=false, got = a ?? '';
      if(e.type==='mcq') ok = a === e.answer;
      else if(e.type==='fill') ok = String(a||'').trim().toLowerCase() === e.answer.toLowerCase();
      else if(e.type==='reorder') ok = String(a||'').trim().replace(/\s+/g,' ') === e.answer;
      else if(e.type==='translate'){ const words = String(a||'').toLowerCase().split(/\s+/); const hit = (e.keywords||[]).filter(k=>words.some(w=>w.includes(k.replace(/[^\p{L}\p{N}]/gu,'')))); ok = e.keywords?.length? (hit.length / e.keywords.length) >= 0.5 : false; got = `${hit.length}/${e.keywords?.length||0} keywords`; }
      if(ok) score++;
      return { id:e.id, ok, got, explain:e.explain, answer:e.answer };
    });
    setResult({ score, total: ex.length, detail });
  }
  const LV = { easy:'#7ee2a0', medium:'#ffd166', hard:'#ff8a70' };
  return (<div style={{maxWidth:720,margin:'0 auto'}}>
    <h1 style={{letterSpacing:'-.03em'}}>Review — exercises from your notebook</h1>
    <p className="muted small">Generated from your saved items, easy → medium → hard. Objective questions are graded deterministically; translate-back is graded by keyword overlap and says so.</p>
    {note && <p className="muted">{note}</p>}
    {ex.length===0 && !note && <p className="muted">No exercises yet — save some translated words/sentences first.</p>}
    {ex.map((e,i)=>(<div key={e.id} className="card" style={{marginTop:14}}>
      <span className="small" style={{color:LV[e.level],fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em'}}>{e.level}</span>
      <div style={{fontWeight:600,marginTop:6}}>{i+1}. {e.prompt}</div>
      {e.context && <div className="small muted" style={{marginTop:4}}>“{e.context}”</div>}
      {e.hint && <div className="small muted">Hint (translation): {e.hint}</div>}
      {e.type==='mcq' && <div style={{display:'grid',gap:8,marginTop:10}}>{e.options.map((o,k)=>(<button key={k} onClick={()=>setAns({...ans,[e.id]:o})} className={ans[e.id]===o?'btn':'btn-ghost'} style={{textAlign:'left',padding:'9px 13px',fontSize:13}}>{o}</button>))}</div>}
      {e.type==='fill' && <input style={{width:'100%',marginTop:10}} placeholder="Type the missing word/phrase…" value={ans[e.id]||''} onChange={ev=>setAns({...ans,[e.id]:ev.target.value})}/>}
      {e.type==='reorder' && <><div className="small" style={{marginTop:8}}>Words: {e.words.join(' · ')}</div><input style={{width:'100%',marginTop:8}} placeholder="Type the sentence in the correct order…" value={ans[e.id]||''} onChange={ev=>setAns({...ans,[e.id]:ev.target.value})}/></>}
      {e.type==='translate' && <textarea rows={2} style={{width:'100%',marginTop:10}} placeholder="Type your translation…" value={ans[e.id]||''} onChange={ev=>setAns({...ans,[e.id]:ev.target.value})}/>}
      {result && (()=>{ const d = result.detail.find(x=>x.id===e.id); return <div style={{marginTop:10,fontSize:13,color: d.ok?'#7ee2a0':'#ff8a70'}}>{d.ok?'✓ Correct':'✗ Not quite'} — {d.explain}</div>; })()}
    </div>))}
    {ex.length>0 && <button className="btn" style={{marginTop:18}} onClick={grade}>Submit & grade</button>}
    {result && <div className="card" style={{marginTop:16}}><b style={{fontSize:18}}>Score: {result.score} / {result.total}</b><div className="small muted" style={{marginTop:4}}>Explanations are shown per question above.</div></div>}
  </div>);
}
