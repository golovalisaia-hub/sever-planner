const CACHE = 'sever-v41-global-rebuild';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=41',
  './qa.css?v=41',
  './responsive.css?v=41',
  './design-system.css?v=41',
  './mobile-system.css?v=41',
  './onboarding.css?v=41',
  './northern.css?v=41',
  './northern-components.css?v=41',
  './sever-v41.css?v=41',
  './assets/sever/mountain-night.svg',
  './assets/sever/ice-dawn.svg',
  './app.js?v=41',
  './notes-pro.js?v=41',
  './mobile-ui.js?v=41',
  './supabase-config.js?v=41',
  './vendor/supabase.min.js?v=2.57.4',
  './js/theme-init.js?v=41',
  './js/protected-notes-crypto.js?v=41',
  './js/security-core.js?v=41',
  './js/supabase-client.js?v=41',
  './js/ui-state.js?v=41',
  './js/sync-core.mjs?v=41',
  './js/cloud-runtime.js?v=41',
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
  '/assets/sever/mountain-night.svg',
  '/assets/sever/ice-dawn.svg',
  '/mobile-ui.js',
  '/app.js',
  '/notes-pro.js',
  '/supabase-config.js',
  '/js/sync-core.mjs',
  '/js/cloud-runtime.js'
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
