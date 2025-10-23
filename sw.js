/* sw.js */
const VERSION = 'v1.0.0';
const BASE_PATH = ''; // ユーザーサイトなので空。プロジェクトサイトなら '/repo-name'
const APP_SHELL = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/offline.html`,
  `${BASE_PATH}/styles.css`,
  `${BASE_PATH}/app.js`,
  `${BASE_PATH}/icons/icon-192.png`,
  `${BASE_PATH}/icons/icon-512.png`,
  `${BASE_PATH}/icons/maskable-512.png`,
  `${BASE_PATH}/manifest.webmanifest`
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(`app-shell-${VERSION}`).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (!k.includes(VERSION)) return caches.delete(k);
    }));
  })());
  self.clients.claim();
});

// ルーティング：
// 1) HTMLナビゲーションは「ネット優先→失敗でoffline.html」
// 2) それ以外は「キャッシュ優先→なければネット」
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // WebSocketやPOSTはスルー
  if (req.method !== 'GET' || req.url.startsWith('ws')) return;

  const isHTML = req.headers.get('accept')?.includes('text/html');

  if (isHTML) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // 成功したらキャッシュに入れて返す
        const cache = await caches.open(`pages-${VERSION}`);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        // オフライン時はキャッシュ → それもなければ offline.html
        const cacheMatch = await caches.match(req, { ignoreSearch: true });
        return cacheMatch || caches.match(`${BASE_PATH}/offline.html`);
      }
    })());
    return;
  }

  // CSS/JS/画像はキャッシュ優先
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      const cache = await caches.open(`assets-${VERSION}`);
      cache.put(req, res.clone());
      return res;
    } catch {
      return cached || Promise.reject('offline');
    }
  })());
});