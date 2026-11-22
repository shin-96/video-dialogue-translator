'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { wordTimings, translationTimings, fmtTime } from '@/lib/text';

export default function Watch(){
  const { id } = useParams();
  const sp = useSearchParams();
  const [v,setV] = useState(null); const [err,setErr] = useState('');
  const [t,setT] = useState(0); const [playing,setPlaying] = useState(false);
  const [loop,setLoop] = useState(false); const [slow,setSlow] = useState(false);
  const [hideSrc,setHideSrc] = useState(false); const [hideTr,setHideTr] = useState(false);
  const [q,setQ] = useState(''); const [pop,setPop] = useState(null); const [savedMsg,setSavedMsg] = useState('');
  const videoRef = useRef(null); const ytRef = useRef(null); const apiRef = useRef(null);
  const tRef = useRef(0); tRef.current = t;
  const loopRef = useRef(false); loopRef.current = loop;
  const activeIdxRef = useRef(-1);

  useEffect(()=>{ fetch(`/api/videos/${id}`).then(async r=>{ const j=await r.json(); if(!r.ok) throw new Error(j.error); setV(j.video);
    const startAt = parseFloat(sp.get('t')||'') || j.video.progress || 0; setTimeout(()=>seek(startAt), 800);
  }).catch(e=>setErr(e.message)); },[id]);

  // YouTube player setup
  useEffect(()=>{
    if(!v || v.kind!=='youtube') return;
    function create(){
      apiRef.current = new window.YT.Player('yt-player', { videoId: v.ytId, playerVars:{ rel:0 },
        events:{ onStateChange:(e)=>setPlaying(e.data===1) } });
    }
    if(window.YT?.Player) create();
    else { const tag=document.createElement('script'); tag.src='https://www.youtube.com/iframe_api'; document.body.appendChild(tag); window.onYouTubeIframeAPIReady = create; }
    const iv = setInterval(()=>{ try{ const ct = apiRef.current?.getCurrentTime?.(); if(typeof ct==='number') setT(ct); }catch{} },120);
    return ()=>clearInterval(iv);
  },[v?.id]);

  // HTML5 video polling
  useEffect(()=>{
    if(!v || v.kind==='youtube') return;
    const iv = setInterval(()=>{ const el=videoRef.current; if(el) setT(el.currentTime); },120);
    return ()=>clearInterval(iv);
  },[v?.id]);

  // progress persistence
  useEffect(()=>{
    const iv = setInterval(()=>{ if(tRef.current>0) fetch(`/api/videos/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress:Math.floor(tRef.current)})}); },5000);
    return ()=>clearInterval(iv);
  },[id]);

  const activeIdx = useMemo(()=>{ if(!v) return -1; return v.sentences.findIndex(s=> t>=s.start && t<s.end); },[v,t]);
  activeIdxRef.current = activeIdx;

  // loop one sentence
  useEffect(()=>{
    if(!loop || activeIdx<0 || !v) return;
    const s = v.sentences[activeIdx];
    if(t >= s.end - 0.05) seek(s.start);
  },[t,loop,activeIdx,v]);

  function seek(sec){
    if(v?.kind==='youtube'){ try{ apiRef.current?.seekTo(sec,true); }catch{} }
    else if(videoRef.current){ videoRef.current.currentTime = sec; }
    setT(sec);
  }
  function togglePlay(){
    if(v?.kind==='youtube'){ try{ playing? apiRef.current.pauseVideo() : apiRef.current.playVideo(); }catch{} }
    else if(videoRef.current){ playing? videoRef.current.pause() : videoRef.current.play(); }
  }
  function setSpeed(slowOn){
    setSlow(slowOn);
    if(videoRef.current) videoRef.current.playbackRate = slowOn?0.75:1;
    try{ apiRef.current?.setPlaybackRate?.(slowOn?0.75:1); }catch{}
  }
  async function save(item){
    const r = await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
    setSavedMsg(r.ok ? `Saved “${item.text}” to your notebook ✓` : 'Save failed — are you logged in?');
    setTimeout(()=>setSavedMsg(''),2600);
  }

  if(err) return <p style={{color:'#ff8a70'}}>{err}</p>;
  if(!v) return <p className="muted">Loading…</p>;
  const shown = v.sentences.map((s,i)=>({s,i})).filter(({s})=> !q || s.text.toLowerCase().includes(q.toLowerCase()) || (s.translation||'').toLowerCase().includes(q.toLowerCase()));

  return (<div>
    <h1 style={{fontSize:22,letterSpacing:'-.02em',margin:'4px 0 4px'}}>{v.title}</h1>
    <p className="small muted">{v.kind} · {v.translated? `translated → ${v.target}` : 'not translated yet'} {v.partialCount && v.partialCount < v.sentences.length ? `· partial: first ${v.partialCount} sentences` : ''} {!v.translated && <a href={`/confirm/${id}`} style={{color:'#FF4D00',fontWeight:600}}>Translate →</a>}</p>
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.15fr) minmax(0,.85fr)',gap:0,border:'1px solid #1F2023',borderRadius:14,overflow:'hidden',marginTop:12}}>
      <div style={{padding:14,borderRight:'1px solid #1F2023',background:'#0B0C0E'}}>
        {v.kind==='youtube'
          ? <div style={{aspectRatio:'16/9',background:'#000',borderRadius:10,overflow:'hidden'}}><div id="yt-player" style={{width:'100%',height:'100%'}}></div></div>
          : <video ref={videoRef} src={v.src} controls style={{width:'100%',borderRadius:10,background:'#000'}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}/>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12,alignItems:'center'}}>
          <button className="btn-white" style={{padding:'8px 16px'}} onClick={togglePlay}>{playing?'❚❚ Pause':'▶ Play'}</button>
          <button className={loop?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={()=>setLoop(!loop)}>↻ Loop sentence</button>
          <button className={slow?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={()=>setSpeed(!slow)}>0.75× slow</button>
          <button className={hideSrc?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={()=>setHideSrc(!hideSrc)}>Hide original</button>
          <button className={hideTr?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={()=>setHideTr(!hideTr)}>Hide translation</button>
          <span className="mono small muted">{fmtTime(t)} / {fmtTime(v.duration)}</span>
        </div>
        {pop && <div className="card" style={{marginTop:12}}>
          <div className="small muted">WORD</div><b style={{fontSize:17}}>{pop.word}</b>
          <div className="small" style={{marginTop:6}}>In context: “{pop.sentence}”</div>
          <div className="small muted">Meaning in context: “{pop.translation||'(not translated)'}”</div>
          <div style={{display:'flex',gap:8,marginTop:10}}>
            <button className="btn" style={{padding:'7px 14px',fontSize:12}} onClick={()=>{ save({videoId:id,kind:'word',text:pop.word,sentence:pop.sentence,translation:pop.translation||'',timestamp:pop.timestamp}); setPop(null); }}>Save word</button>
            <button className="btn-ghost" style={{padding:'7px 14px',fontSize:12}} onClick={()=>setPop(null)}>Close</button>
          </div>
        </div>}
        {savedMsg && <div style={{color:'#7ee2a0',fontSize:13,marginTop:10}}>{savedMsg}</div>}
        <p className="small muted" style={{marginTop:12}}>Tip: click any word to save it with its sentence context. Click a sentence on the right to jump the video there.</p>
      </div>
      <div style={{maxHeight:560,overflow:'auto'}}>
        <div style={{padding:'12px 16px 4px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
          <span className="small" style={{letterSpacing:'.12em',color:'#8A8F98'}}>DIALOGUE — ORIGINAL / TRANSLATION</span>
        </div>
        <div style={{padding:'0 16px 10px'}}><input style={{width:'100%',padding:'8px 10px',fontSize:13}} placeholder="Search in transcript…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {shown.map(({s,i})=>{
          const words = wordTimings(s); const twords = translationTimings(s); const isActive = i===activeIdx;
          return (<div key={i} className={'line'+(isActive?' active':'')} onClick={()=>seek(s.start)}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span className="mono small muted">{fmtTime(s.start)}</span>
              <button title="Bookmark sentence" onClick={(e)=>{ e.stopPropagation(); save({videoId:id,kind:'sentence',text:s.text,sentence:s.text,translation:s.translation||'',timestamp:s.start}); }} style={{background:'transparent',border:0,color:'#8A8F98',fontSize:13}}>🔖</button></div>
            {!hideSrc && <div style={{fontSize:15,fontWeight:600,lineHeight:1.55,marginTop:2}}>
              {words.map((w,k)=>(<span key={k} className={'w'+(isActive && t>=w.start && t<w.end?' on':'')} onClick={(e)=>{ e.stopPropagation(); setPop({word:w.w.replace(/[^\p{L}\p{N}'-]/gu,''), sentence:s.text, translation:s.translation, timestamp:s.start}); }}>{w.w} </span>))}
            </div>}
            {!hideTr && s.translation && <div style={{fontSize:13.5,color:'#a7abb3',lineHeight:1.55,marginTop:3}}>
              {twords.map((w,k)=>(<span key={k} className={'wt'+(isActive && t>=w.start && t<w.end?' on':'')}>{w.w} </span>))}
            </div>}
            {!hideTr && !s.translation && <div className="small muted" style={{marginTop:3}}>(not translated)</div>}
          </div>);
        })}
        {shown.length===0 && <p className="small muted" style={{padding:'10px 16px'}}>No sentences match your search.</p>}
      </div>
    </div>
  </div>);
}
