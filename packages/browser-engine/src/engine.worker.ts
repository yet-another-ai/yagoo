import * as ort from 'onnxruntime-web/webgpu';
import initRust, { analyze, default_config } from '../wasm/yagoo_web';
import { loadArtifact, validateManifest, type Manifest } from './model';
import { ROOT_LAYERS, RootActivationStore, type RootContext } from './activations';

let session: ort.InferenceSession | undefined;
let manifest: Manifest;
let busy = false;
let stats = { evaluations: 0, batches: 0, maxBatch: 0 };
const emit = (data: unknown) => postMessage(data);
const heads = ['policy', 'value', 'miscvalue', 'moremiscvalue', 'ownership', 'scoring', 'futurepos', 'seki', 'scorebelief_logprobs'];
const shapes: Record<string, number[]> = { policy: [6, 362], value: [3], miscvalue: [10], moremiscvalue: [8],
  ownership: [1, 19, 19], scoring: [1, 19, 19], futurepos: [2, 19, 19], seki: [4, 19, 19], scorebelief_logprobs: [842] };
const activations = new RootActivationStore();
let rootContext: RootContext | undefined;
let activationNames: string[] = [];
let activationRequested = false;
let activationReason = 'Root activation retention is disabled.';
let modelSha256 = '';
let activationGeneration = 0;

function clearActivations(reason: string): void {
  activationGeneration++;
  activations.clear();
  emit({ type: 'rootActivations', available: false, reason, context: rootContext });
}

function beginRoot(json: string): void {
  activationGeneration++;
  activations.clear();
  rootContext = JSON.parse(json);
  emit({ type: 'rootActivations', available: false, reason: activationNames.length ? 'This root has no retained neural activation yet (terminal roots do not evaluate the model).' : activationReason, context: rootContext });
}

async function evaluate(spatial: Float32Array, globalInput: Float32Array, count = 1, rootIdentityBatch = false): Promise<string> {
  if (!session) throw new Error('Neural session is not initialized.');
  const capacity = manifest.batch === 0 ? manifest.maxBatch! : 1;
  if (!Number.isInteger(count) || count < 1 || count > capacity || spatial.length !== count * 22 * 361 || globalInput.length !== count * 19) throw new Error('Invalid neural batch shape.');
  const feeds = {
    spatial: new ort.Tensor('float32', spatial, [count, 22, 19, 19]),
    global_input: new ort.Tensor('float32', globalInput, [count, 19]),
  };
  let output: ort.InferenceSession.ReturnType | undefined;
  const activationEpoch = activationGeneration;
  try {
    let keepRoot = rootIdentityBatch && activationNames.length > 0;
    try {
      output = await session.run(feeds, keepRoot ? [...heads, ...activationNames] : heads);
    } catch (error) {
      if (!keepRoot) throw error;
      // A failed optional fetch must not discard a usable head-only session.
      // A failure of this retry still propagates as a real analysis error.
      activationNames = []; keepRoot = false;
      activationReason = `GPU activation fetch failed; retrying analysis heads only: ${String(error)}`;
      clearActivations(activationReason);
      output = await session.run(feeds, heads);
    }
    const rows: Record<string, number[]>[] = Array.from({ length: count }, () => ({}));
    for (const name of heads) {
      const tensor = output![name].data as Float32Array;
      const expected = [count, ...shapes[name]];
      if (output![name].type !== 'float32' || output![name].dims.length !== expected.length || output![name].dims.some((v, i) => v !== expected[i])) throw new Error(`Wrong neural batch output: ${name}.`);
      const bad = tensor.findIndex(v => !Number.isFinite(v));
      if (bad !== -1) throw new Error(`Nonfinite neural output ${name}[${bad}]=${tensor[bad]} (${tensor.length} values).`);
      const width = tensor.length / count;
      for (let i = 0; i < count; i++) rows[i][name] = Array.from(tensor.subarray(i * width, (i + 1) * width));
    }
    if (keepRoot && activationEpoch === activationGeneration) {
      if (!rootContext) throw new Error('Missing explicit root context.');
      try {
        const device = await ort.env.webgpu.device;
        if (activationEpoch === activationGeneration) {
          device.pushErrorScope('validation');
          let lease;
          try {
            lease = activations.capture(device, output, activationNames, rootContext, modelSha256, count);
            await device.queue.onSubmittedWorkDone(); // GPU completion only, no readback.
          } finally {
            const error = await device.popErrorScope();
            if (error) throw new Error(error.message);
          }
          if (activationEpoch === activationGeneration) emit({ type: 'rootActivations', available: true, lease });
        }
      } catch (error) {
        // Activation retention is optional. Preserve the validated head-only path.
        activations.clear(); activationNames = [];
        activationReason = `GPU activation retention failed; analysis heads remain available: ${String(error)}`;
        emit({ type: 'rootActivations', available: false, reason: activationReason, context: rootContext });
      }
    }
    stats.evaluations += count; stats.batches++; stats.maxBatch = Math.max(stats.maxBatch, count);
    return JSON.stringify(rows);
  } finally {
    if (output) Object.values(output).forEach(tensor => tensor.dispose());
    Object.values(feeds).forEach(tensor => tensor.dispose());
  }
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values); const exp = values.map(v => Math.exp(v - max)); const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map(v => v / sum);
}

