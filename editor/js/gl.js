// GPU color pipeline: adjustments, filter presets and sharpening run in a WebGL shader
// so they stay fast enough for live preview and export.

export const ADJUST_KEYS = [
  ['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation'],
  ['warmth', 'Warmth'], ['tint', 'Tint'], ['highlights', 'Highlights'], ['shadows', 'Shadows'],
  ['sharpen', 'Sharpen'], ['vignette', 'Vignette'], ['fade', 'Fade'], ['grain', 'Grain'],
];

// Presets are written in the same -100..100 units as the Adjust sliders,
// plus an optional RGB multiplier for a color cast.
export const PRESETS = [
  { id: 'none', name: 'Original', p: {} },
  { id: 'vivid', name: 'Vivid', p: { saturation: 35, contrast: 15, sharpen: 15 } },
  { id: 'pop', name: 'Pop', p: { saturation: 55, contrast: 22, brightness: 4, sharpen: 30 } },
  { id: 'dusk', name: 'Dusk', p: { warmth: 25, saturation: 10, vignette: 25 }, mul: [1.04, 0.95, 1.08] },
  { id: 'neon', name: 'Neon', p: { saturation: 45, contrast: 20, shadows: -10 }, mul: [1.08, 0.9, 1.12] },
  { id: 'warm', name: 'Golden', p: { warmth: 50, saturation: 10, highlights: 8 } },
  { id: 'cool', name: 'Cool', p: { warmth: -45, tint: -5, contrast: 8 } },
  { id: 'teal', name: 'Teal & Orange', p: { contrast: 15, saturation: 15, warmth: 15 }, mul: [1.06, 0.98, 0.94], tealShadows: true },
  { id: 'film', name: 'Film', p: { fade: 30, grain: 30, warmth: 15, contrast: -5, saturation: -10 } },
  { id: 'vintage', name: 'Vintage', p: { fade: 35, saturation: -35, warmth: 40, vignette: 35, grain: 20 } },
  { id: 'mono', name: 'Mono', p: { saturation: -100, contrast: 12 } },
  { id: 'noir', name: 'Noir', p: { saturation: -100, contrast: 45, vignette: 50, shadows: -15 } },
  { id: 'soft', name: 'Soft', p: { fade: 20, contrast: -12, brightness: 6, saturation: -5, highlights: 10 } },
  { id: 'crisp', name: 'Crisp', p: { sharpen: 55, contrast: 12, highlights: -6, shadows: 8 } },
];

export const defaultAdjust = () => Object.fromEntries(ADJUST_KEYS.map(([k]) => [k, 0]));

// Combine a clip's preset (scaled by intensity) with its manual adjustments into shader uniforms.
export function uniformsFor(clip) {
  const adj = { ...defaultAdjust(), ...(clip.adjust || {}) };
  const preset = PRESETS.find(p => p.id === (clip.filter || 'none')) || PRESETS[0];
  const k = (clip.filterAmount ?? 100) / 100;
  const v = key => (adj[key] || 0) + (preset.p[key] || 0) * k;
  const mul = (preset.mul || [1, 1, 1]).map(m => 1 + (m - 1) * k);
  return {
    bri: v('brightness') / 250,
    con: 1 + v('contrast') / 100,
    sat: Math.max(0, 1 + v('saturation') / 100),
    warm: v('warmth') / 100,
    tint: v('tint') / 100,
    hl: v('highlights') / 100,
    sh: v('shadows') / 100,
    sharp: Math.max(0, v('sharpen')) / 100,
    vig: Math.max(0, v('vignette')) / 100,
    fade: Math.max(0, v('fade')) / 100,
    grain: Math.max(0, v('grain')) / 100,
    teal: preset.tealShadows ? k : 0,
    mul,
  };
}

export function isNeutral(clip) {
  if (clip.filter && clip.filter !== 'none' && (clip.filterAmount ?? 100) > 0) return false;
  const a = clip.adjust || {};
  return ADJUST_KEYS.every(([key]) => !a[key]);
}

