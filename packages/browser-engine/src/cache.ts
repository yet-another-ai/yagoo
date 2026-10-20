/** OPFS content-addressed model cache (same approach as jet/wllama CacheManager). */

export type CacheEntry = { sha256: string; bytes: number };

export async function openModelDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return undefined;
  }
}

export async function cacheHas(sha256: string): Promise<boolean> {
  const directory = await openModelDirectory();
  if (!directory) return false;
  try {
    const file = await (await directory.getFileHandle(sha256)).getFile();
    return file.size > 0;
  } catch {
    return false;
  }
}

export async function cacheDelete(sha256: string): Promise<void> {
  const directory = await openModelDirectory();
  if (!directory) return;
  try {
    await directory.removeEntry(sha256);
  } catch {
    /* missing or busy */
  }
}

export async function cachePut(sha256: string, bytes: Uint8Array): Promise<void> {
  const directory = await openModelDirectory();
  if (!directory) return;
  const writer = await (await directory.getFileHandle(sha256, { create: true })).createWritable();
  try {
    await writer.write(bytes as Uint8Array<ArrayBuffer>);
    await writer.close();
  } catch (error) {
    try { await writer.abort(); } catch { /* ignore */ }
    try { await directory.removeEntry(sha256); } catch { /* ignore partial */ }
    throw error;
  }
}

/** Returns undefined for missing, empty, or unreadable entries (treat as cache miss). */
export async function cacheRead(sha256: string): Promise<Uint8Array | undefined> {
  const directory = await openModelDirectory();
  if (!directory) return undefined;
  try {
    const file = await (await directory.getFileHandle(sha256)).getFile();
    if (file.size <= 0) return undefined;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytes.byteLength > 0 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

export async function listCachedModels(): Promise<CacheEntry[]> {
  const directory = await openModelDirectory();
  if (!directory) return [];
  const entries: CacheEntry[] = [];
  // entries() is the OPFS directory iterator (same surface jet/wllama uses).
  for await (const [name, handle] of (directory as FileSystemDirectoryHandle & {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }).entries()) {
    if (handle.kind !== 'file' || !/^[0-9a-f]{64}$/.test(name)) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    entries.push({ sha256: name, bytes: file.size });
  }
  return entries;
}

/** Clears content-addressed model blobs from OPFS. Does not touch ORT/Wasm assets. */
export async function clearModelCache(): Promise<number> {
  const directory = await openModelDirectory();
  if (!directory) return 0;
  let removed = 0;
  for await (const [name, handle] of (directory as FileSystemDirectoryHandle & {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }).entries()) {
    if (handle.kind !== 'file' || !/^[0-9a-f]{64}$/.test(name)) continue;
    await directory.removeEntry(name);
    removed++;
  }
  return removed;
}
