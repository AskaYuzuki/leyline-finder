const CACHE="leyline-v84";
const SHELL=["./","index.html","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png","places.js","https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"];
// 地図のオフライン用：SAVED＝「この範囲を保存」で入れた地図(自動では消さない)と、地図のスタイル・文字・記号
//                     AUTO ＝見た地図を自動で覚える分(上限を超えたら古いものから消す)
const SAVED="leyline-saved-v1",AUTO="leyline-auto-v1",AUTO_MAX=5000,KEEP=[CACHE,"leyline-poi-v1",SAVED,AUTO];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>!KEEP.includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// OpenFreeMap の地図は版(日付)がURLに入って毎週変わるので、版を外した名前で覚える(アプリ側の tileKey と同じ)
function tileKey(u){if(u.hostname==="tiles.openfreemap.org"){const m=u.pathname.match(/^\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/);if(m)return "https://tiles.openfreemap.org/planet/_/"+m[1];}return u.origin+u.pathname;}
const isTile=u=>/\/\d+\/\d+\/\d+\.(pbf|png|jpg)$/.test(u.pathname);
const withTimeout=(p,ms)=>new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error("timeout")),ms);p.then(v=>{clearTimeout(t);res(v);},e=>{clearTimeout(t);rej(e);});});
let puts=0;
async function trimAuto(){const c=await caches.open(AUTO);const ks=await c.keys();if(ks.length>AUTO_MAX)for(const k of ks.slice(0,ks.length-AUTO_MAX))await c.delete(k);}
async function mapTile(req,u){const key=tileKey(u);
  const hit=(await (await caches.open(SAVED)).match(key))||(await (await caches.open(AUTO)).match(key));
  if(hit)return hit;
  try{const r=await fetch(req);if(r.ok){const cp=r.clone();caches.open(AUTO).then(c=>c.put(key,cp)).then(()=>{if(++puts%200===0)trimAuto();});}return r;}
  catch(e){return new Response("",{status:504,statusText:"offline"});}}
async function mapOther(req,u){const key=u.href;
  try{const r=await withTimeout(fetch(req),6000);if(r.ok){const cp=r.clone();caches.open(SAVED).then(c=>c.put(key,cp));}return r;}
  catch(e){const hit=await (await caches.open(SAVED)).match(key);if(hit)return hit;return new Response("",{status:504,statusText:"offline"});}}
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);
  if(e.request.method!=="GET")return;
  // 地図(標準・淡色＝OpenFreeMap、国土地理院の標準地図・陰影)。航空写真は大きいので覚えない
  if(u.hostname==="tiles.openfreemap.org"||(u.hostname==="cyberjapandata.gsi.go.jp"&&!u.pathname.includes("seamlessphoto"))){
    e.respondWith(isTile(u)?mapTile(e.request,u):mapOther(e.request,u));return;}
  const shell=u.origin===location.origin||u.href.startsWith("https://unpkg.com/maplibre-gl@5.24.0/");
  if(!shell)return;
  // アプリ本体は「新しいものを優先、つながらない・遅いときは保存分」
  e.respondWith(withTimeout(fetch(e.request,{cache:"no-cache"}),4000).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("index.html"))));});
