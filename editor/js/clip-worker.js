// MobileCLIP: turns photos/video frames and search text into vectors in the same space,
// so "sunset", "crowd at night" or "DJ decks" can find matching media. Runs on-device.
const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/transformers.min.js';
const MODEL = 'Xenova/mobileclip_s0';
let tf, tok, proc, textModel, visModel;

async function load() {
  tf = await import(TF);
  tf.env.allowLocalModels = false;
  const progress_callback = p => { if (p.status === 'progress' && /onnx/.test(p.file || '')) self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); };
  // The 8-bit image model gives meaningless results, so images use fp16 (same accuracy as fp32, half the size).
  [tok, proc] = await Promise.all([tf.AutoTokenizer.from_pretrained(MODEL), tf.AutoProcessor.from_pretrained(MODEL)]);
  [textModel, visModel] = await Promise.all([
    tf.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback }),
    tf.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'fp16', device: 'wasm', progress_callback }),
  ]);
}

self.onmessage = async e => {
  const d = e.data;
  try {
    if (d.type === 'load') { await load(); self.postMessage({ type: 'ready' }); return; }
    if (d.type === 'image') {
      const img = new tf.RawImage(new Uint8ClampedArray(d.data), d.w, d.h, 4).rgb();
      const { image_embeds } = await visModel(await proc(img));
      self.postMessage({ type: 'result', id: d.id, vec: image_embeds.normalize().tolist()[0] });
    }
    if (d.type === 'text') {
      const inputs = tok([d.text], { padding: 'max_length', truncation: true });
      const { text_embeds } = await textModel(inputs);
      self.postMessage({ type: 'result', id: d.id, vec: text_embeds.normalize().tolist()[0] });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: d.id, message: err?.message || String(err) });
  }
};
