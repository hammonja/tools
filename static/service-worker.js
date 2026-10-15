const SHELL_CACHE = "toolbox-shell-v2";
const DATA_CACHE = "toolbox-catalogue-v1";
const PHOTO_CACHE = "toolbox-photos-v1";
const SNAPSHOT = "/__toolbox_catalogue__";
const APP_SHELL = [
  "/catalogue-shell", "/offline", "/static/style.css", "/static/pwa.js",
  "/static/catalogue.js", "/static/manifest.webmanifest",
  "/static/icons/toolbox.svg", "/static/icons/toolbox-180.png",
  "/static/icons/toolbox-192.png", "/static/icons/toolbox-512.png"
];

async function network(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {cache: "no-store", signal: controller.signal});
  } finally { clearTimeout(timer); }
}

function valid(response, type) {
  return response.ok && !response.redirected && (response.headers.get("content-type") || "").includes(type);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Do not activate a partial shell or cache an authentication redirect.
    for (const path of APP_SHELL) {
      const response = await network(path);
      const type = path.endsWith(".js") ? "javascript" : path.endsWith(".css") ? "text/css" :
        path.startsWith("/static/icons/") ? "image/" : path.endsWith(".webmanifest") ? "json" : "text/html";
      if (!valid(response, type)) throw new Error("App download failed");
      await cache.put(path, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("toolbox-shell-") && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function validateSnapshot(data) {
  if (data.schema_version !== 1 || !Array.isArray(data.tools)) throw new Error("Invalid catalogue");
  const ids = new Set();
  for (const tool of data.tools) {
    if (!tool || typeof tool.id !== "string" || !tool.id || ids.has(tool.id) ||
        typeof tool.name !== "string" || typeof tool.image_url !== "string") throw new Error("Invalid tool");
    ids.add(tool.id);
    if (tool.image_url) {
      const url = new URL(tool.image_url, self.location.origin);
      if (url.origin !== self.location.origin || !url.pathname.startsWith("/uploads/")) throw new Error("Invalid photo URL");
    }
  }
  return data;
}

async function cachedCatalogue() {
  try {
    const cache = await caches.open(DATA_CACHE);
    const response = await cache.match(SNAPSHOT);
    return response ? validateSnapshot(await response.json()) : null;
  } catch (_) { return null; }
}

async function synchronise() {
  const response = await network("/api/tools");
  if (!valid(response, "application/json")) throw new Error("Server unavailable");
  const data = validateSnapshot(await response.json());
  data.synced_at = new Date().toISOString();
  try {
    const photos = await caches.open(PHOTO_CACHE);
    const wanted = new Set(data.tools.filter((tool) => tool.image_url)
      .map((tool) => new URL(tool.image_url, self.location.origin).href));
    let complete = 0;
    for (const url of wanted) {
      if (!await photos.match(url)) {
        const photo = await network(url);
        if (!valid(photo, "image/")) throw new Error("Photo unavailable");
        await photos.put(url, photo);
      }
      complete++;
      const clients = await self.clients.matchAll({type: "window"});
      clients.forEach((client) => client.postMessage({type: "SYNC_PROGRESS", complete, total: wanted.size}));
    }
    // Commit after every photo is ready. Failure preserves the previous snapshot.
    const catalogue = await caches.open(DATA_CACHE);
    await catalogue.put(SNAPSHOT, new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}}));
    for (const key of await photos.keys()) {
      if (!wanted.has(key.url)) await photos.delete(key);
    }
    return {data, saved: true};
  } catch (_) {
    // Discard incomplete downloads without touching the last committed photos.
    try {
      const previous = await cachedCatalogue();
      const keep = new Set((previous?.tools || []).filter((tool) => tool.image_url)
        .map((tool) => new URL(tool.image_url, self.location.origin).href));
      const photos = await caches.open(PHOTO_CACHE);
      for (const key of await photos.keys()) if (!keep.has(key.url)) await photos.delete(key);
    } catch (_) { /* Storage failure must not prevent normal online browsing. */ }
    return {data, saved: false};
  }
}

let syncing;
self.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === "GET_CATALOGUE") port.postMessage({data: await cachedCatalogue()});
      if (event.data.type === "SYNC_CATALOGUE") {
        if (!syncing) syncing = synchronise().finally(() => { syncing = null; });
        port.postMessage(await syncing);
      }
    } catch (_) {
      port.postMessage({error: "Could not reach the server. Your saved catalogue is unchanged."});
    } finally { port.close(); }
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const shell = await caches.open(SHELL_CACHE);
        if (url.pathname === "/") {
          const page = await shell.match("/catalogue-shell");
          if (page) return page;
        }
        try {
          const response = await network(event.request);
          if (response.status < 500) return response;
        } catch (_) { /* Use the offline navigation page below. */ }
        const offline = await shell.match("/offline");
        if (offline) return offline;
      } catch (_) { return fetch(event.request); }
      return new Response("Offline. Reconnect and try again.", {status: 503});
    })());
  } else if (APP_SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const cached = await (await caches.open(SHELL_CACHE)).match(event.request);
        if (cached) return cached;
      } catch (_) { /* Storage is optional for normal network loading. */ }
      return fetch(event.request);
    })());
  } else if (url.pathname.startsWith("/uploads/")) {
    event.respondWith((async () => {
      try {
        const cached = await (await caches.open(PHOTO_CACHE)).match(event.request);
        if (cached) return cached;
      } catch (_) { /* Preserve normal photo loading without storage. */ }
      return fetch(event.request);
    })());
  }
  // API requests, form pages and writes otherwise stay network-only.
});
