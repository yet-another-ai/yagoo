import { afterEach, expect, it, vi } from 'vitest';

const { mockEngine } = vi.hoisted(() => ({ mockEngine: {
  onMessage: (_message: Record<string, unknown>) => {},
  initialize: vi.fn(), analyze: vi.fn(), dispose: vi.fn(), releaseRootActivations: vi.fn(),
} }));
vi.mock('../src/client', () => ({ BrowserEngine: class { constructor() { return mockEngine; } } }));
vi.mock('../src/cache', () => ({
  listCachedModels: vi.fn(async () => []),
  clearModelCache: vi.fn(async () => 0),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.resetAllMocks(); });

const IDS = [
  'status', 'events', 'scan', 'deep', 'load', 'isolation', 'stop', 'download', 'visits', 'sgf', 'all',
  'symmetries', 'batch', 'manifest', 'wasm', 'threads', 'activation-status', 'activations',
  'release-activations', 'model-select', 'model-size', 'model-notes', 'model-status', 'model-status-wrap',
  'download-bar', 'cache-status', 'cancel-download', 'clear-cache', 'local-files',
];

async function setup(persist = async () => false) {
  const nodes = new Map<string, {
    value: string; checked: boolean; disabled: boolean; textContent: string; hidden: boolean;
    dataset: Record<string, string>; style: { setProperty: (name: string, value: string) => void };
    classList: { toggle: (name: string, force?: boolean) => void };
    listeners: Record<string, (event?: Event) => unknown>;
    addEventListener: (type: string, callback: (event?: Event) => unknown) => void;
    replaceChildren: () => void; append: (node: { value: string; textContent: string; disabled: boolean; selected: boolean }) => void;
    options: { value: string; textContent: string; disabled: boolean; selected: boolean }[];
    files: FileList | null;
  }>();
  for (const id of IDS) {
    const options: { value: string; textContent: string; disabled: boolean; selected: boolean }[] = [];
    nodes.set(id, {
      value: ({ visits: '8', sgf: '(;SZ[9])', batch: '4', threads: '4', manifest: 'models/manifest.json' } as Record<string, string>)[id] ?? '',
      checked: false, disabled: false, textContent: '', hidden: false, dataset: {}, files: null,
      style: { setProperty() {} },
      classList: { toggle() {} },
      listeners: {},
      options,
      addEventListener(type, callback) { this.listeners[type] = callback; },
      replaceChildren() { options.length = 0; },
      append(node) { options.push(node); },
    });
  }
  const node = (id: string) => nodes.get(id)!;
  vi.stubGlobal('document', {
    querySelector: (selector: string) => {
      if (selector.startsWith('#')) return node(selector.slice(1));
      return null;
    },
    createElement: (tag: string) => {
      if (tag !== 'option') throw new Error(tag);
      return { value: '', textContent: '', disabled: false, selected: false };
    },
  });
  vi.stubGlobal('navigator', { storage: { persist } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  mockEngine.initialize.mockResolvedValue({ backend: 'wasm', precision: 'fp32', ortThreads: 1, maxBatch: 1, messages: [] });
  await import('../src/demo');
  node('manifest').value = 'models/manifest.json';
  return node;
}

it('does not initialize when no manifest URL is configured', async () => {
  const node = await setup();
  node('manifest').value = '';
  await node('load').listeners.click!();
  expect(mockEngine.initialize).not.toHaveBeenCalled();
  expect(node('status').textContent).toMatch(/local model/i);
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
});

it('does not fetch model weights on page load; only fills the catalog', async () => {
  const node = await setup();
  expect(node('model-select').options.length).toBeGreaterThanOrEqual(2);
  expect(node('model-select').options.some(option => option.value === 'b18c384nbt-swa')).toBe(true);
  expect(mockEngine.initialize).not.toHaveBeenCalled();
  // fetch may probe nothing on load (we only refresh cache / leave approx size)
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('.onnx'))).toBe(true);
});

it('preserves the active NDJSON stream on repeated clicks and restores controls after failure or completion', async () => {
  const node = await setup();
  await node('load').listeners.click!();
  node('scan').listeners.click!();
  mockEngine.onMessage({ type: 'event', event: { type: 'gameStarted' } });
  expect(node('scan').disabled).toBe(true);
  expect(node('deep').disabled).toBe(true);
  node('deep').listeners.click!();
  expect(mockEngine.analyze).toHaveBeenCalledTimes(1);
  expect(node('events').textContent).toContain('gameStarted');
  mockEngine.onMessage({ type: 'event', event: { type: 'gameCompleted' } });
  mockEngine.onMessage({ type: 'done' });
  expect(node('events').textContent.split('\n').map(line => JSON.parse(line).type)).toEqual(['gameStarted', 'gameCompleted']);
  expect(node('scan').disabled).toBe(false);

  mockEngine.analyze.mockImplementationOnce(() => { throw new Error('Rejected before starting'); });
  node('scan').listeners.click!();
  expect(node('events').textContent).toContain('gameStarted');
  node('scan').listeners.click!();
  mockEngine.onMessage({ type: 'error', message: 'Inference failed' });
  expect(node('scan').disabled).toBe(false);
  node('stop').listeners.click!();
  expect(node('scan').disabled).toBe(true);
});

it('does not start a model load after Stop while the storage permission promise is pending', async () => {
  let resolvePersist!: (value: boolean) => void;
  const node = await setup(() => new Promise<boolean>(resolve => { resolvePersist = resolve; }));
  const loading = node('load').listeners.click!();
  node('stop').listeners.click!();
  resolvePersist(false);
  await loading;
  expect(mockEngine.initialize).not.toHaveBeenCalled();
  expect(node('status').textContent).toMatch(/^Stopped/);
  expect(node('scan').disabled).toBe(true);
});

it('clears stale lease metadata on reload and honors release while storage is pending', async () => {
  let resolvePersist!: (value: boolean) => void;
  const node = await setup(() => new Promise<boolean>(resolve => { resolvePersist = resolve; }));
  node('activation-status').dataset.lease = '{"handle":"old-root"}';
  node('activations').checked = true;
  const loading = node('load').listeners.click!();
  expect(node('activation-status').dataset.lease).toBe('');
  node('release-activations').listeners.click!();
  resolvePersist(false);
  await loading;
  expect(mockEngine.initialize).toHaveBeenCalledWith('models/manifest.json', expect.objectContaining({ retainRootActivations: false }));
});

it('cancel download disposes the engine during load', async () => {
  const node = await setup();
  let resolveInit!: (value: unknown) => void;
  mockEngine.initialize.mockImplementation(() => new Promise(resolve => { resolveInit = resolve; }));
  const loading = node('load').listeners.click!();
  // loadModel awaits storage.persist before initialize — flush that microtask.
  await Promise.resolve();
  await Promise.resolve();
  expect(typeof resolveInit).toBe('function');
  node('cancel-download').listeners.click!();
  resolveInit({ backend: 'wasm', precision: 'fp32', ortThreads: 1, maxBatch: 1, messages: [] });
  await loading;
  expect(mockEngine.dispose).toHaveBeenCalled();
  expect(node('model-status').textContent).toMatch(/cancelled|stopped/i);
});

it('a stale cancelled load does not disable Cancel for a newer load', async () => {
  const node = await setup();
  let resolveFirst!: (value: unknown) => void;
  let resolveSecond!: (value: unknown) => void;
  mockEngine.initialize
    .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
  const first = node('load').listeners.click!();
  await Promise.resolve();
  await Promise.resolve();
  node('cancel-download').listeners.click!();
  // Cancel cleared loadingModel; start a second load while the first init is pending.
  const second = node('load').listeners.click!();
  await Promise.resolve();
  await Promise.resolve();
  expect(typeof resolveSecond).toBe('function');
  expect(node('cancel-download').disabled).toBe(false);
  // Stale first resolve must not clobber the active generation's Cancel button.
  resolveFirst({ backend: 'wasm', precision: 'fp32', ortThreads: 1, maxBatch: 1, messages: [] });
  await first;
  expect(node('cancel-download').disabled).toBe(false);
  resolveSecond({ backend: 'wasm', precision: 'fp32', ortThreads: 1, maxBatch: 1, messages: [] });
  await second;
  expect(node('cancel-download').disabled).toBe(true);
  expect(node('model-status').textContent).toMatch(/ready/i);
});
