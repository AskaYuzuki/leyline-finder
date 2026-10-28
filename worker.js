// LeyLine Finder 中継役(Cloudflare Workers)
// ・/geo?q=名前      … geocoding.jp に名前を問い合わせ、緯度経度を返す(同じ言葉は7日間覚えておき、問い合わせを減らす)
// ・/expand?u=URL    … Googleマップの共有URL(maps.app.goo.gl など)の行き先を調べ、緯度経度を返す
// ・/hist?bb=南,西,北,東 … 古墳・遺跡などの史跡を OpenStreetMap(Overpass)から探して返す
// LeyLine Finder(askayuzuki.github.io)からの問い合わせだけに答える

const ALLOWED_ORIGINS = ["https://askayuzuki.github.io"];
const GOOGLE_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com", "www.google.com", "google.com", "www.google.co.jp", "google.co.jp"];

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const headers = { "Access-Control-Allow-Origin": allowOrigin, "Vary": "Origin", "Content-Type": "application/json; charset=utf-8" };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers });

    if (req.method === "OPTIONS") return new Response(null, { headers: { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
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
      const q = `[out:json][timeout:25];(nwr["historic"~"^(archaeological_site|tomb|ruins|castle)$"]["name"](${box});nwr["historic"~"^(memorial|monument|boundary_stone)$"]["name"~"跡|史跡|古墳"](${box});nwr["site_type"="tumulus"]["name"](${box}););out center tags qt;`;
      const ends = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
      for (const ep of ends) {
        try {
          const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LeyLineFinder-relay/1.0" } });
          if (!r.ok) continue;
          const j = await r.json();
          const keep = ["name", "name:ja", "historic", "site_type", "archaeological_site", "amenity"];
          const items = (j.elements || []).map(e => {
            const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
            if (lat == null) return null;
            const tags = {}; keep.forEach(k => { if (e.tags && e.tags[k]) tags[k] = e.tags[k]; });
            return { lat, lon, tags };
          }).filter(Boolean);
          const body = JSON.stringify({ ok: true, items });
          ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=2592000" } })));
          return new Response(body, { headers });
        } catch (e) { }
      }
      return reply({ ok: false, error: "overpass" }, 502);
    }

    return reply({ ok: true, app: "LeyLine Finder relay" });
  }
};
