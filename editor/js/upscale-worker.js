// Runs the Swin2SR "real-world" 4× super-resolution model off the main thread,
// on the phone's GPU (WebGPU) when available, otherwise on the CPU (WebAssembly).
const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/transformers.min.js';
const MODEL = 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr';

let tf, pipe, device;

async function load() {
  tf = await import(TF);
  tf.env.allowLocalModels = false;
  const progress_callback = p => {
    if (p.status === 'progress' && /onnx/.test(p.file || '')) self.postMessage({ type: 'progress', phase: 'download', loaded: p.loaded, total: p.total });
  };
  let gpu = null;
  try { gpu = self.navigator.gpu && await self.navigator.gpu.requestAdapter(); } catch { }
  if (gpu) {
    try {
      pipe = await tf.pipeline('image-to-image', MODEL, { device: 'webgpu', dtype: 'fp32', progress_callback });
      device = 'webgpu';
    } catch { pipe = null; }
  }
  if (!pipe) {
    pipe = await tf.pipeline('image-to-image', MODEL, { device: 'wasm', dtype: 'fp32', progress_callback });
    device = 'wasm';
  }
}

self.onmessage = async e => {
  const d = e.data;
  try {
    if (d.type === 'load') {
      await load();
      self.postMessage({ type: 'ready', device });
    } else if (d.type === 'tile') {
      const input = new tf.RawImage(new Uint8ClampedArray(d.data), d.w, d.h, 4).rgb();
      const out = (await pipe(input)).rgba();
      const buf = out.data.buffer.slice(out.data.byteOffset, out.data.byteOffset + out.data.byteLength);
      self.postMessage({ type: 'tile', id: d.id, w: out.width, h: out.height, data: buf }, [buf]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: d.id, message: err?.message || String(err) });
  }
};
