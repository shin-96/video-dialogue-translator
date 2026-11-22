'use client';
import { useState } from 'react';
export default function Auth(){
  const [mode,setMode] = useState('login');
  const [email,setEmail] = useState(''); const [password,setPassword] = useState(''); const [name,setName] = useState('');
  const [err,setErr] = useState(''); const [busy,setBusy] = useState(false);
  async function submit(e){
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:mode,email,password,name})});
    const j = await r.json(); setBusy(false);
    if(!r.ok){ setErr(j.error||'failed'); return; }
    location.href='/';
  }
  return (<div style={{maxWidth:420,margin:'40px auto'}}>
    <h1 style={{letterSpacing:'-.03em'}}>{mode==='login'?'Welcome back':'Create your account'}</h1>
    <p className="muted small">Your library, notebook and daily token quota are saved to your account.</p>
    <form onSubmit={submit} className="card" style={{display:'grid',gap:10,marginTop:16}}>
      {mode==='register' && <input placeholder="Display name" value={name} onChange={e=>setName(e.target.value)}/>}
      <input placeholder="Email" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/>
      <input placeholder="Password (min 6 chars)" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/>
      {err && <div style={{color:'#ff8a70',fontSize:13}}>{err}</div>}
      <button className="btn" disabled={busy}>{busy?'Please wait…':(mode==='login'?'Log in':'Register')}</button>
    </form>
    <p className="small muted" style={{marginTop:12}}>{mode==='login'?'No account yet?':'Already have an account?'}{' '}
      <a href="#" onClick={e=>{e.preventDefault();setMode(mode==='login'?'register':'login');}} style={{color:'#FF4D00',fontWeight:600}}>{mode==='login'?'Register':'Log in'}</a></p>
  </div>);
}
