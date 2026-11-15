import { db, uid } from './db.js';
import { Engine, ASPECTS, TRANSITIONS, layout, totalDuration, clipDuration, audioDuration, mediaRecord, forgetMedia, pickRecorderMime } from './engine.js';
import { PRESETS, ADJUST_KEYS, filterer, uniformsFor, analyzeFrame } from './gl.js';
import { ic } from './icons.js';
import { TOOL_WORDS, SETTINGS_WORDS, score, clipWorker, embedImage, embedText, dot, detectFaces, loadPeople, savePeople, assignPerson, frameCanvas, videoMoments, framesAt, meanVec, AI_INDEX_VERSION } from './search.js';
import { askClaudeJSON, testKey, imageBlock, reelSchema, editSchema, refSchema } from './claude.js';
import { PORTRAIT_MODES, portraitActive, segKind, segmenterReady, segmenterInfo, loadSegmenter, upscale, cancelUpscale } from './ai.js';
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
const TEXT_COLORS = ['#ffffff', '#000000', '#3d8bff', '#ff6fb5', '#ffa06a', '#ffd36a', '#7cf2b0', '#5ab0ff', '#b48cff', '#ff4d4d'];
const STICKERS = '🔥 ✨ 💖 😍 😂 😎 🥹 🙌 👀 💯 🎧 🎶 🎵 🎤 🪩 🕺 💃 🎉 🍾 🥂 📸 🎬 ⚡ 💥 🌙 ⭐ 🌈 🌸 🌴 🌊 ☀️ 🌆 🏙️ 🚀 ❤️ 💜 💙 🖤 🤍 👑 💎 🦋 📍 ✅ ‼️ ❓ 💬 👉 👈 ⬆️ 🔊'.split(' ');

export const THEMES = [
  { id: 'blueblack', name: 'Blue & Black', bg: 'radial-gradient(130% 60% at 50% -10%,#0d3a8a88,transparent 60%),radial-gradient(90% 50% at 100% 110%,#0a2a6644,transparent 60%),#000' },
  { id: 'dusk', name: 'Dusk', bg: 'linear-gradient(165deg,#1c1838 0%,#35204a 45%,#6e2e52 85%,#c25a5a 120%)' },
  { id: 'midnight', name: 'Midnight', bg: '#0b0b12' },
  { id: 'neon', name: 'Neon', bg: 'radial-gradient(120% 70% at 0% 0%,#ff6fb544,transparent 60%),radial-gradient(100% 60% at 100% 100%,#5ab0ff40,transparent 60%),#0d0b1c' },
  { id: 'ocean', name: 'Ocean', bg: 'linear-gradient(165deg,#061826,#0d3b5a 60%,#1f7a8c 120%)' },
  { id: 'sunset', name: 'Sunset', bg: 'linear-gradient(170deg,#2a0f2e,#8a2f4f 60%,#ff9a5a 130%)' },
  { id: 'forest', name: 'Forest', bg: 'linear-gradient(165deg,#09160f,#16352a 60%,#3d6b4f 130%)' },
  { id: 'graphite', name: 'Graphite', bg: 'linear-gradient(180deg,#1c1c20,#0e0e10)' },
  { id: 'aurora', name: 'Aurora', bg: 'radial-gradient(90% 60% at 20% 10%,#7cf2b033,transparent 60%),radial-gradient(90% 60% at 90% 40%,#b48cff3a,transparent 60%),radial-gradient(90% 60% at 30% 100%,#5ab0ff30,transparent 60%),#0a0d18' },
];
const ACCENTS = ['#3d8bff', '#5ab0ff', '#7cf2b0', '#ffd36a', '#ffa06a', '#ff6fb5', '#b48cff', '#ffffff'];
const DEFAULT_PREFS = {
  id: 'prefs', v: 2, theme: 'blueblack', accent: '#3d8bff', customBg: null, customColor: null, panels: 'glass', dim: 35, exportRes: 1080, fps: 30,
  gradient: { a: '#000000', b: '#1e5eff', angle: 160 }, textColor: '#f6f3fb', uiFont: 'Space Grotesk', panelColor: '#05070d', panelAlpha: 70,
  myThemes: [], tools: { order: null, hidden: [] }, aiSearch: false, dest: null, claudeKey: null,
};

const canvas = $('#preview');
const engine = new Engine(canvas, $('#hidden-media'));
const tl = $('#timeline');

// ---------------------------------------------------------------- theme
const UI_FONTS = ['Space Grotesk', 'Montserrat', 'System', 'Playfair Display', 'Bebas Neue', 'Caveat', 'Permanent Marker', 'Anton'];
const TEXT_TONES = ['#f6f3fb', '#ffffff', '#fff1e0', '#ffd9ec', '#d9fff0', '#dcecff', '#ffe9a8'];
const PANEL_TONES = ['#05070d', '#000000', '#120f1e', '#1b1b22', '#2a1430', '#0c1d2b', '#10231a', '#2b1a10'];
const hexRgb = hx => { const v = parseInt((hx || '#000').slice(1).padEnd(6, '0'), 16); return `${v >> 16 & 255},${v >> 8 & 255},${v & 255}`; };
async function applyTheme() {
  const p = S.prefs;
  const root = document.documentElement;
  let bg = (THEMES.find(t => t.id === p.theme) || THEMES[0]).bg;
  if (p.theme === 'color' && p.customColor) bg = p.customColor;
  if (p.theme === 'gradient' && p.gradient) bg = `linear-gradient(${p.gradient.angle}deg, ${p.gradient.a}, ${p.gradient.b})`;
  if (p.theme === 'image' && p.customBg) {
    const m = await mediaRecord(p.customBg);
    if (m) bg = `linear-gradient(rgba(5,4,12,${p.dim / 100}),rgba(5,4,12,${Math.min(0.95, p.dim / 100 + 0.15)})),url("${m.url}") center/cover no-repeat`;
  }
  root.style.setProperty('--app-bg', bg);
  root.style.setProperty('--accent', p.accent);
  root.style.setProperty('--text', p.textColor);
  root.style.setProperty('--muted', `color-mix(in srgb, ${p.textColor} 64%, transparent)`);
  root.style.setProperty('--ui', p.uiFont === 'System' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : `"${p.uiFont}", system-ui, sans-serif`);
  const rgb = hexRgb(p.panelColor), a = p.panelAlpha / 100;
  root.style.setProperty('--panel', `rgba(${rgb},${a})`);
  root.style.setProperty('--panel-strong', `rgba(${rgb},${Math.min(0.97, a + 0.2)})`);
  root.style.setProperty('--sheet', `rgba(${rgb},${Math.min(0.97, a + 0.28)})`);
  root.style.setProperty('--panel-solid', p.panelColor);
  document.body.classList.toggle('solid-panels', p.panels === 'solid');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', p.panelColor);
}
const LOOK_KEYS = ['theme', 'customBg', 'customColor', 'gradient', 'dim', 'accent', 'textColor', 'uiFont', 'panelColor', 'panelAlpha', 'panels'];
const savePrefs = debounce(() => db.put('settings', S.prefs), 300);

// ---------------------------------------------------------------- routing
function show(id) {
  for (const s of $$('.screen')) s.hidden = s.id !== id;
  document.body.dataset.screen = id;
}
async function route() {
  const [scr, arg] = location.hash.slice(1).split('/');
  if (scr !== 'editor' && S.project) await closeEditor();
  if (scr === 'editor' && arg) return openEditor(arg);
  if (scr === 'library') return showLibrary();
  if (scr === 'settings') return showSettings();
  if (scr === 'create') return showCreate();
  if (scr === 'refs') return showRefs();
  if (scr === 'ref' && arg) return showRef(arg);
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
    const img = p.poster || (first ? thumbOf(first.mediaId) : '');
    grid.append(h('div', { class: 'proj' },
      h('button', { class: 'proj-thumb', onclick: () => go('#editor/' + p.id), 'aria-label': 'Open ' + p.name },
        img ? h('span', { class: 'proj-blur', style: { backgroundImage: `url(${img})` } }) : null,
        img ? h('img', { class: 'proj-poster', src: img, alt: '' }) : null,
        h('span', { class: 'proj-kind', html: ic(p.kind === 'photo' ? 'image' : 'video') }),
        p.kind !== 'photo' ? h('span', { class: 'badge' }, fmtShort(dur)) : null),
      p.clips.length ? h('button', { class: 'proj-play', 'aria-label': 'Preview ' + p.name, html: ic('play'), onclick: () => previewProject(p) }) : null,
      h('div', { class: 'proj-meta' },
        h('div', {}, h('div', { class: 'proj-name' }, p.name), h('div', { class: 'proj-date' }, new Date(p.updated).toLocaleDateString())),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Project options', html: ic('more'), onclick: () => projectMenu(p) }))));
  }
}

// Watch a project from the main menu without opening the editor.
let previewEngine = null;
function previewProject(p) {
  previewEngine ||= new Engine(document.createElement('canvas'), $('#hidden-media'));
  const pe = previewEngine;
  openSheet(p.name, async (b, close) => {
    const cv = pe.canvas;
    cv.className = 'preview-canvas';
    const stage = h('div', { class: 'preview-stage' }, cv);
    const playB = h('button', { class: 'play', 'aria-label': 'Play', html: ic('play'), onclick: () => pe.toggle() });
    const time = h('span', { class: 'tc' });
    const bar = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'preview-bar', 'aria-label': 'Position' });
    const isVideo = p.kind !== 'photo';
    b.append(stage,
      isVideo ? h('div', { class: 'preview-controls' }, playB, bar, time) : null,
      h('div', { class: 'row-btns' },
        btn('Edit', 'edit', () => { close(); go('#editor/' + p.id); }, 'ghost'),
        btn(isVideo ? 'Export' : 'Save', 'download', () => { close(); S.exportAfterOpen = true; go('#editor/' + p.id); }, 'primary')));
    await pe.load(structuredClone(p));
    const fit = () => {
      const ar = pe.aspect();
      const maxW = stage.clientWidth || 320, maxH = Math.min(window.innerHeight * 0.58, 560);
      let w = maxW, hh = w / ar;
      if (hh > maxH) { hh = maxH; w = hh * ar; }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.style.width = w + 'px'; cv.style.height = hh + 'px';
      cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
      pe.requestRender();
    };
    fit();
    const paint = t => {
      time.textContent = `${fmtTime(t)} / ${fmtTime(pe.total)}`;
      bar.value = pe.total ? Math.round(t / pe.total * 1000) : 0;
      const pct = bar.value / 10;
      bar.style.setProperty('--a', '0%'); bar.style.setProperty('--b', pct + '%');
    };
    pe.onTime = paint;
    pe.onPlayState = on => { playB.innerHTML = ic(on ? 'pause' : 'play'); playB.setAttribute('aria-label', on ? 'Pause' : 'Play'); };
    bar.addEventListener('input', () => { pe.seek(bar.value / 1000 * pe.total); paint(pe.t); });
    cv.addEventListener('click', () => isVideo && pe.toggle());
    paint(0);
    if (isVideo) { await pe.waitReady(0, 1500); pe.play(); }
  }, {
    wide: true,
    onClose: () => { pe.pause(); pe.onTime = null; pe.onPlayState = null; pe.load({ clips: [], texts: [], audio: [] }); },
  });
}

