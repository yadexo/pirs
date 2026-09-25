/*
 * Service worker for the clients' installable apps.
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

/*
 * Web Push. Payload: { title, body, url?, tag?, icon? }.
 *
 * A push must always show something. iOS revokes the permission from an app
 * that receives a push and shows nothing, so every branch below ends in a
 * notification — including the one where the payload is unreadable.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Your clinic";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag,
      // The sender passes the clinic's own icon; without one the platform
      // shows its default rather than a broken image.
      icon: data.icon,
      badge: data.icon,
      data: { url: data.url || "/" },
    }),
  );
});

/**
 * Opening a notification returns to the app the client already has open when
 * there is one, rather than stacking up windows. Only same-origin URLs are
 * followed: the payload is data from the network, so a link anywhere else is
 * ignored rather than opened.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  let target;
  try {
    target = new URL(raw || "/", self.location.origin);
  } catch {
    target = new URL("/", self.location.origin);
  }
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // The clinic's own section of the site: "/riverside" from
      // "/riverside/shop", so a window already inside that clinic is reused.
      const clinic = "/" + target.pathname.split("/").filter(Boolean)[0];
      for (const w of windows) {
        const here = new URL(w.url);
        if (here.origin === self.location.origin && (here.pathname === clinic || here.pathname.startsWith(clinic + "/")) && "focus" in w) {
          await w.navigate(target.href).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