function compareWarmup(actual: Record<string, number[]>, expected: Record<string, number[]>, half: boolean): void {
  for (const name of heads) {
    if (actual[name]?.length !== expected[name]?.length || actual[name].some(v => !Number.isFinite(v))) throw new Error(`Warmup output shape/value failure: ${name}`);
  }
  if (Math.abs(actual.scorebelief_logprobs.reduce((sum, x) => sum + Math.exp(x), 0) - 1) > 0.002) throw new Error('Score-belief warmup is not normalized.');
  for (const name of ['value', 'scorebelief_logprobs', 'policy']) {
    const count = name === 'policy' ? 362 : expected[name].length;
    const a = softmax(actual[name].slice(0, count)); const e = softmax(expected[name].slice(0, count));
    const error = Math.max(...a.map((v, i) => Math.abs(v - e[i])));
    if (error > (half ? 0.005 : 0.001)) throw new Error(`Model warmup differs from SWA reference: ${name}, max probability error ${error}.`);
  }
  if (actual.ownership.some((v, i) => Math.abs(Math.tanh(v) - Math.tanh(expected.ownership[i])) > (half ? 0.01 : 0.002))) throw new Error('Ownership warmup failed.');
  const leadError = Math.abs(actual.miscvalue[2] - expected.miscvalue[2]) * manifest.postprocess.lead_multiplier;
  if (leadError > (half ? 0.1 : 0.02)) throw new Error('Score lead warmup failed.');
}

