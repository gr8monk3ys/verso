/*
 * Verso service worker.
 *
 * Scope is deliberately narrow. The sighting queue lives in IndexedDB and is
 * flushed by the app, not by the worker — background sync is a nice-to-have,
 * but a diary entry that only exists inside a service worker's retry loop is
 * an entry you cannot see, and §9.1's promise is that logging works with no
 * signal, not that it works invisibly.
 *
 * What this does:
 *   · keeps the app shell and static assets available offline
 *   · serves the last-seen copy of a page when the network fails
 *   · never caches API responses that mutate state
 */

const VERSION = "verso-v1";
const SHELL = [
  "/",
  "/capture",
  "/search",
  "/offline",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve a stale sync endpoint; never cache one either.
  if (url.pathname.startsWith("/api/sightings")) return;

  // Immutable build output: cache first.
  if (url.pathname.startsWith("/_next/static")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else: network first, falling back to whatever we last saw.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return (await caches.match("/offline")) ?? Response.error();
        }
        return Response.error();
      }),
  );
});
