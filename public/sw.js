// The offline copy: once the game has been played, it opens with no signal and starts at once.
// - Pages: the network first, so a deploy shows up straight away; the saved copy when there's
//   no network or no answer within 4 s.
// - Built code (assets/, named by a hash of its contents): the saved copy, and a new build's
//   file replaces the old one of the same name.
// - Everything else (models, images, fonts): the saved copy at once, refreshed behind it.
// The page sends the files it loaded before this worker was running (see src/offline.js).
// Registered only in production builds (the dev server never sees it).

const CACHE = 'crypt-skirmish-v1';
const SCOPE = new URL(self.registration.scope);
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isAsset = (url) => url.origin === SCOPE.origin && url.pathname.startsWith(`${SCOPE.pathname}assets/`);
// "index-AbC123.js" → "index-*.js": the same file from another build.
const family = (url) => url.pathname.replace(/-[\w-]{6,}(\.\w+)$/, '-*$1');

async function save(request, response) {
  if (!response || !(response.ok || response.type === 'opaque')) return;
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  if (isAsset(url)) { // drop the last build's copy of this file
    for (const old of await cache.keys()) {
      const o = new URL(old.url);
      if (o.pathname !== url.pathname && isAsset(o) && family(o) === family(url)) await cache.delete(old);
    }
  }
  await cache.put(request, response);
}

async function page(event) {
  const net = fetch(event.request);
  // Keep the newest page for next time, even when the saved one answered first.
  event.waitUntil(net.then(async (r) => { if (r.ok) await (await caches.open(CACHE)).put(SCOPE.href, r.clone()); }).catch(() => {}));
  const late = new Promise((resolve) => setTimeout(() => resolve('late'), 4000));
  const first = await Promise.race([net.catch(() => null), late]);
  if (first && first !== 'late') return first.clone();
  return (await caches.match(SCOPE.href)) ?? net; // nothing saved yet: wait for the network after all
}

async function savedFirst(event, refresh) {
  const hit = await caches.match(event.request);
  if (hit && !refresh) return hit;
  const net = fetch(event.request);
  event.waitUntil(net.then((r) => save(event.request, r.clone())).catch(() => {}));
  return hit ?? net;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.origin === SCOPE.origin) return event.respondWith(page(event));
  if (isAsset(url)) return event.respondWith(savedFirst(event, false));
  if ((url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname)) || FONTS.test(url.origin)) {
    event.respondWith(savedFirst(event, true));
  }
});

// The font files a saved Google Fonts stylesheet names, for the Latin letters the game uses.
// The page can't list them itself: browsers hide what another site's stylesheet fetched.
async function fontFiles(cache, cssUrl) {
  const css = await (await cache.match(cssUrl))?.text();
  if (!css) return [];
  return [...css.matchAll(/\/\* latin \*\/[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
}

// From the page: files it fetched before this worker took over, to save now.
self.addEventListener('message', (event) => {
  const urls = event.data?.save;
  if (!Array.isArray(urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const keep = async (href) => {
      const url = new URL(href, SCOPE);
      if (url.pathname.endsWith('/sw.js') || await cache.match(url.href)) return;
      const req = new Request(url.href, { mode: url.origin === SCOPE.origin ? 'same-origin' : 'cors' }); // fonts are fetched with CORS
      await save(req, await fetch(req));
    };
    for (const u of urls) {
      try {
        await keep(u);
        if (u.startsWith('https://fonts.googleapis.com/')) for (const f of await fontFiles(cache, u)) await keep(f);
      } catch { /* offline now: it'll be saved next time it's fetched */ }
    }
  })());
});
