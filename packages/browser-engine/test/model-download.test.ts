import { afterEach, expect, it, vi } from 'vitest';
import { bundleFromLocalFiles, loadArtifact, validateManifest } from '../src/model';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function artifact(bytes: Uint8Array, url = 'model.onnx') {
  const copy = new Uint8Array(bytes);
  return crypto.subtle.digest('SHA-256', copy).then(hash => ({
    url,
    bytes: copy.byteLength,
    sha256: Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join(''),
    integrity: 'unused',
  }));
}

function manifestFor(fp32: Awaited<ReturnType<typeof artifact>>, warmup: Awaited<ReturnType<typeof artifact>>) {
  return {
    schemaVersion: 1 as const,
    model: 'kata1-b18c384nbt-s9996604416-d4316597426',
    swa: true as const,
    modelVersion: 14,
    inputVersion: 7 as const,
    boardSize: 19 as const,
    batch: 1,
    checkpointSha256: 'ed3f2681be01604fd51b467925de77cea4f19cf125383493449d8c002fb91a24',
    upstreamRevision: 'd91ea855110dae533f0aada947b2b7d78cc8a4e1',
    outputs: ['policy', 'value', 'miscvalue', 'moremiscvalue', 'ownership', 'scoring', 'scorebelief_logprobs', 'seki', 'futurepos'],
    variants: { fp32 },
    warmup,
    license: 'LICENSE',
    source: 'https://example.test/official-checkpoint',
    postprocess: { scoremean_multiplier: 20, scorestdev_multiplier: 20, lead_multiplier: 20 },
  };
}

it('downloads with progress, verifies, and honors AbortSignal without Range resume', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => { throw new Error('no opfs'); } } });
  const chunks = [payload.subarray(0, 3), payload.subarray(3)];
  let index = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          if (index >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[index++] };
        },
        cancel: async () => {},
      }),
    },
  })));
  const progress: number[] = [];
  const bytes = await loadArtifact('https://example.test/', meta, {
    progress: (loaded, total) => progress.push(loaded, total),
  });
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(progress).toEqual([3, 6, 6, 6]);

  index = 0;
  const controller = new AbortController();
  const pending = loadArtifact('https://example.test/', meta, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

it('stages local files into a blob manifest without network fetch', async () => {
  const onnx = new Uint8Array([1, 2, 3, 4]);
  const warmup = new Uint8Array([5, 6]);
  const fp32 = await artifact(onnx, 'model.onnx');
  const warm = await artifact(warmup, 'warmup.json');
  const manifest = manifestFor(fp32, warm);
  validateManifest(manifest);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => { throw new Error('no opfs'); } } });
  const urls: string[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${urls.length}`;
      urls.push(url);
      // Keep a handle so revoke is exercised.
      void blob;
      return url;
    },
    revokeObjectURL: vi.fn(),
  });
  const bundle = await bundleFromLocalFiles([
    new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' }),
    new File([onnx], 'model.onnx'),
    new File([warmup], 'warmup.json'),
  ]);
  expect(bundle.manifestUrl.startsWith('blob:')).toBe(true);
  expect(bundle.manifest.variants.fp32.url.startsWith('blob:')).toBe(true);
  bundle.revoke();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
