import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  run: vi.fn(), analyze: vi.fn(), analyzePosition: vi.fn(), capture: vi.fn(), clear: vi.fn(), create: vi.fn(), load: vi.fn(),
  device: { pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => null),
    queue: { onSubmittedWorkDone: vi.fn(async () => {}) }, lost: new Promise(() => {}) },
}));
vi.mock('onnxruntime-web/webgpu', () => ({
  env: { wasm: {}, webgpu: { device: mock.device } },
  Tensor: class { dispose() {} },
  InferenceSession: { create: mock.create },
}));
vi.mock('../wasm/yagoo_web', () => ({ default: async () => {}, analyze: mock.analyze, analyze_position: mock.analyzePosition, default_config: () => '{"deepSelect":{}}' }));
vi.mock('../src/model', () => ({ validateManifest: (value: unknown) => value, loadArtifact: mock.load }));
vi.mock('../src/activations', () => ({
  ROOT_LAYERS: ['trunkfinal'],
  RootActivationStore: class { clear = mock.clear; capture = mock.capture; },
}));

const shapes: Record<string, number[]> = { policy: [6, 362], value: [3], miscvalue: [10], moremiscvalue: [8],
  ownership: [1, 19, 19], scoring: [1, 19, 19], futurepos: [2, 19, 19], seki: [4, 19, 19], scorebelief_logprobs: [842] };
const reference = Object.fromEntries(Object.entries(shapes).map(([name, dims]) =>
  [name, Array(dims.reduce((a, b) => a * b)).fill(name === 'scorebelief_logprobs' ? -Math.log(842) : 0)]));
const manifest = { batch: 1, outputs: [...Object.keys(shapes), 'trunkfinal'],
  variants: { fp32: { sha256: 'test-model' } }, warmup: { file: 'warmup' }, postprocess: { lead_multiplier: 20 } };
const initialize = { type: 'initialize', manifestUrl: 'https://example.test/manifest.json',
  backend: 'webgpu', ortThreads: 1, precision: 'fp32', retainRootActivations: true };
let messages: Record<string, any>[];
let worker: { onmessage: (event: { data: Record<string, unknown> }) => Promise<void> };
const dispatch = (data: Record<string, unknown>) => worker.onmessage({ data });
async function root(evaluate: (...args: any[]) => Promise<string>, begin: (json: string) => void) {
  begin('{"queryId":"root","boardSize":9,"toPlay":"B"}');
  return evaluate(new Float32Array(22 * 361), new Float32Array(19), 1, true);
}

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  messages = [];
  worker = {} as typeof worker;
  vi.stubGlobal('self', worker);
  vi.stubGlobal('postMessage', (data: Record<string, any>) => messages.push(data));
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ features: new Set() }) } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest })));
  mock.create.mockResolvedValue({ run: mock.run });
  mock.run.mockImplementation(async () => Object.fromEntries(Object.entries(shapes).map(([name, dims]) =>
    [name, { type: 'float32', dims: [1, ...dims], data: new Float32Array(reference[name]), dispose: vi.fn() }])));
  mock.load.mockImplementation(async (_url, artifact) => artifact === manifest.warmup
    ? new TextEncoder().encode(JSON.stringify({ spatial: Array(22 * 361).fill(0), globalInput: Array(19).fill(0), outputs: reference }))
    : new Uint8Array());
  mock.capture.mockReturnValue({ handle: 'root-1', layers: [] });
  await import('../src/engine.worker');
});
afterEach(() => vi.unstubAllGlobals());

