import { afterEach, expect, it, vi } from 'vitest';

const { mockEngine } = vi.hoisted(() => ({ mockEngine: {
  onMessage: (_message: Record<string, unknown>) => {},
  initialize: vi.fn(), analyze: vi.fn(), dispose: vi.fn(),
} }));
vi.mock('../src/client', () => ({ BrowserEngine: class { constructor() { return mockEngine; } } }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.resetAllMocks(); });

async function setup(persist = async () => false) {
  const nodes = new Map<string, {
    value: string; checked: boolean; disabled: boolean; textContent: string;
    listeners: Record<string, () => unknown>; addEventListener: (type: string, callback: () => unknown) => void;
  }>();
  for (const id of ['status', 'events', 'scan', 'deep', 'load', 'isolation', 'stop', 'download', 'visits', 'sgf', 'all', 'symmetries', 'batch', 'manifest', 'wasm', 'threads']) {
    nodes.set(id, { value: ({ visits: '8', sgf: '(;SZ[9])', batch: '4', threads: '4' } as Record<string, string>)[id] ?? '',
      checked: false, disabled: false, textContent: '', listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; } });
  }
  const node = (id: string) => nodes.get(id)!;
  vi.stubGlobal('document', { querySelector: (selector: string) => node(selector.slice(1)) });
  vi.stubGlobal('navigator', { storage: { persist } });
  mockEngine.initialize.mockResolvedValue({ backend: 'wasm', precision: 'fp32', ortThreads: 1, maxBatch: 1, messages: [] });
  await import('../src/demo');
  return node;
}

it('preserves the active NDJSON stream on repeated clicks and restores controls after failure or completion', async () => {
  const node = await setup();
  await node('load').listeners.click();
  node('scan').listeners.click();
  mockEngine.onMessage({ type: 'event', event: { type: 'gameStarted' } });
  expect(node('scan').disabled).toBe(true);
  expect(node('deep').disabled).toBe(true);
  node('deep').listeners.click(); // Also protect against a queued/programmatic click.
  expect(mockEngine.analyze).toHaveBeenCalledTimes(1);
  expect(node('events').textContent).toContain('gameStarted');
  mockEngine.onMessage({ type: 'event', event: { type: 'gameCompleted' } });
  mockEngine.onMessage({ type: 'done' });
  expect(node('events').textContent.split('\n').map(line => JSON.parse(line).type)).toEqual(['gameStarted', 'gameCompleted']);
  expect(node('scan').disabled).toBe(false);
  expect(node('deep').disabled).toBe(false);

  mockEngine.analyze.mockImplementationOnce(() => { throw new Error('Rejected before starting'); });
  node('scan').listeners.click();
  expect(node('events').textContent).toContain('gameStarted');
  expect(node('scan').disabled).toBe(false);
  node('scan').listeners.click();
  mockEngine.onMessage({ type: 'error', message: 'Inference failed' });
  expect(node('scan').disabled).toBe(false);
  expect(node('deep').disabled).toBe(false);
  node('stop').listeners.click();
  expect(node('scan').disabled).toBe(true);
  expect(node('deep').disabled).toBe(true);
});

it('does not start a model load after Stop while the storage permission promise is pending', async () => {
  let resolvePersist!: (value: boolean) => void;
  const node = await setup(() => new Promise<boolean>(resolve => { resolvePersist = resolve; }));
  const loading = node('load').listeners.click();
  node('stop').listeners.click();
  resolvePersist(false);
  await loading;
  expect(mockEngine.initialize).not.toHaveBeenCalled();
  expect(node('status').textContent).toMatch(/^Stopped/);
  expect(node('scan').disabled).toBe(true);
});
