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

## Karaoke sync fix (2026-11-22, vòng sửa theo phản hồi người dùng)

Người dùng phản hồi 4 lỗi: (1) chữ dịch không chạy/tô sáng theo, (2) không vừa xem vừa
lướt được — panel thoại không tự cuộn tới câu đang phát, (3) tua video thì phần dịch
phải tua theo, (4) tốc độ chạy chữ lệch nhiều so với giọng đọc thật.

### Đã sửa
- **A. Karaoke bản dịch ngang hàng bản gốc + overlay trên video:** `.wt.on` giờ có nền
  accent 38% + viền accent + chữ sáng (trước chỉ là màu chữ nhạt gần như không thấy).
  Thêm overlay phụ đề song ngữ lớn ngay trên khung video (cả YouTube lẫn file):
  dòng gốc tô theo từng từ, dòng dịch tô theo tiến độ giọng — cùng dùng chung state `t`.
- **B. Auto-scroll:** panel tự cuộn mượt (scrollIntoView, block:center) tới câu đang
  phát. Có nút "Auto-scroll: On/Off" (mặc định On). Người dùng tự lăn chuột/chạm vào
  panel thì follow tạm dừng và hiện chip "▼ Follow the voice" để quay lại — không
  giành cuộn với người dùng.
- **C. Tua là đồng bộ:** khi `t` rơi vào khoảng trống giữa hai câu, câu active rơi về
  câu gần nhất đã bắt đầu (không mất highlight như trước). `<video>` có
  onTimeUpdate/onSeeked set `t` ngay; polling YouTube giảm xuống 100ms. Cả gốc và
  dịch đều suy ra từ cùng một `t` trong cùng một lần render nên tua là cả hai nhảy theo.
- **D. Timing giọng THẬT bằng Whisper (sửa gốc rễ lỗi 4):**
  - `scripts/asr_words.py`: faster-whisper với `word_timestamps=True`, xuất JSON
    {sentences:[{text,start,end,words:[{w,start,end}]}]}. Audio được giải mã bằng
    ffmpeg→numpy (né đường PyAV của faster-whisper, vốn hỏng với PyAV ≥15 —
    lỗi `metadata_errors`). Model qua env `WHISPER_MODEL` (mặc định `tiny`).
  - Venv nằm NGOÀI repo tại `~/workspace/vdt-whisper-venv` (~500MB, tuyệt đối
    không commit): tạo bằng `bash scripts/setup-asr.sh`. Route tự tìm venv theo
    thứ tự `$ASR_VENV` → `~/workspace/vdt-whisper-venv` → `scripts/.venv` (cũ).
  - API `POST /api/videos/[id]/align` (auth, đúng chủ video): upload/sample dùng file
    local, YouTube tải audio bằng yt-dlp của venv. Có phụ đề sẵn → MAP từ của Whisper
    lên câu phụ đề theo điểm giữa của từ (giữ nguyên chữ phụ đề); chưa có → dùng luôn
    segment của Whisper làm câu. Video được gắn `timingSource:'whisper'`. Lỗi →
    500 kèm lý do, timing cũ giữ nguyên.
  - Trang xem: câu có `words` thật thì tô gốc theo timing thật; bản dịch tô theo
    PROGRESS của giọng trong câu (từ đầu từ đầu tiên → cuối từ cuối cùng), từ dịch
    sáng khi tiến độ vượt vị trí tỉ lệ của nó. Chưa align thì giữ hành vi tỉ lệ cũ.
  - Nút "🎯 Align timing to voice (Whisper)" trên trang xem, có trạng thái đang chạy
    và báo kết quả/lỗi trung thực.

### Bằng chứng test (server production :3100)
- Script độc lập trên bài nói thật của JFK (11s, whisper.cpp samples): ra đúng nguyên
  văn, timing từng từ KHÔNG đều — độ dài từ 0,18s→1,12s, có khoảng lặng thật 1,1s sau
  "Americans," (2,30→3,40s). Phân bổ tỉ lệ theo độ dài chữ không thể tạo ra số này.
- Align đầu-cuối, video upload không phụ đề: `POST align` → {sentences:1, words:22},
  video có `timingSource:'whisper'`, 22 từ với timing thật được lưu.
- Align đầu-cuối, video có phụ đề dán tay (2 câu, khung 0–5/5–10 nhân tạo): chữ phụ đề
  được GIỮ NGUYÊN, 22/22 từ Whisper được map vào 2 câu (7+15), durations không đều.
- Align trên video mẫu (chỉ có tiếng tone, không có giọng): trả lỗi trung thực
  "Whisper found no speech — keeping previous timings", 4 câu mẫu còn nguyên.
- Chưa đăng nhập gọi align → 401. Luồng sample cũ: tạo video + trang xem 200, không hồi quy.
- `npm run build` PASS (có route /api/videos/[id]/align; chuỗi UI mới "Auto-scroll",
  "Follow the voice", ".sub-overlay", ".wt.on" đều có trong bundle production).

### Giới hạn thành thật
- Model `tiny` nhanh (~4s cho 11s audio trên CPU máy này) nhưng nhận chữ kém hơn
  `base`/`small`, nhất là tên riêng và tiếng không phải tiếng Anh; đặt
  `WHISPER_MODEL=base` để chính xác hơn, đổi lại chậm hơn. Timing từ của Whisper là
  ước lượng theo model, không phải mốc đo âm học tuyệt đối.
