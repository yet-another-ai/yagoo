import * as ort from 'onnxruntime-web/webgpu';
import initRust, { analyze, default_config } from '../wasm/yagoo_web';
import { loadArtifact, validateManifest, type Manifest } from './model';

let session: ort.InferenceSession | undefined;
let manifest: Manifest;
let busy = false;
const emit = (data: unknown) => postMessage(data);
const heads = ['policy', 'value', 'miscvalue', 'moremiscvalue', 'ownership', 'scoring', 'futurepos', 'seki', 'scorebelief_logprobs'];

async function evaluate(spatial: Float32Array, globalInput: Float32Array): Promise<string> {
  if (!session) throw new Error('Neural session is not initialized.');
  const feeds = {
    spatial: new ort.Tensor('float32', spatial, [1, 22, 19, 19]),
    global_input: new ort.Tensor('float32', globalInput, [1, 19]),
  };
  let output: ort.InferenceSession.ReturnType | undefined;
  try {
    output = await session.run(feeds, heads);
    const values = Object.fromEntries(heads.map(name => {
      const tensor = output![name].data as Float32Array;
      const bad = tensor.findIndex(v => !Number.isFinite(v));
      if (bad !== -1) throw new Error(`Nonfinite neural output ${name}[${bad}]=${tensor[bad]} (${tensor.length} values).`);
      return [name, Array.from(tensor)];
    }));
    return JSON.stringify(values);
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
  if (busy) { emit({ type: 'error', message: 'Engine is busy.' }); return; }
  busy = true;
  try {
    if (data.type === 'initialize') {
      const response = await fetch(data.manifestUrl);
      if (!response.ok) throw new Error(`Manifest download failed (${response.status}). Export and serve a real model bundle first.`);
      manifest = validateManifest(await response.json());
      let precision: 'fp16' | 'fp32' = 'fp32';
      if (data.backend === 'webgpu') {
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) throw new Error('No WebGPU adapter is available.');
        ort.env.webgpu.adapter = adapter;
        if (data.precision !== 'fp32' && adapter.features.has('shader-f16') && manifest.variants.fp16) precision = 'fp16';
      }
      ort.env.wasm.numThreads = data.ortThreads;
      ort.env.wasm.proxy = false; // We already own an engine worker; proxy cannot carry GPU tensors.
      ort.env.wasm.wasmPaths = data.assetBase;
      const model = await loadArtifact(data.manifestUrl, manifest.variants[precision]!, (loaded, total) => emit({ type: 'download', loaded, total }));
      const reference = JSON.parse(new TextDecoder().decode(await loadArtifact(data.manifestUrl, manifest.warmup, () => {})));
      session = await ort.InferenceSession.create(model, {
        executionProviders: [data.backend],
        graphOptimizationLevel: 'all',
        // Do not label a mixed CPU/GPU graph as a validated GPU backend.
        extra: data.backend === 'webgpu' ? { session: { disable_cpu_ep_fallback: '1' } } : undefined,
      });
      const actual = JSON.parse(await evaluate(new Float32Array(reference.spatial), new Float32Array(reference.globalInput)));
      compareWarmup(actual, reference.outputs, precision === 'fp16');
      await initRust();
      emit({ type: 'ready', status: { backend: data.backend, precision, ortThreads: data.ortThreads,
        searchThreads: 1, validated: true, messages: [] } });
    } else if (data.type === 'analyze') {
      if (!session) throw new Error('Initialize the engine first.');
      const defaults = JSON.parse(default_config());
      const config = { ...defaults, ...data.config, deepSelect: { ...defaults.deepSelect, ...data.config?.deepSelect } };
      await analyze(data.sgf, JSON.stringify(config), JSON.stringify(manifest.postprocess), evaluate,
        (json: string) => emit({ type: 'event', event: JSON.parse(json) }));
      emit({ type: 'done' });
    }
  } catch (error) { emit({ type: 'error', message: String(error) }); }
  finally { busy = false; }
};
