const CACHE="leyline-v40";
const TILES="leyline-tiles-v1";
let trimming=false;
async function trimTiles(c){if(trimming)return;trimming=true;try{const ks=await c.keys();if(ks.length>1500)for(const k of ks.slice(0,ks.length-1300))await c.delete(k);}finally{trimming=false;}}
const SHELL=["./","index.html","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png","https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==TILES).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// アプリ本体は「新しいものを優先、つながらないときは保存分」。地図タイルや検索は保存しない
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);
  if(e.request.method!=="GET")return;
  // 地図データ(OpenFreeMapの細かいタイル)は、一度読んだらiPhoneに取っておき、次からすぐ出す(最大1500枚)
  if(u.hostname==="tiles.openfreemap.org"&&/\/planet\/[^/]+\/1[2-4]\//.test(u.pathname)){
    e.respondWith(caches.open(TILES).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;
      const r=await fetch(e.request);if(r.ok){c.put(e.request,r.clone());trimTiles(c);}return r;}));return;}
  const shell=u.origin===location.origin||u.href.startsWith("https://unpkg.com/maplibre-gl@4.7.1/");
  if(!shell)return;
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("index.html"))));});
