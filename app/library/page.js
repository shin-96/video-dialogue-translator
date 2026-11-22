'use client';
import { useEffect, useState } from 'react';
import { fmtTime } from '@/lib/text';
export default function Library(){
  const [list,setList] = useState(null); const [err,setErr] = useState('');
  useEffect(()=>{ fetch('/api/videos').then(async r=>{ const j=await r.json(); if(!r.ok) throw new Error(j.error); setList(j.videos); }).catch(e=>setErr(e.message)); },[]);
  if(err) return <p style={{color:'#ff8a70'}}>{err} — <a href="/auth" style={{color:'#FF4D00'}}>log in</a></p>;
  if(!list) return <p className="muted">Loading…</p>;
  return (<div><h1 style={{letterSpacing:'-.03em'}}>Videos you watched</h1>
    {list.length===0 && <p className="muted">Nothing yet. <a href="/" style={{color:'#FF4D00',fontWeight:600}}>Add your first video →</a></p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:14,marginTop:16}}>
      {list.map(v=>{ const pct = v.duration? Math.min(100,Math.round((v.progress||0)/v.duration*100)) : 0;
        return (<div key={v.id} className="card" style={{padding:0,overflow:'hidden'}}>
          {v.thumb ? <img src={v.thumb} alt="" style={{width:'100%',aspectRatio:'16/9',objectFit:'cover'}}/> : <div style={{aspectRatio:'16/9',background:'#16171B',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26}}>◐</div>}
          <div style={{padding:12}}>
            <b style={{fontSize:14,display:'block',lineHeight:1.35}}>{v.title}</b>
            <div className="small muted" style={{marginTop:4}}>{v.kind} · {v.translated?`translated → ${v.target}`:'not translated'} · {v.savedCount} saved</div>
            <div style={{height:4,background:'#26272B',borderRadius:99,marginTop:8,overflow:'hidden'}}><div style={{height:'100%',width:pct+'%',background:'#FF4D00'}}/></div>
            <div className="small muted" style={{marginTop:5}}>{fmtTime(v.progress)} / {fmtTime(v.duration)} · {pct}%</div>
            <a className="btn-white" style={{display:'inline-block',padding:'7px 14px',fontSize:12,marginTop:9}} href={`/watch/${v.id}`}>{v.progress>2?'Resume ▶':'Watch ▶'}</a>
          </div></div>); })}
    </div></div>);
}
