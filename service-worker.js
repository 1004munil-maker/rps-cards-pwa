const CACHE_NAME = "rps-cards-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
self.addEventListener("install", (e)=>{
  e.waitUntil((async ()=>{
    const c = await caches.open(CACHE_NAME);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});
self.addEventListener("activate", (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k=> k===CACHE_NAME ? null : caches.delete(k)));
    self.clients.claim();
  })());
});
self.addEventListener("fetch", (e)=>{
  const { request } = e;
  if (request.method !== "GET") return;
  e.respondWith((async ()=>{
    const cached = await caches.match(request);
    if (cached) return cached;
    try{
      const res = await fetch(request);
      const c = await caches.open(CACHE_NAME);
      c.put(request, res.clone());
      return res;
    }catch(e){
      return cached || Response.error();
    }
  })());
});