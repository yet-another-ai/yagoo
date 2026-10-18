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

async function verify(data: Uint8Array, a: Artifact): Promise<void> {
  if (data.byteLength !== a.bytes) throw new Error(`Wrong size for ${a.url}.`);
  const hash = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  const hex = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
  if (hex !== a.sha256) throw new Error(`SHA-256 mismatch for ${a.url}.`);
}

// Content-addressed cache. A partially written file is never accepted as a model.
export async function loadArtifact(base: string, a: Artifact, progress: (n: number, total: number) => void): Promise<Uint8Array> {
  let directory: FileSystemDirectoryHandle | undefined;
  try { directory = await navigator.storage.getDirectory(); } catch { /* storage optional */ }
  try {
    if (directory) {
      const file = await (await directory.getFileHandle(a.sha256)).getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await verify(bytes, a); progress(a.bytes, a.bytes); return bytes;
    }
  } catch { /* cache miss, eviction or corrupt partial file: refetch */ }
  const response = await fetch(new URL(a.url, base), { mode: 'cors', credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}): ${a.url}`);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(a.bytes);
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) throw new Error('Model download exceeds manifest size.');
      bytes.set(value, offset); offset += value.byteLength; progress(offset, a.bytes);
    }
  } finally { await reader.cancel(); }
  await verify(bytes, a);
  try {
    if (directory) {
      const writer = await (await directory.getFileHandle(a.sha256, { create: true })).createWritable();
      await writer.write(bytes); await writer.close();
    }
  } catch { /* quota or private mode: verified in-memory model still works */ }
  return bytes;
}
