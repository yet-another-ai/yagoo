import { beforeEach, expect, it, vi } from 'vitest';
import { ReviewerBrowserEngine } from '../src/reviewer-adapter';

const mock = vi.hoisted(() => ({
  initialize: vi.fn(async () => ({})),
  analyze: vi.fn(), analyzePosition: vi.fn(), dispose: vi.fn(),
  bundle: vi.fn(),
  instance: null as any,
}));
vi.mock('../src/model', () => ({ bundleFromLocalFiles: mock.bundle }));
vi.mock('../src/client', () => ({
  BrowserEngine: class {
    onMessage = (_message: unknown) => {};
    initialize = mock.initialize;
    analyze = mock.analyze;
    analyzePosition = mock.analyzePosition;
    dispose = mock.dispose;
    constructor() { mock.instance = this; }
  },
}));
beforeEach(() => { vi.clearAllMocks(); mock.initialize.mockResolvedValue({}); });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const ready = () => { const adapter = new ReviewerBrowserEngine(); adapter.stageRemote('model.json'); return adapter; };
const request = { sgf: '(;SZ[9];B[cc])', ply: 1, moves: ['pass'], visits: 200 };

it('stop settles an iterator waiting on engine messages and permits another run', async () => {
  const adapter = ready();
  const first = adapter.analyzePosition(request)[Symbol.asyncIterator]();
  const pending = first.next();
  await tick();
  expect(mock.analyzePosition).toHaveBeenCalledWith(request);
  adapter.stop();
  await expect(pending).resolves.toMatchObject({ done: true });
  const second = adapter.analyzePosition(request)[Symbol.asyncIterator]();
  const next = second.next();
  await tick();
  mock.instance.onMessage({ type: 'event', event: { type: 'positionCompleted', snapshot: { ply: 2 } } });
  expect((await next).value).toContain('positionCompleted');
  adapter.stop();
  await expect(second.next()).resolves.toMatchObject({ done: true });
});

it('ignores stale callbacks and reuses the initialized worker after completed runs', async () => {
  const adapter = ready();
  const first = adapter.analyzeSgf(request.sgf)[Symbol.asyncIterator]();
  const pending = first.next();
  await tick();
  const stale = mock.instance.onMessage;
  mock.instance.onMessage({ type: 'done' });
  await expect(pending).resolves.toMatchObject({ done: true });
  const second = adapter.analyzePosition(request)[Symbol.asyncIterator]();
  const next = second.next();
  await tick();
  expect(mock.initialize).toHaveBeenCalledTimes(1);
  stale({ type: 'error', message: 'stale error' });
  mock.instance.onMessage({ type: 'done' });
  await expect(next).resolves.toMatchObject({ done: true });
});

it('cancelling initialization cannot start analysis after initialization resolves', async () => {
  let resolve!: (value: {}) => void;
  mock.initialize.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const adapter = ready();
  const iterator = adapter.analyzePosition(request)[Symbol.asyncIterator]();
  const pending = iterator.next();
  await tick();
  adapter.stop();
  resolve({});
  await expect(pending).resolves.toMatchObject({ done: true });
  expect(mock.analyzePosition).not.toHaveBeenCalled();
});

it('discards and revokes a local bundle that finishes after a different model was selected', async () => {
  let resolve!: (bundle: any) => void;
  mock.bundle.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const adapter = ready();
  const first = adapter.stageLocal([]);
  adapter.stageRemote('new-model.json');
  const revoke = vi.fn();
  resolve({ manifestUrl: 'blob:stale', manifest: { model: 'old' }, revoke });
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect(revoke).toHaveBeenCalledOnce();
  const iterator = adapter.analyzePosition(request)[Symbol.asyncIterator]();
  const pending = iterator.next();
  await tick();
  expect(mock.initialize).toHaveBeenLastCalledWith('new-model.json');
  adapter.stop();
  await expect(pending).resolves.toMatchObject({ done: true });
});