self.onmessage = async ({ data }: MessageEvent) => {
  if (data.type === 'releaseRootActivations') {
    activationRequested = false; activationNames = [];
    activationReason = 'Root activations released. Reload with retention enabled to retain another root.';
    clearActivations(activationReason); return;
  }
  if (busy) { emit({ type: 'error', message: 'Engine is busy.' }); return; }
  busy = true;
  try {
    if (data.type === 'initialize') {
      activationRequested = data.retainRootActivations === true;
      activationNames = [];
      activationReason = 'Root activation retention is disabled.';
      const response = await fetch(data.manifestUrl);
      if (!response.ok) throw new Error(`Manifest download failed (${response.status}). Export and serve a real model bundle first.`);
      manifest = validateManifest(await response.json());
      activationNames = activationRequested && data.backend === 'webgpu' ? ROOT_LAYERS.filter(name => manifest.outputs.includes(name)) : [];
      activationReason = !activationRequested ? activationReason : data.backend !== 'webgpu'
        ? 'GPU root activations are unavailable on the Wasm backend.' : 'This model bundle has no exported trunk activations; export with --trunk.';
      let precision: 'fp16' | 'fp32' = 'fp32';
      if (data.backend === 'webgpu') {
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) throw new Error('No WebGPU adapter is available.');
        ort.env.webgpu.adapter = adapter;
        // TODO(#8): fp16 WebGPU policy warmup still fails (~0.00949 > 0.005); falls back to fp32.
        if (data.precision !== 'fp32' && adapter.features.has('shader-f16') && manifest.variants.fp16) precision = 'fp16';
      }
      ort.env.wasm.numThreads = data.ortThreads;
      ort.env.wasm.proxy = false; // We already own an engine worker; proxy cannot carry GPU tensors.
      ort.env.wasm.wasmPaths = data.assetBase;
      const model = await loadArtifact(data.manifestUrl, manifest.variants[precision]!, (loaded, total) => emit({ type: 'download', loaded, total }));
      modelSha256 = manifest.variants[precision]!.sha256;
      const reference = JSON.parse(new TextDecoder().decode(await loadArtifact(data.manifestUrl, manifest.warmup, () => {})));
      session = await ort.InferenceSession.create(model, {
        executionProviders: [data.backend],
        graphOptimizationLevel: 'all',
        preferredOutputLocation: Object.fromEntries(activationNames.map(name => [name, 'gpu-buffer' as const])),
        // Do not label a mixed CPU/GPU graph as a validated GPU backend.
        extra: data.backend === 'webgpu' ? { session: { disable_cpu_ep_fallback: '1' } } : undefined,
      });
      if (data.backend === 'webgpu') {
        const device = await ort.env.webgpu.device;
        void device.lost.then(() => {
          activationGeneration++; activations.clear(); activationNames = [];
          emit({ type: 'rootActivations', available: false, reason: 'GPU device lost; root activation handles expired.' });
        });
      }
      const maxBatch = manifest.batch === 0 ? manifest.maxBatch! : 1;
      for (const count of maxBatch > 1 ? [1, maxBatch] : [1]) {
        const spatial = new Float32Array(count * reference.spatial.length);
        const global = new Float32Array(count * reference.globalInput.length);
        for (let row = 0; row < count; row++) { spatial.set(reference.spatial, row * reference.spatial.length); global.set(reference.globalInput, row * reference.globalInput.length); }
        const actual = JSON.parse(await evaluate(spatial, global, count));
        for (const row of actual) compareWarmup(row, reference.outputs, precision === 'fp16');
      }
      await initRust();
      emit({ type: 'ready', status: { backend: data.backend, precision, ortThreads: data.ortThreads,
        searchThreads: 1, maxBatch, validated: true, rootActivationLayers: activationNames.length,
        rootActivationReason: activationNames.length ? undefined : activationReason, messages: [] } });
    } else if (data.type === 'analyze') {
      if (!session) throw new Error('Initialize the engine first.');
      const defaults = JSON.parse(default_config());
      const config = { ...defaults, ...data.config, deepSelect: { ...defaults.deepSelect, ...data.config?.deepSelect } };
      const requestedBatch = data.searchOptions?.batchSize ?? 4;
      const rootSymmetries = data.searchOptions?.rootSymmetries ?? 1;
      if (!Number.isInteger(requestedBatch) || requestedBatch < 1 || requestedBatch > 4 || ![1, 8].includes(rootSymmetries)) throw new Error('Batch size must be 1..4 and root symmetries must be 1 or 8.');
      const searchOptions = { rootSymmetries, batchSize: Math.min(requestedBatch, manifest.batch === 0 ? manifest.maxBatch! : 1) };
      stats = { evaluations: 0, batches: 0, maxBatch: 0 };
      activations.clear(); rootContext = undefined;
      await analyze(data.sgf, JSON.stringify(config), JSON.stringify(manifest.postprocess), JSON.stringify(searchOptions), evaluate,
        (json: string) => {
          const event = JSON.parse(json);
          if (event.type === 'error') clearActivations('Root activations released after a pipeline error.');
          emit({ type: 'event', event });
        }, beginRoot);
      emit({ type: 'stats', ...stats, ...searchOptions });
      emit({ type: 'done' });
    }
  } catch (error) { clearActivations('Released after analysis or initialization failure.'); emit({ type: 'error', message: String(error) }); }
  finally { busy = false; }
};
