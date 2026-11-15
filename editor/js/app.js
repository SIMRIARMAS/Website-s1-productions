import { db, uid } from './db.js';
import { Engine, ASPECTS, TRANSITIONS, layout, totalDuration, clipDuration, audioDuration, mediaRecord, forgetMedia, pickRecorderMime } from './engine.js';
import { PRESETS, ADJUST_KEYS, filterer, uniformsFor, analyzeFrame } from './gl.js';
import { ic } from './icons.js';
import { $, $$, h, fmtTime, fmtShort, fmtBytes, toast, openSheet, confirmSheet, promptSheet, slider, chips, swatches, section, btn, debounce } from './ui.js';
import { importFiles, importBlob, pickFiles, saveToDevice, shareFiles, fileNameFor, storageInfo, finishPendingImports, canShareFiles } from './media.js';

// ---------------------------------------------------------------- state
const S = {
  prefs: null, project: null, sel: null, pps: 64,
  undo: [], redo: [], panelSnap: null, progScroll: -1,
  lib: { folder: 'all', kind: 'all', selecting: false, selected: new Set() },
};
let media = new Map(); // id -> record (metadata + blob)

const FONTS = ['Montserrat', 'Bebas Neue', 'Anton', 'Space Grotesk', 'Playfair Display', 'Pacifico', 'Caveat', 'Permanent Marker'];
const TEXT_COLORS = ['#ffffff', '#000000', '#ff6fb5', '#ffa06a', '#ffd36a', '#7cf2b0', '#5ab0ff', '#b48cff', '#ff4d4d'];
const STICKERS = '🔥 ✨ 💖 😍 😂 😎 🥹 🙌 👀 💯 🎧 🎶 🎵 🎤 🪩 🕺 💃 🎉 🍾 🥂 📸 🎬 ⚡ 💥 🌙 ⭐ 🌈 🌸 🌴 🌊 ☀️ 🌆 🏙️ 🚀 ❤️ 💜 💙 🖤 🤍 👑 💎 🦋 📍 ✅ ‼️ ❓ 💬 👉 👈 ⬆️ 🔊'.split(' ');

export const THEMES = [
  { id: 'dusk', name: 'Dusk', bg: 'linear-gradient(165deg,#1c1838 0%,#35204a 45%,#6e2e52 85%,#c25a5a 120%)' },
  { id: 'midnight', name: 'Midnight', bg: '#0b0b12' },
  { id: 'neon', name: 'Neon', bg: 'radial-gradient(120% 70% at 0% 0%,#ff6fb544,transparent 60%),radial-gradient(100% 60% at 100% 100%,#5ab0ff40,transparent 60%),#0d0b1c' },
  { id: 'ocean', name: 'Ocean', bg: 'linear-gradient(165deg,#061826,#0d3b5a 60%,#1f7a8c 120%)' },
  { id: 'sunset', name: 'Sunset', bg: 'linear-gradient(170deg,#2a0f2e,#8a2f4f 60%,#ff9a5a 130%)' },
  { id: 'forest', name: 'Forest', bg: 'linear-gradient(165deg,#09160f,#16352a 60%,#3d6b4f 130%)' },
  { id: 'graphite', name: 'Graphite', bg: 'linear-gradient(180deg,#1c1c20,#0e0e10)' },
  { id: 'aurora', name: 'Aurora', bg: 'radial-gradient(90% 60% at 20% 10%,#7cf2b033,transparent 60%),radial-gradient(90% 60% at 90% 40%,#b48cff3a,transparent 60%),radial-gradient(90% 60% at 30% 100%,#5ab0ff30,transparent 60%),#0a0d18' },
];
const ACCENTS = ['#ff6fb5', '#ffa06a', '#ffd36a', '#7cf2b0', '#5ab0ff', '#b48cff', '#ffffff'];
const DEFAULT_PREFS = { id: 'prefs', theme: 'dusk', accent: '#ff6fb5', customBg: null, customColor: null, panels: 'glass', dim: 35, exportRes: 1080, fps: 30 };

const canvas = $('#preview');
const engine = new Engine(canvas, $('#hidden-media'));
const tl = $('#timeline');

// ---------------------------------------------------------------- theme
async function applyTheme() {
  const p = S.prefs;
  const root = document.documentElement;
  let bg = (THEMES.find(t => t.id === p.theme) || THEMES[0]).bg;
  if (p.theme === 'color' && p.customColor) bg = p.customColor;
  if (p.theme === 'image' && p.customBg) {
    const m = await mediaRecord(p.customBg);
    if (m) bg = `linear-gradient(rgba(5,4,12,${p.dim / 100}),rgba(5,4,12,${Math.min(0.95, p.dim / 100 + 0.15)})),url("${m.url}") center/cover no-repeat`;
  }
  root.style.setProperty('--app-bg', bg);
  root.style.setProperty('--accent', p.accent);
  document.body.classList.toggle('solid-panels', p.panels === 'solid');
}
const savePrefs = debounce(() => db.put('settings', S.prefs), 300);

// ---------------------------------------------------------------- routing
function show(id) {
  for (const s of $$('.screen')) s.hidden = s.id !== id;
  document.body.dataset.screen = id;
}
async function route() {
  const [scr, arg] = location.hash.slice(1).split('/');
  if (scr !== 'editor' && S.project) closeEditor();
  if (scr === 'editor' && arg) return openEditor(arg);
  if (scr === 'library') return showLibrary();
  if (scr === 'settings') return showSettings();
  return showHome();
}
window.addEventListener('hashchange', route);
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

async function loadMedia() {
  media = new Map((await db.all('media')).map(m => [m.id, m]));
}
const thumbOf = id => media.get(id)?.thumb || '';

