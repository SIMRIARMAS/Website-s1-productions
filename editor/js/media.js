// Media library: importing from the phone, reading duration/size/thumbnails, folders, saving and sharing.
import { db, uid } from './db.js';
import { toast } from './ui.js';

export const SYSTEM_FOLDERS = {
  exports: 'Exports', shared: 'Shared to app', voice: 'Voiceovers', frames: 'Frames',
};

export function kindOf(file) {
  const t = file.type || '';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  const ext = (file.name || '').split('.').pop().toLowerCase();
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v', '3gp'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp'].includes(ext)) return 'image';
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'].includes(ext)) return 'audio';
  return null;
}

const once = (el, ev, ms = 8000) => new Promise(res => {
  const t = setTimeout(() => res(false), ms);
  el.addEventListener(ev, () => { clearTimeout(t); res(true); }, { once: true });
});

function thumbFrom(src, sw, sh, size = 180) {
  const c = document.createElement('canvas');
  const s = size / Math.max(sw, sh);
  c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

export async function probe(blob, kind) {
  const url = URL.createObjectURL(blob);
  try {
    if (kind === 'image') {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight, thumb: thumbFrom(img, img.naturalWidth, img.naturalHeight) };
    }
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.muted = true; el.preload = 'metadata'; el.playsInline = true;
    el.src = url;
    await once(el, 'loadedmetadata');
    let duration = el.duration;
    if (!isFinite(duration)) {
      // Recorded WebM files report Infinity until you seek to the end.
      el.currentTime = 1e7;
      await once(el, 'durationchange', 4000);
      duration = isFinite(el.duration) ? el.duration : 0;
      el.currentTime = 0;
    }
    if (kind === 'audio') return { duration };
    const w = el.videoWidth, h = el.videoHeight;
    el.currentTime = Math.min(0.6, duration * 0.15);
    await once(el, 'seeked', 5000);
    let thumb = null;
    try { if (w) thumb = thumbFrom(el, w, h); } catch { }
    return { duration, w, h, thumb };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function ensureFolder(id) {
  if (!SYSTEM_FOLDERS[id]) return;
  if (!(await db.get('folders', id))) await db.put('folders', { id, name: SYSTEM_FOLDERS[id], created: Date.now(), system: true });
}

export async function importBlob(blob, name, folder = null) {
  const kind = kindOf({ type: blob.type, name });
  if (!kind) return null;
  if (folder) await ensureFolder(folder);
  const meta = await probe(blob, kind);
  const rec = {
    id: uid(), name: name || `${kind}-${Date.now()}`, kind, mime: blob.type, size: blob.size, blob,
    folder, created: Date.now(), duration: meta.duration || (kind === 'image' ? 0 : 0), w: meta.w, h: meta.h, thumb: meta.thumb,
  };
  await db.put('media', rec);
  return rec;
}

export async function importFiles(files, folder = null) {
  const out = [];
  const list = [...files];
  let skipped = 0;
  for (let i = 0; i < list.length; i++) {
    if (list.length > 2) toast(`Importing ${i + 1} of ${list.length}…`);
    const r = await importBlob(list[i], list[i].name, folder);
    if (r) out.push(r); else skipped++;
  }
  if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped (not a video, photo or audio file)`);
  return out;
}

// Files shared into the app from the phone's share sheet arrive without thumbnails; fill them in.
export async function finishPendingImports() {
  const all = await db.all('media');
  let n = 0;
  for (const m of all) if (m.needsMeta && !m.pendingShare) {
    const meta = await probe(m.blob, m.kind);
    Object.assign(m, meta, { needsMeta: false });
    await db.put('media', m);
    n++;
  }
  return n;
}

export function pickFiles(accept, multiple = true) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.style.display = 'none';
    document.body.append(inp);
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { res([]); inp.remove(); });
    inp.click();
  });
}

export const extFor = mime => ({
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'image/jpeg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
}[(mime || '').split(';')[0]] || 'bin');

export function fileNameFor(rec) {
  const ext = extFor(rec.mime);
  return /\.[a-z0-9]{2,4}$/i.test(rec.name) ? rec.name : `${rec.name}.${ext}`;
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export async function saveToDevice(blob, name) {
  if (window.showSaveFilePicker && !isPhone()) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name });
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      toast('Saved');
      return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast(isPhone() ? 'Saved to your Downloads' : 'Downloading…');
}

export function canShareFiles() {
  try { return !!navigator.canShare && navigator.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] }); } catch { return false; }
}

// Opens the phone's share sheet (Quick Share, Messages, Instagram, etc.).
export async function shareFiles(items) {
  const files = items.map(r => new File([r.blob], fileNameFor(r), { type: (r.mime || r.blob.type || '').split(';')[0] }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files }); }
    catch (e) { if (e.name !== 'AbortError') toast('Couldn’t share: ' + e.message); }
  } else {
    toast('This browser can’t share files. Use Save instead, or install the app on your phone.');
  }
}

export async function storageInfo() {
  try {
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { used: e.usage || 0, quota: e.quota || 0, persisted };
  } catch { return null; }
}
