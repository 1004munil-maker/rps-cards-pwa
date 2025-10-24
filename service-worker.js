// service-worker.js
const CACHE_NAME = 'rps-cards-v1.2.0'; // ← リリース毎に上げる
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

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

  // 1) 非GETは触らない
  if (req.method !== 'GET') return;

  // 2) 広告/SDK/DB系はネット直通（キャッシュしない）
  const bypassHosts = [
    'pagead2.googlesyndication.com',    // AdSense
    'googleads.g.doubleclick.net',
    'www.googletagservices.com',
    'securepubads.g.doubleclick.net',
    'firebaseio.com',                   // Realtime DB
    'googleapis.com',
    'gstatic.com'                       // Firebase CDNなど
  ];
  if (bypassHosts.some(h => url.hostname.endsWith(h))) {
    event.respondWith(fetch(req));
    return;
  }

  // 3) ナビゲーション(HTML)は network-first（オフライン時はindex.html）
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      }).catch(() =>
        caches.match('./offline.html')
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

// （任意）即時更新したい場合に使う
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});