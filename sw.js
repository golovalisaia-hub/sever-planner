const CACHE = 'sever-v45-ai-r1';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=43',
  './qa.css?v=43',
  './responsive.css?v=43',
  './design-system.css?v=43',
  './mobile-system.css?v=43',
  './onboarding.css?v=43',
  './northern.css?v=43',
  './northern-components.css?v=43',
  './sever-v41.css?v=43',
  './reference-theme.css?v=43',
  './sever-ai.css?v=45',
  './aurora.webp',
  './assets/sever/mountain-night.svg',
  './assets/sever/ice-dawn.svg',
  './app.js?v=43',
  './notes-pro.js?v=43',
  './mobile-ui.js?v=43',
  './supabase-config.js?v=43',
  './vendor/supabase.min.js?v=2.57.4',
  './js/theme-init.js?v=43',
  './js/protected-notes-crypto.js?v=43',
  './js/security-core.js?v=43',
  './js/supabase-client.js?v=43',
  './js/ui-state.js?v=43',
  './js/sync-core.mjs?v=43',
  './js/cloud-runtime.js?v=43',
  './js/sever-ai.js?v=45',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];
const CORE_PATHS = [
  '/vendor/supabase.min.js',
  '/js/theme-init.js',
  '/js/protected-notes-crypto.js',
  '/js/security-core.js',
  '/js/supabase-client.js',
  '/js/ui-state.js',
  '/style.css',
  '/qa.css',
  '/responsive.css',
  '/design-system.css',
  '/mobile-system.css',
  '/onboarding.css',
  '/northern.css',
  '/northern-components.css',
  '/sever-v41.css',
  '/reference-theme.css',
  '/sever-ai.css',
  '/aurora.webp',
  '/assets/sever/mountain-night.svg',
  '/assets/sever/ice-dawn.svg',
  '/mobile-ui.js',
  '/app.js',
  '/notes-pro.js',
  '/supabase-config.js',
  '/js/sync-core.mjs',
  '/js/cloud-runtime.js',
  '/js/sever-ai.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const core = event.request.mode === 'navigate' || CORE_PATHS.some(path => url.pathname.endsWith(path));
  if (core) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    for (const client of windows) if ('focus' in client) return client.focus();
    return clients.openWindow(event.notification.data?.url || './');
  }));
});
