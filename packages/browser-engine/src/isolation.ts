/** Explicit opt-in, scoped to this app's base path, with a one-reload guard. */
export async function enableIsolation(): Promise<string> {
  if (crossOriginIsolated) return 'Cross-origin isolation is already active.';
  if (!isSecureContext || !('serviceWorker' in navigator)) return 'This browser cannot install isolation support. Wasm will use one thread.';
  const base = new URL(import.meta.env.BASE_URL, location.origin);
  const key = `yagoo-coi-reload:${base.pathname}`;
  await navigator.serviceWorker.register(new URL('coi-serviceworker.js', base), { scope: base.pathname });
  await navigator.serviceWorker.ready;
  if (sessionStorage.getItem(key)) return 'Isolation is still unavailable after reload. Check COOP/COEP headers; Wasm will use one thread.';
  sessionStorage.setItem(key, '1');
  location.reload();
  return 'Reloading once to enable shared Wasm memory.';
}
