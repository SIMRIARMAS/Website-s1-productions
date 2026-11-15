// On-device AI. Nothing is uploaded: models download once, then run on the phone.
//  • AI Portrait — MediaPipe selfie segmentation finds the person in every frame so the
//    background can be blurred, dimmed, replaced or cut out (live, works on video).
//  • AI Upscale & Restore — Swin2SR super-resolution (in a worker) rebuilds detail at 4×
//    and cleans noise / JPEG blockiness on photos.
import { cdnGuard } from './cdn-guard.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const SEG = {
  // Small and fast: used for video so it keeps up in real time.
  fast: { url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite', size: 256, label: '250 KB' },
  // Higher quality edges (hair, hands): used for photos.
  hq: { url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite', size: 512, label: '16 MB' },
};

export const PORTRAIT_MODES = [
  { id: 'none', name: 'Off' }, { id: 'blur', name: 'Blur bg' }, { id: 'spotlight', name: 'Spotlight' },
  { id: 'color', name: 'Color bg' }, { id: 'image', name: 'Image bg' }, { id: 'cutout', name: 'Cut out' },
];
export const portraitActive = c => !!c.ai && ((c.ai.mode && c.ai.mode !== 'none') || !!c.ai.light);
export const segKind = c => c.type === 'image' ? 'hq' : 'fast';

const listeners = new Set();
export const onAIReady = fn => listeners.add(fn);
const ready = {}, loading = {}, failed = {};
let visionP;

function vision() {
  return visionP ||= (async () => {
    await cdnGuard();
    const m = await import(`${MP}/vision_bundle.mjs`);
    const files = await m.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    return { m, files };
  })().catch(e => { visionP = null; throw e; });
}

export function loadSegmenter(kind) {
  if (ready[kind]) return Promise.resolve(ready[kind]);
  return loading[kind] ||= (async () => {
    const { m, files } = await vision();
    const opts = delegate => ({
      baseOptions: { modelAssetPath: SEG[kind].url, delegate },
      runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
    });
    let seg;
    try { seg = await m.ImageSegmenter.createFromOptions(files, opts('GPU')); }
    catch { seg = await m.ImageSegmenter.createFromOptions(files, opts('CPU')); }
    ready[kind] = seg;
    listeners.forEach(fn => fn(kind));
    return seg;
  })().catch(e => { failed[kind] = e; loading[kind] = null; throw e; });
}
export const segmenterReady = kind => !!ready[kind];
export const segmenterInfo = kind => SEG[kind];

// ---- mattes (person masks), cached per clip so a paused frame isn't re-segmented
const mattes = new Map();
let lastTs = 0;
export function resetMattes() { mattes.clear(); }

function matteFor(clip, src, sw, sh, key, temporal) {
  const kind = segKind(clip);
  const seg = ready[kind];
  if (!seg) { if (!failed[kind]) loadSegmenter(kind).catch(() => {}); return null; }
  let m = mattes.get(clip.id);
  if (m && m.key === key) return m.canvas;
  if (!m) {
    m = { canvas: document.createElement('canvas'), inC: document.createElement('canvas'), prev: null };
    m.inX = m.inC.getContext('2d', { willReadFrequently: true });
    m.outX = m.canvas.getContext('2d');
    mattes.set(clip.id, m);
  }
  const sc = Math.min(1, SEG[kind].size / Math.max(sw, sh));
  const w = Math.max(16, Math.round(sw * sc)), h = Math.max(16, Math.round(sh * sc));
  if (m.inC.width !== w || m.inC.height !== h) { m.inC.width = w; m.inC.height = h; m.prev = null; }
  m.inX.drawImage(src, 0, 0, w, h);
  lastTs = Math.max(lastTs + 1, performance.now());
  let res;
  try { res = seg.segmentForVideo(m.inC, lastTs); } catch { return m.key ? m.canvas : null; }
  const masks = res.confidenceMasks || [];
  if (!masks.length) return null;
  const mw = masks[0].width, mh = masks[0].height;
  // selfie_segmenter: one mask = person confidence. multiclass: mask 0 = background.
  const multi = masks.length > 1;
  const raw = masks[0].getAsFloat32Array();
  masks.forEach(x => x.close?.());
  const n = mw * mh;
  if (m.canvas.width !== mw || m.canvas.height !== mh) { m.canvas.width = mw; m.canvas.height = mh; m.prev = null; }
  const prev = temporal && m.prev && m.prev.length === n ? m.prev : null;
  const cur = new Float32Array(n);
  const img = m.outX.createImageData(mw, mh);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    let p = multi ? 1 - raw[i] : raw[i];
    if (prev) p = p * 0.7 + prev[i] * 0.3; // steadier edges between video frames
    cur[i] = p;
    const a = Math.min(1, Math.max(0, (p - 0.3) / 0.4)); // soft but clean edge
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
    d[i * 4 + 3] = a * a * (3 - 2 * a) * 255;
  }
  m.prev = cur;
  m.outX.putImageData(img, 0, 0);
  m.key = key;
  return m.canvas;
}

