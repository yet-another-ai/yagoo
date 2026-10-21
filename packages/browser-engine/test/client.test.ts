import { afterEach, expect, it, vi } from 'vitest';
import { BrowserEngine } from '../src/client';

class TestWorker {
  static instances: TestWorker[] = [];
  onerror?: (event: { message?: string; filename?: string; lineno?: number; colno?: number; error?: unknown }) => void;
  onmessage?: (event: { data: Record<string, unknown> }) => void;
  terminated = false;
  sent: Record<string, unknown>[] = [];
  constructor() { TestWorker.instances.push(this); }
  postMessage(message: Record<string, unknown>) { this.sent.push(message); }
  terminate() { this.terminated = true; }
}
function environment() {
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  vi.stubGlobal('location', { href: 'https://example.test/app/', origin: 'https://example.test' });
}
afterEach(() => vi.unstubAllGlobals());

it('cancels initialization without starting fallback workers or leaving a pending promise', async () => {
  environment();
  const engine = new BrowserEngine();
  const pending = engine.initialize('models/manifest.json');
  expect(() => engine.analyze('(;SZ[9])')).toThrow(/Initialize/);
  engine.dispose();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(TestWorker.instances).toHaveLength(1);
  expect(TestWorker.instances[0].terminated).toBe(true);
});

it('retries a failed GPU precision in a fresh worker before changing backends', async () => {
  environment();
  const engine = new BrowserEngine();
  const pending = engine.initialize('models/manifest.json');
  const first = TestWorker.instances[0];
  first.onmessage!({ data: { type: 'error', message: 'Nonfinite neural output' } });
  await Promise.resolve();
  const second = TestWorker.instances[1];
  expect(first.terminated).toBe(true);
  expect(second.sent[0]).toMatchObject({ backend: 'webgpu', precision: 'fp32', ortThreads: 1 });
  second.onmessage!({ data: { type: 'ready', status: { backend: 'webgpu', precision: 'fp32', ortThreads: 1, searchThreads: 1, validated: true, messages: [] } } });
  const result = await pending;
  expect(result.messages[0]).toMatch(/Nonfinite neural output/);
  engine.dispose();
});

it('activation release and status messages do not unlock an active analysis', async () => {
  environment();
  const engine = new BrowserEngine();
  const pending = engine.initialize('models/manifest.json', { retainRootActivations: true });
  const worker = TestWorker.instances[0];
  expect(worker.sent[0].retainRootActivations).toBe(true);
  worker.onmessage!({ data: { type: 'ready', status: { backend: 'webgpu', precision: 'fp32', ortThreads: 1, searchThreads: 1, validated: true, messages: [] } } });
  await pending;
  engine.analyze('(;SZ[9])');
  engine.releaseRootActivations();
  expect(worker.sent.at(-1)).toEqual({ type: 'releaseRootActivations' });
  worker.onmessage!({ data: { type: 'rootActivations', available: false, reason: 'Released' } });
  expect(() => engine.analyze('(;SZ[9])')).toThrow(/already running/);
  worker.onmessage!({ data: { type: 'done' } });
  expect(() => engine.analyze('(;SZ[9])')).not.toThrow();
  engine.dispose();
});

it('stops after a missing hosted manifest instead of chaining backend errors', async () => {
  environment();
  const engine = new BrowserEngine();
  const pending = engine.initialize('models/manifest.json');
  TestWorker.instances[0].onmessage!({ data: { type: 'error', message: 'Manifest download failed (404)' } });
  await expect(pending).rejects.toThrow(/No model bundle is hosted here/);
  expect(TestWorker.instances).toHaveLength(1);
  engine.dispose();
});

it('does not treat the single-thread note as an initialization error', async () => {
  environment();
  vi.stubGlobal('crossOriginIsolated', false);
  vi.stubGlobal('SharedArrayBuffer', undefined);
  const engine = new BrowserEngine();
  const pending = engine.initialize('models/manifest.json', { forceWasm: true });
  const worker = TestWorker.instances[0];
  expect(worker.sent[0]).toMatchObject({ backend: 'wasm', precision: 'fp32', ortThreads: 1 });
  worker.onmessage!({ data: { type: 'error', message: 'warmup failed' } });
  await expect(pending).rejects.toThrow(/warmup failed/);
  await expect(pending).rejects.not.toThrow(/one thread/);
  engine.dispose();
});

it('surfaces the worker error text instead of a generic load failure', async () => {
  environment();
  const engine = new BrowserEngine();
  const pending = engine.initialize('models/manifest.json', { forceWasm: true, wasmThreads: 1 });
  TestWorker.instances[0].onerror?.({
    message: 'Failed to fetch ort-wasm-simd-threaded.asyncify.mjs',
    filename: 'https://example.test/yagoo/assets/engine.worker.js',
    lineno: 1,
    colno: 1,
  });
  await expect(pending).rejects.toThrow(/ort-wasm-simd-threaded\.asyncify\.mjs/);
  await expect(pending).rejects.toThrow(/engine\.worker\.js:1:1/);
  engine.dispose();
});

it('explains an empty worker error when isolation blocked the script', async () => {
  environment();
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => name === 'cross-origin-opener-policy' ? 'same-origin' : null },
  })));
  const engine = new BrowserEngine();
  const pending = engine.initialize('models/manifest.json', { forceWasm: true, wasmThreads: 1 });
  TestWorker.instances[0].onerror?.({ message: '' });
  await expect(pending).rejects.toThrow(/Cross-Origin-Embedder-Policy/);
  await expect(pending).rejects.not.toThrow(/Engine worker failed to load\.$/);
  engine.dispose();
});

it('keeps activation release in effect across initialization fallback workers', async () => {
  environment();
  const engine = new BrowserEngine();
  const pending = engine.initialize('models/manifest.json', { retainRootActivations: true });
  const first = TestWorker.instances[0];
  engine.releaseRootActivations();
  first.onmessage!({ data: { type: 'error', message: 'GPU warmup failed' } });
  await Promise.resolve();
  const second = TestWorker.instances[1];
  expect(second.sent[0].retainRootActivations).toBe(false);
  second.onmessage!({ data: { type: 'ready', status: { backend: 'webgpu', precision: 'fp32', ortThreads: 1, searchThreads: 1, validated: true, messages: [] } } });
  await pending;
  engine.dispose();
});
