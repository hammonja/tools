const CACHE_NAME = "toolbox-shell-v1";
const APP_SHELL = [
  "/offline",
  "/static/style.css",
  "/static/pwa.js",
  "/static/icons/toolbox.svg",
  "/static/icons/toolbox-180.png",
  "/static/icons/toolbox-192.png",
  "/static/icons/toolbox-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/static/")) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});
