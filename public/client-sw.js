/*
 * Service worker for the clients' installable apps (/app/...).
 *
 * Privacy first: pages and data belong to a signed-in client, so they are
 * never cached — a shared or lost phone offline shows a neutral page, not
 * someone's balance. Only Next's fingerprinted static files are cached, which
 * makes a relaunch instant.
 */
const STATIC_CACHE = "client-static-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== STATIC_CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Offline</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f5f7;color:#1b2233;text-align:center;padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#7a8598;margin:0 0 20px}button{font:inherit;font-weight:600;border:0;border-radius:999px;background:#0b0d12;color:#fff;height:48px;padding:0 28px}</style></head>
<body><div><h1>You're offline</h1><p>Connect to the internet to open the app.</p><button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
  }
});

/* Web Push. Payload: { title, body, url, tag?, icon? } — url must be on this site. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "New message";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag,
      icon: data.icon,
      badge: data.icon,
      data: { url: data.url || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/app", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).pathname.startsWith(target.pathname.split("/").slice(0, 3).join("/")) && "focus" in w) {
          await w.navigate(target.href).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
