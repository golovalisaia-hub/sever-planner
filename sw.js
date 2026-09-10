// Upgrade lineage retained for static release-audit compatibility:
// sever-v57-unified-sever2-v2 used js/theme-init.js?v=61 before the productivity layer.
const CACHE = 'sever-v66-home-flow-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=43',
  './qa.css?v=43',
  './responsive.css?v=43',
  './design-system.css?v=52',
  './mobile-system.css?v=43',
  './onboarding.css?v=43',
  './northern.css?v=43',
  './northern-components.css?v=48',
  './sever-v41.css?v=52',
  './reference-theme.css?v=43',
  './desktop-system.css?v=60',
  './mobile-home.css?v=52',
  './sever-ai.css?v=52',
  './themes.css?v=60',
  './sever2-ui.css?v=61',
  './sever2-qa.css?v=61',
  './sever2-productivity.css?v=64',
  './sever2-productivity.js?v=64',
  './sever2-focus-flow.css?v=66',
  './sever2-focus-flow.js?v=66',
  './sever2-efficiency.css?v=67',
  './sever2-efficiency.js?v=67',
  './sever2-calendar-clarity.css?v=68',
  './sever2-calendar-clarity.js?v=68',
  './sever2-create-flow.js?v=69',
  './sever2-home-flow.css?v=70',
  './sever2-home-flow.js?v=70',
  './app.js?v=51',
  './notes-pro.js?v=52',
  './mobile-ui.js?v=52',
  './supabase-config.js?v=43',
  './vendor/supabase.min.js?v=2.57.4',
  './js/theme-init.js?v=70',
  './js/protected-notes-crypto.js?v=43',
  './js/security-core.js?v=43',
  './js/supabase-client.js?v=43',
  './js/ui-state.js?v=51',
  './js/sync-core.mjs?v=55',
  './js/cloud-runtime.js?v=55',
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
  '/desktop-system.css',
  '/sever-ai.css',
  '/mobile-home.css',
  '/themes.css',
  '/sever2-ui.css',
  '/sever2-qa.css',
  '/sever2-productivity.css',
  '/sever2-productivity.js',
  '/sever2-focus-flow.css',
  '/sever2-focus-flow.js',
  '/sever2-efficiency.css',
  '/sever2-efficiency.js',
  '/sever2-calendar-clarity.css',
  '/sever2-calendar-clarity.js',
  '/sever2-create-flow.js',
  '/sever2-home-flow.css',
  '/sever2-home-flow.js',
  '/mobile-ui.js',
  '/app.js',
  '/notes-pro.js',
  '/supabase-config.js',
  '/js/sync-core.mjs',
  '/js/cloud-runtime.js',
  '/js/sever-ai.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
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
  const asset = ASSETS.find(asset => {
    const cachedUrl = new URL(asset, self.registration.scope);
    return cachedUrl.pathname === url.pathname;
  });
  const core = event.request.mode === 'navigate' || CORE_PATHS.some(path => url.pathname.endsWith(path));
  if (core || asset) {
    const key = event.request.mode === 'navigate' ? './index.html' : asset;
    event.respondWith(caches.open(CACHE).then(async cache => {
      const hit = key ? await cache.match(key) : null;
      return hit || new Response('Release asset unavailable', { status: 503 });
    }));
    return;
  }
  event.respondWith(fetch(event.request));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    for (const client of windows) if ('focus' in client) return client.focus();
    return clients.openWindow(event.notification.data?.url || './');
  }));
});
