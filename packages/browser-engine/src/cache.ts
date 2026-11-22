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

/** Writes a verified artifact; false when OPFS is unavailable, full, or blocked. */
export async function cachePut(sha256: string, bytes: Uint8Array): Promise<boolean> {
  const directory = await openModelDirectory();
  if (!directory) return false;
  let writer: FileSystemWritableFileStream | undefined;
  try {
    writer = await (await directory.getFileHandle(sha256, { create: true })).createWritable();
    await writer.write(bytes as Uint8Array<ArrayBuffer>);
    await writer.close();
    return true;
  } catch {
    if (writer) {
      try { await writer.abort(); } catch { /* ignore */ }
    }
    try { await directory.removeEntry(sha256); } catch { /* ignore partial */ }
    return false;
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

/**
 * Resumable first bytes of an artifact, keyed by its final SHA-256 so a stale
 * or different manifest can never resume into a verified entry. Kept beside
 * (never at) the content-addressed cache name until the whole artifact verifies.
 */
export type PartialWriter = {
  /** Durable length when this writer was opened. */
  readonly offset: number;
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

function partialName(sha256: string): string {
  return `partial-${sha256}`;
}

/** Reads a resumable prefix into `target`; returns 0 for missing or invalid data. */
export async function cachePartialRead(sha256: string, target: Uint8Array): Promise<number> {
  const directory = await openModelDirectory();
  if (!directory) return 0;
  const name = partialName(sha256);
  let file: File;
  try {
    file = await (await directory.getFileHandle(name)).getFile();
  } catch {
    return 0;
  }
  if (file.size <= 0) return 0;
  if (file.size > target.byteLength) {
    try { await directory.removeEntry(name); } catch { /* ignore */ }
    return 0;
  }
  let offset = 0;
  try {
    const reader = file.stream().getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (offset + value.byteLength > target.byteLength) {
          try { await directory.removeEntry(name); } catch { /* ignore */ }
          return 0;
        }
        target.set(value, offset);
        offset += value.byteLength;
      }
    } finally {
      try { await reader.cancel(); } catch { /* already closed */ }
    }
  } catch {
    return 0;
  }
  // A concurrent writer changed the file while it was read; do not trust the prefix.
  if (offset !== file.size) return 0;
  return offset;
}

/** Opens the partial entry for appending when its durable length is exactly `offset`. */
export async function cachePartialWriter(
  sha256: string,
  total: number,
  offset: number,
): Promise<PartialWriter | undefined> {
  const directory = await openModelDirectory();
  if (!directory) return undefined;
  const name = partialName(sha256);
  try {
    const handle = await directory.getFileHandle(name, { create: true });
    if ((await handle.getFile()).size !== offset) return undefined;
    // Appending needs the existing prefix; a fresh entry can truncate.
    const writable = await handle.createWritable({ keepExistingData: offset > 0 });
    let position = offset;
    return {
      offset,
      async write(chunk: Uint8Array): Promise<void> {
        if (position + chunk.byteLength > total) throw new RangeError('Partial model bytes exceed the manifest size.');
        await writable.write({ type: 'write', position, data: chunk as Uint8Array<ArrayBuffer> });
        position += chunk.byteLength;
      },
      async close(): Promise<void> {
        await writable.close();
      },
    };
  } catch {
    return undefined;
  }
}

/** Removes a resumable prefix. Safe when absent or blocked by another tab. */
export async function cachePartialDelete(sha256: string): Promise<void> {
  const directory = await openModelDirectory();
  if (!directory) return;
  try {
    await directory.removeEntry(partialName(sha256));
  } catch {
    /* missing or busy */
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

/** Clears content-addressed model blobs and resumable partials from OPFS. Does not touch ORT/Wasm assets. */
export async function clearModelCache(): Promise<number> {
  const directory = await openModelDirectory();
  if (!directory) return 0;
  let removed = 0;
  for await (const [name, handle] of (directory as FileSystemDirectoryHandle & {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }).entries()) {
    if (handle.kind !== 'file' || !/^(?:partial-)?[0-9a-f]{64}$/.test(name)) continue;
    await directory.removeEntry(name);
    removed++;
  }
  return removed;
}
