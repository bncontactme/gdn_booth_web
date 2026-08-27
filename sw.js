// ============================================================================
//  sw.js — Service worker
//  Guarda una copia de la aplicacion para que el booth siga abriendo aunque
//  el WiFi del lugar se caiga. Las fotos se suben aparte, desde app.js.
// ============================================================================

const CACHE = "gdn-booth-v2";

const SHELL = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
    "./booth-config.js",
    "./scenes.js",
    "./layers.js",
    "./vendor/qrcode.min.js",
    "./assets/logo.jpg",
    "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    // Las subidas a Cloudinary nunca se cachean ni se sirven desde cache.
    if (req.url.includes("api.cloudinary.com")) return;

    // Red primero para que una version nueva del booth se vea de inmediato;
    // el cache es solo el paracaidas cuando no hay internet.
    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res && res.ok && new URL(req.url).origin === self.location.origin) {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
});
