'use client';
import { useEffect, useRef, useState } from 'react';
export default function Home(){
  const [me,setMe] = useState(null);
  const [state,setState] = useState('closed'); // closed | open | loading | done
  const [tab,setTab] = useState('link');
  const [url,setUrl] = useState('');
  const [pct,setPct] = useState(0);
  const [label,setLabel] = useState('');
  const [err,setErr] = useState('');
  const [candidates,setCandidates] = useState(null);
  const [manualText,setManualText] = useState('');
  const [pendingGeneric,setPendingGeneric] = useState(null);
  const fileRef = useRef(null);
  useEffect(()=>{ fetch('/api/auth').then(r=>r.json()).then(j=>setMe(j)).catch(()=>{}); },[]);
  const loggedIn = !!me?.user;

  function runProgress(texts){
    setState('loading'); setPct(0); let i=0; setLabel(texts[0]);
    const iv = setInterval(()=>{ setPct(p=>{ const n=Math.min(92,p+9); return n; }); if(i<texts.length-1 && Math.random()>0.5){ i++; setLabel(texts[i]); } },300);
    return ()=>clearInterval(iv);
  }
  async function create(body, texts){
    if(!loggedIn){ location.href='/auth'; return; }
    const stop = runProgress(texts);
    try{
      const r = await fetch('/api/videos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j = await r.json(); stop(); 
      if(!r.ok) throw new Error(j.error||'failed');
      setPct(100); setLabel('Done'); setState('done');
      setTimeout(()=>{ location.href = `/confirm/${j.video.id}`; }, 450);
    }catch(e){ stop(); setState('open'); setErr(e.message); }
  }
  async function submitLink(){
    setErr(''); if(!url.trim()) return;
    if(!loggedIn){ location.href='/auth'; return; }
    if(/youtube\.com|youtu\.be/.test(url)){ create({kind:'youtube',url}, ['Reading YouTube…','Fetching captions…','Building dialogue…']); return; }
    // generic page: detect main video
    const stop = runProgress(['Fetching page…','Scoring video candidates…']);
    try{
      const r = await fetch('/api/detect-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
      const j = await r.json(); stop(); setState('open');
      if(!j.candidates?.length){ setErr(`No video found on that page.${j.engineNote ? ' ' + j.engineNote : ''} You can also try pasting the direct video/embed link (right-click the player → copy video address), or download the file and upload it instead.`); return; }
      setCandidates(j); setPendingGeneric({ title:j.title });
      if(!j.ambiguous){ pickCandidate(j.candidates[0], j.title); }
    }catch(e){ stop(); setState('open'); setErr(e.message); }
  }
  function pickCandidate(c, title){
    create({kind:'link', src:c.src, title: title||'Web video', thumb:c.poster||c.thumb||null, duration:c.duration||undefined, pageUrl:url, transcriptText: manualText||undefined},
      ['Creating project…','Preparing confirmation…']);
  }
  async function submitUpload(file){
    if(!loggedIn){ location.href='/auth'; return; }
    setErr('');
    const stop = runProgress(['Uploading file…','Storing video…']);
    try{
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch('/api/upload',{method:'POST',body:fd});
      const j = await r.json(); stop();
      if(!r.ok) throw new Error(j.error||'upload failed');
      create({kind:'upload', src:j.src, title:j.name, transcriptText: manualText||undefined}, ['Creating project…']);
    }catch(e){ stop(); setState('open'); setErr(e.message); }
  }
  function sample(){ create({kind:'sample'}, ['Loading sample…','Preparing transcript…']); }

  const morphWidth = state==='closed' ? 178 : state==='loading' ? 262 : state==='done' ? 240 : 'min(600px,94vw)';
  return (<div>
    <div style={{textAlign:'center',padding:'36px 10px 6px'}}>
      <div style={{fontSize:34,fontWeight:800,letterSpacing:'-.035em',lineHeight:1.12}}>Paste a link. Learn from the dialogue.</div>
      <p className="muted" style={{fontSize:14,marginTop:10}}>Bilingual karaoke subtitles, one-tap saving, a notebook that turns what you saved into exercises.</p>
      {me?.quota && <p className="small muted">Today: <b style={{color:'#F7F8F8'}}>{me.quota.used.toLocaleString()} / {me.quota.limit.toLocaleString()}</b> tokens used</p>}
      {!loggedIn && <p className="small muted">You can look around freely — <a href="/auth" style={{color:'#FF4D00',fontWeight:600}}>log in</a> to translate and save.</p>}
    </div>

    <div style={{display:'flex',justifyContent:'center',padding:'26px 8px 4px',minHeight:66}}>
      <div className="morph" onClick={()=>{ if(state==='closed') setState('open'); }}
        style={{width:morphWidth,height:50,borderRadius:999,background: state==='loading'?'#FF4D00': state==='done'?'#1DB954':'#F7F8F8',color: state==='closed'||state==='open'?'#08090A':'#fff',display:'flex',alignItems:'center',padding:'0 8px 0 16px',gap:8,cursor: state==='closed'?'pointer':'default',maxWidth:'94vw'}}>
        {state==='closed' && <><span style={{fontWeight:800}}>↗</span><span style={{fontWeight:700,fontSize:14}}>Paste a video link</span></>}
        {(state==='loading'||state==='done') && <><span className="spinner"></span><span style={{fontWeight:700,fontSize:14}}>{state==='done'?'✓ Done':`${label} ${pct}%`}</span></>}
        {state==='open' && <>
          <div style={{display:'flex',gap:4,flex:'none'}}>
            <button onClick={()=>setTab('link')} style={{border:0,borderRadius:999,padding:'6px 10px',fontSize:12,fontWeight:700,background: tab==='link'?'#08090A':'transparent',color: tab==='link'?'#fff':'#555'}}>Link</button>
            <button onClick={()=>setTab('upload')} style={{border:0,borderRadius:999,padding:'6px 10px',fontSize:12,fontWeight:700,background: tab==='upload'?'#08090A':'transparent',color: tab==='upload'?'#fff':'#555'}}>Upload</button>
          </div>
          {tab==='link' ? <>
            <input autoFocus value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') submitLink(); }}
              placeholder="https://youtube.com/watch?v=… or any page with a video"
              style={{flex:1,minWidth:0,background:'transparent',border:0,color:'#08090A',fontSize:13,padding:'6px 4px'}}/>
            <button className="btn" style={{flex:'none',padding:'8px 14px',fontSize:13}} onClick={submitLink}>Fetch →</button>
          </> : <>
            <span style={{flex:1,fontSize:13,color:'#555',overflow:'hidden',textOverflow:'ellipsis'}}>Choose an mp4 / webm from your device</span>
            <input ref={fileRef} type="file" accept="video/*" style={{display:'none'}} onChange={e=>{ if(e.target.files?.[0]) submitUpload(e.target.files[0]); }}/>
            <button className="btn" style={{flex:'none',padding:'8px 14px',fontSize:13}} onClick={()=>fileRef.current?.click()}>Choose file</button>
          </>}
        </>}
      </div>
    </div>
    <div style={{textAlign:'center'}} className="small muted">The button expands, then collapses and loads right on itself — no full-screen spinners.</div>
    {err && <div style={{textAlign:'center',color:'#ff8a70',fontSize:13,marginTop:10}}>{err}</div>}

    {candidates && candidates.candidates.length>1 && (
      <div className="card" style={{maxWidth:640,margin:'18px auto'}}>
        <b>Which one is the main video?</b>
        <p className="small muted">We found {candidates.candidates.length} candidates and could not pick confidently (scores too close). Ads and suggestions are usually the small, low-score ones.</p>
        {candidates.candidates.map((c,i)=>(<div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'8px 0',borderTop:'1px solid #1F2023'}}>
          <span className="small" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.kind} · score {c.score} · {c.src.slice(0,70)}…</span>
          <button className="btn-ghost" style={{flex:'none',padding:'6px 12px',fontSize:12}} onClick={()=>pickCandidate(c, candidates.title)}>Use this</button>
        </div>))}
      </div>
    )}

    <div style={{maxWidth:640,margin:'22px auto 0'}}>
      <details className="card">
        <summary style={{cursor:'pointer',fontWeight:600,fontSize:14}}>No captions? Paste a transcript manually</summary>
        <p className="small muted">Optional: if a video has no captions and no subtitles we can fetch, you can paste its transcript here before you fetch/upload (split into sentences, 5s each). Otherwise the confirm page can create the transcript for you — the "🎙️ Create transcript with Whisper" button listens to the video itself.</p>
        <textarea rows={4} style={{width:'100%'}} value={manualText} onChange={e=>setManualText(e.target.value)} placeholder="Paste the full transcript text here…"/>
      </details>
      <div className="card" style={{marginTop:14,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div><b>Try the built-in sample first</b><div className="small muted">A 24-second sample video with a known English transcript — the whole flow works even if a YouTube caption fetch fails.</div></div>
        <button className="btn-white" onClick={sample}>Open sample →</button>
      </div>
    </div>
  </div>);
}
