// Offline support. Online, every app file comes fresh from the network (so a
// new push shows up right away) and a copy is kept; offline, the copy is used.
// Requests to Claude and Google are never cached.
const VERSION = 'dev';
const CACHE = `afr-${VERSION}`;
const APP_FILES = [
  './', './index.html', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
  '../src/index.js', '../src/assets.js', '../src/claude.js', '../src/research.js', '../src/schema-tools.js',
  '../src/confirm.js', '../src/feature-plan.js', '../src/brief.js', '../src/generate.js', '../src/places.js', '../src/brand-signals.js',
  '../prompts/research-agent.md', '../prompts/profile-extractor.md', '../prompts/app-generator.md',
  '../schema/business-profile.schema.json', '../config/modules.json', '../config/industry-map.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('afr-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !fonts) return;

  if (fonts) {
    // Fonts never change: use the copy when there is one.
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    })));
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
