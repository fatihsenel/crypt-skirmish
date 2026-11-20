// The offline copy (public/sw.js), in production builds only. The worker only sees requests
// made after it starts, so the page tells it which files it has already fetched: right after
// it's ready, and again once every model is in (saveLoaded).

const supported = import.meta.env.PROD && 'serviceWorker' in navigator;

/** Sends the worker every file this page has fetched (its own and the fonts) to keep. */
export function saveLoaded() {
  if (!supported) return;
  navigator.serviceWorker.ready.then((reg) => {
    const base = new URL(import.meta.env.BASE_URL, location.href);
    const urls = performance.getEntriesByType('resource').map((r) => r.name)
      .filter((u) => u.startsWith(base.href) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
    reg.active?.postMessage({ save: [base.href, ...new Set(urls)] });
  }).catch(() => {});
}

if (supported) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then(() => saveLoaded())
    .catch(() => { /* no offline copy: the game works the same online */ });
}
