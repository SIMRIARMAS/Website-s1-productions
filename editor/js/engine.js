// Timeline engine: plays a project in the preview canvas, mixes audio, and records exports.
import { filterer, uniformsFor, isNeutral } from './gl.js';
import { db } from './db.js';
import { portrait, portraitActive, preparePortrait, resetMattes, onAIReady } from './ai.js';

export const ASPECTS = [
  { id: 'orig', label: 'Original' }, { id: '9:16', label: '9:16' }, { id: '16:9', label: '16:9' },
  { id: '1:1', label: '1:1' }, { id: '4:5', label: '4:5' }, { id: '3:4', label: '3:4' }, { id: '4:3', label: '4:3' },
];

export const TRANSITIONS = [
  { id: 'none', name: 'None' }, { id: 'fade', name: 'Fade' }, { id: 'black', name: 'Dip black' },
  { id: 'white', name: 'Flash' }, { id: 'slide', name: 'Slide' }, { id: 'slideup', name: 'Slide up' },
  { id: 'zoom', name: 'Zoom' }, { id: 'wipe', name: 'Wipe' }, { id: 'spin', name: 'Spin' },
];

export const clipDuration = c => c.type === 'image' ? c.duration : Math.max(0.1, (c.out - c.in) / (c.speed || 1));
export function layout(p) {
  let t = 0;
  return p.clips.map(clip => { const dur = clipDuration(clip); const o = { clip, start: t, dur }; t += dur; return o; });
}
export const totalDuration = p => p.clips.reduce((s, c) => s + clipDuration(c), 0);
export const audioDuration = (a, buf) => Math.max(0.1, Math.min(a.dur ?? Infinity, (buf ? buf.duration : Infinity) - (a.offset || 0)));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

const mediaCache = new Map(); // id -> { record, url }
export async function mediaRecord(id) {
  if (mediaCache.has(id)) return mediaCache.get(id);
  const record = await db.get('media', id);
  if (!record) return null;
  const entry = { record, url: URL.createObjectURL(record.blob) };
  mediaCache.set(id, entry);
  return entry;
}
export function forgetMedia(id) {
  const e = mediaCache.get(id);
  if (e) { URL.revokeObjectURL(e.url); mediaCache.delete(id); }
}

