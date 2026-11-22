// popup.js — scans the active tab with finder.js, lists the stream
// candidates it found, and sends the chosen one to the VDT app
// (POST {appUrl}/api/import-stream, Authorization: Bearer <import token>).
'use strict';

const DEFAULT_APP_URL = 'http://localhost:3000';
const $ = (id) => document.getElementById(id);
let appUrl = DEFAULT_APP_URL;
let importToken = '';
let scan = null; // window.__vdtResult from the page

function feedback(html, cls) {
  const el = $('feedback');
  el.className = cls || '';
  el.innerHTML = html;
}

async function loadSettings() {
  const s = await chrome.storage.local.get(['appUrl', 'token']);
  appUrl = (s.appUrl || DEFAULT_APP_URL).replace(/\/+$/, '');
  importToken = s.token || '';
  $('appUrl').value = appUrl;
  $('token').value = importToken;
}

async function runScan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error('No active tab.');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['finder.js'] });
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.__vdtResult || null,
  });
  return res && res.result;
}

function render() {
  const list = $('list');
  list.innerHTML = '';
  const info = $('pageInfo');
  if (!scan) { info.textContent = 'Could not scan this page.'; return; }
  info.textContent = (scan.title ? scan.title + ' — ' : '') + (scan.pageUrl || '');

  if (!scan.candidates || scan.candidates.length === 0) {
    const div = document.createElement('div');
    div.className = 'hint';
    let msg = 'No stream found yet. <b>Press Play on the video first</b>, let it run for a few seconds, then reopen this popup — the stream URL only exists after the player loads it.';
    if (scan.blobCount > 0) {
      msg += '<br><br>This page\'s player uses a blob/MSE stream (' + scan.blobCount + ' video element' + (scan.blobCount > 1 ? 's' : '') + ') and no playlist URL was seen in the network log — it may use DRM or per-segment signing that cannot be imported.';
    }
    div.innerHTML = msg;
    list.appendChild(div);
    return;
  }

  for (const c of scan.candidates) {
    const row = document.createElement('div');
    row.className = 'cand';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = c.kind;
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = c.src;
    url.title = c.src;
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = c.score;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Send →';
    btn.addEventListener('click', () => send(c, btn));
    row.append(badge, url, score, btn);
    list.appendChild(row);
  }
}

async function send(candidate, btn) {
  feedback('', '');
  if (!importToken) {
    feedback('No import token set. Open “Settings” below and paste the token from the app (Settings → Browser companion).', 'err');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const r = await fetch(appUrl + '/api/import-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + importToken },
      body: JSON.stringify({ src: candidate.src, pageUrl: scan.pageUrl || '', title: scan.title || '' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    const link = appUrl + '/confirm/' + j.id;
    feedback('✓ Added — <a href="' + link + '" target="_blank" rel="noreferrer">Open confirm page</a> to transcribe &amp; translate it.', 'ok');
    btn.textContent = '✓ Sent';
  } catch (e) {
    feedback('Send failed: ' + e.message, 'err');
    btn.disabled = false;
    btn.textContent = 'Send →';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  $('saveSettings').addEventListener('click', async () => {
    appUrl = ($('appUrl').value.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');
    importToken = $('token').value.trim();
    await chrome.storage.local.set({ appUrl, token: importToken });
    $('settingsMsg').textContent = 'Saved ✓';
    setTimeout(() => { $('settingsMsg').textContent = ''; }, 2000);
  });
  try {
    await loadSettings();
    scan = await runScan();
    render();
  } catch (e) {
    $('pageInfo').textContent = 'Could not scan this page.';
    feedback('Scan failed: ' + e.message + ' (extensions cannot run on chrome:// or Web Store pages — open the video page first.)', 'err');
  }
});