- Map từ lên phụ đề: nếu cách chia câu của phụ đề khác hẳn cách ngắt câu của Whisper,
  từ ở vùng biên được gán cho câu gần nhất — chữ đúng câu có thể lệch 1–2 từ ở điểm nối.
- Tô sáng bản dịch vẫn là ánh xạ theo tiến độ (progress-based) — không tồn tại timing
  âm thanh cho bản dịch, đây là xấp xỉ tốt nhất có thể, nhưng đã bám theo nhịp giọng
  thật thay vì bám theo khung thời gian phụ đề như trước.
- Tốc độ CPU: video dài (30–60 phút) với model tiny trên CPU sẽ mất vài phút; endpoint
  cho timeout 10 phút và nút align có trạng thái chờ, nhưng chưa có hàng đợi nền.
- YouTube: yt-dlp tải audio có thể bị YouTube chặn theo IP/đợt; khi đó align báo lỗi
  rõ ràng và app vẫn chạy với timing ước lượng.

## Link extraction v2 (2026-11-22, vòng sửa theo phản hồi: "chỉ set link cho YouTube thôi à?")

Trước đây detect-video chỉ regex trên HTML tĩnh (og:video, <video>, src=) nên
trang nào player nạp bằng JS, hoặc bị anti-bot, đều trả "No video found". V2:

