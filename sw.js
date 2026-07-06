const CACHE_NAME = 'firstbeam-cache-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/static/app.v54.js',
  '/static/index.v53.css',
  '/apple-touch-icon_副本.png',
  '/lighthouse_bg.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Use Network First strategy to ensure latest app logic is always loaded if online.
  // Fallback to cache if offline.
  if (event.request.method !== 'GET') return;
  
  // Skip Gemini API requests
  if (event.request.url.includes('generativelanguage.googleapis.com')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Update cache with new response
        const resClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request);
      })
  );
});
