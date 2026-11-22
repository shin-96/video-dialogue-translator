# VDT Companion — browser extension

A small Chrome extension (Manifest V3) that sends the video you're watching
to **Video Dialogue Translator**, even when the streaming site hides its
video from servers.

## Why it exists

The app finds videos in pasted links by fetching the page server-side. Two
classes of sites defeat that completely:

- **Anti-bot walls** (e.g. animevietsub.bid): the server fetch gets an
  HTTP 403 "checking your browser" page — the real page is never served.
- **JavaScript players** (e.g. motphim.skin): the stream URL (usually an
  `.m3u8` playlist) only exists at runtime, after the player loads it.

But *your* browser already passed the wall and already loaded the stream.
The extension harvests that stream URL from the live page — the network
requests the player made, the `<video>` element, embed iframes, common
player globals — and posts it to the app. Same pattern as Language Reactor
and Trancy.

## Install (unpacked, ~1 minute)

1. Open `chrome://extensions` in Chrome (or Edge/Brave: `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin "VDT Companion" to the toolbar if you like.

## Get your import token

1. Start the app and log in.
2. Go to **Settings → Browser companion**. Your import token is shown there
   (Reveal to see it fully; Regenerate if you ever leak it — the old token
   stops working immediately).
3. Click the extension icon → **Settings** at the bottom of the popup:
   - **App URL**: where your app runs, default `http://localhost:3000`.
   - **Import token**: paste the token from step 2. Click **Save settings**.

## Use it

1. Open the episode/movie page and **press Play** — let the video run a few
   seconds. (The stream URL only exists after the player loads it; if the
   popup says "No stream found yet", this is why. Just play, then reopen.)
2. Click the **VDT Companion** icon. It lists the stream candidates found on
   the page, best first, each with a kind badge (`network-stream`,
   `player-config`, `video-tag`, `iframe`) and a score.
3. Click **Send →** on the right one (usually the top `.m3u8`).
4. The popup shows **"✓ Added — Open confirm page"**. Click it: the video is
   now in your library as a link video, and from the confirm page you can
   fetch the site's subtitles or transcribe it with Whisper and translate —
   exactly like a YouTube or uploaded video.

## Honest limits

- **blob:/MSE with DRM won't import.** If a player streams through
  encrypted media (Widevine/FairPlay) there may be no reusable playlist URL
  at all — the popup will tell you it only saw a blob: stream. Downloading
  the file and using the app's Upload is the fallback.
- **Token-signed streams expire.** Many CDNs sign the `.m3u8` URL with a
  short-lived token. Send the video soon after pressing Play; if playback
  later fails with 403, re-send it from the page to get a fresh URL.
- **Referer-locked streams** are handled: when the app creates the video it
  probes the stream, and if the CDN only serves it with the source page as
  Referer, playback automatically goes through the app's stream proxy.
- The extension only has permission for the app on
  `localhost:3000`/`127.0.0.1:3000` plus the current tab when you click it
  (`activeTab`/`scripting`). It reads nothing until you open the popup, and
  the only data it stores is your App URL + import token
  (`chrome.storage.local`).

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest (permissions: activeTab, scripting, storage) |
| `finder.js` | Injected into the page; computes `window.__vdtResult = { title, pageUrl, candidates }` |
| `popup.html` / `popup.js` | Candidate list + settings + Send button |
| `test-finder.mjs` | Plain-Node test of `finder.js`: `node extension/test-finder.mjs` |
