'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
const NAMES = { vi:'Vietnamese', en:'English', zh:'Chinese', ja:'Japanese', ko:'Korean', fr:'French', de:'German', es:'Spanish', ru:'Russian', th:'Thai' };
export default function Confirm(){
  const { id } = useParams();
  const [data,setData] = useState(null); const [err,setErr] = useState('');
  const [source,setSource] = useState(''); const [target,setTarget] = useState('vi');
  const [busy,setBusy] = useState(false); const [msg,setMsg] = useState('');
  useEffect(()=>{ fetch(`/api/videos/${id}`).then(async r=>{ const j=await r.json(); if(!r.ok) throw new Error(j.error); setData(j);
    if(j.detection?.[0]) setSource(j.detection[0].code);
    fetch('/api/auth').then(r=>r.json()).then(m=>{ if(m.user?.defaultTarget) setTarget(m.user.defaultTarget); }).catch(()=>{});
  }).catch(e=>setErr(e.message)); },[id]);
  if(err) return <p style={{color:'#ff8a70'}}>{err}</p>;
  if(!data) return <p className="muted">Loading…</p>;
  const v = data.video;
  const insufficient = data.estimate.totalEstimate > data.quota.remaining && source !== target;
  async function go(partial){
    setBusy(true); setMsg('');
    const r = await fetch(`/api/videos/${id}/translate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,target,partial})});
    const j = await r.json(); setBusy(false);
    if(!r.ok){ setMsg(j.error + (j.fit? ` — ${j.fit}/${j.total} sentences fit your remaining quota. Use the partial button below.` : '')); return; }
    location.href = `/watch/${id}`;
  }
  return (<div style={{maxWidth:680,margin:'20px auto'}}>
    <h1 style={{letterSpacing:'-.03em',fontSize:26}}>Confirm before translating</h1>
    <p className="muted small">Nothing is charged until you confirm on this page.</p>
    <div className="card" style={{marginTop:14,display:'grid',gap:12}}>
      <div><b>{v.title}</b><div className="small muted">{v.kind} · transcript: {v.transcriptSource} · {v.sentences.length} sentences</div>
        {v.thumb && <img src={v.thumb} alt="" style={{width:220,borderRadius:10,marginTop:8}}/>}</div>
      {v.sentences.length===0 && <div style={{color:'#ffb59d',fontSize:13}}>⚠ No transcript found for this video. ASR is not configured in this MVP — go back and paste a transcript manually, or use a captioned YouTube video / the sample.</div>}
      <div>
        <div className="small muted" style={{marginBottom:6}}>Detected language(s) in the transcript — confirm the source language:</div>
        {data.detection.length===0 && <span className="small">Could not detect (no transcript?)</span>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {data.detection.map(d=>(<button key={d.code} onClick={()=>setSource(d.code)} className={source===d.code?'btn':'btn-ghost'} style={{padding:'7px 13px',fontSize:13}}>{NAMES[d.code]||d.code} — {d.pct}%</button>))}
        </div>
      </div>
      <div>
        <div className="small muted" style={{marginBottom:6}}>Translate into:</div>
        <select value={target} onChange={e=>setTarget(e.target.value)}>
          {Object.entries(NAMES).map(([c,n])=><option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <div className="small" style={{background:'#08090A',border:'1px solid #26272B',borderRadius:10,padding:12,lineHeight:1.7}}>
        Real token count of full transcript (heuristic tokenizer): <b>{data.estimate.sourceTokens.toLocaleString()}</b><br/>
        Estimated total incl. translation (×1.3): <b>{data.estimate.totalEstimate.toLocaleString()}</b><br/>
        Your quota today: <b>{data.quota.used.toLocaleString()} / {data.quota.limit.toLocaleString()}</b> used, <b>{data.quota.remaining.toLocaleString()}</b> remaining.
      </div>
      {msg && <div style={{color:'#ff8a70',fontSize:13}}>{msg}</div>}
      {v.translated
        ? <a className="btn" style={{textAlign:'center'}} href={`/watch/${id}`}>Already translated — go to watch →</a>
        : insufficient
          ? <><div style={{color:'#ffb59d',fontSize:13}}>Not enough quota left today for the full video.</div>
              <button className="btn" disabled={busy||!source} onClick={()=>go(true)}>{busy?'Translating…':'Translate the first part that fits my quota'}</button></>
          : <button className="btn" disabled={busy||!source||v.sentences.length===0} onClick={()=>go(false)}>{busy?'Translating… (this can take a while)':'Confirm & translate →'}</button>}
    </div>
  </div>);
}
