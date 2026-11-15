// Small DOM helpers: element builder, toasts, bottom sheets, sliders, chips.
import { ic } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

export const fmtTime = t => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
export const fmtShort = t => t >= 60 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : `${(Math.round(t * 10) / 10).toFixed(1)}s`;
export const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';

let toastTimer;
export function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = '';
  t.append(h('span', {}, msg));
  if (action) t.append(h('button', { onclick: () => { t.classList.remove('show'); action.fn(); } }, action.label));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 4500 : 2600);
}

// Bottom sheet (modal). Returns a close function.
export function openSheet(title, build, { onClose, wide } = {}) {
  const root = $('#sheets');
  const back = h('div', { class: 'sheet-back' });
  const card = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title || 'Dialog' });
  const close = () => {
    if (!back.isConnected) return;
    back.classList.remove('show');
    setTimeout(() => back.remove(), 220);
    onClose?.();
  };
  card.append(h('div', { class: 'sheet-grab' }));
  if (title) card.append(h('div', { class: 'sheet-head' }, h('h3', {}, title),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', html: ic('close'), onclick: close })));
  const body = h('div', { class: 'sheet-body' });
  card.append(body);
  back.append(card);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  root.append(back);
  build(body, close);
  requestAnimationFrame(() => back.classList.add('show'));
  return close;
}

export function confirmSheet(message, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    let answered = false;
    const close = openSheet(null, (b, close) => {
      b.append(h('p', { class: 'sheet-msg' }, message),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn ghost', onclick: () => { answered = true; res(false); close(); } }, 'Cancel'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { answered = true; res(true); close(); } }, okLabel)));
    }, { onClose: () => { if (!answered) res(false); } });
    return close;
  });
}

export function promptSheet(title, value = '', okLabel = 'Save') {
  return new Promise(res => {
    let answered = false;
    openSheet(title, (b, close) => {
      const inp = h('input', { class: 'field', value, maxlength: 80 });
      const ok = () => { answered = true; res(inp.value.trim() || null); close(); };
      inp.addEventListener('keydown', e => e.key === 'Enter' && ok());
      b.append(inp, h('div', { class: 'row-btns' },
        h('button', { class: 'btn ghost', onclick: () => { answered = true; res(null); close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: ok }, okLabel)));
      setTimeout(() => { inp.focus(); inp.select(); }, 250);
    }, { onClose: () => { if (!answered) res(null); } });
  });
}

export function slider({ label, min, max, step = 1, value, fmt = v => Math.round(v), onInput, center }) {
  const out = h('span', { class: 'sl-val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  const paint = () => {
    const pct = (inp.value - min) / (max - min) * 100;
    if (center != null) {
      const c = (center - min) / (max - min) * 100;
      inp.style.setProperty('--a', Math.min(c, pct) + '%'); inp.style.setProperty('--b', Math.max(c, pct) + '%');
    } else { inp.style.setProperty('--a', '0%'); inp.style.setProperty('--b', pct + '%'); }
  };
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); paint(); onInput(v); });
  inp.addEventListener('dblclick', () => { if (center != null) { inp.value = center; inp.dispatchEvent(new Event('input')); } });
  paint();
  const row = h('label', { class: 'sl' }, h('span', { class: 'sl-label' }, label), inp, out);
  row.set = v => { inp.value = v; out.textContent = fmt(v); paint(); };
  return row;
}

export function chips(options, value, onPick, cls = '') {
  const wrap = h('div', { class: 'chips ' + cls });
  const render = () => {
    wrap.innerHTML = '';
    for (const o of options) {
      wrap.append(h('button', {
        class: 'chip' + (o.id === value ? ' on' : ''), style: o.style,
        onclick: () => { value = o.id; render(); onPick(o.id); },
      }, o.html ? h('span', { html: o.html }) : null, o.label ?? o.name ?? o.id));
    }
  };
  render();
  wrap.setValue = v => { value = v; render(); };
  return wrap;
}

export function swatches(colors, value, onPick, allowCustom = true) {
  const wrap = h('div', { class: 'swatches' });
  const render = () => {
    wrap.innerHTML = '';
    for (const c of colors) wrap.append(h('button', {
      class: 'sw' + (c === value ? ' on' : ''), style: { background: c }, 'aria-label': c,
      onclick: () => { value = c; render(); onPick(c); },
    }));
    if (allowCustom) {
      const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#ff6fb5' });
      inp.addEventListener('input', () => { value = inp.value; onPick(inp.value); });
      wrap.append(h('label', { class: 'sw custom', 'aria-label': 'Custom color' }, inp));
    }
  };
  render();
  return wrap;
}

export const section = (title, ...kids) => h('div', { class: 'psec' }, title ? h('div', { class: 'psec-title' }, title) : null, ...kids);
export const btn = (label, icon, onclick, cls = '') => h('button', { class: 'btn ' + cls, onclick }, icon ? h('span', { html: ic(icon) }) : null, label);

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  return d;
}
