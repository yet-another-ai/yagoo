/** Minimal in-memory OPFS used by cache and download tests. */

type WriteChunk = Uint8Array | { type: 'write'; position?: number; data?: Uint8Array };

export function mockOpfs(initial: Record<string, Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>(
    Object.entries(initial).map(([name, data]) => [name, data.slice()]),
  );
  const directory = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new DOMException('missing', 'NotFoundError');
      if (!files.has(name)) files.set(name, new Uint8Array());
      return {
        kind: 'file' as const,
        async getFile() {
          const data = files.get(name) ?? new Uint8Array();
          return {
            size: data.byteLength,
            async arrayBuffer() { return data.slice().buffer as ArrayBuffer; },
            stream() {
              let sent = false;
              return new ReadableStream<Uint8Array>({
                pull(controller) {
                  if (sent) { controller.close(); return; }
                  sent = true;
                  controller.enqueue(data.slice());
                },
              });
            },
          };
        },
        async createWritable(options?: { keepExistingData?: boolean }) {
          let pending = options?.keepExistingData ? (files.get(name) ?? new Uint8Array()).slice() : new Uint8Array();
          return {
            async write(chunk: WriteChunk) {
              if (chunk instanceof Uint8Array) {
                const next = new Uint8Array(pending.byteLength + chunk.byteLength);
                next.set(pending);
                next.set(chunk, pending.byteLength);
                pending = next;
                return;
              }
              const position = chunk.position ?? 0;
              const data = chunk.data ?? new Uint8Array();
              const end = position + data.byteLength;
              const next = new Uint8Array(Math.max(pending.byteLength, end));
              next.set(pending);
              next.set(data, position);
              pending = next;
            },
            async close() { files.set(name, pending); },
            async abort() { /* discard pending */ },
          };
        },
      };
    },
    async removeEntry(name: string) { files.delete(name); },
    async *entries() {
      for (const name of files.keys()) {
        yield [name, await this.getFileHandle(name)] as unknown as [string, FileSystemHandle];
      }
    },
  };
  return { files, directory };
}
