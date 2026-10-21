import { expect, it, vi } from 'vitest';
import { enableIsolation, replaceStaleIsolation, siteIsolationRoot } from '../src/isolation';

it('registers the isolation worker at the site root so hashed assets are in scope', () => {
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/yagoo/demo/' });
  const root = siteIsolationRoot('/yagoo/');
  expect(root.pathname).toBe('/yagoo/');
  expect(new URL('coi-serviceworker.js', root).pathname).toBe('/yagoo/coi-serviceworker.js');
  vi.unstubAllGlobals();
});

it('replaces a page-scoped isolation worker even when the page is already isolated', async () => {
  const scopes: string[] = [];
  const unregistered: string[] = [];
  vi.stubEnv('BASE_URL', '/yagoo/');
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/yagoo/demo/', reload: () => {} });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistrations: async () => [{
        scope: 'https://example.test/yagoo/demo/',
        unregister: async () => { unregistered.push('/yagoo/demo/'); },
      }],
      register: async (_url: URL, options: { scope: string }) => { scopes.push(options.scope); },
      ready: Promise.resolve(),
    },
  });
  await expect(enableIsolation('/yagoo/demo/')).resolves.toMatch(/page-scoped/);
  expect(unregistered).toEqual(['/yagoo/demo/']);
  expect(scopes).toEqual(['/yagoo/']);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('leaves an already-rooted isolation worker in place', async () => {
  let registered = false;
  let looked = 0;
  vi.stubEnv('BASE_URL', '/yagoo/');
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/yagoo/demo/', reload: () => { registered = true; } });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistrations: async () => {
        looked += 1;
        return [{ scope: 'https://example.test/yagoo/', unregister: async () => {} }];
      },
      register: async () => { registered = true; },
      ready: Promise.resolve(),
    },
  });
  await expect(replaceStaleIsolation()).resolves.toBeUndefined();
  expect(looked).toBe(1);
  expect(registered).toBe(false);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
