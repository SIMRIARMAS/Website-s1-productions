// S1 Editor service worker: offline app shell + receiving files from the phone's share sheet.
const CACHE = 's1editor-v6';
const RUNTIME = 's1editor-ai';
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png',
  './js/app.js', './js/engine.js', './js/gl.js', './js/db.js', './js/ui.js', './js/media.js', './js/icons.js', './js/ai.js', './js/upscale-worker.js', './js/search.js', './js/clip-worker.js', './js/claude.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
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

async function receiveShare(request) {
  const form = await request.formData();
  const files = form.getAll('media').filter(f => f && f.size && kindOf(f));
  // A shared link (e.g. Instagram → Share → S1 Editor) becomes a reference.
  if (!files.length) {
    const text = `${form.get('url') || ''} ${form.get('text') || ''}`;
    const link = (text.match(/https?:\/\/[^\s<>"']+/) || [])[0];
    if (link) {
      const db = await openDB();
      await new Promise((res, rej) => {
        const t = db.transaction('settings', 'readwrite');
        const st = t.objectStore('settings');
        const g = st.get('references');
        g.onsuccess = () => {
          const list = g.result?.list || [];
          const host = /instagram/.test(link) ? 'Instagram' : /youtu/.test(link) ? 'YouTube' : /tiktok/.test(link) ? 'TikTok' : 'Link';
          list.push({ id: 'r' + Date.now().toString(36), name: `${host} reference`, link, created: Date.now() });
          st.put({ id: 'references', list });
        };
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
      return Response.redirect('./?reflink=1#refs', 303);
    }
  }
  const db = await openDB();
  await new Promise((res, rej) => {
    const t = db.transaction(['media', 'folders'], 'readwrite');
    const folders = t.objectStore('folders');
    folders.put({ id: 'shared', name: 'Shared to app', created: Date.now(), system: true });
    const media = t.objectStore('media');
    files.forEach((f, i) => media.put({
      id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4) + i,
      name: f.name || 'shared', kind: kindOf(f), mime: f.type, size: f.size, blob: f, folder: 'shared',
      created: Date.now() + i, needsMeta: true,
    }));
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return Response.redirect(`./?shared=${files.length}#library`, 303);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
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
  } else if (url.hostname === 'cdn.jsdelivr.net' || url.href.startsWith('https://storage.googleapis.com/mediapipe-models/')) {
    // AI libraries and models: cache after the first download so AI works offline.
    e.respondWith(caches.open(RUNTIME).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }))));
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })));
  }
});
