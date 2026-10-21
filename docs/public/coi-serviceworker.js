// Same-origin isolation for static hosts that cannot set COOP/COEP.
// Registered at the site root so /assets and /ort are in scope. Headers are
// added only for the demo and reviewer documents, and for the engine worker
// and ORT pthread modules those pages start. Other docs pages stay unisolated.
const sections = ["demo", "app"];

function scopePath() {
  return new URL("./", self.location).pathname;
}

function isReviewerPath(pathname) {
  const root = scopePath();
  return sections.some((name) => {
    const dir = `${root}${name}/`;
    return pathname === `${root}${name}` || pathname === dir || pathname.startsWith(dir);
  });
}

function isEngineClient(pathname) {
  return /\/assets\/engine\.worker-[^/]+\.js$/.test(pathname)
    || /\/ort-wasm[^/]*\.mjs$/.test(pathname)
    || /\/ort\.webgpu\.bundle\.min\.mjs$/.test(pathname);
}

function withIsolation(response) {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  event.respondWith((async () => {
    const response = await fetch(request);
    if (response.status === 0 || response.type === "opaqueredirect") return response;
    const navigating = request.mode === "navigate" || request.destination === "document" || request.destination === "iframe";
    if (navigating) return isReviewerPath(url.pathname) ? withIsolation(response) : response;
    const client = event.clientId ? await self.clients.get(event.clientId) : null;
    const clientPath = client ? new URL(client.url).pathname : "";
    if (isReviewerPath(clientPath) || isEngineClient(clientPath)) return withIsolation(response);
    return response;
  })());
});
