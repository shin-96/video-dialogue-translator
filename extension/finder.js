// finder.js — injected into the active tab by the popup (chrome.scripting).
//
// Why this exists: streaming sites with anti-bot walls or JS-loaded players
// hide their stream URL from any server-side fetch, but the USER's real
// browser has already loaded and played it. This script harvests the stream
// URLs the page itself used (performance timeline, <video> elements, embed
// iframes, common player globals), scores them, and stashes the result on
// window.__vdtResult for the popup to read.
//
// Self-contained classic script: no imports, no chrome.* APIs, so it can
// also run under plain Node with stubbed window/document/performance
// (see test-finder.mjs).
(function () {
  var MEDIA_RE = /\.(m3u8|mp4|webm|mov)(\?|#|$)/i;
  var AD_HOST_RE = /(doubleclick|googlesyndication|googleadservices|google-analytics|adservice|ads\d*\.|\.ads\.|taboola|outbrain|amazon-adsystem|adnxs|pubmatic|rubiconproject|scorecardresearch)/i;
  var EMBED_RE = /(embed|player|video|stream)/i;

  var bySrc = new Map();

  function hostOf(u) {
    try { return new URL(u).hostname; } catch (e) { return ''; }
  }

  function add(src, kind, score, t) {
    if (!src || typeof src !== 'string') return;
    if (!/^https?:\/\//i.test(src)) return;
    if (AD_HOST_RE.test(hostOf(src))) return;
    var prev = bySrc.get(src);
    if (prev) {
      if (score > prev.score) { prev.score = score; prev.kind = kind; }
      if (typeof t === 'number' && t > prev._t) prev._t = t;
      return;
    }
    bySrc.set(src, { src: src, kind: kind, score: score, _t: typeof t === 'number' ? t : 0 });
  }

  // ---- (b) <video> elements -------------------------------------------------
  var videos = [];
  try { videos = Array.prototype.slice.call(document.querySelectorAll('video') || []); } catch (e) {}
  var liveHttpSrcs = [];   // http(s) currentSrc/src of video elements
  var liveHosts = {};      // hostnames of those srcs ("the playing network")
  var anyPlaying = false;  // a <video> that is not paused
  var blobPlaying = false; // a playing <video> fed from a blob: (MSE player)
  var blobCount = 0;       // blob: srcs seen — counted, never sent

  videos.forEach(function (v) {
    var cs = '';
    try { cs = v.currentSrc || v.src || ''; } catch (e) {}
    var playing = false;
    try { playing = v.paused === false; } catch (e) {}
    if (playing) anyPlaying = true;
    if (/^blob:/i.test(cs)) {
      blobCount++;
      if (playing) blobPlaying = true;
    } else if (/^https?:\/\//i.test(cs)) {
      liveHttpSrcs.push(cs);
      liveHosts[hostOf(cs)] = true;
      add(cs, 'video-tag', 60 + (playing ? 15 : 0));
    }
    // <source> children of the video element
    try {
      if (typeof v.querySelectorAll === 'function') {
        Array.prototype.forEach.call(v.querySelectorAll('source'), function (s) {
          var ss = s.src || (typeof s.getAttribute === 'function' ? s.getAttribute('src') : '');
          if (/^https?:\/\//i.test(ss || '')) add(ss, 'video-tag', 58);
        });
      }
    } catch (e) {}
  });

  // ---- (a) performance resource timeline ------------------------------------
  var entries = [];
  try {
    if (typeof performance !== 'undefined' && performance.getEntriesByType) {
      entries = performance.getEntriesByType('resource') || [];
    }
  } catch (e) {}

  var mediaEntries = [];
  entries.forEach(function (en) {
    var name = en && en.name;
    if (!name || !MEDIA_RE.test(name)) return;      // .ts/.jpg/etc. never match
    if (AD_HOST_RE.test(hostOf(name))) return;      // ad media is not the movie
    mediaEntries.push({ name: name, t: typeof en.startTime === 'number' ? en.startTime : 0 });
  });
  // Most recent first: with a blob:/MSE player the newest playlist is almost
  // certainly the stream feeding the playing video.
  mediaEntries.sort(function (a, b) { return b.t - a.t; });
  mediaEntries.forEach(function (me, idx) {
    var score = 70;
    if (liveHttpSrcs.indexOf(me.name) !== -1) score += 20;       // exact match with a <video>
    else if (liveHosts[hostOf(me.name)]) score += 20;            // same network as the playing video
    else if (blobPlaying && idx === 0 && /\.m3u8(\?|#|$)/i.test(me.name)) score += 20; // freshest playlist of the MSE player
    add(me.name, 'network-stream', score, me.t);
  });

  // ---- (c) embed / player iframes -------------------------------------------
  var iframes = [];
  try { iframes = Array.prototype.slice.call(document.querySelectorAll('iframe') || []); } catch (e) {}
  iframes.forEach(function (f) {
    var s = '';
    try { s = f.src || (typeof f.getAttribute === 'function' ? f.getAttribute('src') : '') || ''; } catch (e) {}
    if (/^https?:\/\//i.test(s) && EMBED_RE.test(s)) add(s, 'iframe', 40);
  });

  // ---- (d) common player globals --------------------------------------------
  function addPlayerFile(file) {
    if (typeof file === 'string' && MEDIA_RE.test(file)) add(file, 'player-config', 80);
  }
  function harvestConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    addPlayerFile(cfg.file);
    addPlayerFile(cfg.source);
    var lists = [cfg.sources, cfg.playlist];
    lists.forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        addPlayerFile(item.file);
        addPlayerFile(item.source);
        if (Array.isArray(item.sources)) item.sources.forEach(function (s2) { if (s2) addPlayerFile(s2.file); });
      });
    });
  }
  try {
    if (typeof window !== 'undefined' && typeof window.jwplayer === 'function') {
      var inst = window.jwplayer();
      if (inst && typeof inst.getConfig === 'function') harvestConfig(inst.getConfig());
    }
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.player && typeof window.player === 'object') {
      harvestConfig(window.player.config);
    }
  } catch (e) {}

  // ---- result -----------------------------------------------------------------
  var candidates = Array.from(bySrc.values())
    .sort(function (a, b) { return (b.score - a.score) || (b._t - a._t); })
    .map(function (c) { return { src: c.src, kind: c.kind, score: c.score }; });

  var result = {
    title: '',
    pageUrl: '',
    candidates: candidates,
    blobCount: blobCount,
    anyPlaying: anyPlaying
  };
  try { result.title = document.title || ''; } catch (e) {}
  try { result.pageUrl = (window.location && window.location.href) || ''; } catch (e) {}
  window.__vdtResult = result;
})();
