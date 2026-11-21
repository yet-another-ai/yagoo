import {
  cacheDelete,
  cacheHas,
  cachePartialDelete,
  cachePartialRead,
  cachePartialWriter,
  cachePut,
  cacheRead,
} from './cache';
import { coded } from './errors';

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
    throw coded('engine.manifestInvalid', 'Expected a validated b18 SWA V7 model bundle with fixed batch 1 or bounded dynamic batches.');
  }
  if (m.batch === 0 && (!Number.isInteger(m.maxBatch) || m.maxBatch! < 1 || m.maxBatch! > 4)) throw coded('engine.maxBatch', 'Dynamic model maxBatch must be 1..4.');
  for (const name of ['policy', 'value', 'miscvalue', 'moremiscvalue', 'ownership', 'scoring', 'scorebelief_logprobs', 'seki', 'futurepos']) {
    if (!Array.isArray(m.outputs) || !m.outputs.includes(name)) throw coded('engine.outputMissing', `Model is missing ${name}.`, { name });
  }
  for (const key of ['scoremean_multiplier', 'scorestdev_multiplier', 'lead_multiplier']) {
    if (!(m.postprocess?.[key] > 0) || !Number.isFinite(m.postprocess[key])) throw coded('engine.postprocessInvalid', `Invalid model postprocess ${key}.`, { key });
  }
  if (!m.license || !m.source) throw coded('engine.provenance', 'Model provenance and license are required.');
  for (const a of [m.variants?.fp32, m.variants?.fp16, m.warmup].filter(Boolean) as Artifact[]) {
    if (!a.url || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || !/^[0-9a-f]{64}$/.test(a.sha256)) throw coded('engine.artifactMetadata', 'Invalid model artifact metadata.');
  }
  if (!m.variants?.fp32 || !m.warmup) throw coded('engine.fp32Required', 'The fp32 fallback and warmup reference are required.');
  return m;
}

export async function verify(data: Uint8Array, a: Artifact): Promise<void> {
  if (data.byteLength !== a.bytes) throw coded('engine.wrongSize', `Wrong size for ${a.url}.`, { url: a.url });
  const hash = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  const hex = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
  if (hex !== a.sha256) throw coded('engine.shaMismatch', `SHA-256 mismatch for ${a.url}.`, { url: a.url });
}

export type LoadArtifactOptions = {
  signal?: AbortSignal;
  progress?: (loaded: number, total: number) => void;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Model download was cancelled.', 'AbortError');
}

/** How many received bytes may be lost if the worker is killed mid-download. */
const PARTIAL_CHECKPOINT_BYTES = 16 * 1024 * 1024;

type ContentRange = { start: number; end: number; total: number };

/** Parses `bytes <start>-<end>/<total>`; undefined for absent or malformed values. */
function parseContentRange(value: string | null): ContentRange | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const [start, end, total] = match.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || end < start) return undefined;
  return { start, end, total };
}

