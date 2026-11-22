# BUILD REPORT — MVP (build phase, 2026-11-22)

## How to run
```bash
npm install
npm run build
npm run start        # http://localhost:3000 (PORT env to change)
# dev: npm run dev
```
No env vars required. Optional: `OPENROUTER_API_KEY` enables an extra translation provider ahead of the free ones.
Data lives in `data/db.json` + `data/uploads/` (both gitignored). Sample video: `public/sample.mp4` (ffmpeg-generated, 24s, 854×480).

## Stack actually used
Next.js 15 (App Router, plain JS) + plain CSS in `app/globals.css` (no Tailwind — fewer moving parts). Deps: `franc` (language detection), `youtube-transcript` (caption fetch). Auth/data: node crypto scrypt + JSON file store (SPEC's Supabase/Python-worker plan was deliberately deferred for MVP stability; the store sits behind `lib/store.js` so it can be swapped later).

## What was implemented (per task list 1–10)
1. Auth register/login, scrypt hash, httpOnly session cookie, JSON store. ✔
2. Home morphing button: collapsed pill → expands (Link/Upload tabs in one frame) → collapses with spinner + % + step label on the button while processing; quota shown when logged in; sample entry. ✔
3. Ingest: YouTube (ID extract, IFrame API player + currentTime polling, `youtube-transcript` captions), generic page via `/api/detect-video` (og:video + `<video>` scoring, ambiguous → user picks), upload mp4/webm/mov/mkv to `data/uploads` served with HTTP Range, built-in SAMPLE with known transcript, manual-transcript paste fallback + explicit "ASR not configured" notice (no fake ASR). ✔
4. Confirm step: detected languages with % (franc per sentence), user confirms source + picks target, REAL heuristic token count (documented in `lib/text.js`: CJK char = 1 token, other text ≈ 4 chars/token) ×1.3 estimate, 50,000/day quota, insufficient → 402 with fit-count and a partial-translate button; quota deducted only on confirm. ✔
5. Translation: MyMemory (no key) → LibreTranslate public → optional OpenRouter; per-sentence, cached in store; per-sentence failures counted, never crash the flow. ✔
6. Watch karaoke: word timings distributed proportionally to word length for BOTH original and translation over the same sentence interval; both highlight from player time; click sentence seeks; loop-one-sentence; 0.75×; hide original / hide translation; transcript search. ✔
7. Quick save: click word → popover (word, sentence context, sentence translation as meaning-in-context) + Save; 🔖 per sentence; stores kind/text/sentence/translation/videoId/timestamp. ✔
8. Library: thumbnails, progress bar (progress PATCHed every 5s from watch page), resume, saved-count per video. ✔
9. Notebook cards with timestamp link back to `/watch/:id?t=…`; review stages 1→3→7→14→30 days, mark-reviewed advances stage. `/notebook/review`: exercises generated FROM saved items, easy MCQ → medium fill-blank → hard reorder + translate-back (keyword-overlap grading, labelled as deterministic approximation); submit → score + per-question explanation. ✔
10. Settings: default target language (persisted on user, pre-selected on confirm page), today's quota usage bar. ✔

## Self-test results (live server on :3100, production build)
- `npm run build` — PASS (17 routes, no errors).
- GET / → 200; /sample.mp4 → 200; /watch/:id, /notebook, /notebook/review → 200.
- Register qa@test.local → 200 + session cookie; GET /api/auth returns user + quota 0/50000; wrong password → 401; duplicate/short-password paths coded (400/409).
- Sample flow: create sample → confirm info shows detection `en 100%`, sourceTokens counted → translate en→vi charged **67 tokens**, all 4 sentences got real Vietnamese from MyMemory (e.g. "Mặt trời buổi sáng ló dạng trên ngôi làng yên tĩnh."). Quota endpoint then showed used=89 after a second video (67+22) — accounting consistent.
- YouTube flow: creating from `watch?v=dQw4w9WgXcQ` fetched **61 caption sentences** via youtube-transcript (transcriptSource "YouTube captions").
- detect-video: example.com → 0 candidates (correct); w3schools video page → 2 candidates with equal scores → `ambiguous:true` (correct — user must pick, mp4 vs ogg are format variants of the same clip).
- Upload: sample.mp4 uploaded → served 200 full (3,500,441 bytes) and **206 for Range bytes=0-1023**; upload + pasted transcript → 3 sentences, detection en 100%, translate charged 22.
- Saves: word + sentence saved; library savedCount=2; progress PATCH 13 → persisted (library showed progress 13); mark-reviewed → stage 0→1 and nextReview moved +3 days; settings defaultTarget saved and reflected in /api/auth.
- Exercises: from 2 saves → **8 exercises** (2 easy MCQ, 2 medium fill, 2 hard reorder, 2 hard translate-back), ordered easy→medium→hard.
- Unauthenticated /api/videos and /api/save → 401. ✔
- BUG FOUND & FIXED during QA: logout returned "email and password required" because validation ran before the logout branch. Fixed in `app/api/auth/route.js`, rebuilt, retested: logout → `{ok:true}`, subsequent /api/auth → `user:null`. ✔

## Known limitations (honest)
- **No ASR.** Videos without captions and without a pasted transcript show a clear notice and cannot be translated. Whisper integration is future work.
- Token counter is a documented heuristic (±~25%), not a real BPE tokenizer — fine for quota estimates, labelled as an estimate in the UI.
- MyMemory free tier rate-limits long videos: translating a 61-sentence YouTube video works but is slow (sequential per-sentence calls) and some sentences may fail (counted and reported as `failed`, originals remain). LibreTranslate public endpoint is often rate-limited too; setting OPENROUTER_API_KEY improves this a lot.
- Karaoke word timing is proportional distribution, not forced alignment — words highlight approximately in sync, good for sentence-paced speech, not frame-exact.
- Generic-site playback: a chosen candidate that is a direct mp4/webm file plays in `<video>`; candidates that are embed pages/m3u8-only or behind CORS/login may not play or have no transcript (manual paste is the fallback).
- JSON store is single-process/single-writer (atomic rename writes); fine for MVP QA, not for concurrent production load.
- Sample video has no real speech audio (ffmpeg test pattern + tone) — it exists to exercise the full flow with its known transcript; karaoke timing follows the transcript intervals.
- Forgot-password from SPEC is not implemented in this MVP (register/login only).

## Parent QA loop (vòng 2, 2026-11-22, server production :3200, tài khoản test riêng)
- Register/login/quota: PASS. Sample: detect en 100%, estimate 50 tokens gốc / 65 cả dự trù, dịch thật 4/4 câu MyMemory, trừ 67 token. PASS.
- **BUG vòng 2 (parent bắt được):** lưu qua API mà không gửi kèm `translation` thì save có bản dịch rỗng -> `/api/exercises` trả 0 bài ("Save at least 1 translated...") dù video đã dịch. Đã sửa: `app/api/save` tự tra bản dịch của câu trong video để điền vào save; `app/api/exercises` tự bổ sung bản dịch cho các save cũ thiếu. Retest: save cũ sinh được bài tập; save mới không gửi translation được tự điền đúng "Cô mở cửa sổ và hít thở không khí trong lành." PASS.
- detect-video (POST): w3schools -> 2 candidate bằng điểm, `ambiguous:true`. PASS.
- YouTube thật dQw4w9WgXcQ: lấy 61 câu captions. PASS.
- Upload sample.mp4 -> src phát được; progress PATCH 17 persist ở library, savedCount=3; logout -> `{ok:true}`, phiên sạch. PASS.
- Build cuối: PASS. Dữ liệu test đã xóa trước khi push.
