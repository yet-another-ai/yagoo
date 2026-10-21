import { sharedMemoryAvailable, threadPlan } from './capabilities';
import { CodedError, coded, isParams } from './errors';
import engineWorkerHref from './engine.worker.ts?worker&url';

export type EngineStatus = {
  backend: 'webgpu' | 'wasm'; precision: 'fp16' | 'fp32'; ortThreads: number;
  searchThreads: 1; validated: boolean; messages: string[];
  maxBatch: number;
  rootActivationLayers?: number; rootActivationReason?: string;
};
export type EngineMessage = { type: string; [key: string]: unknown };
export type PositionAnalysisRequest = { sgf: string; ply: number; moves?: string[]; visits?: number };

type WorkerFailure = { message?: string; filename?: string; lineno?: number; colno?: number; error?: unknown };

/** Text from a Worker error event. Empty when Chrome hides a module-worker load failure. */
export function formatWorkerError(event: WorkerFailure): string {
  const thrown = event.error instanceof Error
    ? (event.error.stack || event.error.message)
    : event.error ? String(event.error) : '';
  const where = event.filename ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}` : '';
  return [event.message, thrown, where].map(part => part?.trim()).filter(Boolean).join('\n');
}

async function describeEmptyWorkerError(workerUrl: string): Promise<string> {
  try {
    const response = await fetch(workerUrl);
    const coep = response.headers.get('cross-origin-embedder-policy');
    const coop = response.headers.get('cross-origin-opener-policy');
    const headers = `HTTP ${response.status}, COEP ${coep ?? 'absent'}, COOP ${coop ?? 'absent'}`;
    if (!response.ok) return `Engine worker failed to load (${workerUrl}, ${headers}).`;
    if (crossOriginIsolated && coep !== 'require-corp') {
      return `Engine worker failed to load: ${workerUrl} was blocked because this page is cross-origin isolated and the script was served without Cross-Origin-Embedder-Policy (${headers}). The isolation service worker must cover this script.`;
    }
    return `Engine worker failed to load (${workerUrl}, ${headers}).`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Engine worker failed to load (${workerUrl}): ${detail}`;
  }
}

function errorFromMessage(data: EngineMessage): CodedError {
  const message = String(data.message ?? data.code ?? 'engine.worker');
  const code = typeof data.code === 'string' ? data.code : 'engine.worker';
  const params = isParams(data.params) ? data.params : { detail: message };
  return coded(code, message, params);
}

/** Owns a dedicated engine worker and its ORT pthreads. terminate() cancels all. */
export class BrowserEngine {
  private worker?: Worker;
  private running = false;
  private ready = false;
  private generation = 0;
  private cancelInitialization?: () => void;
  private retainRootActivations = false;
  onMessage: (event: EngineMessage) => void = () => {};