/**
 * Content-addressed OPFS cache + resumable network fetch (jet/wllama-style).
 *
 * A `partial-<sha256>` OPFS entry holds the durable prefix of an interrupted
 * download. It is written while the body arrives and checkpointed so a worker
 * termination loses at most one interval. A retry asks for the missing range and
 * only appends when the host answers `206` with a matching `Content-Range`; a
 * `200`, `416`, a missing or foreign range, or a transformed body restarts from
 * zero. The complete artifact is SHA-256 verified before it replaces the
 * verified cache entry; the partial is deleted only then.
 *
 * Cross-origin hosts must allow `Range` and expose `Content-Range` (plus
 * `Content-Length` for diagnostics). Without byte-range support the loader still
 * works but restarts from the beginning. Cancel via AbortSignal (UI Cancel / Stop
 * terminates the worker) keeps the last checkpoint for the next load.
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
  const bytes = new Uint8Array(a.bytes);
  let offset = await cachePartialRead(a.sha256, bytes);
  if (offset === a.bytes) {
    try {
      await verify(bytes, a);
      await cachePut(a.sha256, bytes);
      await cachePartialDelete(a.sha256);
      progress(a.bytes, a.bytes);
      return bytes;
    } catch {
      // A killed process can leave a full-length but unverified prefix.
      await cachePartialDelete(a.sha256);
      offset = 0;
    }
  }
  const fromPartial = offset > 0;
  if (fromPartial) progress(offset, a.bytes);

  let writer = await cachePartialWriter(a.sha256, a.bytes, offset);
  if (writer && writer.offset !== offset) writer = undefined;
  let durable = writer !== undefined;

  const closeWriter = async (): Promise<boolean> => {
    const current = writer;
    writer = undefined;
    if (!current) return true;
    try {
      await current.close();
      return true;
    } catch {
      durable = false; // Quota or another tab; keep downloading in memory.
      return false;
    }
  };
  const reopenWriter = async (): Promise<void> => {
    if (!durable || writer) return;
    const next = await cachePartialWriter(a.sha256, a.bytes, offset);
    writer = next && next.offset === offset ? next : undefined;
    if (!writer) durable = false;
  };
  const restart = async (): Promise<void> => {
    await closeWriter();
    await cachePartialDelete(a.sha256);
    offset = 0;
    await reopenWriter();
  };
  const discard = async (response: Response): Promise<void> => {
    try { await response.body?.cancel(); } catch { /* ignore */ }
  };

  const url = new URL(a.url, base);
  let restarted = false;
  try {
    for (;;) {
      throwIfAborted(signal);
      const resuming = offset > 0;
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'same-origin',
        signal,
        ...(resuming ? { headers: { Range: `bytes=${offset}-` } } : {}),
      });
      let end = a.bytes;

      if (resuming && response.status === 206) {
        const range = parseContentRange(response.headers.get('Content-Range'));
        const encoding = response.headers.get('Content-Encoding');
        if (!range || range.start !== offset || range.total !== a.bytes || range.end >= a.bytes ||
            (encoding !== null && encoding !== 'identity')) {
          await discard(response);
          if (restarted) throw coded('engine.downloadRange', `Model host did not honor the requested range: ${a.url}`, { url: a.url, status: response.status });
          restarted = true;
          await restart();
          continue;
        }
        end = range.end + 1;
      } else if (resuming && response.status === 200) {
        // The host ignored Range; this body starts at zero.
        restarted = true;
        await restart();
      } else if (resuming && response.status === 416) {
        await discard(response);
        if (restarted) throw coded('engine.downloadFailed', `Model download failed (${response.status}): ${a.url}`, { status: response.status, url: a.url });
        restarted = true;
        await restart();
        continue;
      } else if (response.status !== 200) {
        throw coded('engine.downloadFailed', `Model download failed (${response.status}): ${a.url}`, { status: response.status, url: a.url });
      }
      const body = response.body;
      if (!body) throw coded('engine.downloadFailed', `Model download failed (${response.status}): ${a.url}`, { status: response.status, url: a.url });

      const reader = body.getReader();
      let checkpointed = offset;
      try {
        for (;;) {
          throwIfAborted(signal);
          const { value, done } = await reader.read();
          if (done) break;
          if (offset + value.byteLength > end) throw coded('engine.downloadTooLarge', 'Model download exceeds manifest size.');
          bytes.set(value, offset);
          offset += value.byteLength;
          progress(offset, a.bytes);
          if (writer) {
            try {
              await writer.write(value);
            } catch {
              await closeWriter();
            }
          }
          if (offset - checkpointed >= PARTIAL_CHECKPOINT_BYTES) {
            checkpointed = offset;
            if (await closeWriter()) await reopenWriter();
          }
        }
      } catch (error) {
        await closeWriter();
        if (error instanceof Error && 'code' in error && error.code === 'engine.downloadTooLarge') {
          await cachePartialDelete(a.sha256);
          durable = false;
        }
        throw error;
      } finally {
        try { await reader.cancel(); } catch { /* already closed */ }
      }

      if (offset < end) {
        throw coded('engine.downloadIncomplete', `Incomplete download for ${a.url}: got ${offset}, expected ${end}.`, { url: a.url, got: offset, expected: end });
      }
      if (offset < a.bytes) {
        // A host-capped range finished; request the next missing range.
        await reopenWriter();
        continue;
      }

      try {
        await verify(bytes, a);
      } catch (error) {
        await closeWriter();
        await cachePartialDelete(a.sha256);
        offset = 0;
        if (fromPartial && !restarted) {
          // The durable prefix was stale or corrupt; retry once from zero.
          restarted = true;
          await reopenWriter();
          continue;
        }
        throw error;
      }
      await closeWriter();
      try { await cachePut(a.sha256, bytes); } catch { /* quota / private mode */ }
      await cachePartialDelete(a.sha256);
      return bytes;
    }
  } finally {
    await closeWriter();
  }
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
  if (!manifestFile) throw coded('engine.manifestFiles', 'Select files including manifest.json (plus the .onnx and warmup.json it names).');
  const manifest = validateManifest(JSON.parse(await manifestFile.text()));
  const objectUrls: string[] = [];
  const revokeAll = () => { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.length = 0; };
  try {
    const rewrite = async (artifact: Artifact): Promise<Artifact> => {
      const name = artifact.url.split('/').pop()!;
      const file = byName.get(name);
      if (!file) throw coded('engine.localFileMissing', `Missing local file for ${name} (listed in the manifest as ${artifact.url}).`, { name, url: artifact.url });
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