### Kiến trúc (app/api/detect-video/route.js viết lại)
1. **Direct media short-circuit**: URL kết thúc .mp4/.webm/.mov/.m3u8, hoặc
   HEAD/ranged-GET trả content-type video/* hay mpegurl → 1 candidate
   score 100, kind `direct`.
2. **Deep static scan** (UA trình duyệt thật + Accept-Language): quét TOÀN BỘ
   HTML gồm cả thân <script> — URL media trần, config kiểu JWPlayer
   `file:`/`source:`/`sources:` (m3u8 trong script score 55), data-src/data-file;
   og:video trỏ tới file media score 90, og:video trỏ tới *trang embed*
   (không có đuôi media, vd player Vimeo) chỉ còn 60 vì <video> không phát
   trực tiếp được trang đó.
3. **Iframe embeds**: thu thập tối đa 5 <iframe src>, fetch (10s/cái, sâu 1
   lớp) và quét cùng bộ quy tắc; candidate gán kind `iframe-embed`, +5 điểm
   nếu trang iframe giống player.
4. **Engine yt-dlp** (fallback khi scan tĩnh không ra file media thật hoặc
   fetch lỗi): chạy `python -m yt_dlp -j` từ chính venv Whisper
   ($ASR_VENV → ~/workspace/vdt-whisper-venv → scripts/.venv). Ưu tiên file
   mp4 có cả hình+tiếng (85), rồi manifest m3u8 (80); kèm title/duration/thumb.
   Nếu URL trang trích không ra, engine thử tiếp URL embed/player mà scan
   tĩnh tìm được (đây là cách qua được Vimeo, xem dưới). Hai thực tế môi
   trường được xử lý trong code: `--impersonate chrome` khi venv có curl_cffi
   (Dailymotion/Cloudflare cần), và `--no-check-certificates` vì proxy chặn
   TLS khiến bundle certifi của yt-dlp reject chain của nhiều site lớn
   ("self-signed certificate in certificate chain") trong khi OS store tin
   chain đó — chỉ ảnh hưởng request metadata, bật lại verification bằng
   env `VDT_YTDLP_CHECK_CERT=1`. Lỗi của engine được trả về trong `engineNote`,
   không giả vờ thành công.
5. **Phát lại stream link** (videos POST kind `link`): lúc tạo video, server
   probe stream bằng Range GET *không* Referer; nếu bị 401/403/404 thì thử
   lại với Referer = trang gốc — chỉ đường thứ hai chạy thì đặt
   `needsProxy=true`. Route mới `GET /api/proxy-stream?u=&r=` (bắt buộc đăng
   nhập) fetch upstream kèm Referer đó; gặp playlist m3u8 thì viết lại mọi
   URL segment/key (kể cả URI="..." trong #EXT-X-KEY) qua chính proxy.
   Trang xem: src m3u8 thì nạp hls.js từ CDN jsdelivr và attach, Safari có
   HLS native thì dùng thẳng; video cần proxy thì phát qua /api/proxy-stream.

### Bằng chứng test (server production :3100, tài khoản test riêng)
- **(a) animevietsub.bid (link của user)**: fetch trang từ server bị chặn
  (kết nối bị cắt / trang kiểm tra anti-bot), yt-dlp generic cũng 403
  Cloudflare anti-bot. Kết quả trung thực: `candidates: []` + `engineNote`
  nói rõ site chặn truy cập tự động, kèm lỗi gốc của yt-dlp và workaround
  (dán link video/embed trực tiếp, hoặc tải file rồi upload). Trang chủ hiển
  thị đúng engineNote này (đã kiểm tra chuỗi trong bundle + logic setErr).
  KHÔNG tuyên bố link này chạy được.
- **(b) Vimeo https://vimeo.com/76979871**: scan tĩnh chỉ có og:video embed
  (60). yt-dlp trên URL trang bị Vimeo từ chối ("web client only works when
  logged-in"), nhưng engine thử URL player.vimeo.com từ og:video → trích
  được candidate kind `yt-dlp` score 80 kèm duration 62 + thumbnail; đã tạo
  video thành công. Playlist của candidate tải về 200 NHƯNG chứa
  `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm"` — video này được bảo vệ
  FairPlay DRM nên trình duyệt không phát được dù URL reachable. Đây là giới
  hạn của chính video, không phải của extractor.
- **(b′) archive.org/details/BigBuckBunny_124** (trang ngoài YouTube, kiểm
  chứng phát được trọn vẹn): og:video mp4 score 90 + 2 candidate
  `iframe-embed` từ iframe player của archive.org (nhánh iframe có bằng
  chứng dương tính). Tạo video kind `link`, needsProxy=false, stream trả
  206 Partial Content khi xin Range — phát + tua được.
- **Engine yt-dlp độc lập**: detect trên youtube.com/watch?v=jNQXAC9IVRw cho
  candidate kind `yt-dlp` (manifest HLS googlevideo, 80) — engine chạy trọn
  pipeline ngoài luồng YouTube cứng.
- **(c) m3u8 trực tiếp** (test-streams.mux.dev/x36xhzz): detect → `direct`
  100; tạo video; playlist gốc 200; qua proxy: playlist được viết lại đúng
  (mọi variant trỏ về /api/proxy-stream), tải 1 segment qua proxy → 200,
  272.412 byte; proxy không có cookie → 401. Bundle trang xem chứa loader
  hls.js@1 + logic proxy-stream.
- **needsProxy dương tính** (server local giả lập CDN: 403 khi không
  Referer, 200 khi có): tạo video → needsProxy=true, proxyReferer được lưu;
  phát qua /api/proxy-stream kèm referer → 200 video/mp4. Ca âm tính (Mux,
  archive.org) → needsProxy=false đúng.
- **(d) hlsplayer.net**: trang không có og:video/<video>/<source> nào (v1 ra
  0 candidate); v2 tìm được 3 candidate kind `script-url` score 55 (2 stream
  Castr + 1 Bitmovin Sintel), ambiguous=true để user chọn — đúng thiết kế.
  Trang MDN <video> cũng ra candidate từ text/script như kỳ vọng.
- **(e) Regression**: tạo video YouTube dQw4w9WgXcQ → 61 câu captions như
  cũ; sample → 4 câu; w3schools html5_video vẫn ra video-tag mp4/ogg;
  `npm run build` PASS.

### Ma trận hỗ trợ (trung thực)
- YouTube: ✓ (luồng riêng lấy captions; detect cũng qua được bằng engine).
- Site mà yt-dlp hỗ trợ (nghìn site): ✓ khi video không DRM/không bắt đăng
  nhập — Vimeo qua ngả player-embed, Bilibili/Dailymotion tùy trạng thái
  extractor + region (lúc test: Dailymotion trả metadata rỗng theo region,
  Bilibili vướng cert của proxy chặn TLS ở tầng tải trang của extractor).
- Link media trực tiếp (.mp4/.webm/.mov/.m3u8): ✓, gồm cả HLS qua hls.js.
- Trang HTML tĩnh / config JS / iframe player tự host: ✓ theo scan v2.
- Site streaming bị anti-bot wall (Cloudflare JS check kiểu animevietsub):
  ✗ từ phía server — không đường vòng hợp lệ ở tầng server; workaround là
  dán link video/embed trực tiếp lấy từ player, hoặc tải file về rồi upload.
- Video DRM (FairPlay/Widevine, vd Vimeo title ở trên): URL trích được
  nhưng ✗ không phát được trong trình duyệt nếu không có license server.

## ASR for every video (2026-11-22, vòng sửa theo phản hồi: "web mà cái gì cũng hạn chế thì người dùng dùng cái gì")

Vấn đề: video tạo từ link web (kind link/generic) luôn có `sentences: []` —
creation không hề thử lấy phụ đề của site, route Whisper (align) chỉ nhận
sample/upload/YouTube nên video link bấm vào là lỗi, và trang confirm kết
thúc bằng cảnh báo chết "ASR is not configured in this MVP". Mở khóa theo 3 lớp:

### Đã làm
- **Lưu `pageUrl`** trên record video link (trước đây chỉ dùng để probe
  proxy rồi bỏ). Mọi bước sau đều dựa vào URL trang gốc này.
- **Lớp 1 — phụ đề của chính site, lấy ngay lúc tạo video** (`lib/vtt.js`):
  yt-dlp của venv (`--write-subs --write-auto-subs --sub-langs all
  --sub-format vtt --skip-download`, ngân sách chung ~90s, không bao giờ
  chặn việc tạo video khi lỗi) → parse VTT (parser mới: xử lý cả 2 dạng
  timestamp, gỡ rolling-caption trùng lặp của auto-subs) → `sentences` +
  `transcriptSource: 'site subtitles (yt-dlp)'` + `subLang` từ tên file.
  Bài học thật: yt-dlp thoát mã lỗi (YouTube rate-limit 429 các track dịch
  tự động) SAU KHI các track thật đã tải xong — code phải quét thư mục lấy
  file đã tải thay vì tin mã thoát (đã sửa sau ca test đầu trả 'none' oan).
- **Lớp 2 — nút Whisper trên trang confirm**: video 0 câu không còn là
  đường chết — hiện panel với nút chính "🎙️ Create transcript with Whisper
  (listens to the video)" → `POST /api/videos/[id]/transcribe` (mới, auth +
  đúng chủ, timeout 600s): thay toàn bộ sentences bằng segment Whisper KÈM
  timing từng từ, `transcriptSource: 'whisper-asr'`, `timingSource:
  'whisper'`, lưu ngôn ngữ Whisper nghe được; không có tiếng nói → 422 và
  giữ nguyên dữ liệu cũ. Xong thì confirm tự nạp lại (số câu, ước tính
  token, nhận diện ngôn ngữ đều tươi mới). Câu báo lỗi cũ trong translate
  route + text ở trang chủ đã trỏ về nút này.
- **Giải audio dùng chung** (`lib/asrAudio.js`, align route đã refactor
  sang dùng chung, giữ nguyên hành vi cũ): sample → file local; upload →
  data/uploads; YouTube → yt-dlp tải audio; **link → 3 tầng**: (1) yt-dlp
  tải audio từ pageUrl; (2) nếu CDN từ chối yt-dlp: yt-dlp chỉ liệt kê
  format (-j) rồi tự kéo format audio tốt nhất bằng **ranged GET** (chỉ
  Referer + User-Agent như player thật); (3) ffmpeg kéo thẳng stream kèm
  Referer. Tầng 2 sinh ra từ bằng chứng thật: CDN bilivideo 403 với MỌI
  full-GET và với header kiểu trình duyệt của yt-dlp, nhưng trả 206 cho
  byte-range — curl/Node fetch kéo đủ 2.577.920 byte, ffprobe đọc được
  178,19s audio.

### Bằng chứng test (server production :3100, tài khoản test riêng)
- **Bilibili đầu-cuối** — BV1aRy4zxEMQ 【新闻联播】李梓萌9月收稿～ (178s,
  giọng phát thanh viên tiếng Trung): detect → candidate og:video (player
  embed); tạo link (pageUrl được lưu) → `transcriptSource 'none'`, 0 câu
  (đúng trạng thái người dùng gặp); bấm transcribe → **{ok, language 'zh',
  33 câu, 216 từ có timing}** trong ~38s (kéo audio tầng 2 + Whisper);
  nhận diện ngôn ngữ zh 100%; dịch zh→vi: **33/33 câu, 0 lỗi**, trừ 437
  token. Mẫu câu đầu: "今天的新闻联播播送完了" → "Bản tin thời sự hôm nay
  đã kết thúc."
- **Phụ đề site lúc tạo (lớp 1)**: tạo video YouTube dQw4w9WgXcQ qua luồng
  LINK → **60 câu, `transcriptSource 'site subtitles (yt-dlp)'`, subLang
  'en'**, parse sạch (dòng nhạc có timing chuẩn). Với Bilibili: đã probe
  6 video khác nhau (tin tức, TED re-up, song ngữ) — yt-dlp không đăng
  nhập chỉ thấy track `danmaku` (bình luận chạy chữ, KHÔNG phải phụ đề,
  code lọc đúng không nhận nhầm), không video nào có track phụ đề thật →
  trên Bilibili lớp 1 không bắt được gì và lớp Whisper là đường thắng.
- **Regression**: sample → 4 câu built-in; YouTube (kind youtube) → 61 câu
  captions; align trên file upload (mp4 giọng nói tiếng Trung tự dựng) →
  ok, 38 câu Whisper được adopt, 258 từ; transcribe lên video sample (chỉ
  tiếng tone) → 422 trung thực, dữ liệu cũ nguyên vẹn; transcribe không
  đăng nhập → 401; `npm run build` PASS (route transcribe có trong build).

### Giới hạn thành thật
- **Tốc độ CPU**: Whisper tiny trên CPU — 178s audio mất ~38s cả kéo +
  nghe ở máy test; video dài hàng giờ sẽ mất hàng chục phút (timeout route
  600s cho mỗi lần gọi; chưa có hàng đợi nền).
- **Độ chính xác của model tiny**: nghe đúng tiếng nhưng sai chữ lẻ
  (vd "白露"→"白路", "节气"→"节绩"); muốn chữ chuẩn hơn đặt
  `WHISPER_MODEL=base` (chậm hơn). Dịch vẫn đúng ý ở mức câu.
- **Phụ đề site tùy nền tảng/người đăng**: có video mới có; Bilibili không
  đăng nhập thì yt-dlp không thấy track phụ đề nào (cần cookie đăng nhập
  mới khác — chưa làm). Chất lượng dịch phụ thuộc nhà cung cấp free
  (MyMemory đôi lúc dịch cụt một từ đứng lẻ, vd "再见" đứng một mình).
- Phát lại video Bilibili trong trang xem vẫn là candidate trang player
  embed (Bilibili chỉ cấp DASH tách hình/tiếng, không có file gộp) — vòng
  này mở khóa PHẦN LỜI THOẠI/dịch/học, không thay đổi bản chất stream đó.

## Headless extraction layer (2026-11-22, vòng sửa theo yêu cầu: "thêm Headless browser, bắt network trong cả iframe, auto-play")

### Kiến trúc
- **`lib/headless.js`** — `extractWithHeadless(pageUrl, { timeoutMs })`, stage (5)
  CUỐI CÙNG trong `POST /api/detect-video`: chỉ chạy khi các stage trước
  (direct → static/iframe scan → yt-dlp) không ra media file nào chơi được,
  nên các đường nhanh không bao giờ bị chậm vì nó. Trần 60s/lần gọi,
  tắt bằng `VDT_HEADLESS=0`.
- **Bắt network ở cả 2 tầng** `page.on` + `context.on` cho request/response/
  requestfailed: sự kiện request của Playwright bắn cho MỌI frame (kể cả
  iframe cross-origin lồng nhau mà DOM không chạm được), mỗi candidate ghi
  rõ `frameUrl` của frame đã phát request và `status` HTTP (0 = request chết
  không có response). Lọc media `.(m3u8|mp4|webm|mov)`, loại host quảng cáo
  như extension finder, bỏ qua segment `.ts`.
- **Auto-play**: Chromium mở với `--autoplay-policy=no-user-gesture-required`
  + `--mute-audio`; sau khi load, với mọi frame chạm được: mute + `play()`
  mọi `<video>`, click các overlay quen thuộc (`.vjs-big-play-button`,
  `.jw-display-icon-container`, `[class*="play" i]`…), click tâm iframe lớn
  nhất; chờ request media đầu tiên + 5s settle để bắt rendition phụ.
- **DOM harvest**: evaluate nguyên `extension/finder.js` trong main frame và
  mọi child frame cùng origin, gộp candidate kind `headless-dom`.
  Candidate network: m3u8 = 85, mp4 = 75, +10 nếu frame phát request trông
  như player/embed. Response có engineNote riêng khi headless là stage tìm
  ra hoặc khi nó cũng bó tay (vd trang bot-check).
- **Cài đặt**: `bash scripts/setup-browser.sh` (`npm install` +
  `npx playwright install chromium`); binary ~126MB nằm ở
  `~/.cache/ms-playwright`, KHÔNG vào repo. `playwright` khai trong
  dependencies + `serverExternalPackages` ở next.config.

### Thực tế môi trường đã xử lý (VM này)
Chromium không CONNECT qua egress proxy của VM được: `ERR_TUNNEL_CONNECTION_FAILED`
dù proxy trả 200 cho CONNECT y hệt từ curl/Node/Python (đã kiểm chứng bằng
net-log của Chromium + replay ClientHello ở mức gói tin — lỗi của riêng
đường Chromium↔proxy, không phải do trang đích). Giải pháp trong
`lib/headless.js`: khi có proxy env, dựng **relay loopback** bằng Node
(Chromium → 127.0.0.1 relay → CONNECT lên upstream proxy bằng credential
env → đích); Node CONNECT được proxy chấp nhận nên đường này chạy. Kèm
`ignoreHTTPSErrors` khi có proxy (proxy chặn TLS dùng CA nội bộ). Trên máy
người dùng không có proxy env thì Chromium đi thẳng, không qua relay.

### Bằng chứng test (server production, code cuối)
- **motphim** (`/xem-phim/anh-la-nam-chinh-doi-em/tap-1/vietsub?server=kk`):
  qua pipeline, stage STATIC đã ra candidate trong ~2,4–3,3s (payload RSC
  của Next.js chứa sẵn URL) — 2 `script-url` 55 + 1 `source` 35. Kiểm chứng
  headless TRỰC TIẾP trên cùng trang tập phim: trang render đúng title,
  auto-play chạy, **bắt được đúng playlist
  `https://a.kvp726.com/20261026/oDOMGMuB/index.m3u8` kind
  `headless-network` score 95 do iframe player
  (`motphim.skin/api/v1/player?…`) phát ra** — cơ chế bắt network trong
  iframe hoạt động đúng thiết kế. NHƯNG stream không phát được từ server
  này: playlist trả **404 cho mọi lần fetch trực tiếp** (không Referer,
  Referer trang xem, Referer nguyên frame player, Range hay full GET), và
  trong phiên headless, JW Player không tiến triển (click tâm iframe +
  gọi thẳng `jwplayer().play()` vẫn 0 response từ CDN, video readyState 0,
  paused) → URL bị CDN khóa theo phiên/IP; egress datacenter bị từ chối.
  **Không tuyên bố motphim phát được phía server** — đường chắc chắn với
  nhóm này vẫn là extension trong trình duyệt của chính người dùng.
- **animevietsub.bid** (link Ranma tập 11 của user): pipeline đầy đủ —
  fetch 403, yt-dlp 403, headless chạy (~64s tổng) nhưng điều hướng chết
  `ERR_CERT_AUTHORITY_INVALID` trong môi trường này (chuỗi cert qua proxy
  chặn TLS bị bản headless từ chối cho host này dù đã bật ignoreHTTPSErrors;
  bắt tay TLS thô tới host qua proxy cũng timeout) → candidates rỗng, API
  trả engineNote ghép trung thực có cả kết quả headless. Site này vẫn ✗
  phía server.
- **Regression**: Mux direct ~0,1s; YouTube qua engine ~7,2s; sample 4 câu;
  motphim detect 2,4s — headless KHÔNG kích hoạt khi stage trước đã có
  media; `npm run build` PASS.

### Ma trận hỗ trợ (cập nhật)
| Loại trang | Đường thắng | Phát lại từ server |
|---|---|---|
| YouTube / site yt-dlp hỗ trợ | yt-dlp / captions | ✓ (trừ DRM) |
| Link media trực tiếp | direct | ✓ |
| Trang tĩnh / JS-config / iframe embed | static scan v2 | ✓ (đã test archive.org, Mux) |
| Trang JS-app, stream không khóa phiên | headless (network iframe) | ✓ theo cơ chế — chờ ca thật để xác nhận trọn vẹn |
| motphim (JS-app + CDN khóa phiên/IP) | detect ra URL (static/headless) | ✗ từ egress này (404) — dùng extension |
| animevietsub (anti-bot 403 + TLS) | — | ✗ mọi đường server — dùng extension/upload |
| Nội dung DRM (FairPlay/Widevine) | — | ✗ mọi trình duyệt ngoài player gốc |

### Chi phí
- Dung lượng: Chromium ~126MB (headless shell) trong cache người dùng.
- Độ trễ detect khi headless kích hoạt: ~35–90s (trần route 60s cho riêng
  stage này, cộng thời gian các stage trước); RAM ~200–400MB/phiên, mỗi
  lần detect tối đa 1 browser, đóng ngay sau khi xong.

## Transcript & translation quality (2026-11-22, vòng sửa theo test thật: "lộn lấy văn bản gốc sai tùm lum" + "dịch sai tùm lum")

### Đã thay đổi
- **ASR:** `scripts/asr_words.py` dùng `beam_size=5` (trước: 1). Model mặc
  định ở route transcribe + align đổi từ `tiny` → **`base`** (env
  `WHISPER_MODEL` vẫn thắng khi được đặt). Route transcribe nhận thêm
  `body.model` (chỉ chấp nhận `tiny|base|small|medium`, giá trị lạ thì rơi
  về mặc định). Trang Confirm có thêm ô chọn model cạnh nút Whisper, ghi rõ
  dung lượng tải lần đầu: tiny ~75MB, base ~140MB, small ~470MB, medium ~1.5GB.
- **Dịch:** chuỗi engine mới trong `lib/translate.js`:
  **Google Translate gtx** (`translate.googleapis.com/translate_a/single`,
  không cần key; mã `zh` → `zh-CN`, các mã còn lại giữ nguyên) → MyMemory →
  LibreTranslate. gtx lỗi/timeout/rỗng thì tự rơi xuống engine kế, không
  báo lỗi cho người dùng. (Bước OpenRouter cũ đã gỡ khỏi chuỗi: chỉ chạy
  khi có key và không còn nằm trong chuỗi ưu tiên mới.)

### Benchmark ASR (bằng chứng thật)
Video YouTube `hFZ1CsQulmw` （何同学， tiếng Trung phổ thông rõ ràng) — có
**phụ đề zh-CN do người đăng tải lên (không phải auto-caption)**. Lấy 120
giây đầu: phụ đề gốc làm ground truth (520 ký tự sau khi bỏ dấu câu/khoảng
trắng), chạy `asr_words.py` từng model (beam 5), tính CER (khoảng cách
chỉnh sửa / số ký tự gốc) và độ tương đồng difflib:

| Model | CER ↓ | Tương đồng ↑ | Thời gian (120s audio, VM này) |
|---|---|---|---|
| tiny | 0.302 | 0.670 | 14.6s |
| base (mặc định mới) | 0.198 | 0.811 | 22.5s |
| small | 0.102 | 0.900 | 56.4s |

Ví dụ lỗi điển hình của tiny mà small sửa được: 垃圾桶 → "垃圾头",
桌子上 → "猪子上的", 狂奔的 → mất hẳn. base vẫn còn lỗi đồng âm
（不倒 → 不到）. Kết luận: small giảm ~2/3 lỗi so với tiny; base là mặc
định cân bằng, người dùng cần chính xác hơn thì tự chọn small/medium ở
trang Confirm.

### Kiểm chứng dịch (5 câu trong ảnh chụp của user, zh→vi)
| Câu gốc | MyMemory (cũ) | Chuỗi mới (gtx) |
|---|---|---|
| 然后突然推出了一本爱情合集。 | rồi bất ngờ tung ra một tòn tập tình thường rã | Rồi đột nhiên một bộ sưu tập tình yêu xuất hiện. |
| 胆小的狗怕扒掉垫子。 | Chó mức hoàn sợ tháo trải | Chó nhút nhát sợ làm rách thảm. |
| 粘上跛脚猫有时让蝙蝠失去做脚猫的对手 | Dính chú mèo tay quầy đôi khi sẽ làm dơi mất đôi tay quẩy cụy ra | Gắn mèo què đôi khi khiến dơi mất đối thủ vào tay mèo què |
| 对于去球场的人。 | đối với kẻ đi săn | Dành cho những người đi đến sân bóng chày. |
| 只需一次成功的练习 | Chỉ cần một lần tập tích thành công | Chỉ cần một lần thực hành thành công |

### Regression end-to-end (server production)
- `npm run build` PASS; ô chọn model xuất hiện trong bundle trang Confirm.
- Tạo sample → dịch en→vi qua chuỗi mới: 4/4 câu, 0 lỗi.
- Upload file ghi âm tiếng Trung thật (120s) → transcribe với
  `{"model":"base"}` qua API: trả 73 câu, 450 từ có timestamp, ~24s.

### Giới hạn thành thật
- ASR vẫn không hoàn hảo: nội dung lóng/vô nghĩa kiểu mockumentary (chính
  câu gốc trong ảnh của user — "做脚猫" — nhiều khả năng bản thân nó đã là
  Whisper nghe sai từ video trước), audio nhiễu/nhạc nền, nói nhanh chồng
  tiếng đều làm CER tăng mạnh so với con số benchmark trên tiếng phổ
  thông sạch. Model lớn hơn chỉ giảm lỗi, không xóa hết.
- gtx là endpoint miễn phí **không chính thức**: có thể bị rate-limit hoặc
  thay đổi bất cứ lúc nào; khi đó chuỗi tự rơi về MyMemory/LibreTranslate
  (chất lượng thấp hơn thấy rõ) mà không có cảnh báo riêng.
- beam_size=5 + model lớn hơn = chậm hơn trên CPU: small tốn ~2.5× thời
  gian của base cho cùng audio trên VM này; medium chưa benchmark (tải
  ~1.5GB, dự kiến chậm hơn nữa).

## Translation timing sync (phrase alignment) (2026-11-22, vòng sửa theo phản hồi: "sao giọng đọc và dịch không khớp vậy")

### Vấn đề
Từ gốc sáng theo timestamp Whisper THẬT, nhưng từ dịch sáng theo tiến độ
giọng đọc tổng thể (mỗi từ sáng khi progress vượt qua "trung tâm tỉ lệ"
của nó theo độ dài ký tự — một vệt quét đều). Câu có khoảng lặng ở giữa,
đoạn nói nhanh/chậm, hay thứ tự từ khác nhau là bản dịch lệch khỏi ý đang
được nói.

### Cách sửa — `lib/align.js`
1. Cắt từ gốc thành **cụm** tại khoảng lặng ≥0.30s hoặc dấu câu giữa câu.
2. Dịch riêng từng cụm (qua `translateSentence`, có cache).
3. Tokenize bản dịch toàn câu; tìm dãy token của từng cụm dịch trong đó
   (chuẩn hoá: thường hoá, bỏ dấu câu, bỏ dấu tiếng Việt). Token thừa gán
   cho cụm gần nhất; cụm không khớp liên tục được chia tỉ lệ theo độ dài
   trong phần token còn lại. Các cụm phủ kín mọi token, không chồng lấn.
4. Trong cụm: số từ bằng nhau thì ghép 1:1 theo thứ tự; khác nhau thì
   phân bổ token theo tỉ lệ thời lượng từ gốc — mỗi token dịch nhận
   start/end THẬT nằm trong khoảng nói của cụm.
Kết quả lưu vào `sentence.twords`. Route dịch tự tính twords cho câu có
`words`; route mới `POST /api/videos/[id]/align-translation` tính lại cho
video đã dịch từ trước; trang Watch có nút "🔗 Sync translation timing".
`translationWordsAt` dùng twords khi có (độ dài phải khớp bản dịch hiện
tại — lệch là coi như cũ và rơi về quét tỉ lệ như trước). Video không có
twords chạy y như cũ.

### Bằng chứng test (server production :3100, tài khoản test riêng)
Tập phim: **【阿甘妙世界】The Awareness** — Bilibili **BV1zW4y167zf**,
UP 云里雾里不知物理 (một trong hai UP được chỉ định; BV1kY411w7zX được
chỉ định trước chỉ là clip 2 phút). Bài đăng dạng分P (intro 5s + 4 phần);
đã tải cả 5 phần, ghép thành 1 file 685.9s (11:26), upload vào app (luồng
link của app chỉ lấy p1; bài test sync cần 1 record liên tục). Whisper
model **small** nghe ra **en** (âm thanh gốc tiếng Anh): 279 câu, 1637 từ;
dịch en→vi 279/279, 0 lỗi.

Đo trên cùng một phép phân đoạn tham chiếu (cụm theo aligner): một từ
dịch "đúng nhịp" khi thời điểm nó sáng rơi trong khoảng nói của cụm nó
thuộc về. Tổng 2187 từ dịch trên 279 câu:

| Chỉ số | Logic cũ (quét đều) | Sau khi sửa (twords) |
|---|---|---|
| % từ sáng trong cụm của nó — toàn bộ | 88.9% | **100%** |
| — chỉ câu nhiều cụm (130 câu, 1160 từ) | 79.1% | 100% |
| — câu có lặng ≥0.5s giữa câu (6 câu, 34 từ) | **38.2%** | 100% |
| Trung vị \|lệch so với điểm bắt đầu cụm\| (cụm nhiều từ) | 0.557s | — |
| Độ phủ twords trên câu đã dịch có `words` | — | **279/279 = 100%** |

Mục tiêu ≥98% trong-cụm và ≥90% độ phủ: đều đạt ngay vòng đo đầu tiên.
Ca nặng nhất của logic cũ: câu "Oh, it's Green Week." lặng 2.42s sau
"Oh," — bản dịch cũ sáng "đó là Tuần lễ" ngay trong khoảng lặng
(91.5–93.1s, giọng bắt đầu lại ở 93.8s); bản mới chờ đúng cụm. Câu
"No. No, I didn't." (lặng 0.68s): cũ chỉ 1/6 từ trong-cụm, mới 6/6.

Regression: sample (không có `words`) dịch 4/4, không twords, vẫn chạy
fallback tỉ lệ; twords cũ lệch độ dài tự rơi về fallback; `npm run build`
PASS; nút Sync xuất hiện trong bundle trang Watch.

### Giới hạn thành thật
- Căn chỉnh ở mức **cụm**, không phải mức ngữ nghĩa từng từ: trong một
  cụm ngắn, thứ tự từ địa phương bị đảo (vd tính từ/danh từ) vẫn có thể
  lệch một phần giây.
- Trong cụm giả định thứ tự đơn điệu; cụm nào engine dịch lại bằng từ
  khác hẳn khi dịch riêng (không khớp liên tục) thì rơi về chia tỉ lệ
  trong nội bộ cụm — vẫn bị chặn trong khoảng nói của cụm, nhưng kém
  chính xác hơn khớp trực tiếp.
- Lần dịch đầu tiên tốn thêm các call dịch theo cụm (sau đó có cache);
  video dịch trước tính năng này cần bấm nút Sync một lần.
- Video không có timestamp từ thật của Whisper (chưa align/transcribe)
  vẫn dùng phép quét tỉ lệ cũ — sync này chỉ hoạt động khi đã có `words`.

### Addendum (2026-11-22, tối): sync TỰ CHỮA + CHIA NHỎ theo chunk — vòng sửa theo phản hồi: "vẫn vậy, có khác gì đâu" và "Sync failed: Failed to fetch"

Hai lỗi thật user gặp trên máy của họ:

1. **"Bấm Sync mà không thấy khác gì"** — video dịch từ trước không có
   `twords`; tệ hơn, nếu transcript đến từ phụ đề của site (không có
   `words` thật của Whisper) thì `alignTranslation` trả null cho mọi câu
   và nút Sync *im lặng không làm gì cả*.
2. **"Sync failed: Failed to fetch"** — route cũ đồng bộ CẢ video trong
   một request: hàng trăm call dịch theo cụm chạy nối tiếp, fetch chết
   giữa chừng và **không lưu được gì**.

Cách sửa:

- **Route luôn báo số, không bao giờ no-op lặng lẽ.** Response của
  `POST /api/videos/[id]/align-translation` giờ có
  `{ aligned, skippedNoWords, skippedNoTranslation, total }` đếm trên các
  câu đã xử lý — câu bị bỏ qua vì thiếu `words` hay thiếu bản dịch đều
  được đếm và nói rõ.
- **Chia nhỏ theo chunk.** Route nhận `{ from, limit }` (không truyền =
  xử lý tất cả như cũ), trả thêm `processedUntil` + `done`; mỗi chunk
  được lưu xuống DB trước khi trả lời. Trang Watch (cả auto-sync lẫn nút
  Sync) gọi lặp `limit=40` cho tới `done`, hiện tiến độ trực tiếp
  ("Syncing translation timing… 120/279"). Chunk nào lỗi được thử lại 1
  lần; lỗi tiếp thì dừng ở đó và hiện "Sync stopped at X/Y — press Sync
  to continue" — các chunk đã xong giữ nguyên twords, bấm Sync lại là
  chạy tiếp rẻ (cache dịch theo cụm còn nguyên).
- **Tự chữa khi mở trang.** Trang Watch tự chạy sync MỘT lần khi nạp
  xong nếu video đã dịch + có câu mang `words` thật nhưng thiếu/sai
  twords (guard bằng ref, tối đa 1 lần mỗi lần mở trang; video đã sync
  đủ thì không chạy). Không tự chạy khi chưa có gì để sync.
- **Không có `words` thì nói thẳng trên màn hình.** Notice cố định dưới
  dòng timing: "This video has no real voice timings yet, so the
  translation can't be phrase-synced. Run Align (Whisper) first, then
  Sync." Nút Sync cũng thông minh hơn: video chưa có câu nào có `words`
  thì Sync tự chạy Align (Whisper) trước rồi mới align-translation.
- **Header đếm được.** Dòng timing giờ hiện
  `translation timing: phrase-align (212/279)` khi đã sync (đếm từ dữ
  liệu thật đã nạp), hoặc `estimated (no voice timings)` khi chưa có
  mốc giọng thật.
- **Nhanh hơn ở tầng align (`lib/align.js`).** (a) *Đường tắt một cụm:*
  câu chỉ có 1 cụm thì bản dịch của cụm CHÍNH LÀ bản dịch cả câu — không
  gọi API dịch nào cả, token được phân bổ trên các từ gốc theo thời
  lượng thật (đa số câu thoại là một cụm — đây là lý do sync cả tập phim
  khi cache ấm chỉ tốn chưa tới 1 giây). (b) Câu nhiều cụm: dịch các cụm
  qua một pool giới hạn tối đa **4 call đang bay** (kèm cache có sẵn),
  các câu trong một chunk cũng xử lý song song có giới hạn trên cùng pool
  đó.

Bằng chứng test (server production :3100, tài khoản test riêng; tập
Gumball *The Awareness* 304 câu/1657 từ, Whisper base, dịch en→vi
304/304):

| Ca | Kết quả |
|---|---|
| A — sample không có `words` | align-translation: `aligned 0, skippedNoWords 4/4, done true` — nói rõ lý do thay vì im lặng; bundle trang Watch chứa notice + logic auto-sync + vòng chunk |
| B — có `words`, xoá sạch twords giả lập video cũ | gọi 1 lần (không body): `aligned 304/304`, GET thấy twords trở lại, 0.65s khi cache ấm |
| C — gọi lại trên video đã sync đủ | `aligned 304` ổn định, không lỗi, không đổi dữ liệu |
| D — xoá twords, chạy vòng chunk `limit=10` | 31 chunk; `done=false` cho 30 chunk đầu, `true` ở chunk cuối; cộng dồn `aligned = 304`; chunk chậm nhất **0.104s** (cache ấm; trần thiết kế <20s/chunk 40 khi cache lạnh nhờ fast path + pool 4) |
| E — đường tắt một cụm | dọn sạch cache dịch rồi align 2 câu tổng hợp: cache chỉ xuất hiện đúng 2 key của câu NHIỀU cụm (`I came home`, `and slept` — ca đối chứng), **0 call** cho câu một cụm nhưng twords vẫn đúng (token phân bổ trong đúng khoảng nói, đơn điệu); câu nhiều cụm khớp 1:1 từng cụm (`và` sáng ở 3.3s = điểm bắt đầu cụm 2) |

Giới hạn còn lại: chunk lạnh (lần sync đầu của video dài, cache rỗng)
vẫn tốn thời gian theo số cụm nhiều-cụm và tốc độ engine miễn phí —
nhưng nay nó *tiến triển từng chunk và sống sót qua lỗi mạng*, không
còn chết toàn cục như trước.
