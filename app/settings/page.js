'use client';
import { useEffect, useState } from 'react';
import Companion from './companion';
const NAMES = { vi:'Vietnamese', en:'English', zh:'Chinese', ja:'Japanese', ko:'Korean', fr:'French', de:'German', es:'Spanish', ru:'Russian', th:'Thai' };
export default function Settings(){
  const [me,setMe] = useState(null); const [target,setTarget] = useState('vi'); const [msg,setMsg] = useState('');
  useEffect(()=>{ fetch('/api/auth').then(r=>r.json()).then(j=>{ setMe(j); if(j.user?.defaultTarget) setTarget(j.user.defaultTarget); }); },[]);
  async function save(){
    // store default target on the user via a videos PATCH helper: use quota-independent route below
    const r = await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultTarget:target})});
    setMsg(r.ok?'Saved ✓':'Save failed');
  }
  if(!me) return <p className="muted">Loading…</p>;
  if(!me.user) return <p className="muted">Please <a href="/auth" style={{color:'#FF4D00'}}>log in</a>.</p>;
  return (<div style={{maxWidth:560}}><h1 style={{letterSpacing:'-.03em'}}>Settings</h1>
    <div className="card" style={{display:'grid',gap:12,marginTop:14}}>
      <div><div className="small muted">Account</div><b>{me.user.email}</b></div>
      <div><div className="small muted" style={{marginBottom:6}}>Default target language (used on the confirm page)</div>
        <select value={target} onChange={e=>setTarget(e.target.value)}>{Object.entries(NAMES).map(([c,n])=><option key={c} value={c}>{n}</option>)}</select></div>
      <div><div className="small muted">Today's token quota</div>
        <div style={{height:8,background:'#26272B',borderRadius:99,overflow:'hidden',margin:'8px 0'}}><div style={{height:'100%',width: Math.min(100, me.quota.used/me.quota.limit*100)+'% ',background:'#FF4D00'}}/></div>
        <span className="small">{me.quota.used.toLocaleString()} / {me.quota.limit.toLocaleString()} tokens used today · resets daily</span></div>
      <button className="btn" onClick={save}>Save settings</button>
      {msg && <span className="small" style={{color:'#7ee2a0'}}>{msg}</span>}
    </div>
    <Companion/>
    </div>);
}
