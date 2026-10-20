/**
 * Scope for the page the reviewer is actually on.
 * `/yagoo/demo/` and `/yagoo/app/` each get their own worker so the rest of the docs stay unisolated.
 */
export function pageIsolationScope(base = import.meta.env.BASE_URL || '/'): string | null {
  const root = new URL(base, location.origin);
  for (const section of ['demo', 'app']) {
    const scope = new URL(`${section}/`, root).pathname;
    const bare = scope.replace(/\/$/, '');
    if (location.pathname === scope || location.pathname === bare || location.pathname.startsWith(scope)) return scope;
  }
  return null;
}

/** Explicit opt-in, scoped to this page, with a one-reload guard. */
export async function enableIsolation(scopePath?: string): Promise<string> {
  if (crossOriginIsolated) return 'Cross-origin isolation is already active.';
  if (!isSecureContext || !('serviceWorker' in navigator)) return 'This browser cannot install isolation support. Wasm will use one thread.';
  const base = new URL(scopePath || import.meta.env.BASE_URL, location.origin);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const key = `yagoo-coi-reload:${base.pathname}`;
  await navigator.serviceWorker.register(new URL('coi-serviceworker.js', base), { scope: base.pathname });
  await navigator.serviceWorker.ready;
  if (sessionStorage.getItem(key)) return 'Isolation is still unavailable after reload. Check COOP/COEP headers; Wasm will use one thread.';
  sessionStorage.setItem(key, '1');
  location.reload();
  return 'Reloading once to enable shared Wasm memory.';
}
