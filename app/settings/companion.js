'use client';
import { useEffect, useState } from 'react';

// "Browser companion" settings card: shows the user's import token for the
// VDT Companion Chrome extension. The extension runs on streaming pages the
// server cannot read (anti-bot walls, JS players), harvests the stream URL
// from the user's own browser, and POSTs it to /api/import-stream with this
// token as a Bearer credential.
export default function Companion(){
  const [token,setToken] = useState('');
  const [show,setShow] = useState(false);
  const [msg,setMsg] = useState('');

  useEffect(()=>{
    fetch('/api/import-token').then(r=>r.json()).then(j=>{ if(j.token) setToken(j.token); }).catch(()=>{});
  },[]);

  async function regenerate(){
    const r = await fetch('/api/import-token',{method:'POST'});
    const j = await r.json().catch(()=>({}));
    if(r.ok && j.token){ setToken(j.token); setMsg('New token generated — paste it into the extension popup (the old one no longer works).'); }
    else setMsg('Could not regenerate the token.');
  }

  const masked = token ? token.slice(0,4) + '••••••••••••' + token.slice(-4) : '';

  return (<div className="card" style={{display:'grid',gap:12,marginTop:14}}>
    <div>
      <div className="small muted">Browser companion</div>
      <b>VDT Companion extension</b>
      <p className="small muted" style={{margin:'6px 0 0'}}>
        Some streaming sites block the server from finding their video (anti-bot walls, JavaScript players).
        The companion extension runs in <i>your</i> browser — which already loaded the video — grabs the stream
        URL from the playing page and sends it here.
      </p>
    </div>
    <div>
      <div className="small muted" style={{marginBottom:6}}>Your import token (paste it into the extension popup)</div>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <code className="mono" style={{fontSize:13,background:'#0B0C0E',border:'1px solid #26272B',borderRadius:8,padding:'7px 10px'}}>{token ? (show ? token : masked) : '…'}</code>
        <button className="btn-ghost" style={{padding:'7px 13px',fontSize:12}} onClick={()=>setShow(!show)}>{show?'Hide':'Reveal'}</button>
        <button className="btn-ghost" style={{padding:'7px 13px',fontSize:12}} onClick={regenerate}>Regenerate</button>
      </div>
      {msg && <div className="small" style={{color:'#7ee2a0',marginTop:6}}>{msg}</div>}
    </div>
    <div>
      <div className="small muted" style={{marginBottom:6}}>Install &amp; use — 3 steps</div>
      <ol className="small" style={{margin:0,paddingLeft:18,display:'grid',gap:4}}>
        <li>Open <span className="mono">chrome://extensions</span>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and select the <span className="mono">extension/</span> folder of this project (see <span className="mono">extension/README.md</span> in the repo).</li>
        <li>Click the extension icon, open its Settings, set App URL to this app (e.g. <span className="mono">http://localhost:3000</span>) and paste the token above.</li>
        <li>On any video page, press <b>Play</b>, then click the extension and hit <b>Send →</b> on the stream it found — the video lands in your library, ready to transcribe &amp; translate.</li>
      </ol>
    </div>
  </div>);
}