it('routes tried positions through the single-position pipeline with the full request', async () => {
  await dispatch(initialize);
  const request = { sgf: '(;SZ[9];B[cc];W[])', ply: 2, moves: ['D4', 'pass'], visits: 200 };
  mock.analyzePosition.mockImplementation(async (json, _post, _options, evaluate, emit, begin) => {
    expect(JSON.parse(json)).toEqual(request);
    await root(evaluate, begin);
    emit('{"type":"positionCompleted","v":1,"phase":"deep","snapshot":{"ply":4}}');
  });
  await dispatch({ type: 'analyzePosition', request });
  expect(mock.analyze).not.toHaveBeenCalled();
  expect(messages).toContainEqual({ type: 'event', event: { type: 'positionCompleted', v: 1, phase: 'deep', snapshot: { ply: 4 } } });
  expect(messages.at(-1)).toEqual({ type: 'done' });
});

it('invalidates retained tensors on an error event even when the pipeline resolves normally', async () => {
  await dispatch(initialize);
  mock.analyze.mockImplementation(async (_sgf, _config, _post, _options, evaluate, emit, begin) => {
    await root(evaluate, begin);
    expect(messages.at(-1)).toMatchObject({ type: 'rootActivations', available: true });
    mock.clear.mockClear();
    emit('{"type":"error","message":"Unsupported searched leaf"}');
    expect(mock.clear).toHaveBeenCalledTimes(1);
  });
  await dispatch({ type: 'analyze', sgf: '(;SZ[9])' });
  expect(messages.filter(x => x.type === 'rootActivations').at(-1)).toMatchObject({ available: false, reason: expect.stringMatching(/pipeline error/) });
  expect(messages).toContainEqual({ type: 'event', event: { type: 'error', message: 'Unsupported searched leaf' } });
});

it('retries a failed optional activation fetch with heads only without suppressing later failures', async () => {
  await dispatch(initialize);
  mock.run.mockClear();
  mock.run.mockRejectedValueOnce(new Error('Cannot fetch trunk output'));
  mock.analyze.mockImplementation(async (_sgf, _config, _post, _options, evaluate, _emit, begin) => {
    const values = JSON.parse(await root(evaluate, begin));
    expect(values[0].scorebelief_logprobs).toHaveLength(842);
  });
  await dispatch({ type: 'analyze', sgf: '(;SZ[9])' });
  expect(mock.run.mock.calls.map(call => call[1])).toEqual([[...Object.keys(shapes), 'trunkfinal'], Object.keys(shapes)]);
  expect(mock.capture).not.toHaveBeenCalled();
  expect(messages.at(-1)).toEqual({ type: 'done' });
  mock.run.mockRejectedValueOnce(new Error('Real head inference failure'));
  await dispatch({ type: 'analyze', sgf: '(;SZ[9])' });
  expect(messages.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/Real head inference failure/) });
});

it('propagates a failed heads-only retry within the same root evaluation', async () => {
  await dispatch(initialize);
  mock.run.mockClear();
  mock.run.mockRejectedValueOnce(new Error('Cannot fetch trunk output'))
    .mockRejectedValueOnce(new Error('Head-only retry failed'));
  mock.analyze.mockImplementation(async (_sgf, _config, _post, _options, evaluate, _emit, begin) => {
    await root(evaluate, begin);
  });
  await dispatch({ type: 'analyze', sgf: '(;SZ[9])' });
  expect(mock.run.mock.calls.map(call => call[1])).toEqual([[...Object.keys(shapes), 'trunkfinal'], Object.keys(shapes)]);
  expect(messages.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/Head-only retry failed/) });
});

it('does not re-enable retention when release arrives during the manifest download', async () => {
  let resolveFetch!: (value: unknown) => void;
  vi.stubGlobal('fetch', () => new Promise(resolve => { resolveFetch = resolve; }));
  const loading = dispatch(initialize);
  await dispatch({ type: 'releaseRootActivations' });
  resolveFetch({ ok: true, json: async () => manifest });
  await loading;
  expect(mock.create.mock.calls[0][1].preferredOutputLocation).toEqual({});
  expect(messages.at(-1)).toMatchObject({ type: 'ready', status: { rootActivationLayers: 0, rootActivationReason: expect.stringMatching(/released/) } });
});