const mk = () => { const c = document.createElement('canvas'); return [c, c.getContext('2d')]; };
const [fgC, fg] = mk(), [outC, out] = mk(), [midC, mid] = mk(), [tinyC, tiny] = mk();
const hasFilter = 'filter' in out;

// Returns a canvas with the portrait effect applied (transparent where the background was cut),
// or null while the model is still loading.
export function portrait(clip, s, img, iw, ih, key, bgImage, playing) {
  const ai = clip.ai;
  const matte = matteFor(clip, s.src, s.sw, s.sh, key, playing && clip.type === 'video');
  if (!matte) return null;
  const k = Math.min(1, 1440 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
  for (const c of [fgC, outC]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }

  // Subject: the frame, optionally relit, masked to the person.
  fg.globalCompositeOperation = 'source-over';
  fg.clearRect(0, 0, w, h);
  const light = (ai.light || 0) / 100;
  if (light && hasFilter) fg.filter = `brightness(${1 + light * 0.5}) contrast(${1 + light * 0.12}) saturate(${1 + light * 0.2})`;
  fg.drawImage(img, 0, 0, w, h);
  fg.filter = 'none';
  fg.globalCompositeOperation = 'destination-in';
  fg.imageSmoothingEnabled = true; fg.imageSmoothingQuality = 'high';
  fg.drawImage(matte, 0, 0, w, h);
  fg.globalCompositeOperation = 'source-over';

  // Background.
  out.clearRect(0, 0, w, h);
  const amt = (ai.amount ?? 60) / 100;
  switch (ai.mode) {
    case 'blur': {
      const f = 3 + amt * 22;
      const tw = Math.max(4, Math.round(w / f)), th = Math.max(4, Math.round(h / f));
      midC.width = Math.max(tw, Math.round(w / 3)); midC.height = Math.max(th, Math.round(h / 3));
      mid.drawImage(img, 0, 0, midC.width, midC.height);
      tinyC.width = tw; tinyC.height = th;
      tiny.imageSmoothingQuality = 'high';
      tiny.drawImage(midC, 0, 0, tw, th);
      out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'high';
      out.drawImage(tinyC, 0, 0, w, h);
      break;
    }
    case 'spotlight':
      if (hasFilter) { out.filter = `grayscale(1) brightness(${0.75 - amt * 0.5})`; out.drawImage(img, 0, 0, w, h); out.filter = 'none'; }
      else { out.drawImage(img, 0, 0, w, h); out.fillStyle = `rgba(0,0,0,${0.25 + amt * 0.5})`; out.fillRect(0, 0, w, h); }
      break;
    case 'color':
      out.fillStyle = ai.color || '#0d0b1c'; out.fillRect(0, 0, w, h); break;
    case 'image':
      if (bgImage?.naturalWidth) {
        const sc = Math.max(w / bgImage.naturalWidth, h / bgImage.naturalHeight);
        const dw = bgImage.naturalWidth * sc, dh = bgImage.naturalHeight * sc;
        out.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else { out.fillStyle = '#000'; out.fillRect(0, 0, w, h); }
      break;
    case 'cutout': break; // transparent: the project's Background shows through
    default: out.drawImage(img, 0, 0, w, h); // relight only
  }
  out.drawImage(fgC, 0, 0);
  return outC;
}

export async function preparePortrait(project) {
  const kinds = new Set(project.clips.filter(portraitActive).map(segKind));
  await Promise.all([...kinds].map(k => loadSegmenter(k).catch(() => {})));
}

// ---------------------------------------------------------------- upscaling
let worker = null, workerReady = null, nextId = 1;
const pending = new Map();
let statusFn = null;

function getWorker() {
  if (workerReady) return workerReady;
  workerReady = cdnGuard().then(() => new Promise((res, rej) => {
    worker = new Worker(new URL('./upscale-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const d = e.data;
      if (d.type === 'progress') statusFn?.(d);
      else if (d.type === 'ready') res(d);
      else if (d.type === 'error' && !d.id) rej(new Error(d.message));
      else if (d.id && pending.has(d.id)) {
        const p = pending.get(d.id); pending.delete(d.id);
        d.type === 'error' ? p.rej(new Error(d.message)) : p.res(d);
      }
    };
    worker.onerror = e => rej(new Error(e.message || 'AI worker failed to start'));
    worker.postMessage({ type: 'load' });
  }));
  workerReady.catch(() => { worker?.terminate(); worker = null; workerReady = null; });
  return workerReady;
}
export function cancelUpscale() {
  if (!worker) return;
  worker.terminate(); worker = null; workerReady = null;
  for (const p of pending.values()) p.rej(new Error('cancelled'));
  pending.clear();
}

const round8 = v => Math.max(8, Math.round(v / 8) * 8);

// Upscale an image 4× with detail restoration. maxIn caps the input size (output = 4× that).
export async function upscale(blob, { maxIn = 512, onStatus } = {}) {
  statusFn = onStatus;
  onStatus?.({ phase: 'load' });
  const info = await getWorker();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxIn / Math.max(bmp.width, bmp.height));
  const W = round8(bmp.width * k), H = round8(bmp.height * k);
  const [srcC, src] = mk();
  srcC.width = W; srcC.height = H;
  src.imageSmoothingQuality = 'high';
  src.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();

  const T = 128, OV = 16;
  const tw = Math.min(T, W), th = Math.min(T, H);
  const steps = (size, t) => {
    const out = [];
    if (t >= size) return [0];
    for (let x = 0; ; x += t - 2 * OV) { const xx = Math.min(x, size - t); out.push(xx); if (xx + t >= size) break; }
    return out;
  };
  const xs = steps(W, tw), ys = steps(H, th);
  const total = xs.length * ys.length;
  const [dstC, dst] = mk();
  dstC.width = W * 4; dstC.height = H * 4;
  const [tileC, tile] = mk();
  let done = 0;
  for (const y of ys) for (const x of xs) {
    const data = src.getImageData(x, y, tw, th);
    const id = nextId++;
    const res = await new Promise((resolve, reject) => {
      pending.set(id, { res: resolve, rej: reject });
      worker.postMessage({ type: 'tile', id, w: tw, h: th, data: data.data.buffer }, [data.data.buffer]);
    });
    tileC.width = res.w; tileC.height = res.h;
    tile.putImageData(new ImageData(new Uint8ClampedArray(res.data), res.w, res.h), 0, 0);
    // Keep each tile's interior; overlapping borders are where the model sees least context.
    const s = res.w / tw;
    const x0 = x === 0 ? 0 : OV, y0 = y === 0 ? 0 : OV;
    const x1 = x + tw >= W ? tw : tw - OV, y1 = y + th >= H ? th : th - OV;
    dst.drawImage(tileC, x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s, (x + x0) * 4, (y + y0) * 4, (x1 - x0) * 4, (y1 - y0) * 4);
    done++;
    onStatus?.({ phase: 'run', done, total, device: info.device });
  }
  return new Promise(res => dstC.toBlob(res, 'image/jpeg', 0.94));
}
