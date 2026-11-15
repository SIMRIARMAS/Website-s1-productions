// AI features load code from cdn.jsdelivr.net. The service worker (sw.js) checks every one of
// those files against its fingerprint before it can run. This makes sure that check is switched
// on before any AI code is requested, including on the very first visit.
let guardP;
export function cdnGuard() {
  return guardP ||= (async () => {
    if (!('serviceWorker' in navigator)) throw new Error('This browser can’t run the safety check AI features need.');
    if (navigator.serviceWorker.controller) return;
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('AI safety check isn’t ready yet. Reload the app and try again.')), 15000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
    });
  })().catch(e => { guardP = null; throw e; });
}
