// test-finder.mjs — plain-Node test for finder.js with stubbed
// window/document/performance. Run:  node extension/test-finder.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

// --- Fixture: a walled streaming page (motphim-like) -------------------------
// - one PLAYING <video> fed by a blob: URL (MSE player — the real case on
//   motphim.skin / animevietsub: the src itself is useless, the playlist the
//   player fetched over the network is the prize)
// - performance entries: the real .m3u8 playlist, an ad .mp4 on doubleclick,
//   a googlesyndication script, and .ts segments (must never match)
// - one embed iframe
const PLAYLIST = 'https://cdn.example.net/hls/anh-la-nam-chinh-123/index.m3u8?token=abc123';

globalThis.window = {
  location: { href: 'https://motphim.skin/xem-phim/anh-la-nam-chinh-doi-em/tap-1' },
  // no jwplayer / player globals on this fixture page
};
globalThis.location = globalThis.window.location;
globalThis.document = {
  title: 'Anh Là Nam Chính Đời Em — Tập 1',
  querySelectorAll(sel) {
    if (sel === 'video') {
      return [{
        currentSrc: 'blob:https://motphim.skin/9f2c-uuid',
        src: 'blob:https://motphim.skin/9f2c-uuid',
        paused: false,
        querySelectorAll: () => [],
      }];
    }
    if (sel === 'iframe') {
      return [{ src: 'https://embed.example.net/player/xyz' }];
    }
    return [];
  },
};
globalThis.performance = {
  getEntriesByType(type) {
    if (type !== 'resource') return [];
    return [
      { name: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', startTime: 120 },
      { name: 'https://cdn.example.net/hls/anh-la-nam-chinh-123/seg-0001.ts', startTime: 9000 },
      { name: PLAYLIST, startTime: 4200 },
      { name: 'https://ads.doubleclick.net/video/banner.mp4', startTime: 9500 },
      { name: 'https://cdn.example.net/hls/anh-la-nam-chinh-123/seg-0002.ts', startTime: 9600 },
    ];
  },
};

// --- Run finder.js against the fixture ---------------------------------------
const code = fs.readFileSync(new URL('./finder.js', import.meta.url), 'utf8');
vm.runInThisContext(code, { filename: 'finder.js' });

const res = globalThis.window.__vdtResult;
assert(res, 'finder must set window.__vdtResult');
assert.strictEqual(res.pageUrl, 'https://motphim.skin/xem-phim/anh-la-nam-chinh-doi-em/tap-1');
assert.strictEqual(res.title, 'Anh Là Nam Chính Đời Em — Tập 1');

// The playlist ranks first (network-stream, boosted because it feeds the
// playing blob/MSE video).
assert(res.candidates.length >= 2, 'expected at least playlist + iframe candidates');
assert.strictEqual(res.candidates[0].src, PLAYLIST, 'm3u8 playlist must rank first');
assert.strictEqual(res.candidates[0].kind, 'network-stream');
assert.strictEqual(res.candidates[0].score, 90, 'playlist = 70 base + 20 playing-boost');

// Ads are excluded even though the ad is a real .mp4.
assert(!res.candidates.some(c => c.src.includes('doubleclick')), 'doubleclick ad must be excluded');
assert(!res.candidates.some(c => c.src.includes('googlesyndication')), 'googlesyndication must be excluded');

// Segments never match the media regex.
assert(!res.candidates.some(c => c.src.endsWith('.ts')), '.ts segments must not be candidates');

// blob: srcs are never sent, only counted.
assert(!res.candidates.some(c => c.src.startsWith('blob:')), 'blob: src must not be a candidate');
assert.strictEqual(res.blobCount, 1, 'blob video must be counted in blobCount');

// The embed iframe is harvested as a low-score candidate.
const iframe = res.candidates.find(c => c.kind === 'iframe');
assert(iframe, 'embed iframe candidate expected');
assert.strictEqual(iframe.src, 'https://embed.example.net/player/xyz');
assert.strictEqual(iframe.score, 40);

// Sorted descending by score.
for (let i = 1; i < res.candidates.length; i++) {
  assert(res.candidates[i - 1].score >= res.candidates[i].score, 'candidates must be sorted by score desc');
}

console.log('test-finder: ALL PASS');
console.log(JSON.stringify(res, null, 1));