export function pickRecorderMime() {
  const cands = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return cands.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

export class Engine {
  constructor(canvas, hiddenHost) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.host = hiddenHost;
    this.t = 0;
    this.playing = false;
    this.videos = new Map();  // clip id -> <video>
    this.images = new Map();  // media id -> <img>
    this.buffers = new Map(); // media id -> AudioBuffer | Promise
    this.sources = [];
    this.textBoxes = [];
    this.tiny = document.createElement('canvas');
    this.tinyCtx = this.tiny.getContext('2d');
    onAIReady(() => { resetMattes(); this.requestRender(); });
    this.mid = document.createElement('canvas');
    this.midCtx = this.mid.getContext('2d');
  }

  get total() { return this.p ? totalDuration(this.p) : 0; }

  async load(p) {
    for (const v of this.videos.values()) { v.pause(); v.remove(); }
    this.videos.clear();
    this.p = p;
    this.t = 0;
    await this.sync();
  }

  // Bring media elements in line with the project after any edit.
  async sync() {
    const p = this.p;
    if (!p) return;
    const ids = new Set(p.clips.map(c => c.id));
    for (const [id, v] of this.videos) if (!ids.has(id)) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); this.videos.delete(id); }
    for (const c of p.clips) {
      if (c.type === 'video' && !this.videos.has(c.id)) {
        const m = await mediaRecord(c.mediaId);
        if (!m) continue;
        const v = document.createElement('video');
        v._url = m.url; v.playsInline = true; v.preload = 'auto';
        v.setAttribute('playsinline', '');
        v.addEventListener('seeked', () => this.requestRender());
        v.addEventListener('loadeddata', () => this.requestRender());
        this.host.appendChild(v);
        this.videos.set(c.id, v);
        this.connectVideo(v);
      }
      if (c.type === 'image') await this.ensureImage(c.mediaId);
      if (c.ai?.mediaId) await this.ensureImage(c.ai.mediaId);
      const v = this.videos.get(c.id);
      if (v) this.applyVolume(v, c);
    }
    if (p.bg?.type === 'image' && p.bg.mediaId) await this.ensureImage(p.bg.mediaId);
    for (const a of p.audio || []) this.loadBuffer(a.mediaId);
    this.syncVideos(this.t);
    this.requestRender();
  }

  async ensureImage(id) {
    if (this.images.has(id)) return this.images.get(id);
    const m = await mediaRecord(id);
    if (!m) return null;
    const img = new Image();
    img.src = m.url;
    this.images.set(id, img);
    img.decode().then(() => this.requestRender()).catch(() => {});
    return img;
  }

  loadBuffer(id) {
    if (this.buffers.has(id)) return Promise.resolve(this.buffers.get(id));
    const pr = (async () => {
      const m = await mediaRecord(id);
      if (!m) return null;
      const data = await m.record.blob.arrayBuffer();
      const ctx = this.ac || new OfflineAudioContext(2, 44100, 44100);
      try { return await ctx.decodeAudioData(data); } catch { return null; }
    })().then(buf => { this.buffers.set(id, buf); return buf; });
    this.buffers.set(id, pr);
    return pr;
  }
  buffer(id) { const b = this.buffers.get(id); return b instanceof AudioBuffer ? b : null; }

  ensureAudio() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.connect(this.ac.destination);
    this.exportDest = this.ac.createMediaStreamDestination();
    for (const v of this.videos.values()) this.connectVideo(v);
    if (this.p) for (const c of this.p.clips) { const v = this.videos.get(c.id); if (v) this.applyVolume(v, c); }
  }
  connectVideo(v) {
    if (!this.ac || v._gain) return;
    try {
      const s = this.ac.createMediaElementSource(v);
      const g = this.ac.createGain();
      s.connect(g); g.connect(this.master);
      v._gain = g;
    } catch { /* already connected */ }
  }
  applyVolume(v, c) {
    const vol = c.muted ? 0 : (c.volume ?? 100) / 100;
    if (v._gain) { v._gain.gain.value = vol; v.volume = 1; } else v.volume = clamp(vol, 0, 1);
  }

  aspect() {
    const p = this.p;
    if (p.aspect && p.aspect !== 'orig') { const [a, b] = p.aspect.split(':').map(Number); return a / b; }
    const c = p.clips[0];
    if (!c) return 9 / 16;
    const m = mediaCache.get(c.mediaId)?.record;
    let w = m?.w || 1080, h = m?.h || 1920;
    if ((c.rotate || 0) % 180) [w, h] = [h, w];
    return w / h;
  }

  // ---- Timeline lookup ----
  activeAt(t) {
    const L = layout(this.p);
    if (!L.length) return { L, i: -1 };
    let i = L.findIndex(o => t < o.start + o.dur);
    if (i < 0) i = L.length - 1;
    const tr = a => {
      const T = L[a].clip.transition;
      if (!T || T.type === 'none' || a + 1 >= L.length) return 0;
      return Math.min(T.dur || 0.6, L[a].dur, L[a + 1].dur);
    };
    const o = L[i];
    let d = tr(i);
    if (d && t > o.start + o.dur - d / 2) return { L, i, pair: [i, i + 1], p: (t - (o.start + o.dur - d / 2)) / d, type: o.clip.transition.type };
    if (i > 0) {
      d = tr(i - 1);
      if (d && t < o.start + d / 2) return { L, i, pair: [i - 1, i], p: (t - (o.start - d / 2)) / d, type: L[i - 1].clip.transition.type };
    }
    return { L, i };
  }

  // Keep each clip's <video> at the right spot; only nearby clips stay loaded to spare the phone's decoders.
  syncVideos(t) {
    if (!this.p) return;
    const { L, i } = this.activeAt(t);
    L.forEach((o, j) => {
      const c = o.clip;
      if (c.type !== 'video') return;
      const v = this.videos.get(c.id);
      if (!v) return;
      const near = j >= i - 1 && j <= i + 2;
      if (near && !v._loaded) { v.src = v._url; v._loaded = true; v.load(); }
      if (!near) {
        if (v._loaded) { v.pause(); v.removeAttribute('src'); v.load(); v._loaded = false; }
        return;
      }
      let target = j === i ? c.in + (t - o.start) * (c.speed || 1) : j < i ? c.out - 0.05 : c.in;
      target = clamp(target, c.in, Math.max(c.in, c.out - 0.02));
      const rate = clamp(c.speed || 1, 0.0625, 16);
      if (v.playbackRate !== rate) v.playbackRate = rate;
      if (j === i && this.playing) {
        if (v.paused) { v.currentTime = target; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - target) > 0.3 && !v.seeking) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.04 && !v.seeking) v.currentTime = target;
      }
    });
  }

  waitReady(t, timeout = 4000) {
    const { L, i } = this.activeAt(t);
    const vs = L.slice(Math.max(0, i - 1), i + 2).map(o => this.videos.get(o.clip.id)).filter(Boolean);
    const ready = () => vs.every(v => v.readyState >= 2 && !v.seeking);
    return new Promise(res => {
      const t0 = performance.now();
      const check = () => (ready() || performance.now() - t0 > timeout) ? res() : setTimeout(check, 50);
      check();
    });
  }

  // ---- Audio (music, voiceovers, extracted sound) ----
  startAudio(t) {
    this.stopAudio();
    if (!this.ac || !this.p) return;
    const now = this.ac.currentTime + 0.03;
    const T = this.total;
    for (const a of this.p.audio || []) {
      const buf = this.buffer(a.mediaId);
      if (!buf) continue;
      const dur = Math.min(audioDuration(a, buf), Math.max(0, T - a.start));
      if (a.start + dur <= t || dur <= 0) continue;
      const into = Math.max(0, t - a.start), rem = dur - into;
      const when = now + Math.max(0, a.start - t);
      const vol = a.muted ? 0 : (a.volume ?? 100) / 100;
      const fi = Math.min(a.fadeIn || 0, dur / 2), fo = Math.min(a.fadeOut || 0, dur / 2);
      const gAt = x => { let g = vol; if (fi && x < fi) g *= x / fi; if (fo && x > dur - fo) g *= Math.max(0, (dur - x) / fo); return g; };
      const src = this.ac.createBufferSource();
      src.buffer = buf;
      const g = this.ac.createGain();
      src.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(gAt(into), when);
      if (fi && into < fi) g.gain.linearRampToValueAtTime(vol, when + (fi - into));
      if (fo) {
        const fs = Math.max(into, dur - fo, fi);
        g.gain.setValueAtTime(gAt(fs), when + (fs - into));
        g.gain.linearRampToValueAtTime(0, when + rem);
      }
      src.start(when, (a.offset || 0) + into, rem);
      this.sources.push(src);
    }
  }
  stopAudio() { for (const s of this.sources) { try { s.stop(); } catch { } } this.sources = []; }

  // ---- Transport ----
  play() {
    if (this.playing || !this.p) return;
    this.ensureAudio();
    if (this.t >= this.total - 0.05) this.t = 0;
    this.playing = true;
    this.clock0 = performance.now(); this.t0 = this.t;
    this.startAudio(this.t);
    this.syncVideos(this.t);
    this.onPlayState?.(true);
    const step = () => {
      if (!this.playing) return;
      const T = this.total;
      this.t = this.t0 + (performance.now() - this.clock0) / 1000;
      if (this.t >= T) {
        this.t = T; this.render(); this.onTime?.(T);
        this.pause();
        this._finish?.();
        return;
      }
      this.syncVideos(this.t);
      this.render();
      this.onTime?.(this.t);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    this.syncVideos(this.t);
    this.onPlayState?.(false);
    this.requestRender();
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t) {
    this.t = clamp(t, 0, this.total);
    if (this.playing) { this.clock0 = performance.now(); this.t0 = this.t; this.startAudio(this.t); }
    this.syncVideos(this.t);
    this.requestRender();
  }
  requestRender() {
    if (this.playing || this._pending) return;
    this._pending = requestAnimationFrame(() => { this._pending = 0; this.render(); });
  }
  render() {
    if (!this.p) return;
    if (this.exportTarget) {
      const { ctx, W, H } = this.exportTarget;
      this.renderFrame(ctx, W, H, this.t, false);
      return;
    }
    this.renderFrame(this.ctx, this.canvas.width, this.canvas.height, this.t, true);
  }

  // ---- Drawing ----
  sourceFor(o) {
    const c = o.clip;
    if (c.type === 'video') {
      const v = this.videos.get(c.id);
      if (v && v.readyState >= 2 && v.videoWidth) return { src: v, sw: v.videoWidth, sh: v.videoHeight };
      return null;
    }
    const img = this.images.get(c.mediaId);
    if (img && img.complete && img.naturalWidth) return { src: img, sw: img.naturalWidth, sh: img.naturalHeight };
    return null;
  }

  renderFrame(ctx, W, H, t, interactive, transparent = false) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (transparent) ctx.clearRect(0, 0, W, H);
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    const a = this.activeAt(t);
    if (a.i >= 0) {
      const baseIdx = a.pair ? (a.p < 0.5 ? a.pair[0] : a.pair[1]) : a.i;
      if (!transparent) this.drawBackground(ctx, W, H, a.L[baseIdx]);
      if (a.pair) this.drawTransition(ctx, W, H, a.L[a.pair[0]], a.L[a.pair[1]], clamp(a.p, 0, 1), a.type, t);
      else this.drawClip(ctx, W, H, a.L[a.i], t);
    } else {
      this.drawBackground(ctx, W, H, null);
    }
    this.drawTexts(ctx, W, H, t, interactive);
  }

  drawBackground(ctx, W, H, o) {
    const bg = this.p.bg || { type: 'blur', level: 3 };
    if (bg.type === 'color') { ctx.fillStyle = bg.color || '#000'; ctx.fillRect(0, 0, W, H); return; }
    if (bg.type === 'gradient') {
      const [c1, c2] = bg.colors || ['#000000', '#1e5eff'];
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, c1); g.addColorStop(1, c2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return;
    }
    let s = null;
    if (bg.type === 'image') {
      const img = this.images.get(bg.mediaId);
      if (img && img.complete && img.naturalWidth) s = { src: img, sw: img.naturalWidth, sh: img.naturalHeight };
    } else if (o) s = this.sourceFor(o);
    if (!s) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    const level = bg.type === 'image' ? (bg.level ?? 0) : (bg.level ?? 3);
    if (!level) { this.drawCover(ctx, s, 0, 0, W, H); return; }
    // Cheap, smooth blur: shrink in two steps and stretch back up.
    const tw = [0, 72, 44, 28, 18, 11][clamp(level, 1, 5)];
    const th = Math.max(4, Math.round(tw * H / W));
    this.mid.width = tw * 4; this.mid.height = th * 4;
    this.drawCover(this.midCtx, s, 0, 0, this.mid.width, this.mid.height);
    this.tiny.width = tw; this.tiny.height = th;
    this.tinyCtx.imageSmoothingQuality = 'high';
    this.tinyCtx.drawImage(this.mid, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.tiny, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, H);
  }

  drawCover(ctx, s, x, y, w, h) {
    const sc = Math.max(w / s.sw, h / s.sh);
    const dw = s.sw * sc, dh = s.sh * sc;
    ctx.drawImage(s.src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  drawClip(ctx, W, H, o, t, fx = {}) {
    const s = this.sourceFor(o);
    if (!s) return;
    const c = o.clip;
    const rot = ((c.rotate || 0) % 360 + 360) % 360;
    const rw = rot % 180 ? s.sh : s.sw, rh = rot % 180 ? s.sw : s.sh;
    let sc = c.fit === 'fill' ? Math.max(W / rw, H / rh) : Math.min(W / rw, H / rh);
    sc *= (c.zoom || 100) / 100;
    const prog = clamp((t - o.start) / o.dur, 0, 1);
    let mx = 0;
    if (c.motion === 'in') sc *= 1 + 0.18 * prog;
    else if (c.motion === 'out') sc *= 1.18 - 0.18 * prog;
    else if (c.motion === 'pan') { sc *= 1.15; mx = (prog - 0.5) * 0.12 * W; }
    sc *= fx.scale || 1;
    const dw = s.sw * sc, dh = s.sh * sc;
    let img = s.src;
    if (!isNeutral(c)) {
      // Process at (at most) the drawn size, capped so phones keep up.
      const pw = Math.min(s.sw, dw * Math.min(1, 1600 / Math.max(dw, dh)));
      const out = filterer().process(s.src, pw, pw * s.sh / s.sw, uniformsFor(c));
      if (out) img = out;
    }
    if (portraitActive(c)) {
      // AI Portrait: segment the person and rebuild the background around them.
      const key = c.type === 'video' ? s.src.currentTime.toFixed(3) : c.mediaId;
      const iw = img === s.src ? s.sw : img.width, ih = img === s.src ? s.sh : img.height;
      const outP = portrait(c, s, img, iw, ih, key, this.images.get(c.ai.mediaId), this.playing);
      if (outP) img = outP;
    }
    ctx.save();
    ctx.globalAlpha = fx.alpha ?? 1;
    ctx.translate(W / 2 + (c.x || 0) * W + mx + (fx.tx || 0), H / 2 + (c.y || 0) * H + (fx.ty || 0));
    ctx.rotate((rot + (fx.rot || 0)) * Math.PI / 180);
    ctx.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  drawTransition(ctx, W, H, A, B, p, type, t) {
    const e = easeOut(p);
    switch (type) {
      case 'fade': this.drawClip(ctx, W, H, A, t); this.drawClip(ctx, W, H, B, t, { alpha: p }); break;
      case 'black': case 'white': {
        if (p < 0.5) this.drawClip(ctx, W, H, A, t); else this.drawClip(ctx, W, H, B, t);
        ctx.fillStyle = type === 'black' ? '#000' : '#fff';
        ctx.globalAlpha = 1 - Math.abs(p - 0.5) * 2; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; break;
      }
      case 'slide': this.drawClip(ctx, W, H, A, t, { tx: -e * W }); this.drawClip(ctx, W, H, B, t, { tx: (1 - e) * W }); break;
      case 'slideup': this.drawClip(ctx, W, H, A, t, { ty: -e * H }); this.drawClip(ctx, W, H, B, t, { ty: (1 - e) * H }); break;
      case 'zoom': this.drawClip(ctx, W, H, A, t, { scale: 1 + p * 0.6, alpha: 1 - p }); this.drawClip(ctx, W, H, B, t, { scale: 1.3 - 0.3 * e, alpha: p }); break;
      case 'spin': if (p < 0.5) this.drawClip(ctx, W, H, A, t, { rot: p * 180, scale: 1 - p }); else this.drawClip(ctx, W, H, B, t, { rot: (p - 1) * 180, scale: p }); break;
      case 'wipe': {
        this.drawClip(ctx, W, H, A, t);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W * e, H); ctx.clip();
        this.drawClip(ctx, W, H, B, t); ctx.restore(); break;
      }
      default: this.drawClip(ctx, W, H, p < 0.5 ? A : B, t);
    }
  }

  drawTexts(ctx, W, H, t, interactive) {
    this.textBoxes = [];
    const unit = Math.min(W, H);
    for (const x of this.p.texts || []) {
      if (t < x.start || t > x.start + x.dur) continue;
      const ti = t - x.start;
      const inA = clamp(ti / 0.35, 0, 1), outA = clamp((x.dur - ti) / 0.35, 0, 1);
      let alpha = (x.opacity ?? 100) / 100, scale = 1, dy = 0;
      let text = x.text || '';
      // Photos have no timeline, and a text being edited while paused should stay fully visible.
      const still = this.p.kind === 'photo' || (interactive && !this.playing);
      switch (still ? 'none' : x.anim) {
        case 'fade': alpha *= Math.min(inA, outA); break;
        case 'pop': scale = inA < 1 ? Math.max(0.01, easeOutBack(inA)) : 1; alpha *= outA; break;
        case 'slide': dy = (1 - easeOut(inA)) * unit * 0.08; alpha *= Math.min(inA, outA); break;
        case 'type': text = text.slice(0, Math.ceil(text.length * clamp(ti / Math.max(0.4, text.length * 0.05), 0, 1))); break;
        case 'bounce': scale = 1 + 0.06 * Math.sin(ti * 7); break;
      }
      const px = Math.max(6, (x.size || 8) / 100 * unit);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x.x * W, x.y * H + dy);
      ctx.rotate((x.rotate || 0) * Math.PI / 180);
      ctx.scale(scale, scale);
      ctx.font = `${x.bold === false ? 500 : 700} ${px}px ${x.sticker ? 'system-ui' : `"${x.font || 'Montserrat'}", system-ui, sans-serif`}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = text.split('\n');
      const lh = px * 1.18;
      const widths = lines.map(l => ctx.measureText(l).width);
      const bw = Math.max(px, ...widths), bh = lh * lines.length;
      const style = x.sticker ? 'none' : (x.style || 'shadow');
      if (style === 'box') {
        ctx.fillStyle = x.boxColor || 'rgba(0,0,0,0.6)';
        const padX = px * 0.4, padY = px * 0.2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-bw / 2 - padX, -bh / 2 - padY, bw + padX * 2, bh + padY * 2, px * 0.25);
        else ctx.rect(-bw / 2 - padX, -bh / 2 - padY, bw + padX * 2, bh + padY * 2);
        ctx.fill();
      }
      lines.forEach((l, k) => {
        const y = (k - (lines.length - 1) / 2) * lh;
        if (style === 'outline') { ctx.lineWidth = px * 0.14; ctx.lineJoin = 'round'; ctx.strokeStyle = x.strokeColor || '#000'; ctx.strokeText(l, 0, y); }
        if (style === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = px * 0.25; ctx.shadowOffsetY = px * 0.06; }
        if (style === 'neon') { ctx.shadowColor = x.color || '#3d8bff'; ctx.shadowBlur = px * 0.7; ctx.fillStyle = x.color || '#3d8bff'; ctx.fillText(l, 0, y); ctx.shadowBlur = px * 0.25; ctx.fillStyle = '#fff'; ctx.fillText(l, 0, y); return; }
        ctx.fillStyle = x.color || '#fff';
        ctx.fillText(l, 0, y);
      });
      ctx.restore();
      const box = { id: x.id, x: x.x - bw / 2 / W, y: x.y - bh / 2 / H, w: bw / W, h: bh / H };
      this.textBoxes.push(box);
      if (interactive && this.selectedText === x.id) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.setLineDash([6, 5]); ctx.lineWidth = Math.max(1.5, unit / 300);
        const pad = px * 0.3;
        ctx.strokeRect(box.x * W - pad, box.y * H - pad + dy, box.w * W + pad * 2, box.h * H + pad * 2);
        ctx.restore();
      }
    }
  }

  outputSize(short) {
    const ar = this.aspect();
    let W, H;
    if (ar >= 1) { H = short; W = Math.round(short * ar); } else { W = short; H = Math.round(short / ar); }
    return { W: W & ~1, H: H & ~1 };
  }

  // Render a still (photo export / snapshot).
  async exportImage(short, type = 'image/jpeg', quality = 0.95, transparent = false) {
    await preparePortrait(this.p);
    resetMattes();
    const { W, H } = this.outputSize(short);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    await this.waitReady(this.t);
    this.renderFrame(c.getContext('2d'), W, H, this.t, false, transparent);
    return new Promise(res => c.toBlob(res, type, quality));
  }

  // Real-time export: the timeline is played into an offscreen canvas and recorded with sound.
  async exportVideo({ short = 1080, fps = 30, bitrate, onProgress }) {
    this.pause();
    this.ensureAudio();
    if (this.ac) await this.ac.resume();
    await Promise.all((this.p.audio || []).map(a => this.loadBuffer(a.mediaId)));
    const { W, H } = this.outputSize(short);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const stream = c.captureStream(fps);
    const tracks = [...stream.getVideoTracks()];
    const at = this.exportDest?.stream.getAudioTracks()[0];
    if (at) tracks.push(at);
    const mime = pickRecorderMime();
    const rec = new MediaRecorder(new MediaStream(tracks), {
      mimeType: mime || undefined,
      videoBitsPerSecond: Math.round(bitrate || Math.min(16e6, W * H * fps * 0.14)),
      audioBitsPerSecond: 192000,
    });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    if (this.master) { this.master.disconnect(); this.master.connect(this.exportDest); }
    this.exportTarget = { ctx, W, H };
    this.cancelled = false;
    this.t = 0;
    this.syncVideos(0);
    await preparePortrait(this.p);
    resetMattes();
    await this.waitReady(0);
    this.renderFrame(ctx, W, H, 0, false);
    const prevOnTime = this.onTime;
    const T = this.total;
    this.onTime = t => onProgress?.(t / T);
    const done = new Promise(res => { this._finish = res; });
    rec.start(1000);
    this.play();
    await done;
    this._finish = null;
    const stopped = new Promise(res => { rec.onstop = res; });
    rec.stop();
    await stopped;
    this.onTime = prevOnTime;
    this.exportTarget = null;
    if (this.master) { this.master.disconnect(); this.master.connect(this.ac.destination); }
    this.seek(0);
    if (this.cancelled) return null;
    const type = (mime || 'video/webm').split(';')[0];
    return new Blob(chunks, { type });
  }
  cancelExport() { this.cancelled = true; this.pause(); this._finish?.(); }
}