  async initialize(manifestUrl: string, options: { wasmThreads?: number; forceWasm?: boolean; retainRootActivations?: boolean } = {}): Promise<EngineStatus> {
    this.dispose();
    this.retainRootActivations = options.retainRootActivations === true;
    const generation = this.generation;
    const messages: string[] = [];
    const backends: ('webgpu' | 'wasm')[] = options.forceWasm ? ['wasm'] : ['webgpu', 'wasm'];
    for (const backend of backends) {
      const plan = threadPlan({ isolated: crossOriginIsolated, sharedMemory: sharedMemoryAvailable(),
        hardwareConcurrency: navigator.hardwareConcurrency, requested: options.wasmThreads, backend });
      const attempts = backend === 'webgpu'
        ? [{ threads: 1, precision: 'auto' }, { threads: 1, precision: 'fp32' }]
        : (plan.ortThreads > 1 ? [plan.ortThreads, 1] : [1]).map(threads => ({ threads, precision: 'fp32' }));
      for (const { threads, precision } of attempts) {
        const workerUrl = new URL(engineWorkerHref, import.meta.url);
        const worker = new Worker(workerUrl, { type: 'module' });
        this.worker = worker;
        try {
          const result = await new Promise<EngineStatus>((resolve, reject) => {
            this.cancelInitialization = () => reject(new DOMException('Engine initialization was cancelled.', 'AbortError'));
            const fail = (error: Error) => reject(error);
            worker.onerror = event => {
              const message = formatWorkerError(event);
              if (message) fail(coded('engine.worker', message, { detail: message }));
              else void describeEmptyWorkerError(workerUrl.href).then(text => fail(coded('engine.worker', text, { detail: text })));
            };
            worker.onmessage = ({ data }: MessageEvent<EngineMessage>) => {
              if (data.type === 'ready') resolve(data.status as EngineStatus);
              else if (data.type === 'error') reject(errorFromMessage(data));
              else this.onMessage(data);
            };
            worker.postMessage({ type: 'initialize', manifestUrl: new URL(manifestUrl, location.href).href,
              backend, precision, ortThreads: threads, retainRootActivations: this.retainRootActivations,
              assetBase: new URL(`${import.meta.env.BASE_URL}ort/`, location.origin).href });
          });
          this.cancelInitialization = undefined;
          if (generation !== this.generation) throw new DOMException('Engine initialization was cancelled.', 'AbortError');
          this.ready = true;
          result.messages = messages;
          worker.onmessage = ({ data }: MessageEvent<EngineMessage>) => {
            if (data.type === 'done' || data.type === 'error') this.running = false;
            this.onMessage(data);
          };
          worker.onerror = event => {
            this.running = false;
            const message = formatWorkerError(event);
            const publish = (text: string) => this.onMessage({ type: 'error', code: 'engine.worker', params: { detail: text }, message: text });
            if (message) publish(message);
            else void describeEmptyWorkerError(workerUrl.href).then(publish);
          };
          return result;
        } catch (error) {
          worker.terminate();
          if (generation !== this.generation) throw error;
          this.cancelInitialization = undefined;
          this.worker = undefined;
          const message = String(error);
          if (/Manifest download failed \(404\)/.test(message) || (error instanceof CodedError && error.code === 'engine.manifestDownloadFailed' && Number(error.params.status) === 404)) {
            throw coded(
              'engine.noHostedBundle',
              'No model bundle is hosted here. Load a local model (manifest.json, the .onnx weights, and warmup.json), or set VITE_YAGOO_MANIFEST_URL for local development.',
            );
          }
          messages.push(`${backend} ${precision} (${threads} thread${threads === 1 ? '' : 's'}) failed: ${message}`);
        }
      }
    }
    this.dispose();
    const detail = messages.join('\n');
    throw coded('engine.initFailed', detail, { detail });
  }

  analyze(sgf: string, config?: Record<string, unknown>, searchOptions?: { rootSymmetries?: number; batchSize?: number }): void {
    if (!this.worker || !this.ready) throw coded('engine.notInitialized', 'Initialize the engine first.');
    if (this.running) throw coded('engine.alreadyRunning', 'An analysis is already running.');
    this.running = true;
    this.worker.postMessage({ type: 'analyze', sgf, config, searchOptions });
  }

  dispose(): void {
    this.generation++;
    this.cancelInitialization?.(); this.cancelInitialization = undefined;
    this.worker?.terminate(); this.worker = undefined; this.running = false; this.ready = false;
    this.retainRootActivations = false;
  }

  analyzePosition(request: PositionAnalysisRequest): void {
    if (!this.worker || !this.ready) throw coded('engine.notInitialized', 'Initialize the engine first.');
    if (this.running) throw coded('engine.alreadyRunning', 'An analysis is already running.');
    this.running = true;
    this.worker.postMessage({ type: 'analyzePosition', request });
  }

  /** Releases only ephemeral activation buffers; does not cancel active analysis. */
  releaseRootActivations(): void {
    this.retainRootActivations = false;
    this.worker?.postMessage({ type: 'releaseRootActivations' });
  }
}
