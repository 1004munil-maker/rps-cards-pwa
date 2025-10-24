// service-worker.js
const CACHE_NAME = 'rps-cards-v8.91'; // デプロイのたびに番号を上げると反映が早い
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
8
// インストール：アプリシェルを先取りキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// 有効化：古いキャッシュ掃除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ戦略
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) 非GETは触らない（書き込み系やWSなど）
  if (req.method !== 'GET') return;

  // 2) 広告/SDK/DB系はネット直通（キャッシュしない）
  const bypassHosts = [
    'pagead2.googlesyndication.com',    // AdSense
    'googleads.g.doubleclick.net',
    'www.googletagservices.com',
    'securepubads.g.doubleclick.net',
    'firebaseio.com',                   // Realtime DB
    'googleapis.com',
    'gstatic.com'                       // firebase CDNなど
  ];
  if (bypassHosts.some(h => url.hostname.endsWith(h))) {
    event.respondWith(fetch(req));
    return;
  }

  // 3) HTMLは network-first（更新を取り込みつつ、オフライン時はキャッシュ）
  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      }).catch(() =>
        caches.match(req).then((r) => r || caches.match('./index.html'))
      )
    );
    return;
  }

  // 4) 同一オリジンの静的ファイルは cache-first（高速）
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
      )
    );
    return;
  }

  // 5) それ以外は stale-while-revalidate 風
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetching = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      }).catch(() => cached); // ネットNGでもキャッシュがあれば返す
      return cached || fetching;
    })
  );
});
