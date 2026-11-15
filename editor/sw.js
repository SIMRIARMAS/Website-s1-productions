// S1 Studio service worker: offline app shell, receiving files from the phone's share sheet,
// and a safety check on every outside AI file before the app is allowed to run it.
importScripts('./trusted-files.js'); // self.TRUSTED_FILES: url -> "sha256-<base64>"

const CACHE = 's1studio-v5';
// The AI cache name changes whenever the trusted list changes, so old copies are thrown away.
const TRUSTED_ID = (() => { let h = 0; for (const [k, v] of Object.entries(self.TRUSTED_FILES)) for (const c of k + v) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); })();
const RUNTIME = 's1studio-ai-' + TRUSTED_ID;
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './trusted-files.js',
  './js/app.js', './js/engine.js', './js/gl.js', './js/db.js', './js/ui.js', './js/media.js', './js/icons.js', './js/ai.js', './js/upscale-worker.js', './js/search.js', './js/clip-worker.js', './js/cdn-guard.js'];

// Shared-file limits, so nothing can flood the Library.
const SHARE_MAX_FILES = 50;
const SHARE_MAX_BYTES = 4 * 1024 ** 3; // 4 GB in total

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // Deletes every cache that isn't current, including AI files saved by older versions (never checked).
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('s1studio', 1);
    r.onupgradeneeded = () => { for (const s of ['media', 'projects', 'folders', 'settings']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const kindOf = f => /^video\//.test(f.type) ? 'video' : /^image\//.test(f.type) ? 'image' : /^audio\//.test(f.type) ? 'audio' : null;

// Any web page could send a form here, not just the phone's share sheet. So shared files are
// held as "waiting" until you tap Keep in the app; Discard deletes them.
async function receiveShare(request) {
  const form = await request.formData();
  let total = 0;
  const files = form.getAll('media')
    .filter(f => f && typeof f === 'object' && f.size && kindOf(f))
    .slice(0, SHARE_MAX_FILES)
    .filter(f => (total += f.size) <= SHARE_MAX_BYTES);
  if (!files.length) return Response.redirect('./#library', 303);
  const db = await openDB();
  await new Promise((res, rej) => {
    const t = db.transaction(['media', 'folders'], 'readwrite');
    t.objectStore('folders').put({ id: 'shared', name: 'Shared to app', created: Date.now(), system: true });
    const media = t.objectStore('media');
    files.forEach((f, i) => media.put({
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4) + i,
      name: String(f.name || 'shared').slice(0, 200), kind: kindOf(f), mime: f.type, size: f.size, blob: f, folder: 'shared',
      created: Date.now() + i, needsMeta: true, pendingShare: true,
    }));
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return Response.redirect(`./?shared=${files.length}#library`, 303);
}

// ---- outside AI code: only files on the trusted list, and only if their bytes match
async function sha256(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = ''; for (const b of d) s += String.fromCharCode(b);
  return 'sha256-' + btoa(s);
}
const blocked = why => { console.error('[S1 Studio] Blocked outside file: ' + why); return new Response('Blocked by S1 Studio: ' + why, { status: 403, statusText: 'Blocked' }); };

async function trustedFetch(url) {
  const key = url.origin + url.pathname;
  const expected = self.TRUSTED_FILES[key];
  if (!expected) return blocked(`${key} is not on the trusted list`);
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(key);
  if (hit) return hit; // only verified copies are ever saved
  // Always fetched with CORS so the bytes can be read and checked (a plain <script> fetch hides them).
  const r = await fetch(key, { mode: 'cors', credentials: 'omit', redirect: 'follow', cache: 'no-store' });
  if (!r.ok) return r;
  const buf = await r.arrayBuffer();
  const got = await sha256(buf);
  if (got !== expected) return blocked(`${key} does not match its fingerprint (expected ${expected}, got ${got})`);
  const type = r.headers.get('content-type') || (key.endsWith('.wasm') ? 'application/wasm' : key.endsWith('.json') ? 'application/json' : 'text/javascript');
  const ok = new Response(buf, { status: 200, headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
  await cache.put(key, ok.clone());
  return ok;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request).catch(() => Response.redirect('./#library', 303)));
    return;
  }
  if (e.request.method !== 'GET') return;
  // Network first for the app's own files (so updates land), falling back to cache offline.
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(trustedFetch(url).catch(err => blocked(String(err?.message || err))));
  } else if (url.href.startsWith('https://storage.googleapis.com/mediapipe-models/')) {
    // AI Portrait model data (not code). Saved after the first download so it works offline;
    // the saved copy is cleared whenever the trusted list changes.
    e.respondWith(caches.open(RUNTIME).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }))));
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })));
  }
});