function projectMenu(p) {
  openSheet(p.name, (b, close) => {
    b.append(h('div', { class: 'menu' },
      p.clips.length ? h('button', { onclick: () => { close(); previewProject(p); }, html: ic('play') + 'Preview' }) : null,
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
          runIndexer();
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
  if (S.exportAfterOpen) { S.exportAfterOpen = false; setTimeout(exportFlow, 300); }
}
// A small rendered frame of the edit (filters, text, canvas shape) for the project card.
async function makePoster() {
  const p = S.project;
  if (!p?.clips.length) { if (p) { p.poster = null; } return; }
  try {
    const t = p.kind === 'photo' ? 0 : Math.min(engine.total * 0.3, 2);
    engine.seek(t);
    await engine.waitReady(t, 1500);
    const { W, H } = engine.outputSize(320);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    engine.renderFrame(c.getContext('2d'), W, H, t, false);
    p.poster = c.toDataURL('image/jpeg', 0.78);
    p.posterAR = W / H;
  } catch { }
}
async function closeEditor() {
  engine.pause();
  await makePoster();
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
      c.filter && c.filter !== 'none' ? h('span', { class: 'badge fx', html: ic('filter') }) : null,
      portraitActive(c) ? h('span', { class: 'badge ai', html: ic('wand') }) : null));
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
  { id: 'claude', label: 'Ask Claude', icon: 'chat', fn: askClaudePanel, hot: true },
  { id: 'ai', label: 'AI', icon: 'wand', fn: aiPanel, hot: true },
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
function orderedTools() {
  const known = TOOLS.map(t => t.id);
  const ord = (S.prefs.tools?.order || []).filter(id => known.includes(id));
  return [...ord, ...known.filter(id => !ord.includes(id))].map(id => TOOLS.find(t => t.id === id));
}
function renderTools() {
  const bar = $('#tools');
  bar.innerHTML = '';
  if (!S.project) return;
  const photo = S.project.kind === 'photo';
  const hidden = new Set(S.prefs.tools?.hidden || []);
  for (const t of orderedTools()) {
    if ((photo && t.video) || hidden.has(t.id)) continue;
    const b = h('button', { class: 'tool' + (t.hot ? ' hot' : ''), onclick: () => { if (b._long) { b._long = false; return; } engine.pause(); t.fn(); } }, h('span', { html: ic(t.icon) }), t.label);
    let timer;
    b.addEventListener('pointerdown', () => { timer = setTimeout(() => { b._long = true; toolbarSheet(); }, 550); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
    b.addEventListener('contextmenu', e => e.preventDefault());
    bar.append(b);
  }
  bar.append(h('button', { class: 'tool edit-tools', onclick: toolbarSheet }, h('span', { html: ic('settings') }), 'Customize'));
}
function toolbarSheet() {
  S.prefs.tools ||= { order: null, hidden: [] };
  openSheet('Customize toolbar', (b, close) => {
    const list = h('div', { class: 'tool-list' });
    const save = () => {
      S.prefs.tools.order = $$('.tool-row', list).map(r => r.dataset.id);
      savePrefs(); renderTools();
    };
    const paint = () => {
      list.innerHTML = '';
      const hidden = new Set(S.prefs.tools.hidden);
      for (const t of orderedTools()) {
        const handle = h('span', { class: 'handle', 'aria-label': 'Drag to move', html: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 8h16M4 12h16M4 16h16"/></svg>' });
        const row = h('div', { class: 'tool-row' + (hidden.has(t.id) ? ' off' : ''), 'data-id': t.id },
          handle, h('span', { class: 'tr-ic', html: ic(t.icon) }), h('span', { class: 'tr-name' }, t.label, t.video ? h('small', {}, ' · video') : null),
          h('label', { class: 'toggle' }, Object.assign(h('input', { type: 'checkbox' }), {
            checked: !hidden.has(t.id),
            onchange: e => {
              const set = new Set(S.prefs.tools.hidden);
              e.target.checked ? set.delete(t.id) : set.add(t.id);
              S.prefs.tools.hidden = [...set]; row.classList.toggle('off', !e.target.checked); save();
            },
          }), h('i')));
        // Drag the handle up/down to reorder.
        handle.addEventListener('pointerdown', e => {
          e.preventDefault();
          handle.setPointerCapture(e.pointerId);
          row.classList.add('dragging');
          const move = ev => {
            const prev = row.previousElementSibling, next = row.nextElementSibling;
            if (next && ev.clientY > next.getBoundingClientRect().top + next.offsetHeight / 2) list.insertBefore(next, row);
            else if (prev && ev.clientY < prev.getBoundingClientRect().top + prev.offsetHeight / 2) list.insertBefore(prev, row.nextSibling); // move the neighbour, not the dragged row, so the drag isn't dropped
          };
          const up = () => { row.classList.remove('dragging'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); save(); };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', up);
          handle.addEventListener('pointercancel', up);
        });
        list.append(row);
      }
    };
    paint();
    b.append(h('p', { class: 'hint' }, 'Drag ≡ to move a tool. Switch tools off to hide them.'), list,
      btn('Reset toolbar', 'reset', () => { S.prefs.tools = { order: null, hidden: [] }; savePrefs(); renderTools(); paint(); }, 'ghost block'));
  });
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

const GRADIENTS = [['#000000', '#1e5eff'], ['#ff6fb5', '#5ab0ff'], ['#ffa06a', '#ff6fb5'], ['#1c1838', '#ff6fb5'], ['#0d0b1c', '#5ab0ff'], ['#7cf2b0', '#5ab0ff'], ['#ffd36a', '#ff4d4d'], ['#b48cff', '#1c1838'], ['#111111', '#444444']];
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


// ---- AI: portrait segmentation + upscale/restore
function aiPanel() {
  const c = target();
  if (!c) return;
  openPanel('AI', b => {
    c.ai ||= { mode: 'none', amount: 60, light: 0 };
    const kind = segKind(c);
    const status = h('p', { class: 'hint' });
    const ensure = () => {
      if (segmenterReady(kind)) { status.textContent = 'AI finds the person in every frame — no green screen needed.'; return; }
      status.textContent = `Loading the AI model (${segmenterInfo(kind).label}, first time only)…`;
      loadSegmenter(kind)
        .then(() => { status.textContent = 'AI ready — it finds the person in every frame.'; live(); })
        .catch(() => { status.textContent = 'Couldn’t load the AI model. Check your connection and try again.'; });
    };
    const extra = h('div');
    const renderExtra = () => {
      extra.innerHTML = '';
      const m = c.ai.mode;
      if (m === 'blur' || m === 'spotlight') extra.append(slider({ label: m === 'blur' ? 'Blur' : 'Dim', min: 0, max: 100, value: c.ai.amount ?? 60, onInput: v => { c.ai.amount = v; live(); } }));
      if (m === 'color') extra.append(swatches(BG_COLORS, c.ai.color, v => { c.ai.color = v; live(); }));
      if (m === 'image') extra.append(btn(c.ai.mediaId ? 'Change background image' : 'Choose background image', 'image', async () => {
        const [img] = await pickMedia({ kinds: ['image'], multiple: false, title: 'Background image' });
        if (img) { c.ai.mediaId = img.id; await engine.sync(); live(); renderExtra(); }
      }, 'ghost block'));
      if (m === 'cutout') extra.append(h('p', { class: 'hint' }, S.project.kind === 'photo'
        ? 'Save as PNG for a transparent cut-out. In the editor, your Canvas background shows behind you.'
        : 'Your Canvas background (color, gradient or image) shows behind you.'), btn('Change background', 'bg', bgPanel, 'ghost block'));
    };
    b.append(section('AI Portrait',
      chips(PORTRAIT_MODES, c.ai.mode || 'none', v => { c.ai.mode = v; if (v !== 'none') ensure(); live(); renderExtra(); renderTimeline(); }),
      extra,
      slider({ label: 'Light on you', min: -50, max: 100, value: c.ai.light || 0, center: 0, onInput: v => { c.ai.light = v; if (v) ensure(); live(); } }),
      status,
      applyAllBtn(x => { x.ai = { ...c.ai }; }, 'Use for all clips')));
    renderExtra();
    if (portraitActive(c)) ensure();
    else status.textContent = 'Blur, dim or replace the background behind people — works on video too.';
    b.append(section('AI Upscale & Restore',
      h('p', { class: 'hint' }, c.type === 'image'
        ? 'Rebuilds detail at 4× the size and cleans up noise, blur and JPEG blockiness. Best on small, soft or older photos.'
        : 'Photos only for now — upscaling every video frame takes more power than a phone has. For video, use Enhance and the Sharpen slider.'),
      c.type === 'image' ? btn('Upscale this photo', 'wand', () => upscaleClip(c), 'primary block') : null));
    b.append(section('Auto Enhance', btn('Balance light, color & sharpness', 'enhance', () => { closePanel(); enhanceTool(); }, 'ghost block')));
  });
}

async function upscaleClip(c) {
  const rec = await runUpscale(media.get(c.mediaId));
  if (!rec) return;
  commit(() => { c.mediaId = rec.id; });
  await engine.sync();
  lastCanvasKey = ''; fitCanvas();
  toast(`✨ Upscaled to ${rec.w}×${rec.h}`, { label: 'Undo', fn: undo });
}

function runUpscale(m) {
  return new Promise(resolve => {
    let finished = false;
    const end = (rec, close) => { finished = true; resolve(rec); close(); };
    openSheet('AI Upscale & Restore', (b, close) => {
      const big = Math.max(m.w || 1, m.h || 1);
      let maxIn = 512;
      const outTxt = h('p', { class: 'hint' });
      const upd = () => {
        const k = Math.min(1, maxIn / big);
        const ow = Math.round(m.w * k) * 4, oh = Math.round(m.h * k) * 4;
        outTxt.textContent = `Your photo: ${m.w}×${m.h} → about ${ow}×${oh}.` + (ow * oh < (m.w * m.h) * 0.9 ? ' Your photo is already big, so it comes out smaller but with restored detail — the original stays in your Library.' : '');
      };
      upd();
      const opts = h('div', {},
        chips([{ id: 384, label: 'Quick' }, { id: 512, label: 'Standard' }, { id: 768, label: 'Max detail' }], maxIn, v => { maxIn = v; upd(); }),
        outTxt,
        h('p', { class: 'hint' }, 'Runs on your phone. The first time it downloads the AI model (about 50 MB, use Wi-Fi). Newer phones take seconds; older ones a minute or two.'),
        btn('Start', 'wand', start, 'primary block'));
      b.append(opts);
      async function start() {
        opts.remove();
        const pct = h('div', { class: 'progress-pct' }, '0%');
        const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
        const msg = h('p', { class: 'hint center' }, 'Starting AI…');
        b.append(h('div', { class: 'exporting' }, pct, bar, msg, btn('Cancel', 'close', () => { cancelUpscale(); end(null, close); }, 'ghost block')));
        const set = (v, text) => { pct.textContent = Math.round(v) + '%'; bar.firstChild.style.width = v + '%'; msg.textContent = text; };
        try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { }
        try {
          const blob = await upscale(m.blob, {
            maxIn, onStatus: st => {
              if (st.phase === 'download' && st.total) set(st.loaded / st.total * 100, `Downloading AI model… ${fmtBytes(st.loaded)} of ${fmtBytes(st.total)} (first time only)`);
              if (st.phase === 'run') set(st.done / st.total * 100, `Restoring detail… ${st.done}/${st.total} · ${st.device === 'webgpu' ? 'GPU' : 'CPU'}`);
            },
          });
          set(100, 'Saving…');
          const rec = await importBlob(blob, `${m.name.replace(/\.[^.]+$/, '')} (AI 4x).jpg`, m.folder);
          if (rec) media.set(rec.id, rec);
          end(rec, close);
        } catch (e) {
          if (!finished) { toast(e.message === 'cancelled' ? 'Cancelled' : 'AI upscale failed: ' + e.message); end(null, close); }
        } finally { wakeLock?.release?.(); wakeLock = null; }
      }
    }, { onClose: () => { if (!finished) { finished = true; cancelUpscale(); resolve(null); } } });
  });
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
// Where the video is going decides the best size, frame rate and quality.
const DESTS = [
  { id: 'youtube', name: 'YouTube', sub: 'Long video · 16:9', aspect: '16:9', res: 2160, fps: 30, mbps: { 720: 6, 1080: 12, 1440: 20, 2160: 40 },
    note: 'YouTube re-encodes every upload. Sending 4K gets you their best-quality stream, even for people watching in 1080p.' },
  { id: 'shorts', name: 'YouTube Shorts', sub: 'Vertical · 9:16', aspect: '9:16', res: 2160, fps: 30, max: 180, mbps: { 720: 6, 1080: 12, 1440: 20, 2160: 40 },
    note: 'Shorts can be up to 3 minutes. 4K vertical uploads keep the most detail.' },
  { id: 'reels', name: 'Instagram Reels', sub: 'Vertical · 9:16', aspect: '9:16', res: 1080, fps: 30, max: 180, mbps: { 720: 8, 1080: 14, 1440: 20, 2160: 30 },
    note: 'Instagram plays everything at 1080p, so a 4K upload only gets shrunk. 1080p at a high bitrate looks sharpest. Keep text away from the bottom, where the caption sits.' },
  { id: 'igpost', name: 'Instagram post', sub: 'Feed · 4:5', aspect: '4:5', res: 1080, fps: 30, mbps: { 720: 8, 1080: 14, 1440: 20, 2160: 30 },
    note: '4:5 takes up the most room in the feed. Instagram shows it at 1080 wide.' },
  { id: 'story', name: 'Instagram Story', sub: 'Full screen · 9:16', aspect: '9:16', res: 1080, fps: 30, max: 60, mbps: { 720: 8, 1080: 14, 1440: 20, 2160: 30 },
    note: 'Stories longer than 60 seconds are split into parts. Leave room at the top and bottom for the reply bar.' },
  { id: 'tiktok', name: 'TikTok', sub: 'Vertical · 9:16', aspect: '9:16', res: 1080, fps: 30, max: 600, mbps: { 720: 8, 1080: 14, 1440: 20, 2160: 30 },
    note: 'TikTok plays at 1080p. Keep faces and text away from the right side and bottom, where the buttons and caption go.' },
  { id: 'custom', name: 'Just save it', sub: 'Pick your own', aspect: null, res: null, fps: null, mbps: { 720: 8, 1080: 14, 1440: 20, 2160: 40 }, note: 'Choose any size. 4K takes the most power.' },
];
const RES = [{ id: 720, label: '720p' }, { id: 1080, label: '1080p' }, { id: 1440, label: '2K' }, { id: 2160, label: '4K' }];

async function exportFlow() {
  const p = S.project;
  engine.pause(); closePanel();
  if (!p.clips.length) return toast('Add a video or photo first');
  saveProject.flush();
  if (p.kind === 'photo') return exportPhoto();
  const prefs = S.prefs;
  openSheet('Where’s this going?', (b, close) => {
    const pickDest = () => {
      b.innerHTML = '';
      const grid = h('div', { class: 'dests' });
      for (const d of DESTS) grid.append(h('button', { class: 'dest' + (prefs.dest === d.id ? ' on' : ''), onclick: () => { prefs.dest = d.id; savePrefs(); settings(d); } },
        h('b', {}, d.name), h('small', {}, d.sub)));
      b.append(grid);
    };
    const settings = d => {
      b.innerHTML = '';
      const rec = { res: d.res || prefs.exportRes, fps: d.fps || prefs.fps };
      let res = rec.res, fps = rec.fps, switchAspect = !!d.aspect && p.aspect !== d.aspect;
      const card = h('div', { class: 'rec-card' });
      const paintCard = () => {
        const { W, H } = sizeFor(res);
        const mb = d.mbps[res];
        card.innerHTML = '';
        card.append(h('div', { class: 'rec-title', html: ic('wand') + `Best for ${d.name}` }),
          h('div', { class: 'rec-specs' },
            spec('Size', `${W}×${H}`), spec('Shape', switchAspect ? d.aspect : (p.aspect === 'orig' ? 'Original' : p.aspect)),
            spec('Frames', `${fps} fps`), spec('Quality', `${mb} Mbps`), spec('Format', (pickRecorderMime() || 'webm').includes('mp4') ? 'MP4' : 'WebM')));
      };
      const spec = (k, v) => h('div', {}, h('small', {}, k), h('b', {}, v));
      const sizeFor = r => {
        if (!switchAspect) return engine.outputSize(r);
        const keep = p.aspect; p.aspect = d.aspect; const o = engine.outputSize(r); p.aspect = keep; return o;
      };
      const warn = h('div');
      const paintWarn = () => {
        warn.innerHTML = '';
        if (d.max && engine.total > d.max) warn.append(h('p', { class: 'hint warn' }, `Your video is ${fmtShort(engine.total)} — ${d.name} allows up to ${fmtShort(d.max)}. Trim it, or it may be cut or split.`));
        if (res > 1080 && ['reels', 'igpost', 'story', 'tiktok'].includes(d.id)) warn.append(h('p', { class: 'hint warn' }, `${d.name.split(' ')[0]} converts every upload to 1080p, so ${res >= 2160 ? '4K' : '2K'} won’t look sharper there — the extra shrinking can even soften it. 1080p ★ is the sharpest choice.`));
        if (res >= 2160) warn.append(h('p', { class: 'hint' }, '4K takes the most power and space. On older phones the export can stutter. If it does, use 2K.'));
      };
      const mark = r => r === rec.res ? ' ★' : '';
      b.append(h('button', { class: 'link-btn', onclick: pickDest }, '← Change destination'), card,
        d.aspect && p.aspect !== d.aspect ? h('label', { class: 'switch-row' },
          Object.assign(h('input', { type: 'checkbox' }), { checked: switchAspect, onchange: e => { switchAspect = e.target.checked; paintCard(); } }),
          h('span', {}, `Change the canvas to ${d.aspect} (recommended — right now it’s ${p.aspect === 'orig' ? 'Original' : p.aspect})`)) : null,
        section('Resolution', chips(RES.map(r => ({ ...r, label: r.label + mark(r.id) })), res, v => { res = v; paintCard(); paintWarn(); })),
        section('Frame rate', chips([24, 30, 60].map(v => ({ id: v, label: v + ' fps' + (v === rec.fps && d.fps ? ' ★' : '') })), fps, v => { fps = v; paintCard(); })),
        h('p', { class: 'hint' }, d.note), warn,
        h('p', { class: 'hint' }, 'Exporting plays your video through once in real time. Keep this screen open until it finishes.'),
        btn(`Export for ${d.name}`, 'download', () => start(d, res, fps, switchAspect), 'primary block'));
      paintCard(); paintWarn();
    };
    async function start(d, res, fps, switchAspect) {
      if (switchAspect) { commit(() => { p.aspect = d.aspect; }); await new Promise(r => setTimeout(r, 50)); }
      prefs.exportRes = res; prefs.fps = fps; savePrefs();
      b.innerHTML = '';
      const prog = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
      const pct = h('div', { class: 'progress-pct' }, '0%');
      b.append(h('div', { class: 'exporting' }, pct, prog, h('p', { class: 'hint center' }, `Rendering for ${d.name}… keep the app open`), btn('Cancel', 'close', () => engine.cancelExport(), 'ghost block')));
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { }
      let blob = null;
      try {
        blob = await engine.exportVideo({
          short: res, fps, bitrate: d.mbps[res] * 1e6,
          onProgress: f => { const v = Math.min(100, Math.round(f * 100)); pct.textContent = v + '%'; prog.firstChild.style.width = v + '%'; },
        });
      } catch (e) { toast('Export failed: ' + e.message); }
      wakeLock?.release?.(); wakeLock = null;
      b.innerHTML = '';
      if (!blob) { close(); return; }
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const r = await importBlob(blob, `${p.name.replace(/[\\/:*?"<>|]/g, '-')}${d.id === 'custom' ? '' : ' - ' + d.name}.${ext}`, 'exports');
      showResult(b, r || { blob, name: `${p.name}.${ext}`, mime: blob.type }, close, d);
    }
    const last = DESTS.find(d => d.id === prefs.dest);
    if (last) settings(last); else pickDest();
  });
}
const PHOTO_DESTS = [
  { id: 'orig', name: 'Full quality', sub: 'Original size & shape', aspect: null, short: null },
  { id: 'igpost', name: 'Instagram post', sub: '4:5 · 1080×1350', aspect: '4:5', short: 1080, note: '4:5 shows biggest in the feed. Instagram shrinks anything over 1080 wide, so this is the sharpest size.' },
  { id: 'igsquare', name: 'Instagram square', sub: '1:1 · 1080×1080', aspect: '1:1', short: 1080 },
  { id: 'story', name: 'Story / Reel cover', sub: '9:16 · 1080×1920', aspect: '9:16', short: 1080, note: 'Keep text away from the very top and bottom — the app’s buttons cover them.' },
  { id: 'ytthumb', name: 'YouTube thumbnail', sub: '16:9 · 1280×720', aspect: '16:9', short: 720, note: 'YouTube needs thumbnails under 2 MB — saved as JPG to stay small.', fmt: 'image/jpeg', maxBytes: 2e6 },
  { id: 'print', name: 'Print / portfolio', sub: 'Full size · PNG', aspect: null, short: null, fmt: 'image/png' },
];
async function exportPhoto() {
  const p = S.project;
  const m = media.get(p.clips[0].mediaId);
  const native = Math.min(4096, Math.min(m?.w || 2160, m?.h || 2160));
  const cut = p.clips[0].ai?.mode === 'cutout';
  openSheet('Where’s this going?', (b, close) => {
    const pick = () => {
      b.innerHTML = '';
      b.append(h('div', { class: 'dests' }, ...PHOTO_DESTS.map(d => h('button', { class: 'dest', onclick: () => opts(d) }, h('b', {}, d.name), h('small', {}, d.sub)))));
    };
    const opts = d => {
      b.innerHTML = '';
      let fmt = d.fmt || (cut ? 'image/png' : 'image/jpeg');
      let switchAspect = !!d.aspect && p.aspect !== d.aspect;
      const shapeName = a => a === 'orig' ? 'Original' : a;
      b.append(h('button', { class: 'link-btn', onclick: pick }, '← Change destination'),
        h('div', { class: 'rec-card' }, h('div', { class: 'rec-title', html: ic('wand') }, `Best for ${d.name}`), h('p', { class: 'hint' }, d.sub + (d.note ? ' — ' + d.note : ''))),
        d.aspect && p.aspect !== d.aspect ? h('label', { class: 'switch-row' },
          Object.assign(h('input', { type: 'checkbox' }), { checked: true, onchange: e => { switchAspect = e.target.checked; } }),
          h('span', {}, `Crop the canvas to ${d.aspect} (right now it’s ${shapeName(p.aspect)}). You can move the photo inside the frame with Position.`)) : null,
        d.fmt ? null : section('Format', chips([{ id: 'image/jpeg', label: 'JPG (smaller)' }, { id: 'image/png', label: cut ? 'PNG (transparent)' : 'PNG (best quality)' }], fmt, v => { fmt = v; })),
        btn('Save', 'download', async () => {
          if (switchAspect) commit(() => { p.aspect = d.aspect; });
          b.innerHTML = '<p class="hint center">Rendering…</p>';
          const short = d.short || native;
          let blob = await engine.exportImage(short, fmt, 0.95, cut && fmt === 'image/png');
          if (d.maxBytes && blob.size > d.maxBytes) blob = await engine.exportImage(short, 'image/jpeg', 0.82);
          const r = await importBlob(blob, `${p.name.replace(/[\\/:*?"<>|]/g, '-')}${d.id === 'orig' ? '' : ' - ' + d.name}.${fmt === 'image/png' ? 'png' : 'jpg'}`, 'exports');
          b.innerHTML = '';
          showResult(b, r, close, d);
        }, 'primary block'));
    };
    pick();
  });
}
function showResult(b, r, close, dest) {
  const url = URL.createObjectURL(r.blob);
  const isVid = (r.mime || r.blob.type).startsWith('video');
  b.append(h('div', { class: 'result' },
    isVid ? h('video', { src: url, controls: true, playsinline: true, class: 'result-media' }) : h('img', { src: url, class: 'result-media', alt: 'Exported image' }),
    h('p', { class: 'hint center' }, `Saved in Library → Exports · ${fmtBytes(r.blob.size)}`),
    h('div', { class: 'row-btns' },
      btn('Share', 'share', () => shareFiles([r]), 'primary'),
      btn('Save to phone', 'download', () => saveToDevice(r.blob, fileNameFor(r)), 'ghost')),
    h('div', { class: 'save-help' },
      h('p', {}, h('b', {}, 'Share'), ' — ', canShareFiles()
        ? (dest && /youtube|shorts|reels|igpost|igsquare|story|tiktok|ytthumb/.test(dest.id) ? `pick ${dest.name.split(' ')[0]} to post it, or Quick Share, Messages, Google Drive, Google Photos…` : 'post to Instagram/TikTok/YouTube, or send with Quick Share, Messages, Google Drive, Google Photos…')
        : 'not available in this browser — use Save.'),
      h('p', {}, h('b', {}, 'Save to phone'), ' — ', /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'goes to your Downloads folder (then it shows in your Gallery/Files).' : 'choose the folder to save it in.'),
      h('p', {}, h('b', {}, 'Library'), ' — it’s already kept in this app under Exports.')),
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
  const peopleRow = $('#libPeople');
  peopleRow.innerHTML = '';
  if (S.prefs.aiSearch) {
    const ppl = peopleGroups(await mediaPeople());
    if (ppl.length) peopleRow.append(h('div', { class: 'psec-title' }, 'People'), h('div', { class: 'faces' }, ...ppl.slice(0, 30).map(p => faceChip(p, () => openPerson(p)))));
  }
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
      ...folders.map(f => h('button', { onclick: () => go(f.id) }, h('span', { html: ic('folder') }), f.name)),
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
        }, 'ghost') : null,
        m.kind === 'image' ? btn('AI Upscale', 'wand', async () => {
          close();
          const rec = await runUpscale(m);
          if (rec) { toast(`✨ Saved ${rec.w}×${rec.h} copy`); showLibrary(); }
        }, 'ghost accent') : null),
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
  const keepScroll = body.scrollTop;
  body.innerHTML = '';
  const refresh = () => { savePrefs(); applyTheme(); showSettings(); };
  const set = (k, v, full = false) => { p[k] = v; savePrefs(); applyTheme(); if (full) showSettings(); };

  // Background
  const themes = h('div', { class: 'themes' });
  for (const t of THEMES) themes.append(h('button', { class: 'theme' + (p.theme === t.id ? ' on' : ''), style: { background: t.bg }, onclick: () => set('theme', t.id, true) }, h('span', {}, t.name)));
  for (const t of p.myThemes) {
    const look = t.look;
    const prev = look.theme === 'gradient' ? `linear-gradient(${look.gradient.angle}deg,${look.gradient.a},${look.gradient.b})` : look.theme === 'color' ? look.customColor : (THEMES.find(x => x.id === look.theme)?.bg || '#222');
    const b = h('button', { class: 'theme mine', style: { background: prev, color: look.textColor, fontFamily: look.uiFont === 'System' ? '' : `"${look.uiFont}"`, borderColor: look.accent }, onclick: () => { Object.assign(p, structuredClone(look)); refresh(); toast(`“${t.name}” applied`); } },
      h('span', {}, t.name));
    b.append(h('i', { class: 'x', html: ic('close'), onclick: async e => { e.stopPropagation(); if (await confirmSheet(`Delete your theme “${t.name}”?`, 'Delete', true)) { p.myThemes = p.myThemes.filter(x => x !== t); refresh(); } } }));
    themes.append(b);
  }
  const g = p.gradient;
  const gradBox = h('div', { class: 'grad-builder' + (p.theme === 'gradient' ? '' : ' hidden-soft') },
    h('div', { class: 'grad-preview', style: { background: `linear-gradient(${g.angle}deg, ${g.a}, ${g.b})` } }),
    h('label', { class: 'btn ghost' }, 'Color 1', Object.assign(h('input', { type: 'color', class: 'hidden-color', value: g.a }), { oninput: e => { g.a = e.target.value; p.theme = 'gradient'; savePrefs(); applyTheme(); gradBox.firstChild.style.background = `linear-gradient(${g.angle}deg, ${g.a}, ${g.b})`; } })),
    h('label', { class: 'btn ghost' }, 'Color 2', Object.assign(h('input', { type: 'color', class: 'hidden-color', value: g.b }), { oninput: e => { g.b = e.target.value; p.theme = 'gradient'; savePrefs(); applyTheme(); gradBox.firstChild.style.background = `linear-gradient(${g.angle}deg, ${g.a}, ${g.b})`; } })),
    slider({ label: 'Angle', min: 0, max: 360, value: g.angle, fmt: v => v + '°', onInput: v => { g.angle = v; p.theme = 'gradient'; savePrefs(); applyTheme(); gradBox.firstChild.style.background = `linear-gradient(${g.angle}deg, ${g.a}, ${g.b})`; } }));
  body.append(section('App background', themes,
    h('div', { class: 'row-btns wrap' },
      btn('My photo', 'image', async () => {
        const [m] = await pickMedia({ kinds: ['image'], multiple: false, title: 'Pick a background photo' });
        if (m) { p.customBg = m.id; p.theme = 'image'; refresh(); }
      }, p.theme === 'image' ? 'primary' : 'ghost'),
      btn('Gradient', 'palette', () => { p.theme = 'gradient'; refresh(); }, p.theme === 'gradient' ? 'primary' : 'ghost'),
      h('label', { class: 'btn ' + (p.theme === 'color' ? 'primary' : 'ghost') }, h('span', { html: ic('palette') }), 'Solid',
        Object.assign(h('input', { type: 'color', value: p.customColor || '#1c1838', class: 'hidden-color' }), { oninput: e => { p.customColor = e.target.value; p.theme = 'color'; savePrefs(); applyTheme(); } }))),
    p.theme === 'gradient' ? gradBox : null,
    p.theme === 'image' ? slider({ label: 'Darken', min: 0, max: 85, value: p.dim, fmt: v => v + '%', onInput: v => set('dim', v) }) : null));

  // Colors & type
  const fonts = h('div', { class: 'chips' });
  for (const f of UI_FONTS) fonts.append(h('button', { class: 'chip' + (p.uiFont === f ? ' on' : ''), style: { fontFamily: f === 'System' ? 'system-ui' : `"${f}"` }, onclick: () => set('uiFont', f, true) }, f));
  body.append(section('Accent color', swatches(ACCENTS, p.accent, v => set('accent', v))),
    section('Text color', swatches(TEXT_TONES, p.textColor, v => set('textColor', v))),
    section('App font', fonts));

  // Panels
  body.append(section('Panels & menus',
    chips([{ id: 'glass', label: 'Frosted glass' }, { id: 'solid', label: 'Solid' }], p.panels, v => set('panels', v)),
    h('div', { class: 'swatch-label' }, 'Panel color'),
    swatches(PANEL_TONES, p.panelColor, v => set('panelColor', v)),
    slider({ label: 'See-through', min: 20, max: 95, value: 100 - p.panelAlpha, fmt: v => v + '%', onInput: v => set('panelAlpha', 100 - v) })));

  body.append(section('Save this look',
    h('p', { class: 'hint' }, 'Keep your background, colors and font as a theme you can switch back to anytime.'),
    btn('Save as my theme', 'plus', async () => {
      const name = await promptSheet('Name your theme', `My theme ${p.myThemes.length + 1}`, 'Save');
      if (!name) return;
      p.myThemes.push({ name, look: structuredClone(Object.fromEntries(LOOK_KEYS.map(k => [k, p[k]]))) });
      refresh(); toast('Theme saved');
    }, 'ghost block'),
    btn('Reset look to default', 'reset', () => { for (const k of LOOK_KEYS) p[k] = structuredClone(DEFAULT_PREFS[k]); refresh(); }, 'ghost block')));

  body.append(section('Editing toolbar',
    h('p', { class: 'hint' }, 'Drag tools into the order you like and hide the ones you don’t use. Tip: long-press any tool in the editor.'),
    btn('Customize toolbar', 'arrange', toolbarSheet, 'ghost block')));

  // Claude AI
  const keyIn = h('input', { class: 'field', type: 'password', placeholder: 'sk-ant-…', value: p.claudeKey || '', autocomplete: 'off', spellcheck: 'false' });
  const keyMsg = h('p', { class: 'hint' }, p.claudeKey ? '✓ Key saved on this phone.' : '');
  body.append(section('Claude AI',
    h('p', { class: 'hint' }, 'Connect Claude to plan edits from your footage in ✨ Create and to make changes you ask for in the editor (“Ask Claude”). Claude looks at small previews of the clips you use.'),
    keyIn,
    h('div', { class: 'row-btns' },
      btn('Save', 'check', () => { p.claudeKey = keyIn.value.trim() || null; savePrefs(); keyMsg.textContent = p.claudeKey ? '✓ Key saved on this phone.' : 'Key removed.'; }, 'primary'),
      btn('Test', 'wand', async () => {
        const k = keyIn.value.trim();
        if (!k) return;
        keyMsg.textContent = 'Testing…';
        try { await testKey(k); p.claudeKey = k; savePrefs(); keyMsg.textContent = '✓ Connected to Claude. Key saved on this phone.'; }
        catch (e) { keyMsg.textContent = e.message; }
      }, 'ghost'),
      p.claudeKey ? btn('Remove', 'trash', () => { p.claudeKey = null; savePrefs(); showSettings(); }, 'ghost danger') : null),
    keyMsg,
    h('p', { class: 'hint' }, 'Get a key at console.anthropic.com → API keys. Usage is billed to your Anthropic account — roughly 2–6¢ per Create or Ask. The key is stored only in this app on this phone; don’t share the app’s data or screenshots of it.')));

  // AI search
  const aiSec = section('AI search',
    h('p', { class: 'hint' }, 'Search your library by what’s in it (“sunset”, “crowd”, “DJ decks”) and find everyone by face. Everything is scanned on this phone — nothing is uploaded. Turning it on downloads about 75 MB once (use Wi-Fi).'),
    h('label', { class: 'switch-row' }, Object.assign(h('input', { type: 'checkbox' }), {
      checked: p.aiSearch, onchange: e => { p.aiSearch = e.target.checked; savePrefs(); if (p.aiSearch) runIndexer(); showSettings(); },
    }), h('span', {}, 'Scan my photos & videos for AI search')),
    h('p', { class: 'hint', id: 'indexStatus' }, S.indexStatus || ''),
    p.aiSearch ? btn('Forget faces & AI data', 'trash', async () => {
      if (!(await confirmSheet('Delete all face groups, names and AI search data from this device?', 'Delete', true))) return;
      for (const m of (await db.all('media'))) { delete m.emb; delete m.frames; delete m.people; delete m.aiv; await db.put('media', m); }
      await savePeople([]); p.aiSearch = false; savePrefs(); toast('AI data deleted'); showSettings();
    }, 'ghost danger block') : null);
  body.append(aiSec);

  const info = await storageInfo();
  const st = section('Storage',
    h('p', { class: 'hint' }, info ? `${fmtBytes(info.used)} used of ${fmtBytes(info.quota)} available to the app.` : 'Storage info unavailable.'),
    h('p', { class: 'hint' }, 'Your videos, photos and projects stay on this device — nothing is uploaded.'));
  if (info && !info.persisted && navigator.storage?.persist) st.append(btn('Keep my files safe from cleanup', 'check', async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Storage protected' : 'Install the app to protect storage'); showSettings(); }, 'ghost'));
  body.append(st);
  if (S.installPrompt) body.append(section('Install', btn('Add S1 Editor to home screen', 'download', async () => { S.installPrompt.prompt(); S.installPrompt = null; }, 'primary block')));
  body.scrollTop = keepScroll;
}

// ---------------------------------------------------------------- AI indexing (content + faces)
let indexing = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function indexNotify() {
  const el = document.getElementById('indexStatus');
  if (el) el.textContent = S.indexStatus || '';
  S.onIndex?.();
}
async function runIndexer() {
  if (indexing || !S.prefs.aiSearch) return;
  indexing = true;
  try {
    await loadMedia();
    const todo = [...media.values()].filter(m => m.kind !== 'audio' && m.aiv !== AI_INDEX_VERSION);
    if (!todo.length) { S.indexStatus = 'Library scanned — AI search is ready.'; return; }
    S.indexStatus = 'Getting AI search ready…'; indexNotify();
    await clipWorker(pr => { if (pr.total) { S.indexStatus = `Downloading AI search model… ${fmtBytes(pr.loaded)} of ${fmtBytes(pr.total)} (first time only)`; indexNotify(); } });
    const people = await loadPeople();
    let i = 0;
    for (const m of todo) {
      while (engine.exportTarget || engine.playing) await sleep(1500);
      if (m.kind === 'video') {
        // Look at several moments; check faces on every other one to save time.
        const frames = [], ids = new Set();
        try {
          await videoMoments(m, async (cv, t, k, n) => {
            try { frames.push({ t, emb: await embedImage(cv) }); } catch { }
            if (k % 2 === 0 || n <= 3) { try { for (const f of await detectFaces(cv)) ids.add(assignPerson(people, f)); } catch { } }
            S.indexStatus = `Scanning your library… ${i + 1} of ${todo.length} (video moment ${k + 1}/${n})`; indexNotify();
          });
        } catch { }
        m.frames = frames;
        if (frames.length) m.emb = meanVec(frames.map(f => f.emb));
        m.people = [...ids];
      } else {
        const cv = await frameCanvas(m);
        if (cv) {
          try { m.emb = await embedImage(cv); } catch { }
          try { const faces = await detectFaces(cv); m.people = [...new Set(faces.map(f => assignPerson(people, f)))]; } catch { m.people = []; }
        }
      }
      m.aiv = AI_INDEX_VERSION;
      await db.put('media', m);
      i++;
      S.indexStatus = `Scanning your library… ${i} of ${todo.length}`; indexNotify();
      if (i % 4 === 0) await savePeople(people);
    }
    await savePeople(people);
    S.indexStatus = `Done — scanned ${todo.length} item${todo.length > 1 ? 's' : ''}. AI search is ready.`;
  } catch (e) {
    S.indexStatus = 'AI search couldn’t start: ' + e.message;
  } finally { indexing = false; indexNotify(); }
}
const mediaPeople = async () => { const people = await loadPeople(); return people.filter(p => p.n > 0); };
const personMedia = (person, people) => {
  const ids = new Set(person.name ? people.filter(p => p.name && p.name.toLowerCase() === person.name.toLowerCase()).map(p => p.id) : [person.id]);
  return [...media.values()].filter(m => (m.people || []).some(id => ids.has(id))).sort((a, b) => b.created - a.created);
};
// Group same-named clusters so naming two groups the same merges them.
function peopleGroups(people) {
  const groups = new Map();
  for (const p of people) {
    const key = p.name ? 'n:' + p.name.toLowerCase() : 'id:' + p.id;
    if (!groups.has(key)) groups.set(key, { ...p, count: 0 });
    groups.get(key).count += p.n;
  }
  return [...groups.values()].sort((a, b) => (!!b.name - !!a.name) || b.count - a.count);
}
function faceChip(p, onclick) {
  return h('button', { class: 'face', onclick }, h('img', { src: p.thumb, alt: p.name || 'Unnamed person' }), h('span', {}, p.name || 'Add name'));
}
async function openPerson(person) {
  await loadMedia();
  const people = await loadPeople();
  openSheet(person.name || 'Who is this?', (b, close) => {
    const items = personMedia(person, people);
    const name = h('input', { class: 'field', value: person.name || '', placeholder: 'Add a name…', maxlength: 40 });
    name.addEventListener('change', async () => {
      const v = name.value.trim();
      const ids = person.name ? people.filter(p => p.name && p.name.toLowerCase() === person.name.toLowerCase()).map(p => p.id) : [person.id];
      for (const p of people) if (ids.includes(p.id)) p.name = v;
      await savePeople(people);
      person.name = v;
      toast(v ? `Saved — search “${v}” to find them` : 'Name removed');
      if (document.body.dataset.screen === 'library') showLibrary();
    });
    const grid = h('div', { class: 'grid pick' });
    for (const m of items) grid.append(mediaTile(m, () => { close(); useMedia(m); }));
    b.append(h('div', { class: 'person-head' }, h('img', { src: person.thumb, alt: '' }), name),
      h('p', { class: 'hint' }, `${items.length} photo${items.length === 1 ? '' : 's'}/video${items.length === 1 ? '' : 's'} on this phone. Name two groups the same to merge them.`),
      grid,
      items.some(m => m.kind !== 'audio') ? btn(`Make a video with ${person.name || 'them'}`, 'video', async () => {
        close();
        const p = newProject('video');
        p.name = person.name ? `${person.name} edit` : p.name;
        p.clips = items.filter(m => m.kind !== 'audio').slice(0, 30).reverse().map(newClip);
        await db.put('projects', p); go('#editor/' + p.id);
      }, 'primary block') : null);
  }, { wide: true });
}
// Quick look at a result; videos start at the moment search found.
function previewMedia(m, t) {
  const url = URL.createObjectURL(m.blob);
  openSheet(m.name, b => {
    if (m.kind === 'video') {
      const v = h('video', { src: url, controls: true, playsinline: true, autoplay: true, class: 'result-media' });
      v.addEventListener('loadedmetadata', () => { if (t != null) v.currentTime = Math.max(0, t - 1); }, { once: true });
      b.append(v);
    } else b.append(h('img', { src: url, class: 'result-media', alt: m.name }));
  }, { onClose: () => URL.revokeObjectURL(url), wide: true });
}
// What tapping a search result does depends on where you are.
function useMedia(m) {
  if (S.project && document.body.dataset.screen === 'editor') {
    if (m.kind === 'audio') return addAudio(m);
    const p = S.project;
    const after = S.sel?.kind === 'clip' ? p.clips.findIndex(c => c.id === S.sel.id) + 1 : p.clips.length;
    commit(() => p.clips.splice(after, 0, newClip(m)));
    return toast(`Added “${m.name}”`);
  }
  viewMedia(m);
}

function openSearch() {
  const inEditor = !!S.project && document.body.dataset.screen === 'editor';
  if (inEditor) { engine.pause(); closePanel(); }
  openSheet('Search', async (b, close) => {
    await loadMedia();
    let people = await mediaPeople();
    const input = h('input', { class: 'field search-input', type: 'search', placeholder: inEditor ? 'Search tools, filters, music, people…' : 'Search files, people, projects, settings…', enterkeyhint: 'search' });
    const results = h('div', { class: 'search-results' });
    b.append(h('div', { class: 'search-bar' }, h('span', { html: ic('search') }), input), results);
    const projects = inEditor ? [] : await db.all('projects');
    let seq = 0;
    // Results are picked (numbered in order), then turned into a video or added to this one.
    const picked = new Map(); // media id -> { m, t }
    const foot = h('div', { class: 'sticky-foot pick-foot', hidden: true });
    b.append(foot);
    const paintPicks = () => {
      const n = picked.size;
      $$('.search-results .tile', b).forEach(t => { const k = [...picked.keys()].indexOf(t.dataset.id); t.classList.toggle('picked', k >= 0); t.dataset.n = k >= 0 ? k + 1 : ''; });
      foot.hidden = !n;
      foot.innerHTML = '';
      if (!n) return;
      const moments = [...picked.values()].some(x => x.t != null);
      foot.append(h('div', { class: 'pick-row' }, h('span', {}, `${n} picked`), h('button', { class: 'link-btn', onclick: () => { picked.clear(); paintPicks(); } }, 'Clear')),
        moments ? h('p', { class: 'hint' }, 'Videos are added from the moment AI found (about 6 seconds) — trim it longer in the editor.') : null,
        btn(inEditor ? `Add ${n} to this video` : `Make a video with ${n}`, inEditor ? 'plus' : 'video', async () => {
          const clips = [...picked.values()].map(({ m, t }) => {
            const c = newClip(m);
            if (m.kind === 'video' && t != null) { c.in = Math.max(0, t - 2); c.out = Math.min(m.duration || c.out, t + 4); }
            return c;
          });
          close();
          if (inEditor) {
            const p = S.project;
            const after = S.sel?.kind === 'clip' ? p.clips.findIndex(c => c.id === S.sel.id) + 1 : p.clips.length;
            commit(() => p.clips.splice(after, 0, ...clips));
            toast(`Added ${clips.length} clip${clips.length > 1 ? 's' : ''}`);
          } else {
            const p = newProject('video');
            p.name = input.value.trim() ? input.value.trim().replace(/^./, c => c.toUpperCase()) : p.name;
            p.clips = clips;
            await db.put('projects', p);
            go('#editor/' + p.id);
          }
        }, 'primary block'));
    };
    const hitTile = (m, t) => {
      const tile = mediaTile(m, () => {
        if (picked.has(m.id)) picked.delete(m.id); else picked.set(m.id, { m, t });
        paintPicks();
      });
      if (t != null && m.kind === 'video') tile.append(h('span', { class: 'badge at' }, 'at ' + fmtShort(t).replace(/\.\ds$/, 's')));
      tile.append(h('span', { class: 'peek', role: 'button', 'aria-label': 'Preview', html: ic('play'), onclick: e => { e.stopPropagation(); previewMedia(m, t); } }));
      return tile;
    };
    const sec = (title, ...kids) => h('div', { class: 'psec' }, h('div', { class: 'psec-title' }, title), ...kids);
    const run = async () => {
      const q = input.value.trim();
      const my = ++seq;
      if (!q) people = await mediaPeople();
      if (my !== seq) return;
      results.innerHTML = '';
      if (!q) {
        const sugg = inEditor ? ['blur background', 'slow motion', 'louder', 'text', 'vintage', 'sharpen', 'upscale'] : ['sunset', 'crowd', 'night', 'music', 'DJ'];
        results.append(sec('Try', h('div', { class: 'chips' }, ...sugg.map(s => h('button', { class: 'chip', onclick: () => { input.value = s; run(); } }, s)))));
        if (people.length) results.append(sec('People', h('div', { class: 'faces' }, ...peopleGroups(people).slice(0, 20).map(p => faceChip(p, () => { close(); openPerson(p); })))));
        if (!S.prefs.aiSearch) results.append(h('div', { class: 'ai-banner' },
          h('b', { html: ic('wand') + 'Turn on AI search' }),
          h('p', {}, 'Find photos and videos by what’s in them, and everyone by face. Scanned on this phone, never uploaded.'),
          btn('Turn on', 'check', () => { S.prefs.aiSearch = true; savePrefs(); runIndexer(); run(); }, 'primary')));
        else if (indexing || S.indexStatus) results.append(h('p', { class: 'hint', id: 'indexStatus' }, S.indexStatus));
        return;
      }
      // Tools
      if (inEditor) {
        const photo = S.project.kind === 'photo';
        const tools = TOOLS.filter(t => !(photo && t.video)).map(t => ({ t, s: score(q, t.label, TOOL_WORDS[t.id]) })).filter(x => x.s).sort((a, z) => z.s - a.s).slice(0, 6);
        if (tools.length) results.append(sec('Tools', h('div', { class: 'tool-results' }, ...tools.map(({ t }) =>
          h('button', { class: 'tool', onclick: () => { close(); t.fn(); } }, h('span', { html: ic(t.icon) }), t.label)))));
        const filters = PRESETS.filter(f => f.id !== 'none').map(f => ({ f, s: score(q, f.name, 'filter look') })).filter(x => x.s >= 45).sort((a, z) => z.s - a.s);
        if (filters.length) results.append(sec('Filters — tap to apply', h('div', { class: 'chips' }, ...filters.map(({ f }) =>
          h('button', { class: 'chip', onclick: () => { const c = target(); if (!c) return; commit(() => { c.filter = f.id; }); toast(`${f.name} applied`); } }, f.name)))));
        const trs = TRANSITIONS.filter(x => x.id !== 'none').map(x => ({ x, s: score(q, x.name, 'transition') })).filter(x => x.s >= 45);
        if (trs.length) results.append(sec('Transitions — after this clip', h('div', { class: 'chips' }, ...trs.map(({ x }) =>
          h('button', { class: 'chip', onclick: () => { const c = target(); if (!c) return; commit(() => { c.transition = { type: x.id, dur: c.transition?.dur || 0.6 }; }); toast(`${x.name} transition added`); } }, x.name)))));
      }
      // People
      const pm = peopleGroups(people).filter(p => p.name && score(q, p.name));
      if (pm.length) results.append(sec('People', h('div', { class: 'faces' }, ...pm.map(p => faceChip(p, () => { close(); openPerson(p); })))));
      // Files by name
      const files = [...media.values()].map(m => ({ m, s: score(q, m.name.replace(/\.[^.]+$/, ''), m.kind === 'audio' ? 'audio song music sound' : m.kind === 'video' ? 'video clip' : 'photo picture image') }))
        .filter(x => x.s >= 40).sort((a, z) => z.s - a.s || z.m.created - a.m.created).slice(0, 24);
      const audio = files.filter(x => x.m.kind === 'audio'), visual = files.filter(x => x.m.kind !== 'audio');
      if (audio.length) results.append(sec(inEditor ? 'Music & sounds — tap to add' : 'Audio', h('div', { class: 'menu' }, ...audio.map(({ m }) =>
        h('button', { onclick: () => { close(); useMedia(m); } }, h('span', { html: ic('music') }), m.name)))));
      if (visual.length) results.append(sec('Videos & photos by name — tap to pick', h('div', { class: 'grid pick' }, ...visual.map(({ m }) => hitTile(m)))));
      // Projects & settings
      const pr = projects.map(p => ({ p, s: score(q, p.name, 'project') })).filter(x => x.s >= 40);
      if (pr.length) results.append(sec('Projects', h('div', { class: 'menu' }, ...pr.map(({ p }) => h('button', { onclick: () => { close(); go('#editor/' + p.id); }, }, h('span', { html: ic(p.kind === 'photo' ? 'image' : 'video') }), p.name)))));
      if (score(q, 'settings', SETTINGS_WORDS) >= 40) results.append(sec('Settings', h('div', { class: 'menu' },
        h('button', { onclick: () => { close(); go('#settings'); }, html: ic('palette') + 'Themes, colors & fonts' }),
        h('button', { onclick: () => { close(); toolbarSheet(); }, html: ic('arrange') + 'Customize toolbar' }))));
      // AI: content search
      const indexed = [...media.values()].filter(m => m.emb);
      if (S.prefs.aiSearch && indexed.length && q.length >= 2) {
        // "Simri DJing" → only media with Simri, ranked by "DJing".
        const named = peopleGroups(people).filter(p => p.name);
        const who = named.find(p => new RegExp(`(^|\\s)${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(q));
        let rest = q, pool = indexed;
        if (who) {
          rest = q.replace(new RegExp(who.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/\b(of|with|and|at|in|on|is|me|my)\b/gi, ' ').trim();
          const ids = new Set(people.filter(p => p.name && p.name.toLowerCase() === who.name.toLowerCase()).map(p => p.id));
          pool = indexed.filter(m => (m.people || []).some(id => ids.has(id)));
        }
        const slot = sec(who ? `✨ AI: ${who.name}${rest ? ' · ' + rest : ''} — tap to pick` : '✨ AI: looks like “' + q + '” — tap to pick', h('p', { class: 'hint' }, 'Searching…'));
        results.append(slot);
        try {
          let hits;
          if (who && !rest) hits = pool.map(m => ({ m, s: 1 }));
          else {
            const v = await embedText(rest || q);
            if (my !== seq) return;
            // Videos score by their best-matching moment, and remember when it is.
            const ranked = pool.map(m => {
              if (m.frames?.length) { let s = -1, t = 0; for (const f of m.frames) { const d = dot(v, f.emb); if (d > s) { s = d; t = f.t; } } return { m, s, t }; }
              return { m, s: dot(v, m.emb) };
            }).sort((a, z) => z.s - a.s);
            const best = ranked[0]?.s || 0;
            hits = ranked.filter(x => x.s >= Math.max(0.12, best - 0.06)).slice(0, 24);
          }
          if (my !== seq) return;
          slot.lastChild.remove();
          if (hits.length) slot.append(h('div', { class: 'grid pick' }, ...hits.map(x => hitTile(x.m, x.t))));
          else slot.append(h('p', { class: 'hint' }, who ? `No photos of ${who.name} match that.` : 'No close matches.'));
          paintPicks();
        } catch (e) { slot.lastChild.textContent = 'AI search unavailable: ' + e.message; }
      } else if (S.prefs.aiSearch && indexing) results.append(h('p', { class: 'hint', id: 'indexStatus' }, S.indexStatus));
      if (!results.children.length) results.append(h('p', { class: 'empty' }, `Nothing found for “${q}”.`));
      paintPicks();
    };
    input.addEventListener('input', debounce(run, 220));
    S.onIndex = () => { if (!input.value) run(); };
    run();
    setTimeout(() => input.focus(), 250);
  }, { wide: true, onClose: () => { S.onIndex = null; } });
}

// ---------------------------------------------------------------- voice input
function micButton(target) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) return null;
  const b = h('button', { class: 'icon-btn mic', type: 'button', 'aria-label': 'Speak instead of typing', html: ic('mic') });
  let rec = null;
  b.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new R();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    const base = target.value.trim() ? target.value.trim() + ' ' : '';
    rec.onresult = e => { let t = ''; for (const r of e.results) t += r[0].transcript; target.value = base + t; target.dispatchEvent(new Event('input')); };
    rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Couldn’t use the microphone — check its permission'); };
    rec.onend = () => { rec = null; b.classList.remove('on'); };
    b.classList.add('on');
    rec.start();
  };
  return b;
}

// ---------------------------------------------------------------- music analysis (beat + best section)
function analyzeMusic(buf) {
  const ch = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.round(sr / 100);
  const n = Math.floor(ch.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop, e = j + hop; j < e; j++) s += ch[j] * ch[j]; env[i] = Math.sqrt(s / hop); }
  const on = new Float32Array(n);
  for (let i = 1; i < n; i++) on[i] = Math.max(0, env[i] - env[i - 1]);
  let best = 0, lagBest = 50;
  for (let lag = 33; lag <= 86; lag++) { let s = 0; for (let i = lag; i < n; i++) s += on[i] * on[i - lag]; if (s > best) { best = s; lagBest = lag; } }
  let bpm = 6000 / lagBest;
  while (bpm < 85) bpm *= 2;
  while (bpm > 170) bpm /= 2;
  return { bpm: Math.round(bpm), env };
}
// Start of the most energetic stretch (usually the drop/chorus).
function loudestStart(env, len) {
  const w = Math.round(len * 100);
  if (env.length <= w) return 0;
  let s = 0; for (let i = 0; i < w; i++) s += env[i];
  let best = s, at = 0;
  for (let i = w; i < env.length; i++) { s += env[i] - env[i - w]; if (s > best) { best = s; at = i - w + 1; } }
  return Math.max(0, at / 100 - 0.4);
}

// ---------------------------------------------------------------- Create (AI reels + cover images)
const STYLES = {
  auto: { name: 'Let AI decide' },
  hype: { name: 'Hype', shot: 1.2, filters: ['pop', 'neon', 'vivid'], transitions: ['none', 'zoom', 'white'], fonts: ['Anton', 'Bebas Neue'], style: 'outline', anim: 'pop', motion: 'in', trDur: 0.3 },
  chill: { name: 'Chill', shot: 3, filters: ['soft', 'warm', 'dusk'], transitions: ['fade'], fonts: ['Playfair Display', 'Caveat'], style: 'shadow', anim: 'fade', motion: 'in', trDur: 0.8 },
  cinematic: { name: 'Cinematic', shot: 2.5, filters: ['teal', 'film', 'noir'], transitions: ['black', 'fade'], fonts: ['Bebas Neue', 'Montserrat'], style: 'shadow', anim: 'fade', motion: 'in', trDur: 0.7 },
  vintage: { name: 'Vintage', shot: 2.4, filters: ['vintage', 'film', 'warm'], transitions: ['fade', 'black'], fonts: ['Permanent Marker', 'Caveat'], style: 'shadow', anim: 'type', motion: 'pan', trDur: 0.6 },
  clean: { name: 'Clean', shot: 2, filters: ['none', 'crisp', 'vivid'], transitions: ['slide', 'none', 'wipe'], fonts: ['Montserrat', 'Space Grotesk'], style: 'box', anim: 'slide', motion: 'none', trDur: 0.4 },
};
const FORMATS = [{ id: '9:16', label: 'Reels / TikTok / Shorts' }, { id: '16:9', label: 'YouTube' }, { id: '4:5', label: 'IG post' }, { id: '1:1', label: 'Square' }];
const POS_Y = { top: 0.18, middle: 0.5, bottom: 0.8 };
const SIZE_V = { small: 6, medium: 9, large: 13 };
const hexOk = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null;

function styleFromText(desc) {
  const d = (desc || '').toLowerCase();
  if (/hype|energy|fast|party|turn up|lit|club|rave|drop/.test(d)) return 'hype';
  if (/chill|calm|soft|relax|smooth|vibe|sunset|lofi|lo-fi/.test(d)) return 'chill';
  if (/cinematic|film|movie|epic|dramatic|moody|dark/.test(d)) return 'cinematic';
  if (/vintage|retro|old|90s|80s|throwback|film grain/.test(d)) return 'vintage';
  return 'clean';
}

async function showCreate() {
  show('create');
  await loadMedia();
  S.create ||= { items: [], mode: 'reel', desc: '', style: 'auto', length: 15, format: '9:16', music: 'clip', title: '', useClaude: true };
  const C = S.create;
  C.items = C.items.map(m => media.get(m.id)).filter(Boolean);
  const body = $('#createBody');
  body.innerHTML = '';
  const hasKey = !!S.prefs.claudeKey;

  // 1. Footage
  const strip = h('div', { class: 'grid pick create-strip' });
  const paintStrip = () => {
    strip.innerHTML = '';
    C.items.forEach((m, i) => {
      const t = mediaTile(m, () => { C.items.splice(i, 1); paintStrip(); });
      t.append(h('span', { class: 'peek', html: ic('close') }));
      strip.append(t);
    });
    strip.append(h('button', {
      class: 'tile add-tile', 'aria-label': 'Add footage', html: ic('plus') + '<span>Add</span>', onclick: async () => {
        const picked = await pickMedia({ kinds: ['video', 'image'], title: 'Footage for this edit' });
        for (const m of picked) if (!C.items.some(x => x.id === m.id)) C.items.push(m);
        paintStrip();
      },
    }));
  };
  paintStrip();
  const find = h('input', { class: 'field', placeholder: S.prefs.aiSearch ? 'Or find it: “me DJing”, “crowd at night”…' : 'Turn on AI search in Settings to find footage by describing it', disabled: !S.prefs.aiSearch });
  find.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !find.value.trim()) return;
    const found = await aiFind(find.value.trim(), 12);
    let n = 0;
    for (const m of found) if (!C.items.some(x => x.id === m.id)) { C.items.push(m); n++; }
    toast(n ? `Added ${n} matching clip${n > 1 ? 's' : ''}` : 'Nothing new matched');
    find.value = ''; paintStrip();
  });
  body.append(section('1 · Your footage', h('p', { class: 'hint' }, 'Add the videos and photos to work with. Tap one to remove it.'), strip, find));

  // 2. What you want
  const desc = h('textarea', { class: 'field', rows: 3, placeholder: 'Describe it… e.g. “Hype reel of my DJ set, fast cuts on the beat, end on the crowd, text: SATURDAY NIGHT”', value: C.desc });
  desc.addEventListener('input', () => { C.desc = desc.value; });
  const title = h('input', { class: 'field', placeholder: 'On-screen title (optional)', value: C.title, maxlength: 60 });
  title.addEventListener('input', () => { C.title = title.value; });
  const musicRow = h('div');
  const paintMusic = () => {
    musicRow.innerHTML = '';
    const songs = [...media.values()].filter(m => m.kind === 'audio').sort((a, z) => z.created - a.created);
    const opts = [{ id: 'clip', label: 'Video’s own sound' }, { id: 'none', label: 'Silent' }, ...songs.slice(0, 8).map(m => ({ id: m.id, label: '♪ ' + m.name.replace(/\.[^.]+$/, '') }))];
    musicRow.append(chips(opts, C.music, v => { C.music = v; }),
      btn('Import a song', 'upload', async () => {
        const files = await pickFiles('audio/*', false);
        if (!files.length) return;
        const [r] = await importFiles(files);
        if (r) { media.set(r.id, r); C.music = r.id; paintMusic(); }
      }, 'ghost'));
  };
  paintMusic();
  const modeChips = chips([{ id: 'reel', label: '🎬 Short video' }, { id: 'cover', label: '🖼️ Cover images' }], C.mode, v => { C.mode = v; showCreate(); });
  body.append(section('2 · What do you want?', modeChips,
    h('div', { class: 'with-mic' }, desc, micButton(desc)), title,
    C.mode === 'reel' ? section('Style', chips(Object.entries(STYLES).map(([id, s]) => ({ id, label: s.name })), C.style, v => { C.style = v; })) : null,
    C.mode === 'reel' ? section('Length', chips([7, 15, 30, 60].map(v => ({ id: v, label: v + 's' })), C.length, v => { C.length = v; })) : null,
    section('Made for', chips(FORMATS.map(f => ({ id: f.id, label: f.label })), C.format, v => { C.format = v; })),
    C.mode === 'reel' ? section('Music', musicRow, h('p', { class: 'hint' }, 'With a song, cuts land on the beat and it starts at the song’s most energetic part.')) : null));

  // 3. Brain + generate
  const brain = hasKey
    ? chips([{ id: true, label: '🧠 Claude (sees your footage)' }, { id: false, label: '⚡ On-device (instant, free)' }], C.useClaude, v => { C.useClaude = v; })
    : h('p', { class: 'hint' }, 'Using quick on-device AI. For smarter edits that follow your description closely, add a Claude API key in ', h('a', { href: '#settings' }, 'Settings → Claude AI'), '.');
  const results = h('div', { class: 'create-results' });
  body.append(section('3 · Make it', brain,
    btn(C.mode === 'reel' ? 'Generate 3 videos' : 'Generate 3 cover images', 'wand', () => generate(results), 'primary block')), results);
}

// AI search used to grab footage for Create.
async function aiFind(q, n) {
  const indexed = [...media.values()].filter(m => m.emb && m.kind !== 'audio');
  if (!indexed.length) { toast('Your library hasn’t been scanned yet — turn on AI search in Settings'); return []; }
  const v = await embedText(q);
  const ranked = indexed.map(m => ({ m, s: m.frames?.length ? Math.max(...m.frames.map(f => dot(v, f.emb))) : dot(v, m.emb) })).sort((a, z) => z.s - a.s);
  const best = ranked[0]?.s || 0;
  return ranked.filter(x => x.s >= Math.max(0.12, best - 0.07)).slice(0, n).map(x => x.m);
}

// Candidate moments from the footage. Refs look like V2@12.5 (video 2 at 12.5 s) or P1 (photo 1).
async function collectMoments(items, withImages, onStep) {
  const vids = items.filter(m => m.kind === 'video');
  const per = Math.max(3, Math.min(10, Math.floor(40 / Math.max(1, vids.length))));
  const out = [];
  let vi = 0, pi = 0;
  for (const m of items) {
    if (m.kind === 'video') {
      vi++;
      const dur = m.duration || 0;
      const n = Math.max(1, Math.min(per, Math.floor(dur / 1.5)));
      const times = Array.from({ length: n }, (_, k) => +(dur * (k + 0.5) / n).toFixed(1));
      if (withImages) await framesAt(m, times, (c, t) => { out.push({ ref: `V${vi}@${t}`, m, t, canvas: c }); onStep?.(); });
      else for (const t of times) out.push({ ref: `V${vi}@${t}`, m, t });
    } else {
      pi++;
      out.push({ ref: `P${pi}`, m, t: null, canvas: withImages ? await frameCanvas(m, 384) : null });
      onStep?.();
    }
  }
  return out;
}

// Score moments against the description with on-device AI (when the library has been scanned).
async function scoreMoments(moments, q) {
  if (!q || !S.prefs.aiSearch) return;
  let v;
  try { v = await embedText(q); } catch { return; }
  for (const mo of moments) {
    const m = mo.m;
    if (m.frames?.length && mo.t != null) {
      const f = m.frames.reduce((a, b) => Math.abs(b.t - mo.t) < Math.abs(a.t - mo.t) ? b : a);
      mo.score = dot(v, f.emb);
    } else if (m.emb) mo.score = dot(v, m.emb);
  }
}

function localPlans(moments, o) {
  const st = STYLES[o.style];
  const beat = o.bpm ? 60 / o.bpm : null;
  let shot = st.shot;
  if (beat) shot = Math.max(1, Math.round(st.shot / beat)) * beat;
  const count = Math.max(2, Math.min(moments.length * 2, Math.round(o.length / shot)));
  const byScore = [...moments].sort((a, z) => (z.score ?? 0) - (a.score ?? 0) || Math.random() - 0.5);
  const chrono = [...moments];
  const pick = (list, k) => { const out = []; let i = 0; while (out.length < k && list.length) { out.push(list[i % list.length]); i++; } return out; };
  const spread = (list, k) => Array.from({ length: Math.min(k, list.length) }, (_, i) => list[Math.floor(i * list.length / Math.min(k, list.length))]);
  const sets = [
    { name: 'Best moments', why: 'The strongest matching moments, in the order they happened.', list: pick(byScore, count).sort((a, z) => chrono.indexOf(a) - chrono.indexOf(z)) },
    { name: 'Remix', why: 'A punchier shuffle that opens on your best shot.', list: (() => { const l = pick(byScore, count); const [first, ...rest] = l; return [first, ...rest.sort(() => Math.random() - 0.5)]; })() },
    { name: 'Story', why: 'Moments from start to finish across all your footage.', list: spread(chrono, count) },
  ];
  const titleText = o.title || (o.desc.match(/["“”']([^"“”']{2,40})["“”']/) || [])[1] || '';
  return sets.map((s, v) => {
    const per = o.length / Math.max(1, s.list.length);
    const dur = beat ? Math.max(beat, Math.round(per / beat) * beat) : per;
    const texts = titleText ? [{ text: titleText, at: 0.15, dur: Math.min(2.6, o.length * 0.4), position: 'middle', size: 'large', style: st.style, anim: st.anim, color: '#ffffff' }] : [];
    return {
      name: s.name, why: s.why, shots: s.list.map(mo => ({ ref: mo.ref, dur })),
      filter: st.filters[v % st.filters.length], transition: st.transitions[v % st.transitions.length], font: st.fonts[v % st.fonts.length],
      motion: st.motion, texts, keepClipSound: false,
    };
  });
}

async function claudePlans(moments, o, onStatus) {
  const lines = [
    `Brief: ${o.desc || '(none — make something that suits the footage)'}`,
    o.title ? `On-screen title to use exactly: "${o.title}"` : 'No title given — add short text only if it helps.',
    `Style: ${o.style === 'auto' ? 'your choice based on the brief and footage' : STYLES[o.style].name}`,
    `Target length: about ${o.length} seconds. Format: ${o.format}.`,
    o.bpm ? `Music: ${o.bpm} BPM (one beat = ${(60 / o.bpm).toFixed(3)} s). Make every shot a whole number of beats so cuts land on the beat.` : (o.music === 'clip' ? 'Sound: the clips’ own audio.' : 'No music.'),
    `There are ${moments.length} moments below. Video refs are V<video>@<seconds>; photo refs are P<photo>.`,
  ];
  const content = [{ type: 'text', text: lines.join('\n') }];
  for (const mo of moments) {
    content.push({ type: 'text', text: mo.t != null ? `${mo.ref} — "${mo.m.name}" (${fmtShort(mo.m.duration || 0)} video), moment at ${mo.t}s` : `${mo.ref} — photo "${mo.m.name}"` });
    if (mo.canvas) content.push(imageBlock(mo.canvas));
  }
  onStatus('Claude is watching your footage and planning…');
  const res = await askClaudeJSON({
    apiKey: S.prefs.claudeKey, effort: 'medium', content,
    system: [
      'You are the editor inside S1 Editor, a phone video app for a DJ, photographer and content creator. You plan short-form social edits from the user’s own footage.',
      `Return exactly ${o.mode === 'cover' ? 3 : 3} variations that follow the brief and are clearly different from each other (pacing, look, order or opening shot).`,
      o.mode === 'cover'
        ? 'This is for COVER IMAGES (thumbnails/posters): each variation must have exactly one shot (the single best still for a cover) and bold text that would make someone tap. Set dur to 1.'
        : 'Each variation is a short video: open with the strongest, most eye-catching moment, keep the energy right for the brief, avoid near-identical moments back to back, and make shot durations add up to roughly the target length. Each shot dur is between 0.4 and 8 seconds.',
      'Use only refs that appear in the list. Text on screen: short and punchy (6 words or fewer per line), times inside the video, colors as #rrggbb. Use the user’s title exactly when given.',
      '"why" is one short sentence telling the user the idea behind the variation. Names are 1–3 words.',
    ].join('\n'),
    schema: reelSchema({ filters: PRESETS.map(p => p.id), transitions: TRANSITIONS.map(t => t.id), fonts: FONTS }),
  });
  return res.variations || [];
}

async function buildFromPlan(plan, byRef, o) {
  const st = STYLES[o.style === 'auto' ? styleFromText(o.desc) : o.style];
  if (o.mode === 'cover') {
    const mo = byRef.get(plan.shots[0]?.ref) || [...byRef.values()][0];
    let m = mo.m;
    if (m.kind === 'video') {
      // Turn the chosen video moment into a still for the photo editor.
      let blob = null;
      await framesAt(m, [mo.t ?? 0], async c => { blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95)); }, 2160);
      m = blob ? await importBlob(blob, `${m.name.replace(/\.[^.]+$/, '')} frame ${fmtShort(mo.t ?? 0)}.jpg`, 'frames') : null;
      if (!m) throw new Error('Couldn’t grab that frame');
      media.set(m.id, m);
    }
    const p = newProject('photo');
    p.name = '🖼️ ' + plan.name; p.aspect = o.format;
    const c = newClip(m); c.duration = 5; c.fit = 'fill'; c.filter = plan.filter; c.filterAmount = 90; c.motion = 'none';
    p.clips = [c];
    p.texts = plan.texts.map(t => textFrom(t, plan, st, true));
    return p;
  }
  const p = newProject('video');
  p.name = '✨ ' + plan.name; p.aspect = o.format;
  for (const s of plan.shots) {
    const mo = byRef.get(s.ref);
    if (!mo) continue;
    const m = mo.m, c = newClip(m);
    const d = Math.max(0.4, Math.min(8, s.dur || 2));
    if (m.kind === 'video') {
      const len = Math.min(d, m.duration || d);
      const a = Math.max(0, Math.min((mo.t ?? 0) - len * 0.35, (m.duration || len) - len));
      c.in = a; c.out = a + len;
    } else c.duration = d;
    c.fit = 'fill'; c.filter = plan.filter; c.filterAmount = 85;
    c.motion = plan.motion === 'none' && m.kind === 'image' ? 'in' : plan.motion;
    c.transition = { type: plan.transition, dur: st?.trDur ?? 0.5 };
    const withSong = o.music && o.music !== 'clip' && o.music !== 'none';
    c.volume = o.music === 'none' ? 0 : withSong ? (plan.keepClipSound ? 30 : 0) : 100;
    c.muted = c.volume === 0;
    p.clips.push(c);
  }
  if (!p.clips.length) return null;
  p.clips[p.clips.length - 1].transition = { type: 'none', dur: 0.5 };
  const T = totalDuration(p);
  p.texts = plan.texts.filter(t => t.text?.trim()).map(t => textFrom(t, plan, st, false, T));
  if (o.music && o.music !== 'clip' && o.music !== 'none') {
    const r = media.get(o.music);
    p.audio = [{ id: uid(), mediaId: o.music, name: r?.name.replace(/\.[^.]+$/, '') || 'Music', start: 0, offset: o.musicStart || 0, dur: T, volume: 100, fadeIn: 0.2, fadeOut: Math.min(1.5, T / 4) }];
  }
  return p;
}
function textFrom(t, plan, st, still, T = 9999) {
  return {
    id: uid(), text: t.text.trim(), sticker: false, start: still ? 0 : Math.max(0, Math.min(t.at || 0, T - 0.5)), dur: still ? 9999 : Math.max(0.5, Math.min(t.dur || 2.5, T)),
    x: 0.5, y: POS_Y[t.position] ?? 0.5, size: SIZE_V[t.size] ?? 9, font: plan.font, color: hexOk(t.color) || '#ffffff',
    style: t.style || st?.style || 'shadow', anim: still ? 'none' : (t.anim || st?.anim || 'fade'), rotate: 0, opacity: 100, bold: true,
  };
}

// Render a frame of a project (for result cards and cover images).
let renderEngine = null;
async function renderProject(p, short, at) {
  renderEngine ||= new Engine(document.createElement('canvas'), $('#hidden-media'));
  const re = renderEngine;
  await re.load(structuredClone(p));
  for (const f of new Set(p.texts.map(t => t.font))) await document.fonts.load(`700 40px "${f}"`).catch(() => {});
  const t = at ?? (p.kind === 'photo' ? 0 : Math.min(re.total * 0.25, 1.2));
  re.seek(t);
  await re.waitReady(t, 2500);
  await new Promise(r => setTimeout(r, 120));
  const { W, H } = re.outputSize(short);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  re.renderFrame(c.getContext('2d'), W, H, t, false);
  re.load({ clips: [], texts: [], audio: [] });
  return c;
}

async function generate(results) {
  const C = S.create;
  if (!C.items.length) return toast('Add some videos or photos first');
  results.innerHTML = '';
  const status = h('p', { class: 'hint center gen-status' }, 'Getting started…');
  const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
  results.append(h('div', { class: 'exporting' }, status, bar));
  const setP = (f, msg) => { bar.firstChild.style.width = Math.round(f * 100) + '%'; if (msg) status.textContent = msg; };
  const useClaude = !!S.prefs.claudeKey && C.useClaude;
  const o = { ...C, style: C.style === 'auto' && !useClaude ? styleFromText(C.desc) : C.style, desc: C.desc.trim(), title: C.title.trim() };
  if (o.mode === 'cover') o.length = 1;
  try {
    if (o.mode === 'reel' && o.music && !['clip', 'none'].includes(o.music)) {
      setP(0.05, 'Listening to your song…');
      const buf = await engine.loadBuffer(o.music);
      if (buf) { const a = analyzeMusic(buf); o.bpm = a.bpm; o.musicStart = loudestStart(a.env, o.length); }
    }
    let k = 0;
    const total = C.items.reduce((s, m) => s + (m.kind === 'video' ? 6 : 1), 0);
    const moments = await collectMoments(C.items, useClaude || o.mode === 'cover', () => setP(0.1 + 0.3 * Math.min(1, ++k / total), 'Looking through your footage…'));
    if (!moments.length) throw new Error('Couldn’t read that footage');
    const byRef = new Map(moments.map(m => [m.ref, m]));
    let plans;
    if (useClaude) {
      setP(0.45);
      plans = await claudePlans(moments, o, msg => setP(0.5, msg));
    } else {
      setP(0.5, 'Picking the best moments…');
      await scoreMoments(moments, o.desc || o.title);
      if (o.mode === 'cover') {
        const st = STYLES[o.style === 'auto' ? styleFromText(o.desc) : o.style];
        const best = [...moments].sort((a, z) => (z.score ?? 0) - (a.score ?? 0) || Math.random() - 0.5).slice(0, 3);
        const title = o.title || (o.desc.match(/["“”']([^"“”']{2,40})["“”']/) || [])[1] || '';
        plans = best.map((mo, v) => ({ name: ['Bold', 'Clean', 'Mood'][v], why: 'A strong still from your footage with your title on top.', shots: [{ ref: mo.ref, dur: 1 }], filter: st.filters[v % st.filters.length], transition: 'none', font: st.fonts[v % st.fonts.length], motion: 'none', texts: title ? [{ text: title, at: 0, dur: 1, position: ['bottom', 'middle', 'top'][v], size: 'large', style: ['outline', 'box', 'shadow'][v], anim: 'none', color: '#ffffff' }] : [], keepClipSound: false }));
      } else plans = localPlans(moments, o);
    }
    setP(0.75, 'Putting your edits together…');
    const outs = [];
    for (const plan of plans.slice(0, 3)) {
      const p = await buildFromPlan(plan, byRef, o);
      if (!p) continue;
      const cv = await renderProject(p, 360);
      p.poster = cv.toDataURL('image/jpeg', 0.8); p.posterAR = cv.width / cv.height;
      outs.push({ p, plan });
    }
    if (!outs.length) throw new Error('Couldn’t build an edit from that footage');
    showCreateResults(results, outs, o);
  } catch (e) {
    results.innerHTML = '';
    results.append(h('p', { class: 'hint warn center' }, e.message || String(e)));
  }
}

function showCreateResults(results, outs, o, again) {
  results.innerHTML = '';
  const save = async p => { p.updated = Date.now(); await db.put('projects', p); };
  const grid = h('div', { class: 'gen-grid' });
  for (const { p, plan } of outs) {
    const isVid = p.kind !== 'photo';
    grid.append(h('div', { class: 'gen-card' },
      h('button', { class: 'gen-thumb', onclick: () => isVid ? previewProject(p) : previewCover(p), 'aria-label': 'Preview ' + plan.name },
        h('img', { src: p.poster, alt: '' }), h('span', { class: 'proj-play', html: ic(isVid ? 'play' : 'image') })),
      h('b', {}, plan.name), h('small', {}, plan.why),
      isVid ? h('small', { class: 'gen-meta' }, `${fmtShort(totalDuration(p))} · ${p.clips.length} shots`) : null,
      h('div', { class: 'gen-btns' },
        btn('Edit', 'edit', async () => { await save(p); go('#editor/' + p.id); }, 'ghost'),
        isVid ? btn('Export', 'download', async () => { await save(p); S.exportAfterOpen = true; go('#editor/' + p.id); }, 'primary')
          : btn('Save', 'download', async () => {
            const cv = await renderProject(p, 1440);
            const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.95));
            const r = await importBlob(blob, `${p.name.replace(/^\W+/, '')} cover.jpg`, 'exports');
            if (r) { media.set(r.id, r); toast('Saved to Library → Exports', { label: 'Share', fn: () => shareFiles([r]) }); }
          }, 'primary'))));
  }
  results.append(h('div', { class: 'psec-title' }, o.mode === 'cover' ? 'Your cover images' : 'Your videos — tap one to watch'), grid,
    btn('Make 3 more', 'wand', again || (() => generate(results)), 'ghost block'));
}
function previewCover(p) {
  openSheet(p.name, async b => {
    const cv = await renderProject(p, 1080);
    cv.className = 'result-media';
    b.append(cv);
  }, { wide: true });
}

// ---------------------------------------------------------------- Ask Claude (in the editor)
function askClaudePanel() {
  openPanel('Ask Claude', b => {
    if (!S.prefs.claudeKey) {
      b.append(h('p', { class: 'hint' }, 'Tell Claude what you want — “make it darker and moody”, “add SATURDAY NIGHT at the start”, “cut it to 15 seconds” — and it edits the project for you. It needs a Claude API key.'),
        btn('Add my Claude API key', 'settings', () => { closePanel(); go('#settings'); }, 'primary block'));
      return;
    }
    const log = h('div', { class: 'claude-log' });
    const ta = h('textarea', { class: 'field', rows: 2, placeholder: 'What should Claude change?' });
    const send = btn('Send', 'chat', run, 'primary');
    const sugg = ['Make it punchier', 'Darker, moody look', 'Add a title at the start', 'Sharper and brighter', 'Slow-mo the best part', 'Cut it to about 15 seconds'];
    b.append(log, h('div', { class: 'chips' }, ...sugg.map(s => h('button', { class: 'chip', onclick: () => { ta.value = s; run(); } }, s))),
      h('div', { class: 'with-mic' }, ta, micButton(ta)), send,
      h('p', { class: 'hint' }, 'Claude sees your clips and current settings. Everything it changes can be undone.'));
    async function run() {
      const q = ta.value.trim();
      if (!q) return;
      ta.value = '';
      send.disabled = true;
      log.append(h('div', { class: 'msg me' }, q));
      const thinking = h('div', { class: 'msg ai' }, 'Thinking…');
      log.append(thinking);
      log.scrollTop = log.scrollHeight;
      try {
        const res = await askClaudeJSON({
          apiKey: S.prefs.claudeKey, effort: 'medium',
          system: [
            'You are the editor inside S1 Editor, a phone video editor. The user describes a change; you return a short friendly reply and a list of edit operations.',
            'Only use the operations and values in the schema. Indexes are 0-based. target -1 on a "clip" op means every clip; null means the clip under the playhead.',
            'Adjust values are -100..100 (sharpen, vignette, fade, grain 0..100). filterAmount 0..100. speed 0.1..4. volume 0..200. zoom 50..300. Times are seconds on the timeline, except trimStart/trimEnd which are seconds inside that clip’s source video.',
            'Leave every field you are not changing as null. If something can’t be done with these operations, say so in the reply and return no ops for it.',
          ].join('\n'),
          content: claudeContext(q),
          schema: editSchema({ filters: PRESETS.map(p => p.id), transitions: TRANSITIONS.map(t => t.id), fonts: FONTS, aspects: ASPECTS.map(a => a.id) }),
        });
        const before = snapshot();
        commit(() => applyOps(res.ops || []));
        const changed = snapshot() !== before;
        thinking.textContent = res.reply || (changed ? 'Done.' : 'No changes.');
        if (changed) toast('Claude made changes', { label: 'Undo', fn: undo });
      } catch (e) {
        thinking.textContent = e.message;
        thinking.classList.add('err');
      }
      send.disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  }, 'claude');
}
function claudeContext(request) {
  const p = S.project;
  const L = layout(p);
  const ctx = {
    aspect: p.aspect, background: p.bg, totalSeconds: +engine.total.toFixed(2), playhead: +engine.t.toFixed(2),
    clips: L.map((o, i) => {
      const c = o.clip, m = media.get(c.mediaId);
      return {
        index: i, kind: c.type, file: m?.name, startsAt: +o.start.toFixed(2), length: +o.dur.toFixed(2),
        sourceSeconds: c.type === 'video' ? { in: +c.in.toFixed(2), out: +c.out.toFixed(2), full: +(m?.duration || 0).toFixed(2) } : undefined,
        speed: c.speed, volume: c.muted ? 0 : c.volume, filter: c.filter, filterAmount: c.filterAmount, adjust: c.adjust, fit: c.fit, zoom: c.zoom,
        motion: c.motion, transitionAfter: c.transition, portrait: c.ai?.mode || 'none',
      };
    }),
    texts: p.texts.map((t, i) => ({ index: i, text: t.text, at: t.start, dur: t.dur, y: t.y, size: t.size, style: t.style, font: t.font, color: t.color, anim: t.anim })),
    audio: p.audio.map((a, i) => ({ index: i, name: a.name, startsAt: a.start, length: a.dur, volume: a.volume, fadeIn: a.fadeIn, fadeOut: a.fadeOut })),
  };
  const content = [{ type: 'text', text: `Request: ${request}\n\nProject:\n${JSON.stringify(ctx)}\n\nImages: the current preview frame, then a thumbnail of each clip in order.` }];
  const cur = document.createElement('canvas');
  const { W, H } = engine.outputSize(480);
  cur.width = W; cur.height = H;
  engine.renderFrame(cur.getContext('2d'), W, H, engine.t, false);
  content.push(imageBlock(cur, 480));
  for (const c of p.clips.slice(0, 16)) {
    const th = thumbOf(c.mediaId);
    if (th?.startsWith('data:image/jpeg')) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: th.split(',')[1] } });
  }
  return content;
}
function applyOps(ops) {
  const p = S.project;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const T = () => totalDuration(p);
  const clipsFor = t => t == null ? [target()].filter(Boolean) : t === -1 ? p.clips : [p.clips[t]].filter(Boolean);
  // Deletions last, highest index first, so earlier indexes stay valid.
  const order = { delete_text: 1, delete_clip: 1 };
  ops = [...ops].sort((a, z) => (order[a.op] || 0) - (order[z.op] || 0) || ((order[a.op] && order[z.op]) ? (z.target ?? 0) - (a.target ?? 0) : 0));
  const set = (o, k, v) => { if (v !== null && v !== undefined) o[k] = v; };
  for (const o of ops) {
    switch (o.op) {
      case 'clip':
        for (const c of clipsFor(o.target)) {
          set(c, 'filter', o.filter);
          if (o.filterAmount != null) c.filterAmount = clampN(o.filterAmount, 0, 100);
          c.adjust ||= {};
          for (const k of ['brightness', 'contrast', 'saturation', 'warmth']) if (o[k] != null) c.adjust[k] = clampN(Math.round(o[k]), -100, 100);
          for (const k of ['sharpen', 'vignette', 'fade', 'grain']) if (o[k] != null) c.adjust[k] = clampN(Math.round(o[k]), 0, 100);
          if (o.speed != null && c.type === 'video') c.speed = clampN(o.speed, 0.1, 4);
          if (o.volume != null) { c.volume = clampN(Math.round(o.volume), 0, 200); c.muted = c.volume === 0; }
          set(c, 'muted', o.muted);
          set(c, 'fit', o.fit);
          if (o.zoom != null) c.zoom = clampN(o.zoom, 50, 300);
          set(c, 'motion', o.motion);
          if (o.transition != null) c.transition = { type: o.transition, dur: c.transition?.dur || 0.6 };
          if (o.transitionDur != null) c.transition = { ...(c.transition || { type: 'fade' }), dur: clampN(o.transitionDur, 0.2, 2) };
          if (o.duration != null && c.type === 'image') c.duration = clampN(o.duration, 0.5, 20);
          if (c.type === 'video') {
            const full = media.get(c.mediaId)?.duration || c.out;
            if (o.trimStart != null) c.in = clampN(o.trimStart, 0, c.out - 0.2);
            if (o.trimEnd != null) c.out = clampN(o.trimEnd, c.in + 0.2, full);
          }
          if (o.portrait != null) c.ai = { amount: 60, light: 0, ...(c.ai || {}), mode: o.portrait };
        }
        break;
      case 'add_text':
        p.texts.push({
          id: uid(), text: o.text || 'Text', sticker: false, start: clampN(o.at ?? engine.t, 0, Math.max(0, T() - 0.3)), dur: clampN(o.dur ?? 3, 0.3, Math.max(0.3, T())),
          x: 0.5, y: POS_Y[o.position] ?? 0.5, size: SIZE_V[o.size] ?? 9, font: o.font || 'Montserrat', color: hexOk(o.color) || '#ffffff',
          style: o.style || 'shadow', anim: o.anim || 'fade', rotate: 0, opacity: 100,
        });
        if (p.kind === 'photo') { const t = p.texts[p.texts.length - 1]; t.start = 0; t.dur = 9999; }
        break;
      case 'edit_text': {
        const t = p.texts[o.target];
        if (!t) break;
        set(t, 'text', o.text); if (o.at != null) t.start = clampN(o.at, 0, T()); if (o.dur != null) t.dur = clampN(o.dur, 0.3, T());
        if (o.position) t.y = POS_Y[o.position]; if (o.size) t.size = SIZE_V[o.size];
        set(t, 'font', o.font); if (hexOk(o.color)) t.color = o.color; set(t, 'style', o.style); set(t, 'anim', o.anim);
        break;
      }
      case 'delete_text': if (p.texts[o.target]) p.texts.splice(o.target, 1); break;
      case 'delete_clip': if (p.clips[o.target] && p.clips.length > 1) p.clips.splice(o.target, 1); break;
      case 'move_clip': {
        const c = p.clips[o.target];
        if (!c || o.to == null) break;
        p.clips.splice(o.target, 1); p.clips.splice(clampN(o.to, 0, p.clips.length), 0, c);
        break;
      }
      case 'canvas':
        set(p, 'aspect', o.aspect);
        if (o.bgType) p.bg = { ...p.bg, type: o.bgType, ...(o.bgType === 'color' ? { color: hexOk(o.bgColor) || p.bg.color || '#000000' } : {}) };
        else if (hexOk(o.bgColor)) p.bg = { ...p.bg, type: 'color', color: o.bgColor };
        break;
      case 'audio': {
        const a = p.audio[o.target ?? 0];
        if (!a) break;
        if (o.volume != null) a.volume = clampN(Math.round(o.volume), 0, 200);
        if (o.fadeIn != null) a.fadeIn = clampN(o.fadeIn, 0, 5); if (o.fadeOut != null) a.fadeOut = clampN(o.fadeOut, 0, 5);
        if (o.at != null) a.start = clampN(o.at, 0, T()); if (o.dur != null) a.dur = Math.max(0.5, o.dur);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- References (learn from edits you like)
async function loadRefs() { return (await db.get('settings', 'references'))?.list || []; }
async function saveRefs(list) { await db.put('settings', { id: 'references', list }); }
const ytId = u => (u.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/) || [])[1];
const platformOf = u => /instagram\.com/.test(u) ? 'Instagram' : /youtu/.test(u) ? 'YouTube' : /tiktok\.com/.test(u) ? 'TikTok' : 'Link';

// Color "fingerprint" of a frame: exposure, contrast, saturation, warmth, tint, black/white points, vignette.
function colorStats(canvas) {
  const w = canvas.width, hh = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh).data;
  const hist = new Uint32Array(256);
  let n = 0, sl = 0, sl2 = 0, ss = 0, sr = 0, sg = 0, sb = 0, cl = 0, cn = 0, el = 0, en = 0;
  for (let y = 0; y < hh; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    hist[l | 0]++; sl += l; sl2 += l * l; n++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    ss += mx ? (mx - mn) / mx : 0; sr += r; sg += g; sb += b;
    const dx = x / w - 0.5, dy = y / hh - 0.5, rr = dx * dx + dy * dy;
    if (rr < 0.04) { cl += l; cn++; } else if (rr > 0.17) { el += l; en++; }
  }
  const pct = q => { let a = 0; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= n * q) return i; } return 255; };
  const mean = sl / n;
  return { mean, std: Math.sqrt(Math.max(0, sl2 / n - mean * mean)), sat: ss / n, warm: (sr - sb) / n, tint: (sg - (sr + sb) / 2) / n, lo: pct(0.03), hi: pct(0.97), vig: cn && en ? (el / en) / Math.max(1, cl / cn) : 1 };
}
function avgStats(list) {
  const out = {};
  for (const k of Object.keys(list[0])) out[k] = list.reduce((s, x) => s + x[k], 0) / list.length;
  return out;
}
const NEUTRAL = { mean: 118, std: 58, sat: 0.32, warm: 8, tint: 2, lo: 8, hi: 245, vig: 0.92 };
// Slider values that move `user` footage toward the `ref` look (calibrated to the Adjust shader).
function matchLook(ref, user = NEUTRAL, k = 1) {
  const c = (v, a, b) => Math.round(Math.max(a, Math.min(b, v * k)));
  return {
    brightness: c((ref.mean - user.mean) * 0.9, -60, 60),
    contrast: c((ref.std / Math.max(1, user.std) - 1) * 100, -50, 60),
    saturation: c((ref.sat / Math.max(0.02, user.sat) - 1) * 100, -100, 70),
    warmth: c((ref.warm - user.warm) * 1.6, -60, 60),
    tint: c((ref.tint - user.tint) * 3, -40, 40),
    fade: c((Math.max(0, ref.lo - 6) - Math.max(0, user.lo - 6)) * 3.5, 0, 60),
    vignette: c((user.vig - ref.vig) * 120, 0, 70),
    highlights: c(Math.min(0, ref.hi - user.hi) * 0.8, -40, 0),
    shadows: 0, sharpen: 15, grain: 0,
  };
}
function describeLook(s) {
  const bits = [];
  bits.push(s.mean < 90 ? 'dark & moody' : s.mean > 150 ? 'bright & airy' : 'balanced exposure');
  bits.push(s.std > 70 ? 'punchy contrast' : s.std < 45 ? 'soft, low contrast' : 'medium contrast');
  bits.push(s.sat < 0.15 ? 'black & white / muted' : s.sat > 0.45 ? 'vivid color' : s.sat < 0.26 ? 'muted color' : 'natural color');
  if (s.warm > 25) bits.push('warm tones'); else if (s.warm < -8) bits.push('cool / blue tones');
  if (s.lo > 22) bits.push('faded blacks (film look)');
  if (s.vig < 0.75) bits.push('dark corners (vignette)');
  return bits.join(' · ');
}

const once2 = (el, ev, ms) => new Promise(r => { const t = setTimeout(() => r(false), ms); el.addEventListener(ev, () => { clearTimeout(t); r(true); }, { once: true }); });
// Find every cut, the pacing, dips to black, the beat, the look, and a keyframe per shot.
async function analyzeRef(m, onStep) {
  if (m.kind === 'image') {
    const cv = await frameCanvas(m, 512);
    const stats = colorStats(cv);
    return { kind: 'image', aspect: cv.width / cv.height, look: stats, lookText: describeLook(stats), keyframes: [{ t: 0, img: cv.toDataURL('image/jpeg', 0.75), stats }] };
  }
  const url = URL.createObjectURL(m.blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  const res = { kind: 'video' };
  try {
    await once2(v, 'loadeddata', 10000);
    const dur = isFinite(v.duration) && v.duration ? v.duration : (m.duration || 0);
    res.duration = dur; res.aspect = v.videoWidth / v.videoHeight;
    const step = Math.max(1 / 8, dur / 480);
    const sw = 48, sh = Math.max(8, Math.round(48 / res.aspect));
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const x = c.getContext('2d', { willReadFrequently: true });
    let prev = null; const diffs = [], lumas = [], times = [];
    for (let t = 0; t < dur; t += step) {
      v.currentTime = t; await once2(v, 'seeked', 4000);
      x.drawImage(v, 0, 0, sw, sh);
      const d = x.getImageData(0, 0, sw, sh).data;
      let lum = 0, diff = 0;
      for (let i = 0; i < d.length; i += 4) { lum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; if (prev) diff += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]); }
      lumas.push(lum / (sw * sh)); times.push(t); diffs.push(prev ? diff / (sw * sh * 3 * 255) : 0);
      prev = d.slice();
      onStep?.(Math.min(0.7, t / dur * 0.7));
    }
    const sorted = [...diffs].sort((a, b) => a - b), med = sorted[sorted.length >> 1] || 0;
    const thr = Math.max(0.09, med * 3 + 0.05);
    const cuts = [0], dips = [];
    for (let i = 1; i < diffs.length; i++) {
      if (diffs[i] > thr && diffs[i] >= (diffs[i - 1] || 0) && diffs[i] >= (diffs[i + 1] || 0) && times[i] - cuts[cuts.length - 1] > 0.25) cuts.push(+(times[i] - step / 2).toFixed(2));
      if (lumas[i] < 14 && lumas[i - 1] >= 14) dips.push(+times[i].toFixed(2));
    }
    res.shots = cuts.map((s, i) => ({ start: s, end: i + 1 < cuts.length ? cuts[i + 1] : +dur.toFixed(2) })).filter(s => s.end - s.start > 0.05);
    res.avgShot = dur / res.shots.length;
    res.dips = dips;
    // Keyframe in the middle of each shot (up to 24).
    const pickShots = res.shots.length <= 24 ? res.shots : Array.from({ length: 24 }, (_, i) => res.shots[Math.floor(i * res.shots.length / 24)]);
    res.keyframes = [];
    await framesAt(m, pickShots.map(s => (s.start + s.end) / 2), (cv, t) => {
      const stats = colorStats(cv);
      res.keyframes.push({ t: +t.toFixed(2), img: cv.toDataURL('image/jpeg', 0.72), stats });
      onStep?.(0.7 + 0.25 * res.keyframes.length / pickShots.length);
    }, 320);
    res.look = avgStats(res.keyframes.map(k => k.stats));
    res.lookText = describeLook(res.look);
    // Beat of the reference's own audio, and whether its cuts follow it.
    try {
      const buf = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(await m.blob.arrayBuffer());
      if (buf.duration > 2) {
        const a = analyzeMusic(buf);
        res.bpm = a.bpm;
        const beat = 60 / a.bpm;
        const ints = res.shots.map(s => (s.end - s.start) / beat);
        res.onBeat = ints.length ? ints.filter(q => Math.abs(q - Math.round(q)) < 0.2 && Math.round(q) >= 1).length / ints.length : 0;
      }
    } catch { }
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
  return res;
}
const nearestAspect = ar => ['9:16', '4:5', '1:1', '16:9', '3:4', '4:3'].map(id => { const [a, b] = id.split(':').map(Number); return { id, d: Math.abs(Math.log(ar / (a / b))) }; }).sort((x, y) => x.d - y.d)[0].id;

async function showRefs() {
  show('refs');
  await loadMedia();
  const refs = (await loadRefs()).sort((a, b) => b.created - a.created);
  const body = $('#refsBody');
  body.innerHTML = '';
  const link = h('input', { class: 'field', type: 'url', placeholder: 'Paste an Instagram, TikTok or YouTube link…' });
  const addLink = async () => {
    const u = link.value.trim();
    if (!/^https?:\/\//.test(u)) return toast('Paste a full link (starting with https://)');
    const list = await loadRefs();
    const r = { id: uid(), name: `${platformOf(u)} reference`, link: u, created: Date.now() };
    list.push(r); await saveRefs(list);
    go('#ref/' + r.id);
  };
  link.addEventListener('keydown', e => e.key === 'Enter' && addLink());
  const upload = async (accept) => {
    const files = await pickFiles(accept, false);
    if (!files.length) return;
    const [m] = await importFiles(files, 'refs');
    if (!m) return;
    media.set(m.id, m);
    const list = await loadRefs();
    const r = { id: uid(), name: m.name.replace(/\.[^.]+$/, ''), mediaId: m.id, created: Date.now() };
    list.push(r); await saveRefs(list);
    go('#ref/' + r.id);
  };
  body.append(section('Add something you like',
    h('p', { class: 'hint' }, 'A video or photo edit you want to recreate: a screen recording, a saved video, a screenshot — or a link.'),
    h('div', { class: 'big-actions' },
      h('button', { class: 'big', onclick: () => upload('video/*') }, h('span', { html: ic('video') }), 'Video or screen recording', h('small', {}, 'Best for reels and edits — the AI can see every cut')),
      h('button', { class: 'big', onclick: () => upload('image/*') }, h('span', { html: ic('image') }), 'Photo edit or screenshot', h('small', {}, 'Copy a color look or a cover/thumbnail style'))),
    h('div', { class: 'link-row' }, link, btn('Add', 'plus', addLink, 'primary')),
    h('p', { class: 'hint' }, 'Tip: on Instagram, tap Share → S1 Editor to save a link here in one tap (after installing the app).')));
  if (refs.length) {
    const grid = h('div', { class: 'gen-grid' });
    for (const r of refs) {
      const thumb = r.analysis?.keyframes?.[0]?.img || (r.mediaId && media.get(r.mediaId)?.thumb) || (r.link && ytId(r.link) ? `https://i.ytimg.com/vi/${ytId(r.link)}/hqdefault.jpg` : '');
      grid.append(h('button', { class: 'gen-card ref-card', onclick: () => go('#ref/' + r.id) },
        h('span', { class: 'gen-thumb' }, thumb ? h('img', { src: thumb, alt: '' }) : h('span', { class: 'tile-ic', html: ic('link') })),
        h('b', {}, r.name),
        h('small', {}, r.analysis ? (r.analysis.kind === 'video' ? `${r.analysis.shots.length} shots · ${fmtShort(r.analysis.duration)}${r.analysis.bpm ? ' · ' + r.analysis.bpm + ' BPM' : ''}` : r.analysis.lookText) : r.link ? platformOf(r.link) + ' link' : 'Not studied yet')));
    }
    body.append(section('Your references', grid));
  }
}

async function showRef(id) {
  show('ref');
  await loadMedia();
  const list = await loadRefs();
  const r = list.find(x => x.id === id);
  if (!r) return go('#refs');
  const persist = async () => { const l = await loadRefs(); const i = l.findIndex(x => x.id === r.id); if (i >= 0) l[i] = r; else l.push(r); await saveRefs(l); };
  $('#refTitle').textContent = r.name;
  const body = $('#refBody');
  body.innerHTML = '';
  const m = r.mediaId ? media.get(r.mediaId) : null;
  const top = h('div', { class: 'psec' });
  if (m) {
    const url = URL.createObjectURL(m.blob);
    top.append(m.kind === 'video' ? h('video', { src: url, controls: true, playsinline: true, muted: true, class: 'result-media ref-media' }) : h('img', { src: url, class: 'result-media ref-media', alt: r.name }));
  }
  if (r.link) top.append(h('a', { class: 'btn ghost block', href: r.link, target: '_blank', rel: 'noopener', html: ic('link') + `Open on ${platformOf(r.link)}` }));
  if (!m) top.append(h('div', { class: 'ai-banner' },
    h('b', { html: ic('video') + 'Let the AI see it' }),
    h('p', {}, `Apps can’t pull videos out of ${platformOf(r.link || '')}. Open it, screen-record it (swipe down → Screen recorder), then add the recording here.`),
    btn('Add the screen recording', 'upload', async () => {
      const files = await pickFiles('video/*,image/*', false);
      if (!files.length) return;
      const [mm] = await importFiles(files, 'refs');
      if (!mm) return;
      media.set(mm.id, mm); r.mediaId = mm.id; delete r.analysis; await persist(); showRef(r.id);
    }, 'primary')));
  const name = h('input', { class: 'field', value: r.name, maxlength: 60 });
  name.addEventListener('change', async () => { r.name = name.value.trim() || r.name; $('#refTitle').textContent = r.name; await persist(); });
  const note = h('textarea', { class: 'field', rows: 2, placeholder: 'What do you like about it? (the transitions, the color, the timing…)', value: r.note || '' });
  note.addEventListener('change', async () => { r.note = note.value; await persist(); });
  top.append(name, h('div', { class: 'with-mic' }, note, micButton(note)));
  body.append(top);
  if (!m) return;

  const recipe = h('div');
  body.append(recipe);
  if (!r.analysis) {
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
    recipe.append(h('div', { class: 'exporting' }, h('p', { class: 'hint center' }, 'Studying the edit — cuts, pacing, beat and color…'), bar));
    try {
      r.analysis = await analyzeRef(m, f => { bar.firstChild.style.width = Math.round(f * 100) + '%'; });
      await persist();
    } catch (e) { recipe.innerHTML = ''; recipe.append(h('p', { class: 'hint warn' }, 'Couldn’t read that file: ' + e.message)); return; }
  }
  const A = r.analysis;
  recipe.innerHTML = '';
  const strip = h('div', { class: 'keyframes' }, ...A.keyframes.map((k, i) => h('div', { class: 'kf' }, h('img', { src: k.img, alt: '' }), h('span', {}, A.kind === 'video' ? `${i + 1}` : ''))));
  recipe.append(h('div', { class: 'rec-card' },
    h('div', { class: 'rec-title', html: ic('wand') + 'What makes it work' }),
    h('div', { class: 'rec-specs' },
      A.kind === 'video' ? [
        h('div', {}, h('small', {}, 'Length'), h('b', {}, fmtShort(A.duration))),
        h('div', {}, h('small', {}, 'Shots'), h('b', {}, String(A.shots.length))),
        h('div', {}, h('small', {}, 'Avg shot'), h('b', {}, A.avgShot.toFixed(1) + 's')),
        A.bpm ? h('div', {}, h('small', {}, 'Beat'), h('b', {}, A.bpm + ' BPM')) : null,
        A.bpm ? h('div', {}, h('small', {}, 'Cuts on beat'), h('b', {}, Math.round((A.onBeat || 0) * 100) + '%')) : null,
      ] : null,
      h('div', {}, h('small', {}, 'Shape'), h('b', {}, nearestAspect(A.aspect)))),
    h('p', { class: 'hint' }, 'Look: ' + A.lookText),
    A.kind === 'video' ? h('p', { class: 'hint' }, A.avgShot < 0.9 ? 'Pacing: very fast cuts — high energy.' : A.avgShot < 1.8 ? 'Pacing: quick cuts that keep it moving.' : A.avgShot < 3.5 ? 'Pacing: relaxed — each shot gets a moment.' : 'Pacing: slow and cinematic.') : null),
    section(A.kind === 'video' ? 'Shot by shot' : '', strip));

  // Your footage + actions
  r.items = (r.items || []).filter(id => media.get(id));
  const fstrip = h('div', { class: 'grid pick create-strip' });
  const paintF = () => {
    fstrip.innerHTML = '';
    r.items.forEach((id, i) => { const t = mediaTile(media.get(id), () => { r.items.splice(i, 1); paintF(); persist(); }); t.append(h('span', { class: 'peek', html: ic('close') })); fstrip.append(t); });
    fstrip.append(h('button', {
      class: 'tile add-tile', html: ic('plus') + '<span>Add</span>', onclick: async () => {
        const picked = await pickMedia({ kinds: A.kind === 'image' ? ['image'] : ['video', 'image'], title: 'Your footage to use' });
        for (const x of picked) if (!r.items.includes(x.id)) r.items.push(x.id);
        paintF(); persist();
      },
    }));
  };
  paintF();
  const out = h('div', { class: 'create-results' });
  const hasKey = !!S.prefs.claudeKey;
  r.useClaude ??= true;
  body.append(section('Your footage', h('p', { class: 'hint' }, A.kind === 'video' ? 'Add the clips you want to use — the AI matches each shot of the reference to your most similar moment.' : 'Add the photo(s) you want to give this look.'), fstrip),
    hasKey ? chips([{ id: true, label: '🧠 Claude (understands the content)' }, { id: false, label: '⚡ On-device (instant, free)' }], r.useClaude, v => { r.useClaude = v; }) : null,
    h('div', { class: 'row-btns' },
      btn('Make it for me', 'wand', () => refMake(r, A, out, false), 'primary'),
      btn('Show me how', 'info', () => refMake(r, A, out, true), 'ghost')),
    out,
    btn('Delete this reference', 'trash', async () => {
      if (!(await confirmSheet('Delete this reference? (Your own footage isn’t touched.)', 'Delete', true))) return;
      await saveRefs((await loadRefs()).filter(x => x.id !== r.id)); go('#refs');
    }, 'ghost danger block'));
}

// Build edits that copy the reference (and/or a step-by-step guide).
async function refMake(r, A, out, guideOnly) {
  const items = r.items.map(id => media.get(id)).filter(Boolean);
  if (!guideOnly && !items.length) return toast('Add some of your footage first');
  out.innerHTML = '';
  const status = h('p', { class: 'hint center gen-status' }, 'Working…');
  const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
  out.append(h('div', { class: 'exporting' }, status, bar));
  const setP = (f, msg) => { bar.firstChild.style.width = Math.round(f * 100) + '%'; if (msg) status.textContent = msg; };
  const useClaude = !!S.prefs.claudeKey && r.useClaude;
  try {
    let moments = [];
    if (items.length) {
      let k = 0; const total = items.reduce((s, m) => s + (m.kind === 'video' ? 6 : 1), 0);
      moments = await collectMoments(items, true, () => setP(0.05 + 0.35 * Math.min(1, ++k / total), 'Looking through your footage…'));
      for (const mo of moments) if (mo.canvas) mo.stats = colorStats(mo.canvas);
    }
    const userLook = moments.length ? avgStats(moments.filter(m => m.stats).map(m => m.stats)) : NEUTRAL;
    const look = matchLook(A.look, userLook);
    const aspect = nearestAspect(A.aspect);
    let guide = null, plans = [];
    const byRef = new Map(moments.map(m => [m.ref, m]));

    if (useClaude) {
      setP(0.45, 'Claude is studying the reference…');
      const content = [{ type: 'text', text: [
        `REFERENCE (${A.kind}): "${r.name}"${r.link ? ' from ' + r.link : ''}. The user says: ${r.note || '(no note)'}`,
        A.kind === 'video' ? `Measured: ${fmtShort(A.duration)} long, ${A.shots.length} shots, average shot ${A.avgShot.toFixed(2)}s, shot lengths: ${A.shots.slice(0, 40).map(s => (s.end - s.start).toFixed(2)).join(', ')}${A.bpm ? `, music ${A.bpm} BPM, ${Math.round((A.onBeat || 0) * 100)}% of cuts on the beat` : ''}${A.dips.length ? `, ${A.dips.length} dips to black` : ''}.` : '',
        `Shape ${aspect}. Color look: ${A.lookText}. Matched slider values for the user's footage: ${JSON.stringify(look)}.`,
        'Reference keyframes follow (R1, R2… in order).',
      ].join('\n') }];
      A.keyframes.forEach((kf, i) => { content.push({ type: 'text', text: `R${i + 1}${A.kind === 'video' ? ` at ${kf.t}s` : ''}` }); content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: kf.img.split(',')[1] } }); });
      if (moments.length) {
        content.push({ type: 'text', text: `USER FOOTAGE — ${moments.length} moments. Video refs are V<video>@<seconds>; photo refs are P<photo>.` });
        for (const mo of moments) { content.push({ type: 'text', text: mo.t != null ? `${mo.ref} — "${mo.m.name}", moment at ${mo.t}s` : `${mo.ref} — photo "${mo.m.name}"` }); content.push(imageBlock(mo.canvas)); }
      } else content.push({ type: 'text', text: 'The user hasn’t added footage yet — return an empty variations list and write the guide and shot list as instructions for what to film or pick.' });
      const res = await askClaudeJSON({
        apiKey: S.prefs.claudeKey, effort: 'medium', content,
        system: [
          'You are the editor inside S1 Editor, a phone video/photo editor for a DJ, photographer and content creator. The user shows you an edit they love and wants to recreate it with their own footage.',
          'summary: 2–3 sentences on what makes the reference work (hook, pacing, transitions, text, color, mood). look: one sentence on the color grade.',
          'steps: a clear numbered recipe for doing it by hand in this app, naming its tools exactly: Canvas, Background, Trim, Split, Speed, Filter, Adjust (Brightness, Contrast, Saturation, Warmth, Tint, Highlights, Shadows, Sharpen, Vignette, Fade, Grain), AI (portrait blur/cut-out), Text, Sticker, Music, Transition (button between clips), Motion, Export. Give concrete numbers (seconds, slider values, fonts). 6–10 steps.',
          'shotList: one entry per reference keyframe (ref R1, R2…): describe what that shot shows and, in "use", which of the user’s moment refs fits best (or what to look for if none fit).',
          'variations: if footage was given, 3 versions that follow the reference’s structure with the user’s moments — same pacing and order of shot types; variation 1 closest to the reference, the others looser. Only use given refs. Text: copy the reference’s on-screen text style; use the user’s note for wording if any.',
          `filter: the closest preset to the reference look (the matched slider values will also be applied).`,
        ].join('\n'),
        schema: refSchema({ filters: PRESETS.map(p => p.id), transitions: TRANSITIONS.map(t => t.id), fonts: FONTS }),
      });
      guide = { summary: res.summary, look: res.look, steps: res.steps, shotList: res.shotList, filter: res.filter };
      plans = res.variations || [];
      plans.forEach(p => { p.filter = res.filter || p.filter; });
    } else {
      setP(0.5, 'Matching shots to your footage…');
      guide = localGuide(A, look, aspect);
      if (moments.length && A.kind === 'video') plans = await localRefPlans(A, moments);
      else if (moments.length) plans = moments.slice(0, 3).map((mo, i) => ({ name: ['Look match', 'Look match B', 'Look match C'][i], why: 'Your photo with the reference’s color look.', shots: [{ ref: mo.ref, dur: 1 }], filter: 'none', transition: 'none', font: 'Montserrat', motion: 'none', texts: [], keepClipSound: true }));
    }
    if (guideOnly || !plans.length) { showGuide(out, guide, A, byRef, r); return; }

    setP(0.8, 'Putting your versions together…');
    const o = { mode: A.kind === 'image' ? 'cover' : 'reel', style: 'clean', desc: r.note || '', title: '', format: aspect, music: 'clip', length: A.duration || 15 };
    const outs = [];
    for (const plan of plans.slice(0, 3)) {
      const p = await buildFromPlan(plan, byRef, o);
      if (!p) continue;
      p.name = '📌 ' + (plan.name || r.name);
      for (const c of p.clips) {
        // Color-match to the reference (softer when Claude also picked a preset).
        c.adjust = useClaude && plan.filter !== 'none' ? Object.fromEntries(Object.entries(look).map(([k, v]) => [k, Math.round(v * 0.6)])) : { ...look };
        c.filterAmount = useClaude ? 60 : 0;
        if (!useClaude) c.filter = 'none';
        if (A.dips?.length > 1) c.transition = { type: 'black', dur: 0.5 };
      }
      if (p.clips.length) p.clips[p.clips.length - 1].transition = { type: 'none', dur: 0.5 };
      const cv = await renderProject(p, 360);
      p.poster = cv.toDataURL('image/jpeg', 0.8); p.posterAR = cv.width / cv.height;
      outs.push({ p, plan: { name: plan.name, why: plan.why } });
    }
    showCreateResults(out, outs, o, () => refMake(r, A, out, false));
    out.append(btn('Show me how instead', 'info', () => showGuide(out, guide, A, byRef, r, true), 'ghost block'));
  } catch (e) {
    out.innerHTML = '';
    out.append(h('p', { class: 'hint warn center' }, e.message || String(e)));
  }
}

// On-device: same timing as the reference, each slot filled with your most similar moment.
async function localRefPlans(A, moments) {
  let sim;
  if (S.prefs.aiSearch) {
    try {
      const refV = [];
      for (const kf of A.keyframes) { const img = new Image(); img.src = kf.img; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); refV.push(await embedImage(c)); }
      for (const mo of moments) mo.vec = await embedImage(mo.canvas);
      sim = (i, mo) => dot(refV[i], mo.vec);
    } catch { sim = null; }
  }
  if (!sim) {
    // Fallback: compare color fingerprints (brightness, color, contrast).
    sim = (i, mo) => { const a = A.keyframes[i].stats, b = mo.stats; return -(Math.abs(a.mean - b.mean) / 60 + Math.abs(a.sat - b.sat) * 3 + Math.abs(a.warm - b.warm) / 40 + Math.abs(a.std - b.std) / 40); };
  }
  const slots = A.shots.length <= 24 ? A.shots.map((s, i) => ({ dur: s.end - s.start, kf: i })) : A.shots.map((s, i) => ({ dur: s.end - s.start, kf: Math.min(23, Math.floor(i * 24 / A.shots.length)) }));
  const fill = (rank) => {
    const used = new Map(); let last = null;
    return slots.map(sl => {
      const ranked = moments.map(mo => ({ mo, s: sim(sl.kf, mo) - (used.get(mo.ref) || 0) * 0.08 })).filter(x => x.mo !== last).sort((a, z) => z.s - a.s);
      const pick = (ranked[Math.min(rank, ranked.length - 1)] || ranked[0]).mo;
      used.set(pick.ref, (used.get(pick.ref) || 0) + 1); last = pick;
      return { ref: pick.ref, dur: Math.max(0.3, sl.dur) };
    });
  };
  const chrono = slots.map((sl, i) => ({ ref: moments[Math.floor(i * moments.length / slots.length)].ref, dur: Math.max(0.3, sl.dur) }));
  const base = { filter: 'none', transition: 'none', font: 'Montserrat', motion: 'none', texts: [], keepClipSound: true };
  return [
    { ...base, name: 'Closest match', why: 'Same cuts and timing as the reference, each shot matched to your most similar moment.', shots: fill(0) },
    { ...base, name: 'Alternate picks', why: 'Same timing, using your next-best matching moments.', shots: fill(1) },
    { ...base, name: 'Your story', why: 'The reference’s rhythm with your footage in the order it happened.', shots: chrono },
  ];
}

function localGuide(A, look, aspect) {
  const steps = [];
  steps.push({ title: `Set the shape to ${aspect}`, detail: `Tap Canvas → ${aspect}. Then Fit/Fill → Fill so your clips cover the frame like the reference.` });
  if (A.kind === 'video') {
    steps.push({ title: `Plan about ${A.shots.length} shots`, detail: `The reference is ${fmtShort(A.duration)} long with ${A.shots.length} cuts — about ${A.avgShot.toFixed(1)}s per shot. Add your clips (the + at the end of the timeline). Use the shot-by-shot strip above to pick a similar moment for each.` });
    steps.push({ title: 'Trim each clip to its moment', detail: `Select a clip → Trim, or put the playhead on the moment and use Split, then Delete the extra. Keep most shots around ${A.avgShot.toFixed(1)}s${A.avgShot < 1.2 ? ' — fast, punchy cuts' : ''}.` });
    if (A.bpm) steps.push({ title: `Cut on the beat (${A.bpm} BPM)`, detail: `Add your song in Music. One beat is ${(60 / A.bpm).toFixed(2)}s, so make shots ${(60 / A.bpm).toFixed(2)}s, ${(120 / A.bpm).toFixed(2)}s or ${(240 / A.bpm).toFixed(2)}s long. ${Math.round((A.onBeat || 0) * 100)}% of the reference’s cuts land on the beat.` });
    steps.push({ title: A.dips.length > 1 ? 'Transitions: dip to black' : 'Transitions: hard cuts', detail: A.dips.length > 1 ? 'Tap the small square between clips → Dip black, about 0.5s.' : 'Leave the squares between clips on None — the reference uses straight cuts, which feel faster.' });
  }
  const L = Object.entries(look).filter(([k, v]) => v && k !== 'sharpen');
  steps.push({ title: 'Copy the color look', detail: `Look: ${A.lookText}. Open Adjust and set ${L.map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)} ${v > 0 ? '+' : ''}${v}`).join(', ') || 'small tweaks only — it’s close to natural'}${A.kind === 'video' ? ', then tap “Apply to all clips”' : ''}.` });
  steps.push({ title: 'Sharpen a touch', detail: 'Adjust → Sharpen 15–25, or ✨ Enhance first and then the look.' });
  steps.push({ title: 'Export for where it’s going', detail: 'Tap Export, pick Instagram Reels / TikTok / YouTube and it sets the best size and quality.' });
  return { summary: A.kind === 'video' ? `${A.shots.length} shots in ${fmtShort(A.duration)} (${A.avgShot.toFixed(1)}s each)${A.bpm ? `, cut to ${A.bpm} BPM` : ''}. ${A.lookText}.` : `Photo look: ${A.lookText}.`, look: A.lookText, steps, shotList: null };
}

function showGuide(out, guide, A, byRef, r, keep) {
  if (!keep) out.innerHTML = '';
  const list = h('ol', { class: 'guide' }, ...guide.steps.map(s => h('li', {}, h('b', {}, s.title), h('p', {}, s.detail))));
  const shots = guide.shotList?.length ? h('div', { class: 'shotlist' }, ...guide.shotList.map(s => {
    const i = parseInt((s.ref || '').slice(1), 10) - 1;
    const kf = A.keyframes[i];
    const use = byRef.get((s.use || '').trim());
    return h('div', { class: 'shot-row' },
      kf ? h('img', { src: kf.img, alt: '' }) : null,
      h('div', {}, h('b', {}, s.ref), h('p', {}, s.describe), h('small', {}, use ? `Use: ${use.m.name}${use.t != null ? ' at ' + use.t + 's' : ''}` : s.use)),
      use?.canvas ? h('img', { src: use.canvas.toDataURL('image/jpeg', 0.7), alt: '' }) : null);
  })) : null;
  out.append(h('div', { class: 'rec-card' }, h('div', { class: 'rec-title', html: ic('info') + 'How to make it' }), h('p', { class: 'hint' }, guide.summary)),
    list, shots ? section('Shot list', shots) : null,
    r.items?.length ? btn('Now make it for me', 'wand', () => refMake(r, A, out, false), 'primary block') : h('p', { class: 'hint center' }, 'Add your footage above and tap “Make it for me” to have it built for you.'));
}

// ---------------------------------------------------------------- wiring
$('#newVideo').onclick = () => createProject('video');
$('#newPhoto').onclick = () => createProject('photo');
$('#openLibrary').onclick = () => go('#library');
$('#openCreate').onclick = () => go('#create');
$('#openRefs').onclick = () => go('#refs');
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
$('#edBack').onclick = () => go('#home');
$('#playBtn').onclick = () => engine.toggle();
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#exportBtn').onclick = exportFlow;
$$('.search-btn').forEach(b => b.addEventListener('click', openSearch));
$('#projName').addEventListener('change', e => { if (S.project) { S.project.name = e.target.value.trim() || S.project.name; saveProject(); } });
$('#libImport').onclick = async () => {
  const files = await pickFiles('video/*,image/*,audio/*', true);
  if (!files.length) return;
  const folder = ['all', 'root'].includes(S.lib.folder) ? null : S.lib.folder;
  const recs = await importFiles(files, folder);
  if (recs.length) toast(`Imported ${recs.length} item${recs.length > 1 ? 's' : ''}`);
  showLibrary();
  runIndexer();
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if (e.key === 'Escape') closePanel();
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; });
window.addEventListener('pagehide', () => saveProject.flush());
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveProject.flush(); if (!engine.exportTarget) engine.pause(); } });

// ---------------------------------------------------------------- boot
(async function boot() {
  S.prefs = { ...DEFAULT_PREFS, ...(await db.get('settings', 'prefs') || {}) };
  if ((S.prefs.v || 1) < 2) {
    // v2: the default look changed from pink/purple to blue & black.
    if (S.prefs.accent === '#ff6fb5') S.prefs.accent = DEFAULT_PREFS.accent;
    if (S.prefs.theme === 'dusk') S.prefs.theme = 'blueblack';
    if (S.prefs.panelColor === '#120f1e') S.prefs.panelColor = DEFAULT_PREFS.panelColor;
    S.prefs.v = 2; savePrefs();
  }
  await applyTheme();
  const params = new URLSearchParams(location.search);
  const shared = await finishPendingImports();
  if (params.has('reflink')) { history.replaceState(null, '', location.pathname + '#refs'); toast('Saved to References'); }
  if (params.has('shared')) {
    history.replaceState(null, '', location.pathname + '#library');
    S.lib.folder = 'shared';
    toast(`${params.get('shared') || shared} file(s) received`);
  }
  route();
  if (S.prefs.aiSearch) setTimeout(runIndexer, 4000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
