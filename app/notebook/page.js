'use client';
import { useEffect, useState } from 'react';
import { fmtTime } from '@/lib/text';
export default function Notebook(){
  const [saves,setSaves] = useState(null); const [err,setErr] = useState('');
  function load(){ fetch('/api/save').then(async r=>{ const j=await r.json(); if(!r.ok) throw new Error(j.error); setSaves(j.saves); }).catch(e=>setErr(e.message)); }
  useEffect(load,[]);
  async function review(id){ await fetch('/api/save',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); load(); }
  async function del(id){ await fetch('/api/save',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); load(); }
  if(err) return <p style={{color:'#ff8a70'}}>{err} — <a href="/auth" style={{color:'#FF4D00'}}>log in</a></p>;
  if(!saves) return <p className="muted">Loading…</p>;
  const due = saves.filter(s=> (s.nextReview||0) <= Date.now());
  return (<div><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
      <h1 style={{letterSpacing:'-.03em'}}>Notebook</h1>
      <a className="btn" href="/notebook/review">Review & exercises ({due.length} due) →</a></div>
    <p className="muted small">{saves.length} saved items · {due.length} due for review (intervals: 1 → 3 → 7 → 14 → 30 days)</p>
    {saves.length===0 && <p className="muted">Nothing saved yet. Open a video, click a word or the 🔖 on a sentence.</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14,marginTop:16}}>
      {saves.map(s=>(<div key={s.id} className="card">
        <div style={{display:'flex',justifyContent:'space-between'}}><span className="small" style={{color:'#FF4D00',fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em'}}>{s.kind}</span>
          <span className="small muted">{(s.nextReview||0)<=Date.now()?'● due':'next: '+new Date(s.nextReview).toLocaleDateString()}</span></div>
        <b style={{fontSize:17,display:'block',marginTop:6}}>{s.text}</b>
        {s.sentence && s.sentence!==s.text && <div className="small" style={{marginTop:6}}>“{s.sentence}”</div>}
        {s.translation && <div className="small muted" style={{marginTop:4}}>→ {s.translation}</div>}
        <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
          <a className="btn-ghost" style={{padding:'6px 12px',fontSize:12}} href={`/watch/${s.videoId}?t=${Math.floor(s.timestamp)}`}>▶ at {fmtTime(s.timestamp)}</a>
          <button className="btn-ghost" style={{padding:'6px 12px',fontSize:12}} onClick={()=>review(s.id)}>Mark reviewed</button>
          <button className="btn-ghost" style={{padding:'6px 12px',fontSize:12}} onClick={()=>del(s.id)}>Delete</button>
        </div></div>))}
    </div></div>);
}
