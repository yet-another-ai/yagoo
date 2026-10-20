import { afterEach, expect, it, vi } from 'vitest';
import { cacheHas, cachePut, cacheRead, clearModelCache, listCachedModels } from '../src/cache';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

function mockOpfs(files = new Map<string, Uint8Array>()) {
  const directory = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new DOMException('missing', 'NotFoundError');
      if (!files.has(name)) files.set(name, new Uint8Array());
      return {
        kind: 'file' as const,
        async getFile() {
          const data = files.get(name)!;
          return { size: data.byteLength, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
        },
        async createWritable() {
          const chunks: Uint8Array[] = [];
          return {
            async write(bytes: Uint8Array) { chunks.push(bytes); },
            async close() { files.set(name, chunks.length === 1 ? chunks[0]! : concat(chunks)); },
            async abort() {},
          };
        },
      };
    },
    async removeEntry(name: string) { files.delete(name); },
    async *entries() {
      for (const [name] of files) {
        yield [name, await this.getFileHandle(name)] as unknown as [string, FileSystemHandle];
      }
    },
  };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory } });
  return files;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

it('stores, lists, and clears content-addressed OPFS model blobs', async () => {
  const files = mockOpfs();
  const sha = 'a'.repeat(64);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await cachePut(sha, bytes);
  expect(await cacheHas(sha)).toBe(true);
  expect(Array.from(await cacheRead(sha) ?? [])).toEqual([1, 2, 3, 4]);
  expect(await listCachedModels()).toEqual([{ sha256: sha, bytes: 4 }]);
  expect(await clearModelCache()).toBe(1);
  expect(files.size).toBe(0);
  expect(await listCachedModels()).toEqual([]);
});
