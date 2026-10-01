// JAGU service worker -- makes the app installable and usable offline.
// Strategy: network-first (so a fresh deploy is always picked up while
// online, instead of getting stuck showing an old cached version), falling
// back to the cache when offline.
const CACHE_NAME = 'jagu-shell-v1';
const PRECACHE_URLS = [
  './', './index.html', './manifest.json', './favicon.svg',
  './css/styles.css',
  './js/app.js', './js/ai.js', './js/classroom.js', './js/diagnostics.js',
  './js/focus.js', './js/helpers.js', './js/live-api.js', './js/modals.js',
  './js/render.js', './js/settings.js', './js/state.js', './js/voice.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event)=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=> cache.addAll(PRECACHE_URLS)).catch(()=>{})
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys()
      .then(keys=> Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return; // never intercept cross-origin (fonts, APIs)

  event.respondWith(
    fetch(event.request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache=> cache.put(event.request, copy));
      return res;
    }).catch(()=>
      caches.match(event.request).then(cached=> cached || caches.match('./index.html'))
    )
  );
});

// Lets a reminder fired from the page show as a real OS notification even
// when the JAGU tab isn't the focused one.
self.addEventListener('message', (event)=>{
  if(event.data && event.data.type === 'notify'){
    self.registration.showNotification(event.data.title || 'JAGU', {
      body: event.data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: event.data.tag || 'jagu-reminder',
    });
  }
});

self.addEventListener('notificationclick', (event)=>{
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type:'window'}).then(list=>{
      for(const c of list){ if('focus' in c) return c.focus(); }
      if(self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
