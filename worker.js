// LeyLine Finder 中継役(Cloudflare Workers)
// ・/geo?q=名前      … geocoding.jp に名前を問い合わせ、緯度経度を返す(同じ言葉は7日間覚えておき、問い合わせを減らす)
// ・/expand?u=URL    … Googleマップの共有URL(maps.app.goo.gl など)の行き先を調べ、緯度経度を返す
// ・/hist?bb=南,西,北,東 … 古墳・遺跡などの史跡を OpenStreetMap(Overpass)と Wikidata から探して返す
// ・/card(POST)        … Noteに貼るカード用に、地図の画像とタイトルを預かり、短いURL(/n/番号)を返す
// ・/n/番号             … Noteのカード用のページ。地図の画像・タイトルを見せ、人が開くと見るだけの地図へ移る
// ・/i/番号.jpg         … カードの画像
// ・/card/delete(POST) … カードを消す(作ったときの合言葉 k が必要)
// ※ /card を使うには、Cloudflareで KV(名前空間)を作り、このWorkerに変数名「CARDS」で結び付けておく
// LeyLine Finder(askayuzuki.github.io)からの問い合わせだけに答える

const ALLOWED_ORIGINS = ["https://askayuzuki.github.io"];
const APP_URL = "https://askayuzuki.github.io/leyline-finder/";
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GOOGLE_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com", "www.google.com", "google.com", "www.google.co.jp", "google.co.jp"];

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const headers = { "Access-Control-Allow-Origin": allowOrigin, "Vary": "Origin", "Content-Type": "application/json; charset=utf-8" };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers });

    // Noteのカード用ページと画像(だれが開いてもよい)
    let m;
    if (req.method === "GET" && (m = url.pathname.match(/^\/i\/([A-Za-z0-9_-]{8,20})\.jpg$/))) {
      if (!env.CARDS) return new Response("not found", { status: 404 });
      const img = await env.CARDS.get("i:" + m[1], { type: "arrayBuffer" });
      if (!img) return new Response("not found", { status: 404 });
      return new Response(img, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
    }
    if (req.method === "GET" && (m = url.pathname.match(/^\/n\/([A-Za-z0-9_-]{8,20})$/))) {
      const rec = env.CARDS ? await env.CARDS.get("c:" + m[1], { type: "json" }) : null;
      if (!rec) return Response.redirect(APP_URL, 302);
      const dest = APP_URL + "?view#" + rec.h, title = rec.t || "LeyLine Finder の地図";
      const desc = (rec.d ? rec.d + "｜" : "") + "押すと地図が開き、拡大・縮小して見られます。LeyLine Finder";
      const img = url.origin + "/i/" + m[1] + ".jpg";
      const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}｜LeyLine Finder</title><meta name="description" content="${escHtml(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="LeyLine Finder"><meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(url.origin + url.pathname)}"><meta property="og:image" content="${escHtml(img)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="note:card" content="summary_large_image"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escHtml(img)}">
<meta http-equiv="refresh" content="0;url=${escHtml(dest)}"></head>
<body style="font-family:sans-serif;padding:24px"><script>location.replace(${JSON.stringify(dest)})</script><p><a href="${escHtml(dest)}">地図を開く</a></p></body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    }

    if (req.method === "OPTIONS") return new Response(null, { headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
    // My Mapごとの合言葉(k)から番号を作る。合言葉は端末の中だけにあり、番号からは逆算できない
    const idFromKey = async k => { const dg = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("k|" + k))); return btoa(String.fromCharCode(...dg.slice(0, 9))).replace(/\+/g, "-").replace(/\//g, "_"); };
    const okKey = k => /^[A-Za-z0-9_-]{16,64}$/.test(k);
    if (req.method === "POST" && url.pathname === "/card/delete") {
      if (!ALLOWED_ORIGINS.includes(origin)) return reply({ error: "forbidden" }, 403);
      if (!env.CARDS) return reply({ ok: false, error: "nokv" }, 501);
      let b; try { b = await req.json(); } catch (e) { return reply({ error: "json" }, 400); }
      const k = String(b.k || ""); if (!okKey(k)) return reply({ error: "k" }, 400);
      const id = await idFromKey(k);
      await env.CARDS.delete("i:" + id); await env.CARDS.delete("c:" + id);
      return reply({ ok: true, id });
    }
    if (req.method === "POST" && url.pathname === "/card") {
      if (!ALLOWED_ORIGINS.includes(origin)) return reply({ error: "forbidden" }, 403);
      if (!env.CARDS) return reply({ ok: false, error: "nokv" }, 501);
      let b; try { b = await req.json(); } catch (e) { return reply({ error: "json" }, 400); }
      const h = String(b.h || ""), t = String(b.t || "").slice(0, 60), d = String(b.d || "").slice(0, 120);
      if (!/^[zj]=[A-Za-z0-9_-]{1,8000}$/.test(h)) return reply({ error: "h" }, 400);
      const b64 = String(b.img || "");
      if (!b64 || b64.length > 1400000) return reply({ error: "img" }, 400);
      let bytes; try { bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch (e) { return reply({ error: "img" }, 400); }
      if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return reply({ error: "img" }, 400);
      // My Mapの合言葉(k)があれば、そのMy Mapでいつも同じ番号(中身を変えても画像を差し替えるだけ)。
      // 合言葉がなければ、同じ地図・同じタイトルなら同じ番号
      const k = String(b.k || "");
      let id;
      if (okKey(k)) id = await idFromKey(k);
      else { const dg = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(h + "|" + t))); id = btoa(String.fromCharCode(...dg.slice(0, 9))).replace(/\+/g, "-").replace(/\//g, "_"); }
      await env.CARDS.put("i:" + id, bytes);
      await env.CARDS.put("c:" + id, JSON.stringify({ h, t, d, at: Date.now() }));
      return reply({ ok: true, id, url: url.origin + "/n/" + id });
    }
    if (req.method !== "GET") return reply({ error: "method" }, 405);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ error: "forbidden" }, 403);

    if (url.pathname === "/geo") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q || q.length > 200) return reply({ error: "q" }, 400);
      const cache = caches.default;
      const key = new Request("https://leyline-cache.invalid/geo?q=" + encodeURIComponent(q));
      const hit = await cache.match(key);
      if (hit) { const body = await hit.text(); return new Response(body, { headers }); }
      const r = await fetch("https://www.geocoding.jp/api/?q=" + encodeURIComponent(q), { headers: { "User-Agent": "LeyLineFinder-relay/1.0" } });
      const xml = await r.text();
      const tag = (t) => { const m = xml.match(new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">")); return m ? m[1].trim() : ""; };
      const lat = parseFloat(tag("lat")), lng = parseFloat(tag("lng"));
      const out = (isFinite(lat) && isFinite(lng))
        ? { ok: true, lat, lng, name: tag("address"), place: tag("google_maps") }
        : { ok: false, error: tag("error") || "notfound" };
      const body = JSON.stringify(out);
      if (out.ok) ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=604800" } })));
      return new Response(body, { headers });
    }

    if (url.pathname === "/expand") {
      let u;
      try { u = new URL(url.searchParams.get("u") || ""); } catch (e) { return reply({ error: "u" }, 400); }
      if (u.protocol !== "https:" || !GOOGLE_HOSTS.includes(u.hostname)) return reply({ error: "host" }, 400);
      const r = await fetch(u.toString(), { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Accept-Language": "ja" } });
      const finalUrl = r.url;
      const pick = (s) => {
        let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|ll|query|center|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i);
        return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
      };
      let pos = pick(decodeURIComponent(finalUrl));
      let name = "";
      const pm = finalUrl.match(/\/place\/([^/@?]+)/);
      if (pm) name = decodeURIComponent(pm[1].replace(/\+/g, " "));
      if (!pos) {
        const html = await r.text();
        pos = pick(html) || (() => { const m = html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/); return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null; })();
        if (!name) { const t = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/); if (t) name = t[1].split(" · ")[0]; }
      }
      return reply(pos ? { ok: true, ...pos, name } : { ok: false, error: "nocoord" });
    }

    // /hist?bb=南,西,北,東 … 古墳・遺跡など史跡の登録を OpenStreetMap(Overpass)から探す(30日間覚えておく)
    if (url.pathname === "/hist") {
      const bb = (url.searchParams.get("bb") || "").split(",").map(Number);
      if (bb.length !== 4 || bb.some(v => !isFinite(v)) || bb[2] - bb[0] > 0.31 || bb[3] - bb[1] > 0.31 || bb[2] <= bb[0] || bb[3] <= bb[1]) return reply({ error: "bb" }, 400);
      const box = bb.map(v => v.toFixed(3)).join(",");
      const cache = caches.default;
      const key = new Request("https://leyline-cache.invalid/hist?bb=" + box);
      const hit = await cache.match(key);
      if (hit) return new Response(await hit.text(), { headers });
      const [S, W, N, E] = bb;
      const withTimeout = async (p, ms) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { return await p(ac.signal); } finally { clearTimeout(t); } };
      // ① OpenStreetMap(Overpass)：史跡の登録(古墳・遺跡・城跡など)
      const overpass = async () => {
        const q = `[out:json][timeout:15];(nwr["historic"~"^(archaeological_site|tomb|ruins|castle)$"]["name"](${box});nwr["historic"~"^(memorial|monument|boundary_stone)$"]["name"~"跡|史跡|古墳"](${box});nwr["site_type"="tumulus"]["name"](${box}););out center tags qt;`;
        for (const ep of ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter"]) {
          try {
            const j = await withTimeout(async sig => { const r = await fetch(ep + "?data=" + encodeURIComponent(q), { signal: sig, headers: { "User-Agent": "LeyLineFinder-relay/1.0 (personal map app)" } }); if (!r.ok) throw new Error(r.status); return r.json(); }, 9000);
            const keep = ["name", "name:ja", "historic", "site_type", "archaeological_site", "amenity"];
            return (j.elements || []).map(e => {
              const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
              if (lat == null) return null;
              const tags = {}; keep.forEach(k => { if (e.tags && e.tags[k]) tags[k] = e.tags[k]; });
              return { lat, lon, tags };
            }).filter(Boolean);
          } catch (e) { }
        }
        return null;
      };
      // ② Wikidata：座標を持つ項目のうち、名前に古墳・陵・塚・遺跡・跡が入るもの
      const wikidata = async () => {
        const q = `SELECT ?label ?loc WHERE { SERVICE wikibase:box { ?item wdt:P625 ?loc . bd:serviceParam wikibase:cornerSouthWest "Point(${W} ${S})"^^geo:wktLiteral . bd:serviceParam wikibase:cornerNorthEast "Point(${E} ${N})"^^geo:wktLiteral . } ?item rdfs:label ?label FILTER(lang(?label)="ja" && REGEX(?label,"古墳|陵|塚|遺跡|跡")) } LIMIT 400`;
        try {
          const j = await withTimeout(async sig => { const r = await fetch("https://query.wikidata.org/sparql?query=" + encodeURIComponent(q), { signal: sig, headers: { "Accept": "application/sparql-results+json", "User-Agent": "LeyLineFinder-relay/1.0 (personal map app)" } }); if (!r.ok) throw new Error(r.status); return r.json(); }, 9000);
          return (j.results.bindings || []).map(b => { const m = b.loc.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/); return m ? { lat: +m[2], lon: +m[1], tags: { name: b.label.value, historic: "wikidata" } } : null; }).filter(Boolean);
        } catch (e) { return null; }
      };
      const [a1, a2] = await Promise.all([overpass(), wikidata()]);
      if (!a1 && !a2) return reply({ ok: false, error: "sources" }, 502);
      const items = [...(a1 || []), ...(a2 || [])];
      const body = JSON.stringify({ ok: true, items, from: { overpass: !!a1, wikidata: !!a2 } });
      ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=2592000" } })));
      return new Response(body, { headers });
    }

    return reply({ ok: true, app: "LeyLine Finder relay" });
  }
};
