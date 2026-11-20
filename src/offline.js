// The offline copy (public/sw.js), in production builds only. The worker only sees requests
// made after it starts, so the page tells it which files it has already fetched: right after
// it's ready, and again once every model is in (saveLoaded(true)), when the worker answers
// that everything is saved. It also looks for a newer deploy than the one running.
import { appStatus } from './ui/appStatus.js';

const supported = import.meta.env.PROD && 'serviceWorker' in navigator;
const base = new URL(import.meta.env.BASE_URL, location.href);

/** Sends the worker every file this page has fetched (its own and the fonts) to keep. */
export function saveLoaded(all = false) {
  if (!supported) return;
  navigator.serviceWorker.ready.then((reg) => {
    const urls = performance.getEntriesByType('resource').map((r) => r.name)
      .filter((u) => u.startsWith(base.href) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
    reg.active?.postMessage({ save: [base.href, ...new Set(urls)], all });
  }).catch(() => {});
}

// A newer deploy names a different entry script than the one running. Asked past the worker
// (no-store), when the page opens, comes back into view, or the signal returns, at most every
// 10 minutes.
const entry = (html) => html.match(/assets\/index-[\w-]+\.js/)?.[0];
const running = entry(document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? '');
let lastCheck = 0;
function checkUpdate() {
  if (!running || !navigator.onLine || Date.now() - lastCheck < 600_000) return;
  lastCheck = Date.now();
  fetch(base.href, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''))
    .then((html) => { const latest = entry(html); if (latest && latest !== running) appStatus.set({ update: true }); })
    .catch(() => { lastCheck = 0; });
}

if (supported) {
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data?.saved) appStatus.set({ saved: true });
  });
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then(() => saveLoaded())
    .catch(() => { /* no offline copy: the game works the same online */ });
  checkUpdate();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  window.addEventListener('online', () => { lastCheck = 0; checkUpdate(); });
}