// ---------------------------------------------------------------- home
async function showHome() {
  show('home');
  await loadMedia();
  const list = (await db.all('projects')).sort((a, b) => b.updated - a.updated);
  const grid = $('#projects');
  grid.innerHTML = '';
  $('#noProjects').hidden = list.length > 0;
  for (const p of list) {
    const first = p.clips[0];
    const dur = totalDuration(p);
    grid.append(h('div', { class: 'proj' },
      h('button', { class: 'proj-thumb', style: { backgroundImage: first ? `url(${thumbOf(first.mediaId)})` : '' }, onclick: () => go('#editor/' + p.id), 'aria-label': 'Open ' + p.name },
        h('span', { class: 'proj-kind', html: ic(p.kind === 'photo' ? 'image' : 'video') }),
        p.kind !== 'photo' ? h('span', { class: 'badge' }, fmtShort(dur)) : null),
      h('div', { class: 'proj-meta' },
        h('div', {}, h('div', { class: 'proj-name' }, p.name), h('div', { class: 'proj-date' }, new Date(p.updated).toLocaleDateString())),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Project options', html: ic('more'), onclick: () => projectMenu(p) }))));
  }
}

function projectMenu(p) {
  openSheet(p.name, (b, close) => {
    b.append(h('div', { class: 'menu' },
      h('button', { onclick: async () => { close(); const n = await promptSheet('Rename project', p.name); if (n) { p.name = n; await db.put('projects', p); showHome(); } }, html: ic('edit') + 'Rename' }),
      h('button', { onclick: async () => { close(); const c = structuredClone(p); c.id = uid(); c.name = p.name + ' copy'; c.updated = Date.now(); await db.put('projects', c); showHome(); }, html: ic('copy') + 'Duplicate' }),
      h('button', { class: 'danger', onclick: async () => { close(); if (await confirmSheet(`Delete “${p.name}”? Your media stays in the Library.`, 'Delete', true)) { await db.del('projects', p.id); showHome(); } }, html: ic('trash') + 'Delete' })));
  });
}

function newProject(kind) {
  return {
    id: uid(), name: (kind === 'photo' ? 'Photo ' : 'Video ') + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    kind, created: Date.now(), updated: Date.now(), aspect: 'orig', bg: { type: 'blur', level: 3 }, clips: [], texts: [], audio: [],
  };
}
function newClip(m) {
  const video = m.kind === 'video';
  return {
    id: uid(), mediaId: m.id, type: video ? 'video' : 'image', in: 0, out: video ? (m.duration || 3) : 0, duration: 3,
    speed: 1, volume: 100, muted: false, filter: 'none', filterAmount: 100, adjust: {}, fit: 'fit', zoom: 100, x: 0, y: 0,
    rotate: 0, flipH: false, flipV: false, motion: 'none', transition: { type: 'none', dur: 0.6 },
  };
}

async function createProject(kind) {
  const picked = await pickMedia({ kinds: kind === 'photo' ? ['image'] : ['video', 'image'], multiple: kind !== 'photo', title: kind === 'photo' ? 'Choose a photo' : 'Choose videos & photos' });
  if (!picked.length) return;
  const p = newProject(kind);
  p.clips = picked.map(newClip);
  if (kind === 'photo') p.clips[0].duration = 5;
  await db.put('projects', p);
  go('#editor/' + p.id);
}

// ---------------------------------------------------------------- media picker
function pickMedia({ kinds, multiple = true, title = 'Add media' }) {
  return new Promise(async res => {
    await loadMedia();
    let done = false;
    const chosen = [];
    const accept = kinds.map(k => k + '/*').join(',');
    openSheet(title, (b, close) => {
      const finish = list => { done = true; res(list); close(); };
      b.append(h('button', {
        class: 'btn primary block', html: ic('upload') + 'From your phone',
        onclick: async () => {
          const files = await pickFiles(accept, multiple);
          if (!files.length) return;
          const recs = await importFiles(files);
          recs.forEach(r => media.set(r.id, r));
          finish(recs.filter(r => kinds.includes(r.kind)));
        },
      }));
      const items = [...media.values()].filter(m => kinds.includes(m.kind)).sort((a, z) => z.created - a.created);
      if (items.length) {
        b.append(h('div', { class: 'psec-title' }, 'From your library'));
        const grid = h('div', { class: 'grid pick' });
        const addBtn = h('button', { class: 'btn primary block', disabled: true, onclick: () => finish(chosen) }, 'Add');
        for (const m of items) {
          const tile = mediaTile(m, () => {
            if (!multiple) return finish([m]);
            const i = chosen.indexOf(m);
            if (i >= 0) chosen.splice(i, 1); else chosen.push(m);
            $$('.tile', grid).forEach(t => { const k = chosen.findIndex(c => c.id === t.dataset.id); t.classList.toggle('picked', k >= 0); t.dataset.n = k >= 0 ? k + 1 : ''; });
            addBtn.disabled = !chosen.length;
            addBtn.textContent = chosen.length ? `Add ${chosen.length}` : 'Add';
          });
          grid.append(tile);
        }
        b.append(grid);
        if (multiple) b.append(h('div', { class: 'sticky-foot' }, addBtn));
      }
    }, { onClose: () => { if (!done) res([]); }, wide: true });
  });
}

function mediaTile(m, onclick, onlong) {
  const tile = h('button', { class: 'tile kind-' + m.kind, 'data-id': m.id, style: { backgroundImage: m.thumb ? `url(${m.thumb})` : '' }, onclick },
    m.kind === 'audio' ? h('span', { class: 'tile-ic', html: ic('music') }) : null,
    m.kind !== 'image' && m.duration ? h('span', { class: 'badge' }, fmtShort(m.duration)) : null,
    h('span', { class: 'tile-name' }, m.name));
  if (onlong) {
    let timer;
    tile.addEventListener('pointerdown', () => { timer = setTimeout(() => { timer = null; tile._long = true; onlong(); }, 480); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) tile.addEventListener(ev, () => clearTimeout(timer));
    tile.addEventListener('contextmenu', e => { e.preventDefault(); });
  }
  return tile;
}

// ---------------------------------------------------------------- editor: open / save / undo
async function openEditor(id) {
  if (S.project?.id === id) return;
  const p = await db.get('projects', id);
  if (!p) return go('#home');
  await loadMedia();
  S.project = p; S.sel = null; S.undo = []; S.redo = [];
  show('editor');
  document.body.classList.toggle('photo-mode', p.kind === 'photo');
  $('#projName').value = p.name;
  await engine.load(p);
  for (const f of new Set((p.texts || []).map(t => t.font))) if (f) document.fonts.load(`700 40px "${f}"`).then(() => engine.requestRender());
  closePanel();
  renderTools();
  renderTimeline();
  fitCanvas();
  updateTime();
  updateUndo();
  $('#exportBtn').textContent = p.kind === 'photo' ? 'Save' : 'Export';
}
function closeEditor() {
  saveProject.flush();
  engine.pause();
  engine.load({ clips: [], texts: [], audio: [] });
  S.project = null;
  closePanel();
}

const saveProject = debounce(() => { if (S.project) { S.project.updated = Date.now(); db.put('projects', S.project); } }, 350);
const snapshot = () => JSON.stringify(S.project);

function flushPanelSnap() {
  if (S.panelSnap && S.panelSnap !== snapshot()) { S.undo.push(S.panelSnap); S.redo = []; if (S.undo.length > 60) S.undo.shift(); }
  S.panelSnap = $('#panel').hidden ? null : snapshot();
}
function commit(fn) {
  flushPanelSnap();
  const before = snapshot();
  fn();
  if (snapshot() !== before) { S.undo.push(before); S.redo = []; if (S.undo.length > 60) S.undo.shift(); }
  if (!$('#panel').hidden) S.panelSnap = snapshot();
  changed();
}
function changed({ timeline = true } = {}) {
  saveProject();
  engine.sync();
  if (timeline) renderTimeline();
  fitCanvas();
  updateTime();
  updateUndo();
}
async function restore(json) {
  const keepId = S.project.id;
  S.project = JSON.parse(json);
  S.project.id = keepId;
  engine.p = S.project;
  S.sel = null;
  await engine.sync();
  engine.seek(Math.min(engine.t, engine.total));
  changed();
}
function undo() {
  flushPanelSnap(); S.panelSnap = null; closePanel();
  if (!S.undo.length) return;
  S.redo.push(snapshot());
  restore(S.undo.pop());
}
function redo() {
  flushPanelSnap(); S.panelSnap = null; closePanel();
  if (!S.redo.length) return;
  S.undo.push(snapshot());
  restore(S.redo.pop());
}
function updateUndo() {
  $('#undoBtn').disabled = !S.undo.length && !(S.panelSnap && S.panelSnap !== snapshot());
  $('#redoBtn').disabled = !S.redo.length;
}

// ---------------------------------------------------------------- editor: preview
let lastCanvasKey = '';
function fitCanvas() {
  if (!S.project) return;
  const st = $('#stage').getBoundingClientRect();
  if (!st.width || !st.height) return;
  const ar = engine.aspect();
  let w = st.width - 24, hh = st.height - 20;
  if (w / hh > ar) w = hh * ar; else hh = w / ar;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${Math.round(w)}x${Math.round(hh)}@${dpr}`;
  if (key === lastCanvasKey) return;
  lastCanvasKey = key;
  canvas.style.width = w + 'px'; canvas.style.height = hh + 'px';
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
  engine.requestRender();
}
new ResizeObserver(() => { lastCanvasKey = ''; fitCanvas(); renderTimeline(); }).observe($('#stage'));

function updateTime() {
  if (!S.project) return;
  $('#time').textContent = fmtTime(engine.t);
  $('#dur').textContent = fmtTime(engine.total);
}
engine.onTime = t => { updateTime(); setScroll(t); };
engine.onPlayState = playing => { $('#playBtn').innerHTML = ic(playing ? 'pause' : 'play'); $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play'); };

// Drag text/stickers on the preview; pinch with two fingers to resize and rotate.
const pointers = new Map();
let drag = null;
canvas.addEventListener('pointerdown', e => {
  const r = canvas.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 2 && drag) {
    const [a, b] = [...pointers.values()];
    drag.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), size: drag.item.size, rot: drag.item.rotate || 0 };
    return;
  }
  const hit = [...engine.textBoxes].reverse().find(b => nx >= b.x - 0.04 && nx <= b.x + b.w + 0.04 && ny >= b.y - 0.04 && ny <= b.y + b.h + 0.04);
  if (hit) {
    const item = S.project.texts.find(t => t.id === hit.id);
    if (S.sel?.id !== item.id) select({ kind: 'text', id: item.id });
    drag = { item, dx: nx - item.x, dy: ny - item.y, moved: false, snap: snapshot() };
  } else {
    drag = { tap: true, x: e.clientX, y: e.clientY };
  }
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !drag) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (drag.tap) return;
  const it = drag.item;
  if (drag.pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    it.size = Math.max(1, Math.min(60, drag.pinch.size * d / drag.pinch.d));
    it.rotate = Math.round(drag.pinch.rot + (ang - drag.pinch.ang) * 180 / Math.PI);
  } else {
    const r = canvas.getBoundingClientRect();
    let nx = (e.clientX - r.left) / r.width - drag.dx, ny = (e.clientY - r.top) / r.height - drag.dy;
    // Snap to the center guides.
    if (Math.abs(nx - 0.5) < 0.02) nx = 0.5;
    if (Math.abs(ny - 0.5) < 0.02) ny = 0.5;
    it.x = Math.max(0, Math.min(1, nx)); it.y = Math.max(0, Math.min(1, ny));
  }
  drag.moved = true;
  engine.requestRender();
});
const endPointer = e => {
  pointers.delete(e.pointerId);
  if (!drag) return;
  if (pointers.size > 0) { if (drag.pinch) drag.pinch = null; return; }
  if (drag.tap) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) { if (S.sel?.kind === 'text') select(null); else engine.toggle(); } }
  else if (drag.moved) {
    if (drag.snap !== snapshot() && !S.panelSnap) { S.undo.push(drag.snap); S.redo = []; }
    saveProject(); updateUndo();
    if (S.sel?.kind === 'text') refreshTextPanel?.();
  }
  drag = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// ---------------------------------------------------------------- editor: timeline
function setScroll(t) {
  tl.scrollLeft = t * S.pps;
  S.progScroll = tl.scrollLeft;
}
tl.addEventListener('scroll', () => {
  if (Math.abs(tl.scrollLeft - S.progScroll) < 1.5) return;
  S.progScroll = -1;
  if (engine.playing) engine.pause();
  engine.seek(tl.scrollLeft / S.pps);
  updateTime();
}, { passive: true });

// Pinch to zoom the timeline.
let tlPinch = null;
tl.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    const [a, b] = e.touches;
    tlPinch = { d: Math.abs(a.clientX - b.clientX) || 1, pps: S.pps, t: engine.t };
  }
}, { passive: true });
tl.addEventListener('touchmove', e => {
  if (!tlPinch || e.touches.length !== 2) return;
  const [a, b] = e.touches;
  const d = Math.abs(a.clientX - b.clientX) || 1;
  S.pps = Math.max(12, Math.min(480, tlPinch.pps * d / tlPinch.d));
  renderTimeline();
  setScroll(tlPinch.t);
}, { passive: true });
tl.addEventListener('touchend', () => { tlPinch = null; });
tl.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const t = engine.t;
  S.pps = Math.max(12, Math.min(480, S.pps * (e.deltaY < 0 ? 1.12 : 0.89)));
  renderTimeline(); setScroll(t);
}, { passive: false });

function renderTimeline() {
  const p = S.project;
  if (!p || p.kind === 'photo') return;
  const inner = $('#tlInner');
  const pad = tl.clientWidth / 2;
  const pps = S.pps;
  const T = totalDuration(p);
  inner.innerHTML = '';
  inner.style.paddingLeft = inner.style.paddingRight = pad + 'px';
  const wrap = h('div', { class: 'tl-content', style: { width: T * pps + 64 + 'px' } });

  const ruler = h('div', { class: 'ruler' });
  const step = pps >= 140 ? 0.5 : pps >= 60 ? 1 : pps >= 30 ? 2 : pps >= 16 ? 5 : 10;
  for (let s = 0; s <= T + 0.001; s += step) ruler.append(h('span', { style: { left: s * pps + 'px' } }, fmtShort(s).replace('.0s', 's')));

  const main = h('div', { class: 'track main' });
  layout(p).forEach((o, i) => {
    const c = o.clip;
    const sel = S.sel?.kind === 'clip' && S.sel.id === c.id;
    main.append(h('div', {
      class: 'clip' + (sel ? ' sel' : '') + (c.type === 'image' ? ' still' : ''),
      style: { left: o.start * pps + 'px', width: Math.max(6, o.dur * pps - 2) + 'px', backgroundImage: thumbOf(c.mediaId) ? `url(${thumbOf(c.mediaId)})` : '' },
      onclick: e => { e.stopPropagation(); select(sel ? null : { kind: 'clip', id: c.id }); },
    },
      h('span', { class: 'badge' }, fmtShort(o.dur)),
      c.type === 'video' && c.speed !== 1 ? h('span', { class: 'badge sp' }, c.speed + '×') : null,
      c.type === 'video' && (c.muted || !c.volume) ? h('span', { class: 'badge mu', html: ic('mute') }) : null,
      c.filter && c.filter !== 'none' ? h('span', { class: 'badge fx', html: ic('filter') }) : null));
    if (i < p.clips.length - 1) {
      const on = c.transition?.type && c.transition.type !== 'none';
      main.append(h('button', {
        class: 'tr-btn' + (on ? ' on' : ''), style: { left: (o.start + o.dur) * pps + 'px' }, 'aria-label': 'Transition', html: ic('transition'),
        onclick: e => { e.stopPropagation(); openTransitionPanel(c); },
      }));
    }
  });
  main.append(h('button', { class: 'add-clip', style: { left: T * pps + 10 + 'px' }, 'aria-label': 'Add clips', html: ic('plus'), onclick: e => { e.stopPropagation(); addClips(); } }));

  const texts = h('div', { class: 'track lane text-lane' });
  for (const x of p.texts) {
    texts.append(h('div', {
      class: 'bar' + (x.sticker ? ' sticker' : '') + (S.sel?.id === x.id ? ' sel' : ''),
      style: { left: x.start * pps + 'px', width: Math.max(10, x.dur * pps) + 'px' },
      onclick: e => { e.stopPropagation(); select({ kind: 'text', id: x.id }); },
    }, x.sticker ? x.text : (x.text || 'Text').split('\n')[0]));
  }
  const audio = h('div', { class: 'track lane audio-lane' });
  for (const a of p.audio) {
    const buf = engine.buffer(a.mediaId);
    audio.append(h('div', {
      class: 'bar audio' + (a.voice ? ' voice' : '') + (S.sel?.id === a.id ? ' sel' : ''),
      style: { left: a.start * pps + 'px', width: Math.max(10, audioDuration(a, buf) * pps) + 'px' },
      onclick: e => { e.stopPropagation(); select({ kind: 'audio', id: a.id }); },
    }, h('span', { html: ic(a.voice ? 'mic' : 'music') }), a.name || 'Audio'));
  }
  wrap.append(ruler, main, texts, audio);
  inner.append(wrap);
  inner.onclick = () => { if (S.sel) select(null); };
  setScroll(engine.t);
}

function select(sel) {
  S.sel = sel;
  engine.selectedText = sel?.kind === 'text' ? sel.id : null;
  renderTimeline();
  engine.requestRender();
  if (sel?.kind === 'text') openTextPanel(S.project.texts.find(t => t.id === sel.id));
  else if (sel?.kind === 'audio') openAudioPanel(S.project.audio.find(a => a.id === sel.id));
  else if (['text', 'audio'].includes($('#panel').dataset.kind)) closePanel();
}

// The clip a tool acts on: the selected one, or whatever is under the playhead.
function target() {
  const p = S.project;
  if (!p.clips.length) { toast('Add a video or photo first'); return null; }
  if (S.sel?.kind === 'clip') { const c = p.clips.find(c => c.id === S.sel.id); if (c) return c; }
  const L = layout(p);
  const o = L.find(o => engine.t < o.start + o.dur) || L[L.length - 1];
  return o.clip;
}
const entryOf = c => layout(S.project).find(o => o.clip.id === c.id);

// ---------------------------------------------------------------- panels
let refreshTextPanel = null;
function openPanel(title, build, kind = '') {
  closePanel(true);
  const panel = $('#panel');
  panel.dataset.kind = kind;
  $('#panelTitle').textContent = title;
  const body = $('#panelBody');
  body.innerHTML = '';
  build(body);
  panel.hidden = false;
  document.body.classList.add('panel-open');
  S.panelSnap = snapshot();
  requestAnimationFrame(() => { lastCanvasKey = ''; fitCanvas(); });
}
function closePanel(keepSel = false) {
  const panel = $('#panel');
  if (panel.hidden) return;
  if (S.project) flushPanelSnap();
  S.panelSnap = null;
  panel.hidden = true;
  panel.dataset.kind = '';
  refreshTextPanel = null;
  document.body.classList.remove('panel-open');
  if (!keepSel && S.sel && S.sel.kind !== 'clip') { S.sel = null; engine.selectedText = null; renderTimeline(); engine.requestRender(); }
  updateUndo();
  requestAnimationFrame(() => { lastCanvasKey = ''; fitCanvas(); });
}
$('#panelDone').addEventListener('click', () => closePanel());
const live = () => changed({ timeline: false });

const TOOLS = [
  { id: 'canvas', label: 'Canvas', icon: 'canvas', fn: canvasPanel },
  { id: 'bg', label: 'Background', icon: 'bg', fn: bgPanel },
  { id: 'trim', label: 'Trim', icon: 'trim', fn: trimPanel, video: true },
  { id: 'split', label: 'Split', icon: 'split', fn: splitAtPlayhead, video: true },
  { id: 'speed', label: 'Speed', icon: 'speed', fn: speedPanel, video: true },
  { id: 'enhance', label: 'Enhance', icon: 'enhance', fn: enhanceTool, hot: true },
  { id: 'filter', label: 'Filter', icon: 'filter', fn: filterPanel },
  { id: 'adjust', label: 'Adjust', icon: 'adjust', fn: adjustPanel },
  { id: 'text', label: 'Text', icon: 'text', fn: addText },
  { id: 'sticker', label: 'Sticker', icon: 'sticker', fn: stickerPanel },
  { id: 'music', label: 'Music', icon: 'music', fn: musicPanel, video: true },
  { id: 'voice', label: 'Voiceover', icon: 'mic', fn: voicePanel, video: true },
  { id: 'volume', label: 'Volume', icon: 'volume', fn: volumePanel, video: true },
  { id: 'crop', label: 'Position', icon: 'crop', fn: positionPanel },
  { id: 'motion', label: 'Motion', icon: 'motion', fn: motionPanel, video: true },
  { id: 'arrange', label: 'Arrange', icon: 'arrange', fn: arrangePanel, video: true },
  { id: 'dup', label: 'Duplicate', icon: 'copy', fn: duplicateClip, video: true },
  { id: 'snap', label: 'Save frame', icon: 'camera', fn: snapshotFrame, video: true },
  { id: 'del', label: 'Delete', icon: 'trash', fn: deleteClip, video: true },
];
function renderTools() {
  const bar = $('#tools');
  bar.innerHTML = '';
  const photo = S.project.kind === 'photo';
  for (const t of TOOLS) {
    if (photo && t.video) continue;
    bar.append(h('button', { class: 'tool' + (t.hot ? ' hot' : ''), onclick: () => { engine.pause(); t.fn(); } }, h('span', { html: ic(t.icon) }), t.label));
  }
}

function applyAllBtn(fn, label = 'Apply to all clips') {
  return h('button', { class: 'link-btn', onclick: () => { commit(() => S.project.clips.forEach(fn)); toast('Applied to all clips'); } }, label);
}

// ---- Canvas & background
function canvasPanel() {
  const p = S.project;
  const c = p.clips.length ? target() : null;
  openPanel('Canvas', b => {
    b.append(section('Ratio', chips(ASPECTS.map(a => ({ ...a, html: ratioIcon(a.id) })), p.aspect, v => { p.aspect = v; live(); }, 'ratio')));
    if (c) b.append(section('Clip fit',
      chips([{ id: 'fit', label: 'Fit' }, { id: 'fill', label: 'Fill' }], c.fit, v => { c.fit = v; live(); }),
      applyAllBtn(x => { x.fit = c.fit; }, 'Use for all clips')));
  });
}
function ratioIcon(id) {
  if (id === 'orig') return '<i class="rt" style="width:12px;height:12px;border-style:dashed"></i>';
  const [a, b] = id.split(':').map(Number);
  const s = 16 / Math.max(a, b);
  return `<i class="rt" style="width:${a * s}px;height:${b * s}px"></i>`;
}

const GRADIENTS = [['#ff6fb5', '#5ab0ff'], ['#ffa06a', '#ff6fb5'], ['#1c1838', '#ff6fb5'], ['#0d0b1c', '#5ab0ff'], ['#7cf2b0', '#5ab0ff'], ['#ffd36a', '#ff4d4d'], ['#b48cff', '#1c1838'], ['#111111', '#444444']];
const BG_COLORS = ['#000000', '#ffffff', '#0d0b1c', '#1c1838', '#ff6fb5', '#ffa06a', '#ffd36a', '#7cf2b0', '#5ab0ff', '#b48cff'];
function bgPanel() {
  const p = S.project;
  openPanel('Background', b => {
    const body = h('div');
    const render = () => {
      body.innerHTML = '';
      const bg = p.bg;
      if (bg.type === 'blur') body.append(slider({ label: 'Blur', min: 1, max: 5, value: bg.level ?? 3, onInput: v => { bg.level = v; live(); } }));
      if (bg.type === 'color') body.append(swatches(BG_COLORS, bg.color, v => { bg.color = v; live(); }));
      if (bg.type === 'gradient') {
        const wrap = h('div', { class: 'swatches' });
        for (const g of GRADIENTS) wrap.append(h('button', { class: 'sw', style: { background: `linear-gradient(135deg,${g[0]},${g[1]})` }, onclick: () => { bg.colors = g; live(); } }));
        body.append(wrap);
      }
      if (bg.type === 'image') {
        body.append(btn(bg.mediaId ? 'Change image' : 'Choose image', 'image', async () => {
          const [m] = await pickMedia({ kinds: ['image'], multiple: false, title: 'Background image' });
          if (m) { bg.mediaId = m.id; await engine.sync(); live(); render(); }
        }));
        body.append(slider({ label: 'Blur', min: 0, max: 5, value: bg.level ?? 0, onInput: v => { bg.level = v; live(); } }));
      }
      body.append(h('p', { class: 'hint' }, 'Shows around your clip when it doesn’t fill the frame. Set Canvas → Fit to see it.'));
    };
    b.append(chips([{ id: 'blur', label: 'Blur' }, { id: 'color', label: 'Color' }, { id: 'gradient', label: 'Gradient' }, { id: 'image', label: 'Image' }], p.bg.type, v => {
      p.bg = { ...p.bg, type: v };
      if (v === 'color' && !p.bg.color) p.bg.color = '#000000';
      if (v === 'gradient' && !p.bg.colors) p.bg.colors = GRADIENTS[0];
      live(); render();
    }), body);
    render();
  });
}

// ---- Trim / split / speed
function trimPanel() {
  const c = target();
  if (!c) return;
  if (c.type !== 'video') return speedPanel();
  const m = media.get(c.mediaId);
  const full = m?.duration || c.out;
  openPanel('Trim', b => {
    const info = h('p', { class: 'hint center' });
    const upd = () => { info.textContent = `Keeping ${fmtShort((c.out - c.in) / c.speed)} of ${fmtShort(full / c.speed)}`; };
    const seekTo = local => { const o = entryOf(c); engine.seek(o.start + local); };
    const sIn = slider({ label: 'Start', min: 0, max: full, step: 0.05, value: c.in, fmt: fmtShort, onInput: v => { c.in = Math.min(v, c.out - 0.2); sIn.set(c.in); upd(); changed(); seekTo(0); } });
    const sOut = slider({ label: 'End', min: 0, max: full, step: 0.05, value: c.out, fmt: fmtShort, onInput: v => { c.out = Math.max(v, c.in + 0.2); sOut.set(c.out); upd(); changed(); seekTo(Math.max(0, clipDuration(c) - 0.05)); } });
    upd();
    b.append(info, sIn, sOut, h('div', { class: 'row-btns' }, btn('Split at playhead', 'split', splitAtPlayhead, 'ghost')));
  });
}
function splitAtPlayhead() {
  const p = S.project;
  const L = layout(p);
  const o = L.find(o => engine.t >= o.start && engine.t < o.start + o.dur);
  if (!o) return toast('Move the playhead over a clip');
  const local = engine.t - o.start;
  if (local < 0.1 || o.dur - local < 0.1) return toast('Move the playhead a bit further into the clip');
  commit(() => {
    const a = o.clip, b = structuredClone(a);
    b.id = uid();
    if (a.type === 'video') { const at = a.in + local * a.speed; a.out = at; b.in = at; }
    else { a.duration = local; b.duration = o.dur - local; }
    a.transition = { type: 'none', dur: 0.6 };
    p.clips.splice(p.clips.indexOf(a) + 1, 0, b);
    S.sel = { kind: 'clip', id: b.id };
  });
  toast('Split');
}
function speedPanel() {
  const c = target();
  if (!c) return;
  if (c.type === 'image') {
    return openPanel('Duration', b => {
      b.append(slider({ label: 'Show for', min: 0.5, max: 20, step: 0.1, value: c.duration, fmt: fmtShort, onInput: v => { c.duration = v; changed(); } }),
        applyAllBtn(x => { if (x.type === 'image') x.duration = c.duration; }, 'Use for all photos'));
    });
  }
  openPanel('Speed', b => {
    const sl = slider({ label: 'Speed', min: 0.1, max: 4, step: 0.05, value: c.speed, fmt: v => v.toFixed(2).replace(/0$/, '') + '×', onInput: v => { c.speed = v; ch.setValue(null); changed(); } });
    const ch = chips([0.25, 0.5, 1, 1.5, 2, 3, 4].map(v => ({ id: v, label: v + '×' })), c.speed, v => { c.speed = v; sl.set(v); changed(); });
    b.append(ch, sl, h('p', { class: 'hint' }, 'Pitch is kept natural when you speed up or slow down.'));
  });
}

// ---- Filters, adjust, enhance
function filterPanel() {
  const c = target();
  if (!c) return;
  openPanel('Filter', b => {
    const row = h('div', { class: 'filters' });
    const img = new Image();
    img.src = thumbOf(c.mediaId);
    const render = () => {
      row.innerHTML = '';
      for (const f of PRESETS) {
        const pv = h('span', { class: 'fthumb' });
        row.append(h('button', { class: 'fbtn' + ((c.filter || 'none') === f.id ? ' on' : ''), onclick: () => { c.filter = f.id; live(); render(); } }, pv, h('span', {}, f.name)));
        if (img.complete && img.naturalWidth) {
          const out = filterer().process(img, 120, 120 * img.naturalHeight / img.naturalWidth, uniformsFor({ filter: f.id, filterAmount: 100 }));
          pv.style.backgroundImage = `url(${out ? out.toDataURL('image/jpeg', 0.8) : img.src})`;
        }
      }
    };
    img.onload = render;
    render();
    b.append(row,
      slider({ label: 'Strength', min: 0, max: 100, value: c.filterAmount ?? 100, onInput: v => { c.filterAmount = v; live(); } }),
      applyAllBtn(x => { x.filter = c.filter; x.filterAmount = c.filterAmount; }));
  });
}
function adjustPanel(clip) {
  const c = clip || target();
  if (!c) return;
  openPanel('Adjust', b => {
    c.adjust ||= {};
    const sliders = [];
    for (const [k, label] of ADJUST_KEYS) {
      const pos = ['sharpen', 'vignette', 'fade', 'grain'].includes(k);
      const s = slider({ label, min: pos ? 0 : -100, max: 100, value: c.adjust[k] || 0, center: pos ? null : 0, onInput: v => { c.adjust[k] = v; live(); } });
      s.key = k; sliders.push(s);
    }
    b.append(h('div', { class: 'row-btns' },
      btn('Auto enhance', 'enhance', () => { runEnhance(c); sliders.forEach(s => s.set(c.adjust[s.key] || 0)); }, 'ghost accent'),
      btn('Reset', 'reset', () => { c.adjust = {}; sliders.forEach(s => s.set(0)); live(); }, 'ghost')),
      ...sliders,
      applyAllBtn(x => { x.adjust = { ...c.adjust }; }));
  });
}
function runEnhance(c) {
  const o = entryOf(c);
  let s = o && engine.sourceFor(o);
  if (!s) {
    const img = new Image(); img.src = thumbOf(c.mediaId);
    if (!img.naturalWidth) return toast('Still loading — try again in a second');
    s = { src: img, sw: img.naturalWidth, sh: img.naturalHeight };
  }
  c.adjust = analyzeFrame(s.src, s.sw, s.sh);
  live();
}
function enhanceTool() {
  const c = target();
  if (!c) return;
  const before = snapshot();
  runEnhance(c);
  S.undo.push(before); S.redo = [];
  toast('✨ Enhanced: exposure, color and sharpness balanced', { label: 'Undo', fn: undo });
  adjustPanel(c);
  $('#panelBody').prepend(h('button', {
    class: 'link-btn', onclick: () => {
      commit(() => S.project.clips.forEach(x => {
        const img = new Image(); img.src = thumbOf(x.mediaId);
        if (img.naturalWidth) x.adjust = analyzeFrame(img, img.naturalWidth, img.naturalHeight);
      }));
      toast('✨ Enhanced every clip');
      adjustPanel(c);
    },
  }, 'Enhance all clips'));
}

// ---- Text & stickers
function addText(sticker) {
  const p = S.project;
  const t = {
    id: uid(), text: sticker || 'Your text', sticker: !!sticker, start: Math.min(engine.t, Math.max(0, engine.total - 0.5)),
    dur: Math.min(3, Math.max(1, engine.total - engine.t)) || 3, x: 0.5, y: sticker ? 0.4 : 0.5, size: sticker ? 16 : 8,
    font: 'Montserrat', color: '#ffffff', style: 'shadow', anim: sticker ? 'pop' : 'fade', rotate: 0, opacity: 100,
  };
  if (p.kind === 'photo') { t.start = 0; t.dur = 9999; }
  commit(() => p.texts.push(t));
  select({ kind: 'text', id: t.id });
  if (!sticker) setTimeout(() => { const ta = $('#panelBody textarea'); ta?.focus(); ta?.select(); }, 60);
}
function stickerPanel() {
  openPanel('Stickers', b => {
    const g = h('div', { class: 'emoji-grid' });
    for (const e of STICKERS) g.append(h('button', { onclick: () => addText(e) }, e));
    b.append(g);
  });
}
function openTextPanel(t) {
  if (!t) return;
  const p = S.project;
  openPanel(t.sticker ? 'Sticker' : 'Text', b => {
    const rerender = () => { engine.requestRender(); renderTimeline(); saveProject(); };
    if (!t.sticker) {
      const ta = h('textarea', { class: 'field', rows: 2, value: t.text, placeholder: 'Type something…' });
      ta.addEventListener('input', () => { t.text = ta.value; rerender(); });
      b.append(ta);
      const fonts = h('div', { class: 'chips' });
      const paintFonts = () => {
        fonts.innerHTML = '';
        for (const f of FONTS) fonts.append(h('button', { class: 'chip' + (t.font === f ? ' on' : ''), style: { fontFamily: `"${f}"` }, onclick: () => { t.font = f; document.fonts.load(`700 40px "${f}"`).then(() => engine.requestRender()); paintFonts(); rerender(); } }, f));
      };
      paintFonts();
      b.append(section('Font', fonts),
        section('Color', swatches(TEXT_COLORS, t.color, v => { t.color = v; rerender(); })),
        section('Style', chips(['shadow', 'outline', 'box', 'neon', 'plain'].map(s => ({ id: s, label: s[0].toUpperCase() + s.slice(1) })), t.style, v => { t.style = v; rerender(); })));
      b.append(section('', h('div', { class: 'swatch-label' }, 'Box color'), swatches(['rgba(0,0,0,0.6)', '#ffffff', '#ff6fb5', '#ffd36a', '#5ab0ff', '#000000'], t.boxColor, v => { t.boxColor = v; t.style = 'box'; rerender(); })));
    }
    const sz = slider({ label: 'Size', min: 2, max: t.sticker ? 60 : 30, step: 0.5, value: t.size, onInput: v => { t.size = v; rerender(); } });
    const rot = slider({ label: 'Rotate', min: -180, max: 180, value: t.rotate || 0, center: 0, fmt: v => v + '°', onInput: v => { t.rotate = v; rerender(); } });
    refreshTextPanel = () => { sz.set(t.size); rot.set(t.rotate || 0); };
    b.append(sz, rot,
      slider({ label: 'Opacity', min: 10, max: 100, value: t.opacity ?? 100, onInput: v => { t.opacity = v; rerender(); } }),
      section('Animation', chips([['none', 'None'], ['fade', 'Fade'], ['pop', 'Pop'], ['slide', 'Slide up'], ['type', 'Typewriter'], ['bounce', 'Pulse']].map(([id, label]) => ({ id, label })), t.anim, v => { t.anim = v; rerender(); })));
    if (p.kind !== 'photo') {
      const T = Math.max(0.5, engine.total);
      b.append(section('Timing',
        slider({ label: 'Starts', min: 0, max: T, step: 0.1, value: Math.min(t.start, T), fmt: fmtShort, onInput: v => { t.start = v; rerender(); engine.seek(v + 0.4); } }),
        slider({ label: 'Lasts', min: 0.3, max: T, step: 0.1, value: Math.min(t.dur, T), fmt: fmtShort, onInput: v => { t.dur = v; rerender(); } })));
    }
    b.append(h('p', { class: 'hint' }, 'Drag it on the preview to move it. Pinch with two fingers to resize and rotate.'),
      h('div', { class: 'row-btns' },
        btn('Duplicate', 'copy', () => { const c = { ...structuredClone(t), id: uid(), y: Math.min(0.95, t.y + 0.08) }; commit(() => p.texts.push(c)); select({ kind: 'text', id: c.id }); }, 'ghost'),
        btn('Delete', 'trash', () => { commit(() => { p.texts = p.texts.filter(x => x.id !== t.id); }); S.sel = null; closePanel(); }, 'ghost danger')));
  }, 'text');
}

// ---- Music, voiceover, volume
function musicPanel() {
  openPanel('Music & sound', b => {
    b.append(h('div', { class: 'big-actions' },
      h('button', {
        class: 'big', onclick: async () => {
          const files = await pickFiles('audio/*,video/*', true);
          if (!files.length) return;
          const recs = await importFiles(files);
          recs.forEach(r => media.set(r.id, r));
          for (const r of recs) addAudio(r);
        },
      }, h('span', { html: ic('upload') }), 'Import from phone', h('small', {}, 'MP3, M4A, WAV… or a video to take its sound')),
      h('button', {
        class: 'big', onclick: async () => {
          const picked = await pickMedia({ kinds: ['audio', 'video'], title: 'Pick a song or video sound' });
          for (const r of picked) addAudio(r);
        },
      }, h('span', { html: ic('library') }), 'From library', h('small', {}, 'Songs, voiceovers, or sound from your videos')),
      h('button', { class: 'big', onclick: voicePanel }, h('span', { html: ic('mic') }), 'Record voiceover', h('small', {}, 'Talk over your video as it plays'))));
    b.append(section('Where to get music',
      h('p', { class: 'hint' }, 'Download tracks you have the rights to use, then import them here. These are free for videos:'),
      h('div', { class: 'links' },
        h('a', { href: 'https://studio.youtube.com/channel/UC/music', target: '_blank', rel: 'noopener', html: ic('link') + 'YouTube Audio Library' }),
        h('a', { href: 'https://pixabay.com/music/', target: '_blank', rel: 'noopener', html: ic('link') + 'Pixabay Music' }),
        h('a', { href: 'https://freemusicarchive.org/', target: '_blank', rel: 'noopener', html: ic('link') + 'Free Music Archive' })),
      h('p', { class: 'hint' }, 'Your own mixes and productions work great too — export them as MP3/WAV and import.')));
  });
}
async function addAudio(r, extra = {}) {
  const p = S.project;
  const buf = await engine.loadBuffer(r.id);
  if (!buf) return toast(`Couldn’t read the sound in “${r.name}”`);
  const start = extra.start ?? Math.min(engine.t, Math.max(0, engine.total - 0.5));
  const a = { id: uid(), mediaId: r.id, name: r.name.replace(/\.[^.]+$/, ''), start, offset: 0, dur: Math.min(buf.duration, Math.max(0.5, engine.total - start)), volume: 100, fadeIn: 0, fadeOut: 0, ...extra };
  commit(() => p.audio.push(a));
  select({ kind: 'audio', id: a.id });
}
function openAudioPanel(a) {
  if (!a) return;
  const p = S.project;
  const buf = engine.buffer(a.mediaId);
  const full = buf ? buf.duration : a.dur;
  openPanel(a.name || 'Audio', b => {
    const upd = () => { renderTimeline(); saveProject(); updateUndo(); };
    const T = Math.max(0.5, engine.total);
    b.append(
      slider({ label: 'Volume', min: 0, max: 200, value: a.volume ?? 100, fmt: v => v + '%', onInput: v => { a.volume = v; upd(); } }),
      slider({ label: 'Fade in', min: 0, max: 5, step: 0.1, value: a.fadeIn || 0, fmt: fmtShort, onInput: v => { a.fadeIn = v; upd(); } }),
      slider({ label: 'Fade out', min: 0, max: 5, step: 0.1, value: a.fadeOut || 0, fmt: fmtShort, onInput: v => { a.fadeOut = v; upd(); } }),
      section('Trim & place',
        slider({ label: 'Song starts at', min: 0, max: Math.max(0.1, full - 0.5), step: 0.1, value: a.offset || 0, fmt: fmtShort, onInput: v => { a.offset = v; upd(); } }),
        slider({ label: 'Length', min: 0.5, max: Math.max(0.5, full), step: 0.1, value: a.dur, fmt: fmtShort, onInput: v => { a.dur = v; upd(); } }),
        slider({ label: 'Plays from', min: 0, max: T, step: 0.1, value: Math.min(a.start, T), fmt: fmtShort, onInput: v => { a.start = v; upd(); } })),
      h('div', { class: 'row-btns wrap' },
        btn('Split', 'split', () => {
          const local = engine.t - a.start;
          if (local < 0.2 || local > audioDuration(a, buf) - 0.2) return toast('Put the playhead over this track to split it');
          commit(() => { const c = { ...a, id: uid(), start: engine.t, offset: (a.offset || 0) + local, dur: audioDuration(a, buf) - local }; a.dur = local; p.audio.push(c); });
        }, 'ghost'),
        btn('Fill video', 'arrange', () => { commit(() => { a.start = 0; a.dur = Math.min(full - (a.offset || 0), engine.total); }); }, 'ghost'),
        btn('Duplicate', 'copy', () => { commit(() => p.audio.push({ ...a, id: uid(), start: a.start + audioDuration(a, buf) })); }, 'ghost'),
        btn('Delete', 'trash', () => { commit(() => { p.audio = p.audio.filter(x => x.id !== a.id); }); S.sel = null; closePanel(); }, 'ghost danger')),
      h('p', { class: 'hint' }, 'Drag the timeline to hear the change from any point.'));
  }, 'audio');
}
let voiceRec = null;
function voicePanel() {
  openPanel('Voiceover', b => {
    const status = h('p', { class: 'hint center' }, 'Recording starts from the playhead while your video plays. Headphones help avoid echo.');
    const rb = h('button', { class: 'rec-btn', 'aria-label': 'Record', html: ic('record') });
    rb.onclick = async () => {
      if (voiceRec) { voiceRec.stop(); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { return toast('Microphone access was blocked'); }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      const chunks = [];
      const startAt = engine.t;
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        engine.pause();
        voiceRec = null;
        rb.classList.remove('on'); rb.innerHTML = ic('record');
        status.textContent = 'Saving…';
        const blob = new Blob(chunks, { type: (mime || 'audio/webm').split(';')[0] });
        const n = [...media.values()].filter(m => m.folder === 'voice').length + 1;
        const r = await importBlob(blob, `Voiceover ${n}.${mime.includes('mp4') ? 'm4a' : 'webm'}`, 'voice');
        if (!r) return;
        media.set(r.id, r);
        await addAudio(r, { start: startAt, voice: true, name: `Voiceover ${n}` });
      };
      rec.start(250);
      voiceRec = rec;
      rb.classList.add('on'); rb.innerHTML = ic('stop');
      status.textContent = 'Recording… tap to stop';
      engine.play();
      const stopAtEnd = () => { if (voiceRec === rec && !engine.playing) rec.state !== 'inactive' && rec.stop(); else if (voiceRec === rec) setTimeout(stopAtEnd, 200); };
      setTimeout(stopAtEnd, 400);
    };
    b.append(h('div', { class: 'center' }, rb), status);
  });
}
function volumePanel() {
  const c = target();
  if (!c) return;
  if (c.type !== 'video') return toast('Photos have no sound — add Music instead');
  openPanel('Clip volume', b => {
    const sl = slider({ label: 'Volume', min: 0, max: 200, value: c.muted ? 0 : (c.volume ?? 100), fmt: v => v + '%', onInput: v => { c.volume = v; c.muted = v === 0; live(); renderTimeline(); } });
    b.append(sl, h('div', { class: 'row-btns' },
      btn('Mute', 'mute', () => { c.muted = true; c.volume = 0; sl.set(0); live(); renderTimeline(); }, 'ghost'),
      btn('Use sound as music', 'music', async () => { closePanel(); await addAudio(media.get(c.mediaId), { start: entryOf(c).start, offset: c.in, dur: c.out - c.in, name: 'Sound · ' + media.get(c.mediaId).name }); }, 'ghost')),
      applyAllBtn(x => { x.volume = c.volume; x.muted = c.muted; }));
  });
}

// ---- Position, motion, arrange, duplicate, delete, snapshot
function positionPanel() {
  const c = target();
  if (!c) return;
  openPanel('Position', b => {
    const zs = slider({ label: 'Zoom', min: 50, max: 300, value: c.zoom || 100, fmt: v => v + '%', onInput: v => { c.zoom = v; live(); } });
    const xs = slider({ label: 'Left/right', min: -50, max: 50, value: Math.round((c.x || 0) * 100), center: 0, onInput: v => { c.x = v / 100; live(); } });
    const ys = slider({ label: 'Up/down', min: -50, max: 50, value: Math.round((c.y || 0) * 100), center: 0, onInput: v => { c.y = v / 100; live(); } });
    b.append(chips([{ id: 'fit', label: 'Fit' }, { id: 'fill', label: 'Fill' }], c.fit, v => { c.fit = v; live(); }),
      h('div', { class: 'row-btns wrap' },
        btn('Rotate', 'rotate', () => { c.rotate = ((c.rotate || 0) + 90) % 360; live(); }, 'ghost'),
        btn('Flip', 'flip', () => { c.flipH = !c.flipH; live(); }, 'ghost'),
        btn('Flip ↕', 'flipv', () => { c.flipV = !c.flipV; live(); }, 'ghost'),
        btn('Reset', 'reset', () => { Object.assign(c, { zoom: 100, x: 0, y: 0, rotate: 0, flipH: false, flipV: false }); zs.set(100); xs.set(0); ys.set(0); live(); }, 'ghost')),
      zs, xs, ys);
  });
}
function motionPanel() {
  const c = target();
  if (!c) return;
  openPanel('Motion', b => {
    b.append(chips([['none', 'None'], ['in', 'Zoom in'], ['out', 'Zoom out'], ['pan', 'Pan']].map(([id, label]) => ({ id, label })), c.motion || 'none', v => { c.motion = v; live(); }),
      h('p', { class: 'hint' }, 'A slow camera move — great for making photos feel alive.'),
      applyAllBtn(x => { x.motion = c.motion; }, 'Use for all clips'));
  });
}
function arrangePanel() {
  const c = target();
  if (!c) return;
  const p = S.project;
  const move = d => commit(() => {
    const i = p.clips.indexOf(c), j = Math.max(0, Math.min(p.clips.length - 1, i + d));
    p.clips.splice(i, 1); p.clips.splice(j, 0, c);
    S.sel = { kind: 'clip', id: c.id };
  });
  openPanel('Arrange', b => {
    b.append(h('p', { class: 'hint center' }, 'Move the selected clip earlier or later.'),
      h('div', { class: 'row-btns' },
        btn('To start', 'left', () => move(-999), 'ghost'), btn('Earlier', 'left', () => move(-1), 'ghost'),
        btn('Later', 'right', () => move(1), 'ghost'), btn('To end', 'right', () => move(999), 'ghost')));
  });
}
function duplicateClip() {
  const c = target();
  if (!c) return;
  commit(() => { const d = { ...structuredClone(c), id: uid() }; S.project.clips.splice(S.project.clips.indexOf(c) + 1, 0, d); S.sel = { kind: 'clip', id: d.id }; });
  toast('Duplicated');
}
function deleteClip() {
  const c = target();
  if (!c) return;
  commit(() => { S.project.clips = S.project.clips.filter(x => x.id !== c.id); S.sel = null; });
  toast('Clip deleted', { label: 'Undo', fn: undo });
}
async function snapshotFrame() {
  const blob = await engine.exportImage(S.prefs.exportRes, 'image/jpeg');
  const r = await importBlob(blob, `${S.project.name} frame ${fmtTime(engine.t).replace(':', '-')}.jpg`, 'frames');
  if (r) toast('Frame saved to Library → Frames', { label: 'Share', fn: () => shareFiles([r]) });
}
async function addClips() {
  const picked = await pickMedia({ kinds: ['video', 'image'], title: 'Add clips' });
  if (!picked.length) return;
  const p = S.project;
  const after = S.sel?.kind === 'clip' ? p.clips.findIndex(c => c.id === S.sel.id) + 1 : p.clips.length;
  commit(() => p.clips.splice(after, 0, ...picked.map(newClip)));
}

function openTransitionPanel(c) {
  openPanel('Transition', b => {
    c.transition ||= { type: 'none', dur: 0.6 };
    b.append(chips(TRANSITIONS, c.transition.type, v => { c.transition.type = v; changed(); const o = entryOf(c); engine.seek(Math.max(0, o.start + o.dur - c.transition.dur / 2 - 0.3)); engine.play(); }),
      slider({ label: 'Length', min: 0.2, max: 2, step: 0.1, value: c.transition.dur, fmt: fmtShort, onInput: v => { c.transition.dur = v; changed(); } }),
      applyAllBtn(x => { x.transition = { ...c.transition }; }));
  });
}

// ---------------------------------------------------------------- export
let wakeLock = null;
async function exportFlow() {
  const p = S.project;
  engine.pause(); closePanel();
  if (!p.clips.length) return toast('Add a video or photo first');
  saveProject.flush();
  if (p.kind === 'photo') return exportPhoto();
  const prefs = S.prefs;
  openSheet('Export video', (b, close) => {
    const opts = h('div');
    const ar = engine.aspect();
    const resChips = chips([{ id: 720, label: '720p' }, { id: 1080, label: '1080p' }, { id: 1440, label: '2K' }], prefs.exportRes, v => { prefs.exportRes = v; savePrefs(); size(); });
    const fpsChips = chips([{ id: 24, label: '24' }, { id: 30, label: '30' }, { id: 60, label: '60' }], prefs.fps, v => { prefs.fps = v; savePrefs(); });
    const sizeTxt = h('p', { class: 'hint' });
    const size = () => { const { W, H } = engine.outputSize(prefs.exportRes); sizeTxt.textContent = `${W}×${H} · ${(pickRecorderMime() || 'webm').includes('mp4') ? 'MP4' : 'WebM'} · ${fmtShort(engine.total)} long`; };
    size();
    opts.append(section('Resolution', resChips), section('Frame rate', fpsChips), sizeTxt,
      h('p', { class: 'hint' }, 'Exporting plays your video through once in real time. Keep this screen open until it finishes.'),
      btn('Export', 'download', start, 'primary block'));
    b.append(opts);
    void ar;
    async function start() {
      opts.remove();
      const prog = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
      const pct = h('div', { class: 'progress-pct' }, '0%');
      const cancel = btn('Cancel', 'close', () => engine.cancelExport(), 'ghost block');
      b.append(h('div', { class: 'exporting' }, pct, prog, h('p', { class: 'hint center' }, 'Rendering… keep the app open'), cancel));
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { }
      let blob = null;
      try {
        blob = await engine.exportVideo({
          short: prefs.exportRes, fps: prefs.fps,
          onProgress: f => { const v = Math.min(100, Math.round(f * 100)); pct.textContent = v + '%'; prog.firstChild.style.width = v + '%'; },
        });
      } catch (e) { toast('Export failed: ' + e.message); }
      wakeLock?.release?.(); wakeLock = null;
      b.innerHTML = '';
      if (!blob) { close(); return; }
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const r = await importBlob(blob, `${p.name.replace(/[\\/:*?"<>|]/g, '-')}.${ext}`, 'exports');
      showResult(b, r || { blob, name: `${p.name}.${ext}`, mime: blob.type }, close);
    }
  });
}
async function exportPhoto() {
  const p = S.project;
  openSheet('Save photo', (b, close) => {
    let fmt = 'image/jpeg';
    const m = media.get(p.clips[0].mediaId);
    const native = Math.min(4096, Math.min(m?.w || 2160, m?.h || 2160));
    let res = native;
    b.append(section('Format', chips([{ id: 'image/jpeg', label: 'JPG' }, { id: 'image/png', label: 'PNG' }], fmt, v => { fmt = v; })),
      section('Size', chips([{ id: native, label: `Full (${native}px)` }, { id: 1080, label: '1080px' }], res, v => { res = v; })),
      btn('Save', 'download', async () => {
        b.innerHTML = '<p class="hint center">Rendering…</p>';
        const blob = await engine.exportImage(res, fmt, 0.95);
        const r = await importBlob(blob, `${p.name.replace(/[\\/:*?"<>|]/g, '-')}.${fmt === 'image/png' ? 'png' : 'jpg'}`, 'exports');
        b.innerHTML = '';
        showResult(b, r, close);
      }, 'primary block'));
  });
}
function showResult(b, r, close) {
  const url = URL.createObjectURL(r.blob);
  const isVid = (r.mime || r.blob.type).startsWith('video');
  b.append(h('div', { class: 'result' },
    isVid ? h('video', { src: url, controls: true, playsinline: true, class: 'result-media' }) : h('img', { src: url, class: 'result-media', alt: 'Exported image' }),
    h('p', { class: 'hint center' }, `Saved in Library → Exports · ${fmtBytes(r.blob.size)}`),
    h('div', { class: 'row-btns' },
      btn('Share', 'share', () => shareFiles([r]), 'primary'),
      btn('Save to phone', 'download', () => saveToDevice(r.blob, fileNameFor(r)), 'ghost')),
    canShareFiles() ? h('p', { class: 'hint center' }, 'Share opens your phone’s share sheet — Quick Share, Instagram, TikTok, Messages…') : null,
    btn('Done', null, () => { URL.revokeObjectURL(url); close(); }, 'ghost block')));
}

// ---------------------------------------------------------------- library
async function showLibrary() {
  show('library');
  await loadMedia();
  const folders = (await db.all('folders')).sort((a, b) => (a.system === b.system ? a.name.localeCompare(b.name) : a.system ? -1 : 1));
  const L = S.lib;
  if (L.folder !== 'all' && L.folder !== 'root' && !folders.some(f => f.id === L.folder)) L.folder = 'all';
  const fbar = $('#folders');
  fbar.innerHTML = '';
  const fchip = (id, name, extra) => {
    const count = [...media.values()].filter(m => id === 'all' || (id === 'root' ? !m.folder : m.folder === id)).length;
    const b = h('button', { class: 'chip' + (L.folder === id ? ' on' : ''), onclick: () => { L.folder = id; showLibrary(); } }, id !== 'all' && id !== 'root' ? h('span', { html: ic('folder') }) : null, name, h('em', {}, count));
    if (extra) {
      let t;
      b.addEventListener('pointerdown', () => { t = setTimeout(() => { t = null; folderMenu(extra); }, 500); });
      for (const ev of ['pointerup', 'pointerleave']) b.addEventListener(ev, () => clearTimeout(t));
      b.addEventListener('contextmenu', e => { e.preventDefault(); folderMenu(extra); });
    }
    return b;
  };
  fbar.append(fchip('all', 'All'), fchip('root', 'Unsorted'), ...folders.map(f => fchip(f.id, f.name, f)),
    h('button', { class: 'chip add', html: ic('plus') + 'Folder', onclick: newFolder }));
  $('#kindBar').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.kind === L.kind));

  const items = [...media.values()]
    .filter(m => L.folder === 'all' || (L.folder === 'root' ? !m.folder : m.folder === L.folder))
    .filter(m => L.kind === 'all' || m.kind === L.kind)
    .sort((a, b) => b.created - a.created);
  const grid = $('#libGrid');
  grid.innerHTML = '';
  $('#libEmpty').hidden = items.length > 0;
  for (const m of items) {
    const tile = mediaTile(m, () => {
      if (tile._long) { tile._long = false; return; }
      if (L.selecting) toggleSel(m.id, tile); else viewMedia(m);
    }, () => { if (!L.selecting) { L.selecting = true; updateSelBar(); } toggleSel(m.id, tile); });
    if (L.selected.has(m.id)) tile.classList.add('picked');
    grid.append(tile);
  }
  updateSelBar();
  const info = await storageInfo();
  $('#libStorage').textContent = info ? `${items.length} item${items.length === 1 ? '' : 's'} · ${fmtBytes(info.used)} used on this device` : '';
}
function toggleSel(id, tile) {
  const s = S.lib.selected;
  s.has(id) ? s.delete(id) : s.add(id);
  tile.classList.toggle('picked', s.has(id));
  updateSelBar();
}
function updateSelBar() {
  const L = S.lib;
  document.body.classList.toggle('selecting', L.selecting);
  $('#selCount').textContent = L.selected.size ? `${L.selected.size} selected` : 'Tap items to select';
  $('#selectBtn').innerHTML = L.selecting ? ic('close') : ic('select');
  $$('#selBar button[data-act]').forEach(b => { b.disabled = !L.selected.size; });
}
const selectedRecs = () => [...S.lib.selected].map(id => media.get(id)).filter(Boolean);
function endSelect() { S.lib.selecting = false; S.lib.selected.clear(); showLibrary(); }

async function newFolder() {
  const name = await promptSheet('New folder', '', 'Create');
  if (!name) return null;
  const f = { id: uid(), name, created: Date.now() };
  await db.put('folders', f);
  S.lib.folder = f.id;
  showLibrary();
  return f;
}
function folderMenu(f) {
  openSheet(f.name, (b, close) => {
    b.append(h('div', { class: 'menu' },
      h('button', { html: ic('edit') + 'Rename', onclick: async () => { close(); const n = await promptSheet('Rename folder', f.name); if (n) { f.name = n; await db.put('folders', f); showLibrary(); } } }),
      h('button', {
        class: 'danger', html: ic('trash') + 'Delete folder (keeps files)', onclick: async () => {
          close();
          for (const m of media.values()) if (m.folder === f.id) { m.folder = null; await db.put('media', m); }
          await db.del('folders', f.id);
          S.lib.folder = 'all'; showLibrary();
        },
      })));
  });
}
async function moveTo(recs) {
  const folders = await db.all('folders');
  openSheet(`Move ${recs.length} item${recs.length > 1 ? 's' : ''} to…`, (b, close) => {
    const go = async folder => { for (const m of recs) { m.folder = folder; await db.put('media', m); } close(); toast('Moved'); endSelect(); };
    b.append(h('div', { class: 'menu' },
      h('button', { html: ic('library') + 'Unsorted', onclick: () => go(null) }),
      ...folders.map(f => h('button', { html: ic('folder') + f.name, onclick: () => go(f.id) })),
      h('button', { html: ic('plus') + 'New folder…', onclick: async () => { close(); const f = await newFolder(); if (f) { for (const m of recs) { m.folder = f.id; await db.put('media', m); } endSelect(); } } })));
  });
}
async function deleteMedia(recs) {
  const projects = await db.all('projects');
  const ids = new Set(recs.map(r => r.id));
  const used = projects.filter(p => p.clips.some(c => ids.has(c.mediaId)) || p.audio.some(a => ids.has(a.mediaId)) || ids.has(p.bg?.mediaId));
  const msg = `Delete ${recs.length} item${recs.length > 1 ? 's' : ''} from this device?` + (used.length ? ` ${used.length} project${used.length > 1 ? 's use' : ' uses'} them — those clips will be removed.` : '');
  if (!(await confirmSheet(msg, 'Delete', true))) return false;
  for (const p of used) {
    p.clips = p.clips.filter(c => !ids.has(c.mediaId));
    p.audio = p.audio.filter(a => !ids.has(a.mediaId));
    if (ids.has(p.bg?.mediaId)) p.bg = { type: 'blur', level: 3 };
    await db.put('projects', p);
  }
  for (const id of ids) { await db.del('media', id); forgetMedia(id); }
  toast('Deleted');
  return true;
}
function viewMedia(m) {
  const url = URL.createObjectURL(m.blob);
  openSheet(m.name, (b, close) => {
    const el = m.kind === 'video' ? h('video', { src: url, controls: true, playsinline: true, class: 'result-media' })
      : m.kind === 'audio' ? h('audio', { src: url, controls: true, class: 'result-audio' })
        : h('img', { src: url, class: 'result-media', alt: m.name });
    b.append(el,
      h('p', { class: 'hint center' }, [m.w && `${m.w}×${m.h}`, m.duration && fmtShort(m.duration), fmtBytes(m.size || m.blob.size), new Date(m.created).toLocaleDateString()].filter(Boolean).join(' · ')),
      h('div', { class: 'row-btns wrap' },
        btn('Share', 'share', () => shareFiles([m]), 'primary'),
        btn('Save to phone', 'download', () => saveToDevice(m.blob, fileNameFor(m)), 'ghost'),
        m.kind !== 'audio' ? btn(m.kind === 'image' ? 'Edit photo' : 'New video', 'edit', async () => {
          close();
          const p = newProject(m.kind === 'image' ? 'photo' : 'video');
          p.clips = [newClip(m)];
          if (m.kind === 'image') p.clips[0].duration = 5;
          await db.put('projects', p); go('#editor/' + p.id);
        }, 'ghost') : null),
      h('div', { class: 'menu' },
        h('button', { html: ic('edit') + 'Rename', onclick: async () => { close(); const n = await promptSheet('Rename', m.name); if (n) { m.name = n; await db.put('media', m); showLibrary(); } } }),
        h('button', { html: ic('move') + 'Move to folder', onclick: () => { close(); moveTo([m]); } }),
        h('button', { class: 'danger', html: ic('trash') + 'Delete', onclick: async () => { close(); if (await deleteMedia([m])) showLibrary(); } })));
  }, { onClose: () => URL.revokeObjectURL(url), wide: true });
}

// ---------------------------------------------------------------- settings
async function showSettings() {
  show('settings');
  const p = S.prefs;
  const body = $('#settingsBody');
  body.innerHTML = '';
  const themes = h('div', { class: 'themes' });
  const paintThemes = () => {
    themes.innerHTML = '';
    for (const t of THEMES) themes.append(h('button', { class: 'theme' + (p.theme === t.id ? ' on' : ''), style: { background: t.bg }, onclick: () => { p.theme = t.id; savePrefs(); applyTheme(); paintThemes(); } }, h('span', {}, t.name)));
  };
  paintThemes();
  const custom = h('div', { class: 'row-btns wrap' },
    btn('Use my photo', 'image', async () => {
      const [m] = await pickMedia({ kinds: ['image'], multiple: false, title: 'Pick a background photo' });
      if (!m) return;
      p.customBg = m.id; p.theme = 'image'; savePrefs(); await applyTheme(); paintThemes(); showSettings();
    }, p.theme === 'image' ? 'primary' : 'ghost'),
    h('label', { class: 'btn ghost' + (p.theme === 'color' ? ' on' : '') }, h('span', { html: ic('palette') }), 'Solid color',
      Object.assign(h('input', { type: 'color', value: p.customColor || '#1c1838', class: 'hidden-color' }), {
        oninput: e => { p.customColor = e.target.value; p.theme = 'color'; savePrefs(); applyTheme(); paintThemes(); },
      })));
  body.append(section('App background', themes, custom));
  if (p.theme === 'image') body.append(slider({ label: 'Darken', min: 0, max: 85, value: p.dim, fmt: v => v + '%', onInput: v => { p.dim = v; savePrefs(); applyTheme(); } }));
  body.append(section('Accent color', swatches(ACCENTS, p.accent, v => { p.accent = v; savePrefs(); applyTheme(); })),
    section('Panels', chips([{ id: 'glass', label: 'Frosted glass' }, { id: 'solid', label: 'Solid' }], p.panels, v => { p.panels = v; savePrefs(); applyTheme(); })),
    section('Export defaults',
      chips([{ id: 720, label: '720p' }, { id: 1080, label: '1080p' }, { id: 1440, label: '2K' }], p.exportRes, v => { p.exportRes = v; savePrefs(); }),
      chips([{ id: 24, label: '24 fps' }, { id: 30, label: '30 fps' }, { id: 60, label: '60 fps' }], p.fps, v => { p.fps = v; savePrefs(); })));
  const info = await storageInfo();
  const st = h('div', { class: 'psec' }, h('div', { class: 'psec-title' }, 'Storage'),
    h('p', { class: 'hint' }, info ? `${fmtBytes(info.used)} used of ${fmtBytes(info.quota)} available to the app.` : 'Storage info unavailable.'),
    h('p', { class: 'hint' }, 'Your videos, photos and projects stay on this device — nothing is uploaded.'));
  if (info && !info.persisted && navigator.storage?.persist) st.append(btn('Keep my files safe from cleanup', 'check', async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Storage protected' : 'Install the app to protect storage'); showSettings(); }, 'ghost'));
  body.append(st);
  if (S.installPrompt) body.append(section('Install', btn('Add S1 Studio to home screen', 'download', async () => { S.installPrompt.prompt(); S.installPrompt = null; }, 'primary block')));
}

// ---------------------------------------------------------------- wiring
$('#newVideo').onclick = () => createProject('video');
$('#newPhoto').onclick = () => createProject('photo');
$('#openLibrary').onclick = () => go('#library');
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
$('#edBack').onclick = () => go('#home');
$('#playBtn').onclick = () => engine.toggle();
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#exportBtn').onclick = exportFlow;
$('#projName').addEventListener('change', e => { if (S.project) { S.project.name = e.target.value.trim() || S.project.name; saveProject(); } });
$('#libImport').onclick = async () => {
  const files = await pickFiles('video/*,image/*,audio/*', true);
  if (!files.length) return;
  const folder = ['all', 'root'].includes(S.lib.folder) ? null : S.lib.folder;
  const recs = await importFiles(files, folder);
  if (recs.length) toast(`Imported ${recs.length} item${recs.length > 1 ? 's' : ''}`);
  showLibrary();
};
$('#selectBtn').onclick = () => { if (S.lib.selecting) endSelect(); else { S.lib.selecting = true; updateSelBar(); } };
$('#kindBar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.lib.kind = b.dataset.kind; showLibrary(); } });
$('#selBar').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const recs = selectedRecs();
  if (!recs.length) return;
  if (b.dataset.act === 'share') await shareFiles(recs);
  if (b.dataset.act === 'save') for (const r of recs) await saveToDevice(r.blob, fileNameFor(r));
  if (b.dataset.act === 'move') moveTo(recs);
  if (b.dataset.act === 'delete' && await deleteMedia(recs)) endSelect();
});
// Drop files onto the window to import them (desktop).
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault();
  if (!e.dataTransfer?.files?.length) return;
  const recs = await importFiles(e.dataTransfer.files);
  toast(`Imported ${recs.length} item${recs.length === 1 ? '' : 's'}`);
  if (S.project) { recs.forEach(r => media.set(r.id, r)); const vis = recs.filter(r => r.kind !== 'audio'); if (vis.length) commit(() => S.project.clips.push(...vis.map(newClip))); for (const r of recs.filter(r => r.kind === 'audio')) addAudio(r); }
  else if (document.body.dataset.screen === 'library') showLibrary();
});
window.addEventListener('keydown', e => {
  if (!S.project || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); engine.toggle(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if (e.key === 'Escape') closePanel();
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; });
window.addEventListener('pagehide', () => saveProject.flush());
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveProject.flush(); if (!engine.exportTarget) engine.pause(); } });

// ---------------------------------------------------------------- boot
(async function boot() {
  S.prefs = { ...DEFAULT_PREFS, ...(await db.get('settings', 'prefs') || {}) };
  await applyTheme();
  const params = new URLSearchParams(location.search);
  const shared = await finishPendingImports();
  if (params.has('shared')) {
    history.replaceState(null, '', location.pathname + '#library');
    S.lib.folder = 'shared';
    toast(`${params.get('shared') || shared} file(s) received`);
  }
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
