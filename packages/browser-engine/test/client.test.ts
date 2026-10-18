import { afterEach, expect, it, vi } from 'vitest';
import { BrowserEngine } from '../src/client';

class TestWorker {
  static instances: TestWorker[] = [];
  onerror?: (event: { message: string }) => void;
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
