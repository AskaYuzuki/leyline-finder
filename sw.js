const CACHE="leyline-v1";
const SHELL=["./","index.html","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png","https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// アプリ本体は「新しいものを優先、つながらないときは保存分」。地図タイルや検索は保存しない
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);
  if(e.request.method!=="GET")return;
  const shell=u.origin===location.origin||u.href.startsWith("https://unpkg.com/maplibre-gl@4.7.1/");
  if(!shell)return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("index.html"))));});
