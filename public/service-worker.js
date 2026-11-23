const CACHE_NAME = "DUMBBUDGET_PWA_CACHE_V2";
const ASSETS_TO_CACHE = [];

const preload = async () => {
  console.log("Installing web app");
  return await caches.open(CACHE_NAME)
    .then(async (cache) => {
      console.log("caching index and important routes");
      const response = await fetch("/asset-manifest.json");
      const assets = await response.json();
      ASSETS_TO_CACHE.push(...assets);
      console.log("Assets Cached:", ASSETS_TO_CACHE);
      return cache.addAll(ASSETS_TO_CACHE);
  });
}

// Fetch asset manifest dynamically
globalThis.addEventListener("install", (event) => {
  // Activate the new version straight away instead of waiting
  globalThis.skipWaiting();
  event.waitUntil(preload());
});

globalThis.addEventListener("activate", (event) => {
  // Delete caches from older versions of the app
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

// Network first: always try to get the latest files, use the cache only when offline.
// (The original "cache first" approach kept serving old files after code changes.)
globalThis.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});