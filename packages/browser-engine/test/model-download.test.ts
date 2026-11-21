import { afterEach, expect, it, vi } from 'vitest';
import { bundleFromLocalFiles, loadArtifact, validateManifest, type Artifact } from '../src/model';
import { mockOpfs } from './opfs';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function artifact(bytes: Uint8Array, url = 'model.onnx'): Promise<Artifact> {
  const copy = new Uint8Array(bytes);
  return crypto.subtle.digest('SHA-256', copy).then(hash => ({
    url,
    bytes: copy.byteLength,
    sha256: Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join(''),
    integrity: 'unused',
  }));
}

function manifestFor(fp32: Artifact, warmup: Artifact) {
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

function response(chunks: Uint8Array[], init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { status: init.status ?? 200, headers: init.headers });
}

function partialName(sha256: string): string {
  return `partial-${sha256}`;
}

function useOpfs(directory: unknown): void {
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory } });
}

function useNoOpfs(): void {
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => { throw new Error('no opfs'); } } });
}

function rangeOf(init?: RequestInit): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Range;
}

it('downloads with progress, verifies, and honors AbortSignal', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  useNoOpfs();
  vi.stubGlobal('fetch', vi.fn(async () => response([payload.subarray(0, 3), payload.subarray(3)])));
  const progress: number[] = [];
  const bytes = await loadArtifact('https://example.test/', meta, {
    progress: (loaded, total) => progress.push(loaded, total),
  });
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(progress).toEqual([3, 6, 6, 6]);

  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => {
          controller.abort();
          throw new DOMException('aborted', 'AbortError');
        },
        cancel: async () => {},
      }),
    },
  })));
  const pending = loadArtifact('https://example.test/', meta, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

it('resumes a partial artifact with a matching 206 range', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  const { files, directory } = mockOpfs({ [partialName(meta.sha256)]: payload.subarray(0, 3) });
  useOpfs(directory);
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => response([payload.subarray(3)], {
    status: 206,
    headers: { 'Content-Range': 'bytes 3-5/6' },
  }));
  vi.stubGlobal('fetch', fetchMock);

  const progress: number[] = [];
  const bytes = await loadArtifact('https://example.test/', meta, {
    progress: (loaded, total) => progress.push(loaded, total),
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(rangeOf(fetchMock.mock.calls[0]![1])).toBe('bytes=3-');
  expect(progress).toEqual([3, 6, 6, 6]);
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(Array.from(files.get(meta.sha256)!)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(files.has(partialName(meta.sha256))).toBe(false);
});

it('restarts from zero when the host ignores Range', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  const { files, directory } = mockOpfs({ [partialName(meta.sha256)]: payload.subarray(0, 3) });
  useOpfs(directory);
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => response([payload]));
  vi.stubGlobal('fetch', fetchMock);

  const bytes = await loadArtifact('https://example.test/', meta);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(rangeOf(fetchMock.mock.calls[0]![1])).toBe('bytes=3-');
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(Array.from(files.get(meta.sha256)!)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(files.has(partialName(meta.sha256))).toBe(false);
});

it('rejects a foreign Content-Range and retries without Range', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  const { directory } = mockOpfs({ [partialName(meta.sha256)]: payload.subarray(0, 3) });
  useOpfs(directory);
  let calls = 0;
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
    if (calls++ === 0) {
      return response([payload.subarray(1)], {
        status: 206,
        headers: { 'Content-Range': 'bytes 1-5/6' },
      });
    }
    return response([payload]);
  });
  vi.stubGlobal('fetch', fetchMock);

  const bytes = await loadArtifact('https://example.test/', meta);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(rangeOf(fetchMock.mock.calls[0]![1])).toBe('bytes=3-');
  expect(rangeOf(fetchMock.mock.calls[1]![1])).toBeUndefined();
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
});

it('drops an oversized partial and downloads from zero', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  const { files, directory } = mockOpfs({ [partialName(meta.sha256)]: new Uint8Array(8) });
  useOpfs(directory);
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => response([payload]));
  vi.stubGlobal('fetch', fetchMock);

  const bytes = await loadArtifact('https://example.test/', meta);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(rangeOf(fetchMock.mock.calls[0]![1])).toBeUndefined();
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(files.has(partialName(meta.sha256))).toBe(false);
});

