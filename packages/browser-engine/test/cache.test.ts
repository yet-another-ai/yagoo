import { afterEach, expect, it, vi } from 'vitest';
import {
  cacheHas,
  cachePartialDelete,
  cachePartialRead,
  cachePartialWriter,
  cachePut,
  cacheRead,
  clearModelCache,
  listCachedModels,
} from '../src/cache';
import { mockOpfs } from './opfs';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function useOpfs(directory: unknown): void {
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory } });
}

it('stores, lists, and clears content-addressed OPFS model blobs', async () => {
  const { files, directory } = mockOpfs();
  useOpfs(directory);
  const sha = 'a'.repeat(64);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  expect(await cachePut(sha, bytes)).toBe(true);
  expect(await cacheHas(sha)).toBe(true);
  expect(Array.from(await cacheRead(sha) ?? [])).toEqual([1, 2, 3, 4]);
  expect(await listCachedModels()).toEqual([{ sha256: sha, bytes: 4 }]);
  expect(await clearModelCache()).toBe(1);
  expect(files.size).toBe(0);
  expect(await listCachedModels()).toEqual([]);
});

it('reads, appends to, and deletes a resumable partial', async () => {
  const sha = 'b'.repeat(64);
  const name = `partial-${sha}`;
  const { files, directory } = mockOpfs({ [name]: new Uint8Array([1, 2]) });
  useOpfs(directory);

  const target = new Uint8Array(4);
  expect(await cachePartialRead(sha, target)).toBe(2);
  expect(Array.from(target)).toEqual([1, 2, 0, 0]);
  expect(await cachePartialWriter(sha, 4, 0)).toBeUndefined();

  const writer = await cachePartialWriter(sha, 4, 2);
  expect(writer?.offset).toBe(2);
  await writer!.write(new Uint8Array([3, 4]));
  await writer!.close();

  const again = new Uint8Array(4);
  expect(await cachePartialRead(sha, again)).toBe(4);
  expect(Array.from(again)).toEqual([1, 2, 3, 4]);
  // Partials are not verified models.
  expect(await cacheHas(sha)).toBe(false);
  expect(await listCachedModels()).toEqual([]);

  await cachePartialDelete(sha);
  expect(files.has(name)).toBe(false);
});

it('drops an oversized or truncated partial instead of resuming from it', async () => {
  const sha = 'c'.repeat(64);
  const name = `partial-${sha}`;
  const { files, directory } = mockOpfs({ [name]: new Uint8Array(5) });
  useOpfs(directory);

  expect(await cachePartialRead(sha, new Uint8Array(4))).toBe(0);
  expect(files.has(name)).toBe(false);

  files.set(name, new Uint8Array([7, 8]));
  const target = new Uint8Array(4);
  expect(await cachePartialRead(sha, target)).toBe(2);
  expect(Array.from(target)).toEqual([7, 8, 0, 0]);
});

it('clears resumable partials together with verified entries', async () => {
  const sha = 'd'.repeat(64);
  const { files, directory } = mockOpfs({
    [sha]: new Uint8Array([1]),
    [`partial-${sha}`]: new Uint8Array([2]),
  });
  useOpfs(directory);
  expect(await clearModelCache()).toBe(2);
  expect(files.size).toBe(0);
});
