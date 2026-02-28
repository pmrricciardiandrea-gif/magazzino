const CACHE_NAME = "magazzino-shell-v1";
const SHELL_ASSETS = [
  "/app",
  "/app/",
  "/app/index.html",
  "/app/styles.css",
  "/app/app.js",
  "/app/manifest.webmanifest",
  "/app/icons/icon-192.svg",
  "/app/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/app/") &&
    (url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".webmanifest"))
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/app/index.html", copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/app/index.html")))
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const networkFetch = fetch(req)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            return response;
          })
          .catch(() => hit);
        return hit || networkFetch;
      })
    );
  }
});
