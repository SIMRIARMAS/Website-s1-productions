// Claude (Anthropic API) inside the app: plans reels from your footage and makes edits you describe.
// Uses your own API key, kept only on this device. Calls go straight from the phone to Anthropic.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
export const CLAUDE_MODEL = 'claude-opus-5-5';

let sdkP, client, clientKey;
async function sdk() { return (sdkP ||= import(SDK_URL).then(m => m.default || m.Anthropic)); }
async function getClient(apiKey) {
  const Anthropic = await sdk();
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = apiKey;
  }
  return { client, Anthropic };
}

// Friendly messages for the errors people actually hit.
async function explain(err) {
  const Anthropic = await sdk().catch(() => null);
  if (Anthropic) {
    if (err instanceof Anthropic.AuthenticationError) return 'Your Claude API key isn’t valid. Check it in Settings → Claude AI.';
    if (err instanceof Anthropic.PermissionDeniedError) return 'This API key doesn’t have access to Claude Opus. Check your Anthropic Console.';
    if (err instanceof Anthropic.RateLimitError) return 'Claude is busy or your account hit its limit. Try again in a minute.';
    if (err instanceof Anthropic.BadRequestError) return 'Claude couldn’t read that request: ' + (err.message || '').slice(0, 160);
    if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach Claude — check your internet connection.';
    if (err instanceof Anthropic.APIError && err.status >= 500) return 'Claude had a temporary problem. Try again.';
  }
  return err?.message || String(err);
}

// One request that must come back as JSON matching `schema`.
export async function askClaudeJSON({ apiKey, system, content, schema, effort = 'medium', maxTokens = 16000 }) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings → Claude AI first.');
  let msg;
  try {
    const { client } = await getClient(apiKey);
    msg = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      // If a safety check declines the request, the API retries on a suitable model automatically.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    });
  } catch (e) {
    throw new Error(await explain(e));
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request. Try describing it differently.');
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude’s answer was cut off. Try fewer clips or a simpler request.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { return JSON.parse(text); } catch { throw new Error('Claude’s answer couldn’t be read. Try again.'); }
}

export async function testKey(apiKey) {
  const r = await askClaudeJSON({
    apiKey, effort: 'low', maxTokens: 2000,
    content: [{ type: 'text', text: 'Reply with ok=true.' }],
    schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
  });
  return !!r.ok;
}

// Image block from a canvas (small JPEG keeps requests fast and cheap).
export function imageBlock(canvas, maxSide = 384) {
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  let c = canvas;
  if (k < 1) {
    c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  }
  const data = c.toDataURL('image/jpeg', 0.72).split(',')[1];
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
}

// ---------------------------------------------------------------- schemas
const str = { type: 'string' }, num = { type: 'number' }, int = { type: 'integer' }, bool = { type: 'boolean' };
const nul = t => ({ anyOf: [t, { type: 'null' }] });
const en = vals => ({ type: 'string', enum: vals });
const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });

export function reelSchema({ filters, transitions, fonts }) {
  const text = obj({
    text: str, at: num, dur: num, position: en(['top', 'middle', 'bottom']), size: en(['small', 'medium', 'large']),
    style: en(['shadow', 'outline', 'box', 'neon', 'plain']), anim: en(['none', 'fade', 'pop', 'slide', 'type', 'bounce']),
    color: str,
  });
  return obj({
    variations: {
      type: 'array',
      items: obj({
        name: str, why: str,
        shots: { type: 'array', items: obj({ ref: str, dur: num }) },
        filter: en(filters), transition: en(transitions), font: en(fonts), motion: en(['none', 'in', 'out', 'pan']),
        texts: { type: 'array', items: text },
        keepClipSound: bool,
      }),
    },
  });
}

export function editSchema({ filters, transitions, fonts, aspects }) {
  const op = obj({
    op: en(['clip', 'add_text', 'edit_text', 'delete_text', 'delete_clip', 'move_clip', 'canvas', 'audio']),
    target: nul(int), // clip/text/audio index; -1 = every clip
    filter: nul(en(filters)), filterAmount: nul(num),
    brightness: nul(num), contrast: nul(num), saturation: nul(num), warmth: nul(num), sharpen: nul(num), vignette: nul(num), fade: nul(num), grain: nul(num),
    speed: nul(num), volume: nul(num), muted: nul(bool), fit: nul(en(['fit', 'fill'])), zoom: nul(num), motion: nul(en(['none', 'in', 'out', 'pan'])),
    transition: nul(en(transitions)), transitionDur: nul(num), duration: nul(num), trimStart: nul(num), trimEnd: nul(num),
    portrait: nul(en(['none', 'blur', 'spotlight', 'color', 'cutout'])),
    text: nul(str), at: nul(num), dur: nul(num), position: nul(en(['top', 'middle', 'bottom'])), size: nul(en(['small', 'medium', 'large'])),
    style: nul(en(['shadow', 'outline', 'box', 'neon', 'plain'])), anim: nul(en(['none', 'fade', 'pop', 'slide', 'type', 'bounce'])),
    font: nul(en(fonts)), color: nul(str),
    to: nul(int), aspect: nul(en(aspects)), bgType: nul(en(['blur', 'color', 'gradient'])), bgColor: nul(str),
    fadeIn: nul(num), fadeOut: nul(num),
  });
  return obj({ reply: str, ops: { type: 'array', items: op } });
}

// Reference analysis: what makes a video/photo work, how to recreate it, and edits with the user's footage.
export function refSchema({ filters, transitions, fonts }) {
  const reel = reelSchema({ filters, transitions, fonts }).properties.variations;
  return obj({
    summary: str,
    look: str,
    steps: { type: 'array', items: obj({ title: str, detail: str }) },
    shotList: { type: 'array', items: obj({ ref: str, describe: str, use: str }) },
    filter: en(filters),
    variations: reel,
  });
}