it('keeps a durable prefix when the connection drops, then resumes it', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  const { files, directory } = mockOpfs();
  useOpfs(directory);
  let calls = 0;
  const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    if (calls++ === 0) {
      let pulled = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled++ === 0) controller.enqueue(payload.subarray(0, 3));
          else controller.error(new Error('connection lost'));
        },
      }), { status: 200 });
    }
    expect(rangeOf(init)).toBe('bytes=3-');
    return response([payload.subarray(3)], {
      status: 206,
      headers: { 'Content-Range': 'bytes 3-5/6' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(loadArtifact('https://example.test/', meta)).rejects.toThrow('connection lost');
  expect(Array.from(files.get(partialName(meta.sha256))!)).toEqual([9, 8, 7]);

  const bytes = await loadArtifact('https://example.test/', meta);
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(files.has(partialName(meta.sha256))).toBe(false);
});

it('retries once from zero when a resumed artifact fails verification', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  const { files, directory } = mockOpfs({ [partialName(meta.sha256)]: new Uint8Array([0, 0, 0]) });
  useOpfs(directory);
  let calls = 0;
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
    if (calls++ === 0) {
      return response([payload.subarray(3)], {
        status: 206,
        headers: { 'Content-Range': 'bytes 3-5/6' },
      });
    }
    return response([payload]);
  });
  vi.stubGlobal('fetch', fetchMock);

  const bytes = await loadArtifact('https://example.test/', meta);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(Array.from(files.get(meta.sha256)!)).toEqual([9, 8, 7, 6, 5, 4]);
});

it('accepts a full-length partial without a network request', async () => {
  const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = await artifact(payload);
  const { files, directory } = mockOpfs({ [partialName(meta.sha256)]: payload });
  useOpfs(directory);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const bytes = await loadArtifact('https://example.test/', meta);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(Array.from(files.get(meta.sha256)!)).toEqual([9, 8, 7, 6, 5, 4]);
  expect(files.has(partialName(meta.sha256))).toBe(false);
});

it('drops a corrupt OPFS hit and refetches instead of failing forever', async () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const meta = await artifact(payload);
  const { files, directory } = mockOpfs({ [meta.sha256]: new Uint8Array([9, 9]) });
  useOpfs(directory);
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => response([payload]));
  vi.stubGlobal('fetch', fetchMock);

  const bytes = await loadArtifact('https://example.test/', meta);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(Array.from(files.get(meta.sha256)!)).toEqual([1, 2, 3, 4, 5, 6]);
});

it('stages local files into a blob manifest without network fetch', async () => {
  const onnx = new Uint8Array([1, 2, 3, 4]);
  const warmup = new Uint8Array([5, 6]);
  const fp32 = await artifact(onnx, 'model.onnx');
  const warm = await artifact(warmup, 'warmup.json');
  const manifest = manifestFor(fp32, warm);
  validateManifest(manifest);
  useNoOpfs();
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

it('revokes partial object URLs when a later local file is missing', async () => {
  const onnx = new Uint8Array([1, 2, 3, 4]);
  const warmup = new Uint8Array([5, 6]);
  const fp16 = new Uint8Array([7, 8]);
  const fp32Meta = await artifact(onnx, 'model.onnx');
  const warmMeta = await artifact(warmup, 'warmup.json');
  const fp16Meta = await artifact(fp16, 'model.fp16.onnx');
  const manifest = {
    ...manifestFor(fp32Meta, warmMeta),
    variants: { fp32: fp32Meta, fp16: fp16Meta },
  };
  validateManifest(manifest);
  useNoOpfs();
  const created: string[] = [];
  const revoked: string[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      const url = `blob:partial/${created.length}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => { revoked.push(url); },
  });
  await expect(bundleFromLocalFiles([
    new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' }),
    new File([onnx], 'model.onnx'),
    // warmup missing after fp32 was staged — must revoke fp32 blob
  ])).rejects.toThrow(/Missing local file/);
  expect(created.length).toBeGreaterThan(0);
  expect(revoked).toEqual(created);
});
