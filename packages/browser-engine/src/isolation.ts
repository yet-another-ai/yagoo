/**
 * Page that may opt into isolation. The service worker itself is registered at
 * the site root: hashed engine assets and ORT files live outside `/demo/` and `/app/`.
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

/** Site root. The worker script must live here so its scope includes `/assets/` and `/ort/`. */
export function siteIsolationRoot(base = import.meta.env.BASE_URL || '/'): URL {
  const root = new URL(base, location.origin);
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  return root;
}

function registrationPath(registration: ServiceWorkerRegistration): string {
  return new URL(registration.scope).pathname;
}

/** Page-scoped workers from older builds do not cover `/assets/` or `/ort/`. */
async function unregisterNarrowIsolation(root: URL): Promise<number> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  const stale = registrations.filter((registration) => {
    const path = registrationPath(registration);
    return path.startsWith(root.pathname) && path !== root.pathname;
  });
  await Promise.all(stale.map((registration) => registration.unregister()));
  return stale.length;
}

/**
 * Explicit opt-in. Headers are limited to the reviewer pages by coi-serviceworker.js.
 * An already-isolated page still reloads once when a narrower registration would
 * leave the engine worker outside COEP.
 */
export async function enableIsolation(scopePath?: string): Promise<string> {
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    return crossOriginIsolated
      ? 'engine.isolationActive'
      : 'engine.isolationUnsupported';
  }
  const page = new URL(scopePath || import.meta.env.BASE_URL, location.origin);
  if (!page.pathname.endsWith('/')) page.pathname += '/';
  const root = siteIsolationRoot();
  const key = `yagoo-coi-reload:${page.pathname}`;
  const upgradeKey = `yagoo-coi-upgrade:${page.pathname}`;
  const removed = await unregisterNarrowIsolation(root);
  const registrations = await navigator.serviceWorker.getRegistrations();
  const hasRoot = registrations.some((registration) => registrationPath(registration) === root.pathname);
  if (!hasRoot) {
    await navigator.serviceWorker.register(new URL('coi-serviceworker.js', root), { scope: root.pathname });
    await navigator.serviceWorker.ready;
  }
  if (removed > 0) {
    if (sessionStorage.getItem(upgradeKey)) {
      return 'engine.isolationStale';
    }
    sessionStorage.setItem(upgradeKey, '1');
    location.reload();
    return 'engine.isolationUpgrade';
  }
  if (crossOriginIsolated && hasRoot) return 'engine.isolationActive';
  if (sessionStorage.getItem(key)) return 'engine.isolationUnavailable';
  sessionStorage.setItem(key, '1');
  location.reload();
  return 'engine.isolationReloading';
}

/** Replace an older `/demo/` or `/app/` registration the next time that page loads. */
export async function replaceStaleIsolation(): Promise<void> {
  if (!isSecureContext || !('serviceWorker' in navigator)) return;
  const scope = pageIsolationScope();
  if (!scope) return;
  const root = siteIsolationRoot();
  const registrations = await navigator.serviceWorker.getRegistrations();
  const stale = registrations.some((registration) => {
    const path = registrationPath(registration);
    return path.startsWith(root.pathname) && path !== root.pathname;
  });
  if (stale) await enableIsolation(scope);
}