const VS = `attribute vec2 p; varying vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `precision mediump float;
varying vec2 uv;
uniform sampler2D tex; uniform vec2 px; uniform float seed;
uniform float bri, con, sat, warm, tint, hl, sh, sharp, vig, fade, grain, teal;
uniform vec3 mul;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p){ return fract(sin(dot(p + seed, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture2D(tex, uv).rgb;
  if (sharp > 0.0) {
    vec3 b = texture2D(tex, uv + vec2(px.x, 0.0)).rgb + texture2D(tex, uv - vec2(px.x, 0.0)).rgb
           + texture2D(tex, uv + vec2(0.0, px.y)).rgb + texture2D(tex, uv - vec2(0.0, px.y)).rgb;
    vec3 b2 = texture2D(tex, uv + px).rgb + texture2D(tex, uv - px).rgb
            + texture2D(tex, uv + vec2(px.x, -px.y)).rgb + texture2D(tex, uv + vec2(-px.x, px.y)).rgb;
    vec3 blur = (b * 2.0 + b2 + c * 4.0) / 16.0;
    c += (c - blur) * sharp * 3.0;
  }
  c += bri;
  c = (c - 0.5) * con + 0.5;
  float l = luma(c);
  c += sh * (1.0 - smoothstep(0.0, 0.55, l)) * 0.45;
  c += hl * smoothstep(0.45, 1.0, l) * 0.45;
  l = luma(c);
  c = mix(vec3(l), c, sat);
  c.r += warm * 0.09; c.b -= warm * 0.09; c.g += tint * 0.08;
  if (teal > 0.0) { float s = 1.0 - smoothstep(0.0, 0.5, l); c += vec3(-0.05, 0.02, 0.06) * s * teal; }
  c *= mul;
  c = mix(c, c * 0.82 + 0.1, fade);
  float d = distance(uv, vec2(0.5));
  c *= 1.0 - vig * smoothstep(0.25, 0.8, d) * 0.85;
  if (grain > 0.0) c += (hash(uv * 1000.0) - 0.5) * grain * 0.16;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

class Filterer {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false });
    this.gl = gl;
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.loc = {};
    for (const n of ['tex', 'px', 'seed', 'bri', 'con', 'sat', 'warm', 'tint', 'hl', 'sh', 'sharp', 'vig', 'fade', 'grain', 'teal', 'mul'])
      this.loc[n] = gl.getUniformLocation(prog, n);
  }

  // Returns a canvas of size w×h holding `source` with the clip's look applied, or null if WebGL is unavailable.
  process(source, w, h, u) {
    const gl = this.gl;
    if (!gl) return null;
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch { return null; }
    const L = this.loc;
    gl.uniform1i(L.tex, 0);
    gl.uniform2f(L.px, 1 / w, 1 / h);
    gl.uniform1f(L.seed, (performance.now() % 1000) / 1000);
    for (const n of ['bri', 'con', 'sat', 'warm', 'tint', 'hl', 'sh', 'sharp', 'vig', 'fade', 'grain', 'teal']) gl.uniform1f(L[n], u[n]);
    gl.uniform3f(L.mul, u.mul[0], u.mul[1], u.mul[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

let shared;
export const filterer = () => (shared ||= new Filterer());

// "Auto Enhance": looks at the frame's histogram and picks exposure, contrast,
// color and sharpening values that bring it to a balanced, punchy result.
export function analyzeFrame(source, sw, sh) {
  const c = document.createElement('canvas');
  const scale = 96 / Math.max(sw, sh);
  c.width = Math.max(8, Math.round(sw * scale)); c.height = Math.max(8, Math.round(sh * scale));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(source, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const hist = new Array(256).fill(0);
  let n = 0, satSum = 0, rS = 0, bS = 0, lSum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[l]++; n++; lSum += l;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    satSum += mx ? (mx - mn) / mx : 0;
    rS += r; bS += b;
  }
  const pct = q => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * q) return i; } return 255; };
  const lo = pct(0.02), hi = pct(0.98), mean = lSum / n, sat = satSum / n;
  const range = Math.max(1, hi - lo);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
  const cast = (rS - bS) / n; // >0 warm cast, <0 cool cast
  return {
    brightness: clamp((128 - mean) * 0.45, -35, 35),
    contrast: clamp((200 / range - 1) * 45, -10, 40),
    saturation: clamp((0.42 - sat) * 90, -15, 35),
    warmth: clamp(-cast * 0.35, -20, 20),
    tint: 0,
    highlights: hi > 245 ? -15 : 0,
    shadows: lo < 10 ? 15 : 5,
    sharpen: 35,
    vignette: 0, fade: 0, grain: 0,
  };
}
