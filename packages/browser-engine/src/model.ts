import { cacheDelete, cacheHas, cachePut, cacheRead } from './cache';

export interface Artifact { url: string; bytes: number; sha256: string; integrity: string }
export interface Manifest {
  schemaVersion: 1; model: string; swa: true; modelVersion: number; inputVersion: 7;
  boardSize: 19; batch: number; maxBatch?: number; outputs: string[];
  variants: { fp32: Artifact; fp16?: Artifact }; warmup: Artifact;
  postprocess: Record<string, number>; license: string; source: string;
  checkpointSha256: string; upstreamRevision: string;
}

export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (!m || m.schemaVersion !== 1 || m.swa !== true || m.inputVersion !== 7 || m.boardSize !== 19 || ![0, 1].includes(m.batch) ||
      m.modelVersion !== 14 || m.model !== 'kata1-b18c384nbt-s9996604416-d4316597426' ||
      m.checkpointSha256 !== 'ed3f2681be01604fd51b467925de77cea4f19cf125383493449d8c002fb91a24' ||
      !/^[0-9a-f]{40}$/.test(m.upstreamRevision ?? '')) {
    throw new Error('Expected a validated b18 SWA V7 model bundle with fixed batch 1 or bounded dynamic batches.');
  }
  if (m.batch === 0 && (!Number.isInteger(m.maxBatch) || m.maxBatch! < 1 || m.maxBatch! > 4)) throw new Error('Dynamic model maxBatch must be 1..4.');
  for (const name of ['policy', 'value', 'miscvalue', 'moremiscvalue', 'ownership', 'scoring', 'scorebelief_logprobs', 'seki', 'futurepos']) {
    if (!Array.isArray(m.outputs) || !m.outputs.includes(name)) throw new Error(`Model is missing ${name}.`);
  }
  for (const key of ['scoremean_multiplier', 'scorestdev_multiplier', 'lead_multiplier']) {
    if (!(m.postprocess?.[key] > 0) || !Number.isFinite(m.postprocess[key])) throw new Error(`Invalid model postprocess ${key}.`);
  }
  if (!m.license || !m.source) throw new Error('Model provenance and license are required.');
  for (const a of [m.variants?.fp32, m.variants?.fp16, m.warmup].filter(Boolean) as Artifact[]) {
    if (!a.url || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || !/^[0-9a-f]{64}$/.test(a.sha256)) throw new Error('Invalid model artifact metadata.');
  }
  if (!m.variants?.fp32 || !m.warmup) throw new Error('The fp32 fallback and warmup reference are required.');
  return m;
}

export async function verify(data: Uint8Array, a: Artifact): Promise<void> {
  if (data.byteLength !== a.bytes) throw new Error(`Wrong size for ${a.url}.`);
  const hash = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  const hex = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
  if (hex !== a.sha256) throw new Error(`SHA-256 mismatch for ${a.url}.`);
}

export type LoadArtifactOptions = {
  signal?: AbortSignal;
  progress?: (loaded: number, total: number) => void;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Model download was cancelled.', 'AbortError');
}

/**
 * Content-addressed OPFS cache + network fetch (jet/wllama-style).
 * Cancel via AbortSignal (UI Cancel / Stop terminates the worker). Partial
 * OPFS writes are never accepted as models.
 * TODO(#14): HTTP Range / resumable downloads — cancel is supported; resume is not.
 */
export async function loadArtifact(
  base: string,
  a: Artifact,
  progressOrOptions: ((n: number, total: number) => void) | LoadArtifactOptions = {},
): Promise<Uint8Array> {
  const options: LoadArtifactOptions = typeof progressOrOptions === 'function'
    ? { progress: progressOrOptions }
    : progressOrOptions;
  const progress = options.progress ?? (() => {});
  const signal = options.signal;
  throwIfAborted(signal);

  const cached = await cacheRead(a.sha256);
  if (cached) {
    try {
      await verify(cached, a);
      progress(a.bytes, a.bytes);
      return cached;
    } catch {
      // Truncated / interrupted OPFS writes must not block forever — drop and refetch.
      await cacheDelete(a.sha256);
    }
  }

  throwIfAborted(signal);
  const response = await fetch(new URL(a.url, base), {
    mode: 'cors',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}): ${a.url}`);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(a.bytes);
  let offset = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) throw new Error('Model download exceeds manifest size.');
      bytes.set(value, offset); offset += value.byteLength; progress(offset, a.bytes);
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  if (offset !== a.bytes) throw new Error(`Incomplete download for ${a.url}: got ${offset}, expected ${a.bytes}.`);
  await verify(bytes, a);
  try { await cachePut(a.sha256, bytes); } catch { /* quota / private mode */ }
  return bytes;
}

/** Total bytes a validated session may need to download (fp32 or fp16 + warmup). */
export function manifestDownloadBytes(manifest: Manifest, preferFp16: boolean): number {
  const weights = preferFp16 && manifest.variants.fp16 ? manifest.variants.fp16 : manifest.variants.fp32;
  return weights.bytes + manifest.warmup.bytes;
}

export async function artifactsCached(manifest: Manifest, preferFp16: boolean): Promise<boolean> {
  const weights = preferFp16 && manifest.variants.fp16 ? manifest.variants.fp16 : manifest.variants.fp32;
  return (await cacheHas(weights.sha256)) && (await cacheHas(manifest.warmup.sha256));
}

export type LocalBundle = { manifestUrl: string; revoke: () => void; manifest: Manifest };

/**
 * Stage user-picked local files (like wllama loadModel(File[])).
 * Expects manifest.json plus the referenced onnx/warmup filenames.
 */
export async function bundleFromLocalFiles(files: Iterable<File>): Promise<LocalBundle> {
  const byName = new Map<string, File>();
  for (const file of files) byName.set(file.name, file);
  const manifestFile = byName.get('manifest.json');
  if (!manifestFile) throw new Error('Select files including manifest.json (plus the .onnx and warmup.json it names).');
  const manifest = validateManifest(JSON.parse(await manifestFile.text()));
  const objectUrls: string[] = [];
  const revokeAll = () => { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.length = 0; };
  try {
    const rewrite = async (artifact: Artifact): Promise<Artifact> => {
      const name = artifact.url.split('/').pop()!;
      const file = byName.get(name);
      if (!file) throw new Error(`Missing local file for ${name} (listed in the manifest as ${artifact.url}).`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await verify(bytes, artifact);
      try { await cachePut(artifact.sha256, bytes); } catch { /* optional */ }
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
      objectUrls.push(url);
      return { ...artifact, url };
    };
    const rewritten: Manifest = {
      ...manifest,
      variants: {
        fp32: await rewrite(manifest.variants.fp32),
        ...(manifest.variants.fp16 ? { fp16: await rewrite(manifest.variants.fp16) } : {}),
      },
      warmup: await rewrite(manifest.warmup),
    };
    const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(rewritten)], { type: 'application/json' }));
    objectUrls.push(manifestUrl);
    const urls = [...objectUrls];
    return {
      manifestUrl,
      manifest: rewritten,
      revoke: () => { for (const url of urls) URL.revokeObjectURL(url); },
    };
  } catch (error) {
    revokeAll();
    throw error;
  }
}
