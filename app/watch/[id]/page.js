'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { origWords, translationWordsAt, fmtTime } from '@/lib/text';

export default function Watch(){
  const { id } = useParams();
  const sp = useSearchParams();
  const [v,setV] = useState(null); const [err,setErr] = useState('');
  const [t,setT] = useState(0); const [playing,setPlaying] = useState(false);
  const [loop,setLoop] = useState(false); const [slow,setSlow] = useState(false);
  const [hideSrc,setHideSrc] = useState(false); const [hideTr,setHideTr] = useState(false);
  const [q,setQ] = useState(''); const [pop,setPop] = useState(null); const [savedMsg,setSavedMsg] = useState('');
  const [autoScroll,setAutoScroll] = useState(true); const [followPaused,setFollowPaused] = useState(false);
  const [aligning,setAligning] = useState(false); const [alignMsg,setAlignMsg] = useState('');
  const [syncing,setSyncing] = useState(false); const [syncMsg,setSyncMsg] = useState('');
  const [syncNoWords,setSyncNoWords] = useState(false);
  const autoSyncRef = useRef(false); const syncingRef = useRef(false);
  const videoRef = useRef(null); const ytRef = useRef(null); const apiRef = useRef(null);
  const tRef = useRef(0); tRef.current = t;
  const loopRef = useRef(false); loopRef.current = loop;
  const activeIdxRef = useRef(-1);
  const panelRef = useRef(null); const lineRefs = useRef({});
  const autoScrollRef = useRef(true); autoScrollRef.current = autoScroll;
  const followPausedRef = useRef(false);
  const setPaused = (p)=>{ followPausedRef.current = p; setFollowPaused(p); };

  // A sentence "has words" only when Whisper gave it REAL word timings.
  const hasRealWords = (s)=> Array.isArray(s.words) && s.words.length > 0;
  // twords are valid only while they still line up 1:1 with the current
  // translation's tokens (same staleness guard as lib/text.js).
  const twordsValid = (s)=> !!s.translation && Array.isArray(s.twords) && s.twords.length > 0
    && s.twords.length === s.translation.split(/\s+/).filter(Boolean).length;

  async function loadVideo(){
    const r = await fetch(`/api/videos/${id}`); const j = await r.json();
    if(!r.ok) throw new Error(j.error);
    setV(j.video); return j.video;
  }
  useEffect(()=>{ loadVideo().then(video=>{
    const startAt = parseFloat(sp.get('t')||'') || video.progress || 0; setTimeout(()=>seek(startAt), 800);
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
    const iv = setInterval(()=>{ try{ const ct = apiRef.current?.getCurrentTime?.(); if(typeof ct==='number') setT(ct); }catch{} },100);
    return ()=>clearInterval(iv);
  },[v?.id]);

  // HTML5 video polling (backup — onTimeUpdate/onSeeked below are primary)
  useEffect(()=>{
    if(!v || v.kind==='youtube') return;
    const iv = setInterval(()=>{ const el=videoRef.current; if(el) setT(el.currentTime); },100);
    return ()=>clearInterval(iv);
  },[v?.id]);

  // Remote-stream playback: when the CDN only serves the file to requests
  // carrying the embedding page as Referer, play through /api/proxy-stream.
  // .m3u8 (HLS) sources get hls.js attached unless the browser plays HLS
  // natively (Safari) — in that case the plain src is used.
  const playSrc = v ? (v.needsProxy
    ? `/api/proxy-stream?u=${encodeURIComponent(v.src)}&r=${encodeURIComponent(v.proxyReferer || '')}`
    : v.src) : '';
  const isHls = !!v && /\.m3u8(\?|#|$)/i.test(v.src || '');
  useEffect(()=>{
    if(!v || v.kind==='youtube' || !playSrc) return;
    const el = videoRef.current; if(!el) return;
    let hls = null, cancelled = false;
    async function attach(){
      if(isHls && !el.canPlayType('application/vnd.apple.mpegurl')){
        try{
          if(!window.Hls){
            await new Promise((res, rej)=>{ const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1'; s.onload = res; s.onerror = rej; document.body.appendChild(s); });
          }
        }catch{ /* CDN unreachable: fall through to plain src */ }
        if(!cancelled && window.Hls && window.Hls.isSupported()){
          hls = new window.Hls();
          hls.loadSource(playSrc);
          hls.attachMedia(el);
          return;
        }
      }
      if(!cancelled) el.src = playSrc;
    }
    attach();
    return ()=>{ cancelled = true; if(hls){ try{ hls.destroy(); }catch{} } };
  },[v?.id, playSrc, isHls]);

  // progress persistence
  useEffect(()=>{
    const iv = setInterval(()=>{ if(tRef.current>0) fetch(`/api/videos/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress:Math.floor(tRef.current)})}); },5000);
    return ()=>clearInterval(iv);
  },[id]);

  // Self-healing translation timing: a video translated before phrase sync
  // existed (or re-transcribed since) can hold translations + real word
  // timings but no twords — sync it ONCE automatically on load instead of
  // waiting for the user to discover the Sync button. When everything
  // already has valid twords this never fires. When NO sentence has real
  // word timings it also stays quiet (Align needs Whisper and real time);
  // the persistent notice under the header covers that case instead.
  useEffect(()=>{
    if(!v || autoSyncRef.current) return;
    if(!v.translated) return;
    const needsSync = v.sentences.some(s=> s.translation && hasRealWords(s) && !twordsValid(s));
    if(!needsSync) return;
    autoSyncRef.current = true;
    runSync();
  },[v]);

  // Active sentence: exact match first; if t falls in a GAP between sentences
  // (common right after a seek/scrub), fall back to the last sentence that has
  // started, so the highlight — original AND translation — never vanishes.
  const activeIdx = useMemo(()=>{
    if(!v || !v.sentences.length) return -1;
    const exact = v.sentences.findIndex(s=> t>=s.start && t<s.end);
    if(exact >= 0) return exact;
    let last = -1;
    v.sentences.forEach((s,i)=>{ if(s.start <= t) last = i; });
    return last;
  },[v,t]);
  activeIdxRef.current = activeIdx;

  // Auto-scroll the dialogue panel to the active sentence.
  useEffect(()=>{
    if(!autoScrollRef.current || followPausedRef.current) return;
    const el = lineRefs.current[activeIdx];
    if(el) el.scrollIntoView({ behavior:'smooth', block:'center' });
  },[activeIdx]);

  function scrollToActive(){
    const el = lineRefs.current[activeIdxRef.current];
    if(el) el.scrollIntoView({ behavior:'smooth', block:'center' });
  }
  function toggleAutoScroll(){
    const next = !autoScroll; setAutoScroll(next);
    if(next){ setPaused(false); setTimeout(scrollToActive, 60); }
  }
  function resumeFollow(){ setPaused(false); setTimeout(scrollToActive, 60); }
  // Manual scrolling of the panel pauses follow until the user resumes it.
  function onPanelScrollIntent(){
    if(autoScrollRef.current && !followPausedRef.current) setPaused(true);
  }

  // loop one sentence
  useEffect(()=>{
    if(!loop || activeIdx<0 || !v) return;
    const s = v.sentences[activeIdx];
    if(t >= s.start && t >= s.end - 0.05 && t < s.end + 0.5) seek(s.start);
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
  async function alignTiming(){
    setAligning(true); setAlignMsg('Listening to the voice and aligning word timings… (can take a while)');
    try{
      const r = await fetch(`/api/videos/${id}/align`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || 'align failed');
      await loadVideo();
      setAlignMsg(`Aligned to voice ✓ — ${j.words} real word timings across ${j.sentences} sentences (Whisper, language: ${j.language||'auto'}). Karaoke now follows the actual speech rhythm.`);
    }catch(e){ setAlignMsg('Align failed: '+e.message+' — keeping the estimated timings.'); }
    setAligning(false);
  }
  // Shared translation-timing sync (manual Sync button + auto-sync on
  // load). Always reports the outcome — never a silent no-op. Smart edge
  // case: if NO sentence carries real Whisper word timings, phrase sync
  // has nothing to sync against, so run the Align flow FIRST (same
  // endpoint the Align button uses), then align-translation, then reload.
  async function runSync(){
    if(syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true); setSyncMsg('Syncing translation timing…');
    try{
      if(v && v.translated && !v.sentences.some(hasRealWords)){
        setSyncMsg('No real voice timings yet — running Align (Whisper) first, then syncing the translation… (can take a while)');
        const ar = await fetch(`/api/videos/${id}/align`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
        const aj = await ar.json();
        if(!ar.ok) throw new Error(aj.error || 'align failed');
        setSyncMsg('Voice timings aligned ✓ — now syncing the translation timing…');
      }
      // Chunked loop: one request syncs at most CHUNK sentences and saves
      // them before responding, so even a long video never dies inside a
      // single fetch (the original bug: one request for hundreds of
      // sentences, hundreds of phrase translations, one dead fetch, zero
      // saved). A failed chunk is retried ONCE; a second failure stops the
      // loop — chunks already saved keep their twords, so pressing Sync
      // again resumes cheaply (phrase translations are cached server-side).
      const CHUNK = 40;
      let from = 0, total = v.sentences.length, alignedSum = 0, noWordsSum = 0, noTrSum = 0, done = false;
      while(!done){
        let j = null, lastErr = null;
        for(let attempt = 0; attempt < 2 && !j; attempt++){
          try{
            const r = await fetch(`/api/videos/${id}/align-translation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ from, limit: CHUNK })});
            const jj = await r.json();
            if(!r.ok) throw new Error(jj.error || 'sync failed');
            j = jj;
          }catch(e){ lastErr = e; }
        }
        if(!j || (j.processedUntil <= from && !j.done)){
          await loadVideo();
          setSyncMsg(`Sync stopped at ${from}/${total} — press Sync to continue.${lastErr ? ` (${lastErr.message})` : ''} Sentences already synced keep their timing.`);
          setSyncing(false); syncingRef.current = false;
          return;
        }
        alignedSum += j.aligned; noWordsSum += j.skippedNoWords; noTrSum += j.skippedNoTranslation;
        total = j.total; from = j.processedUntil; done = j.done;
        if(!done) setSyncMsg(`Syncing translation timing… ${from}/${total}`);
      }
      await loadVideo();
      if(alignedSum === 0 && noWordsSum > 0){
        setSyncNoWords(true);
        setSyncMsg(`Translation timing could not be synced — ${noWordsSum}/${total} sentences have a translation but no real voice timings, so there is nothing to phrase-sync against. Run “🎯 Align timing to voice (Whisper)” above first, then Sync again.`);
      } else {
        setSyncNoWords(false);
        let msg = `Translation timing synced: ${alignedSum}/${total} sentences`;
        const skips = [];
        if(noWordsSum) skips.push(`${noWordsSum} skipped — no voice timings`);
        if(noTrSum) skips.push(`${noTrSum} skipped — not translated`);
        if(skips.length) msg += ` (${skips.join('; ')})`;
        msg += ' — each translated word now lights inside the spoken phrase it belongs to, so pauses no longer desync the meaning.';
        setSyncMsg(msg);
      }
    }catch(e){ setSyncMsg('Sync failed: '+e.message+' — keeping the estimated translation timing.'); }
    setSyncing(false);
    syncingRef.current = false;
  }
  async function syncTranslationTiming(){ return runSync(); }

  if(err) return <p style={{color:'#ff8a70'}}>{err}</p>;
  if(!v) return <p className="muted">Loading…</p>;
  const shown = v.sentences.map((s,i)=>({s,i})).filter(({s})=> !q || s.text.toLowerCase().includes(q.toLowerCase()) || (s.translation||'').toLowerCase().includes(q.toLowerCase()));
  const activeS = activeIdx >= 0 ? v.sentences[activeIdx] : null;
  const activeOrig = activeS ? origWords(activeS) : [];
  const activeTr = activeS ? translationWordsAt(activeS, t, true) : [];
  // Translation-timing state derived from the loaded data (header counts +
  // the no-voice-timings notice): how many translated sentences already
  // carry valid phrase-aligned twords, and whether ANY translated sentence
  // has real voice timings to sync against at all.
  const trSentences = v.sentences.filter(s=>s.translation);
  const trSyncedCount = trSentences.filter(twordsValid).length;
  const anyRealWords = v.sentences.some(hasRealWords);
  const showNoWordsNotice = syncNoWords
    || (!!v.translated && trSentences.length > 0 && !trSentences.some(hasRealWords));

  return (<div>
    <h1 style={{fontSize:22,letterSpacing:'-.02em',margin:'4px 0 4px'}}>{v.title}</h1>
    <p className="small muted">{v.kind} · {v.translated? `translated → ${v.target}` : 'not translated yet'} {v.partialCount && v.partialCount < v.sentences.length ? `· partial: first ${v.partialCount} sentences` : ''} · timing: {v.timingSource==='whisper' ? 'Whisper (real voice)' : 'estimated'}{v.translated ? (trSyncedCount > 0 ? ` · translation timing: phrase-align (${trSyncedCount}/${trSentences.length})` : ` · translation timing: estimated${anyRealWords ? '' : ' (no voice timings)'}`) : ''} {!v.translated && <a href={`/confirm/${id}`} style={{color:'#FF4D00',fontWeight:600}}>Translate →</a>}</p>
    {showNoWordsNotice && <div className="small" style={{color:'#ffb37e',marginTop:6,lineHeight:1.5}}>⚠ This video has no real voice timings yet, so the translation can't be phrase-synced. Run Align (Whisper) first, then Sync.</div>}
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.15fr) minmax(0,.85fr)',gap:0,border:'1px solid #1F2023',borderRadius:14,overflow:'hidden',marginTop:12}}>
      <div style={{padding:14,borderRight:'1px solid #1F2023',background:'#0B0C0E'}}>
        <div className="player-wrap" style={{aspectRatio: v.kind==='youtube' ? '16/9' : undefined}}>
          {v.kind==='youtube'
            ? <div style={{position:'absolute',inset:0}}><div id="yt-player" style={{width:'100%',height:'100%'}}></div></div>
            : <video ref={videoRef} controls style={{width:'100%',display:'block',background:'#000'}}
                onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}
                onTimeUpdate={(e)=>setT(e.currentTarget.currentTime)}
                onSeeked={(e)=>setT(e.currentTarget.currentTime)}/>}
          {activeS && <div className="sub-overlay">
            {!hideSrc && <div className="ov-orig">{activeOrig.map((w,k)=>(<span key={k} className={'w'+(t>=w.start && t<w.end?' on':'')}>{w.w} </span>))}</div>}
            {!hideTr && activeS.translation && <div className="ov-tr">{activeTr.map((w,k)=>(<span key={k} className={'wt'+(w.on?' on':'')}>{w.w} </span>))}</div>}
          </div>}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12,alignItems:'center'}}>
          <button className="btn-white" style={{padding:'8px 16px'}} onClick={togglePlay}>{playing?'❚❚ Pause':'▶ Play'}</button>
          <button className={loop?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={()=>setLoop(!loop)}>↻ Loop sentence</button>
          <button className={slow?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={()=>setSpeed(!slow)}>0.75× slow</button>
          <button className={hideSrc?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={()=>setHideSrc(!hideSrc)}>Hide original</button>
          <button className={hideTr?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={()=>setHideTr(!hideTr)}>Hide translation</button>
          <button className={autoScroll?'btn':'btn-ghost'} style={{padding:'8px 13px',fontSize:12}} onClick={toggleAutoScroll}>Auto-scroll: {autoScroll?'On':'Off'}</button>
          <span className="mono small muted">{fmtTime(t)} / {fmtTime(v.duration)}</span>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10,alignItems:'center'}}>
          <button className="btn-ghost" style={{padding:'8px 13px',fontSize:12}} onClick={alignTiming} disabled={aligning}>
            {aligning ? 'Aligning…' : '🎯 Align timing to voice (Whisper)'}
          </button>
          {v.timingSource==='whisper' && <span className="small" style={{color:'#7ee2a0'}}>Word timings are synced to the real voice.</span>}
        </div>
        {v.translated && <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10,alignItems:'center'}}>
          <button className="btn-ghost" style={{padding:'8px 13px',fontSize:12}} onClick={syncTranslationTiming} disabled={syncing}>
            {syncing ? 'Syncing…' : '🔗 Sync translation timing'}
          </button>
          {trSyncedCount > 0
            ? <span className="small" style={{color:'#7ee2a0'}}>Translation words are synced to the spoken phrases ({trSyncedCount}/{trSentences.length} sentences).</span>
            : <span className="small muted">Gives each translated word the real timing of the phrase it belongs to. Runs automatically when a translated video already has voice timings; if this video has none yet, Sync runs Align (Whisper) first.</span>}
        </div>}
        {alignMsg && <div className="small" style={{color:'#a7abb3',marginTop:8,lineHeight:1.5}}>{alignMsg}</div>}
        {syncMsg && <div className="small" style={{color:'#a7abb3',marginTop:8,lineHeight:1.5}}>{syncMsg}</div>}
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
      <div ref={panelRef} style={{maxHeight:560,overflow:'auto',position:'relative'}} onWheel={onPanelScrollIntent} onTouchMove={onPanelScrollIntent}>
        <div style={{padding:'12px 16px 4px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
          <span className="small" style={{letterSpacing:'.12em',color:'#8A8F98'}}>DIALOGUE — ORIGINAL / TRANSLATION</span>
        </div>
        <div style={{padding:'0 16px 10px'}}><input style={{width:'100%',padding:'8px 10px',fontSize:13}} placeholder="Search in transcript…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {shown.map(({s,i})=>{
          const words = origWords(s); const twords = translationWordsAt(s, t, i===activeIdx); const isActive = i===activeIdx;
          return (<div key={i} ref={el=>{ lineRefs.current[i]=el; }} className={'line'+(isActive?' active':'')} onClick={()=>seek(s.start)}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span className="mono small muted">{fmtTime(s.start)}</span>
              <button title="Bookmark sentence" onClick={(e)=>{ e.stopPropagation(); save({videoId:id,kind:'sentence',text:s.text,sentence:s.text,translation:s.translation||'',timestamp:s.start}); }} style={{background:'transparent',border:0,color:'#8A8F98',fontSize:13}}>🔖</button></div>
            {!hideSrc && <div style={{fontSize:15,fontWeight:600,lineHeight:1.55,marginTop:2}}>
              {words.map((w,k)=>(<span key={k} className={'w'+(isActive && t>=w.start && t<w.end?' on':'')} onClick={(e)=>{ e.stopPropagation(); setPop({word:String(w.w).replace(/[^\p{L}\p{N}'-]/gu,''), sentence:s.text, translation:s.translation, timestamp:s.start}); }}>{w.w} </span>))}
            </div>}
            {!hideTr && s.translation && <div style={{fontSize:13.5,color:'#a7abb3',lineHeight:1.55,marginTop:3}}>
              {twords.map((w,k)=>(<span key={k} className={'wt'+(w.on?' on':'')}>{w.w} </span>))}
            </div>}
            {!hideTr && !s.translation && <div className="small muted" style={{marginTop:3}}>(not translated)</div>}
          </div>);
        })}
        {shown.length===0 && <p className="small muted" style={{padding:'10px 16px'}}>No sentences match your search.</p>}
        {autoScroll && followPaused && <button className="follow-chip" onClick={resumeFollow}>▼ Follow the voice</button>}
      </div>
    </div>
  </div>);
}
