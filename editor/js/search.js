// Search: smart matching for tools/filters/files, plus on-device AI for media content
// (MobileCLIP) and people (face-api face recognition, grouped into people you can name).
import { db } from './db.js';

// ---------------------------------------------------------------- word matching
export const TOOL_WORDS = {
  ai: 'ai portrait background blur background remove background green screen cut out cutout bokeh upscale restore 4x sharpen ai spotlight replace background person',
  canvas: 'canvas ratio aspect size 9:16 16:9 1:1 4:5 square vertical horizontal portrait landscape reels format',
  bg: 'background backdrop blur border color background gradient behind',
  trim: 'trim shorten cut length cut start cut end clip length',
  split: 'split cut scissors divide break in two',
  speed: 'speed slow motion slowmo slow mo fast timelapse fast forward duration quick',
  enhance: 'enhance auto fix improve better brighten magic auto color',
  filter: 'filter preset look lut color grade vibe style',
  adjust: 'adjust brightness contrast saturation warmth exposure sharpen sharpness vignette grain highlights shadows color tint fade',
  text: 'text title caption words subtitle font type label write',
  sticker: 'sticker emoji icon',
  music: 'music song audio sound track beat mp3 add music',
  voice: 'voiceover voice record mic microphone narrate narration talk',
  volume: 'volume mute loud louder quiet sound level silence',
  crop: 'position zoom rotate flip mirror crop move scale turn',
  motion: 'motion ken burns pan zoom in zoom out movement animate',
  arrange: 'arrange reorder move clip order earlier later',
  dup: 'duplicate copy clone repeat',
  snap: 'save frame screenshot snapshot still photo from video grab frame',
  del: 'delete remove clip trash',
};
export const SETTINGS_WORDS = 'settings theme themes background wallpaper color colors accent font fonts look customize dark style app toolbar tools layout';

const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s:]/g, ' ').replace(/\s+/g, ' ').trim();
function subseq(q, s) { let i = 0; for (const ch of s) if (ch === q[i]) i++; return i === q.length; }
// 0 = no match, higher = better.
export function score(query, label, words = '') {
  const q = norm(query), l = norm(label), w = norm(words);
  if (!q) return 0;
  if (l === q) return 100;
  if (l.startsWith(q)) return 80;
  if (l.split(' ').some(t => t.startsWith(q))) return 70;
  if (w && (` ${w} `).includes(` ${q} `)) return 60;
  if (w && w.includes(q)) return 45;
  const qt = q.split(' ');
  if (qt.length > 1 && qt.every(t => l.includes(t) || w.includes(t))) return 40;
  if (q.length >= 3 && subseq(q.replace(/ /g, ''), l.replace(/ /g, ''))) return 20;
  return 0;
}

// ---------------------------------------------------------------- MobileCLIP worker
let worker = null, readyP = null, nextId = 1;
const pending = new Map();
let progressFn = null;
export function clipWorker(onProgress) {
  if (onProgress) progressFn = onProgress;
  if (readyP) return readyP;
  worker = new Worker(new URL('./clip-worker.js', import.meta.url), { type: 'module' });
  readyP = new Promise((res, rej) => {
    worker.onmessage = e => {
      const d = e.data;
      if (d.type === 'progress') progressFn?.(d);
      else if (d.type === 'ready') res();
      else if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.type === 'error' ? p.rej(new Error(d.message)) : p.res(d.vec); }
      else if (d.type === 'error') rej(new Error(d.message));
    };
    worker.onerror = e => rej(new Error(e.message || 'AI search failed to start'));
  });
  readyP.catch(() => { worker?.terminate(); worker = null; readyP = null; });
  worker.postMessage({ type: 'load' });
  return readyP;
}
const ask = msg => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); worker.postMessage({ ...msg, id }, msg.data ? [msg.data] : []); });
export async function embedImage(canvas) {
  await clipWorker();
  const x = canvas.getContext('2d');
  const d = x.getImageData(0, 0, canvas.width, canvas.height);
  return ask({ type: 'image', w: d.width, h: d.height, data: d.data.buffer });
}
const textCache = new Map();
export async function embedText(text) {
  if (textCache.has(text)) return textCache.get(text);
  await clipWorker();
  const v = await ask({ type: 'text', text: `a photo of ${text}` });
  textCache.set(text, v);
  return v;
}
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ---------------------------------------------------------------- faces
const FA = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15';
let faP;
function faceapi() {
  return faP ||= (async () => {
    const fa = await import(`${FA}/dist/face-api.esm.js`);
    try { await fa.tf.setBackend('webgl'); } catch { }
    await fa.tf.ready();
    await Promise.all([
      fa.nets.tinyFaceDetector.loadFromUri(`${FA}/model`),
      fa.nets.faceLandmark68Net.loadFromUri(`${FA}/model`),
      fa.nets.faceRecognitionNet.loadFromUri(`${FA}/model`),
    ]);
    return fa;
  })().catch(e => { faP = null; throw e; });
}
export async function detectFaces(canvas) {
  const fa = await faceapi();
  const res = await fa.detectAllFaces(canvas, new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptors();
  return res.filter(r => r.detection.box.width >= 28).map(r => {
    const b = r.detection.box;
    // Square crop with some margin for the face thumbnail.
    const s = Math.max(b.width, b.height) * 1.5, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const c = document.createElement('canvas'); c.width = c.height = 96;
    c.getContext('2d').drawImage(canvas, cx - s / 2, cy - s / 2, s, s, 0, 0, 96, 96);
    return { desc: Array.from(r.descriptor), thumb: c.toDataURL('image/jpeg', 0.8), size: b.width };
  });
}
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };

// People are stored as one settings record: [{ id, name, centroid, n, thumb }]
export async function loadPeople() { return (await db.get('settings', 'people'))?.list || []; }
export async function savePeople(list) { await db.put('settings', { id: 'people', list }); }
export function assignPerson(people, face) {
  let best = null, bd = 0.58;
  for (const p of people) { const d = dist(p.centroid, face.desc); if (d < bd) { bd = d; best = p; } }
  if (!best) {
    best = { id: 'p' + Math.random().toString(36).slice(2, 9), name: '', centroid: face.desc.slice(), n: 0, thumb: face.thumb, size: 0 };
    people.push(best);
  }
  best.centroid = best.centroid.map((v, i) => (v * best.n + face.desc[i]) / (best.n + 1));
  best.n++;
  if (face.size > (best.size || 0)) { best.thumb = face.thumb; best.size = face.size; }
  return best.id;
}

// ---------------------------------------------------------------- frames for indexing
const once = (el, ev, ms) => new Promise(r => { const t = setTimeout(() => r(false), ms); el.addEventListener(ev, () => { clearTimeout(t); r(true); }, { once: true }); });
export async function frameCanvas(m, size = 512) {
  const c = document.createElement('canvas');
  const draw = (src, w, h) => {
    const k = Math.min(1, size / Math.max(w, h));
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, c.width, c.height);
    return c;
  };
  if (m.kind === 'image') {
    try { const b = await createImageBitmap(m.blob); const r = draw(b, b.width, b.height); b.close?.(); return r; } catch { return null; }
  }
  if (m.kind === 'video') {
    const url = URL.createObjectURL(m.blob);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    try {
      if (!(await once(v, 'loadeddata', 8000))) return null;
      v.currentTime = Math.min(1.5, (m.duration || v.duration || 2) * 0.35);
      await once(v, 'seeked', 5000);
      return v.videoWidth ? draw(v, v.videoWidth, v.videoHeight) : null;
    } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
  }
  return null;
}
export const AI_INDEX_VERSION = 1;
