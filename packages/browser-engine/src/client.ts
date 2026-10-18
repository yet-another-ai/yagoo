import { sharedMemoryAvailable, threadPlan } from './capabilities';

export type EngineStatus = {
  backend: 'webgpu' | 'wasm'; precision: 'fp16' | 'fp32'; ortThreads: number;
  searchThreads: 1; validated: boolean; messages: string[];
};
export type EngineMessage = { type: string; [key: string]: unknown };

/** Owns a dedicated engine worker and its ORT pthreads. terminate() cancels all. */
export class BrowserEngine {
  private worker?: Worker;
  private running = false;
  private ready = false;
  private generation = 0;
  private cancelInitialization?: () => void;
  onMessage: (event: EngineMessage) => void = () => {};

  async initialize(manifestUrl: string, options: { wasmThreads?: number; forceWasm?: boolean } = {}): Promise<EngineStatus> {
    this.dispose();
    const generation = this.generation;
    const messages: string[] = [];
    const backends: ('webgpu' | 'wasm')[] = options.forceWasm ? ['wasm'] : ['webgpu', 'wasm'];
    for (const backend of backends) {
      const plan = threadPlan({ isolated: crossOriginIsolated, sharedMemory: sharedMemoryAvailable(),
        hardwareConcurrency: navigator.hardwareConcurrency, requested: options.wasmThreads, backend });
      if (plan.reason) messages.push(plan.reason);
      const attempts = backend === 'webgpu'
        ? [{ threads: 1, precision: 'auto' }, { threads: 1, precision: 'fp32' }]
        : (plan.ortThreads > 1 ? [plan.ortThreads, 1] : [1]).map(threads => ({ threads, precision: 'fp32' }));
      for (const { threads, precision } of attempts) {
        const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        try {
          const result = await new Promise<EngineStatus>((resolve, reject) => {
            this.cancelInitialization = () => reject(new DOMException('Engine initialization was cancelled.', 'AbortError'));
            worker.onerror = event => reject(new Error(event.message || 'Engine worker failed to load.'));
            worker.onmessage = ({ data }: MessageEvent<EngineMessage>) => {
              if (data.type === 'ready') resolve(data.status as EngineStatus);
              else if (data.type === 'error') reject(new Error(String(data.message)));
              else this.onMessage(data);
            };
            worker.postMessage({ type: 'initialize', manifestUrl: new URL(manifestUrl, location.href).href,
              backend, precision, ortThreads: threads, assetBase: new URL(`${import.meta.env.BASE_URL}ort/`, location.origin).href });
          });
          this.cancelInitialization = undefined;
          if (generation !== this.generation) throw new DOMException('Engine initialization was cancelled.', 'AbortError');
          this.ready = true;
          result.messages = messages;
          worker.onmessage = ({ data }: MessageEvent<EngineMessage>) => {
            if (data.type === 'done' || data.type === 'error') this.running = false;
            this.onMessage(data);
          };
          worker.onerror = event => { this.running = false; this.onMessage({ type: 'error', message: event.message }); };
          return result;
        } catch (error) {
          worker.terminate();
          if (generation !== this.generation) throw error;
          this.cancelInitialization = undefined;
          this.worker = undefined;
          messages.push(`${backend} ${precision} (${threads} thread${threads === 1 ? '' : 's'}) failed: ${String(error)}`);
        }
      }
    }
    this.dispose();
    throw new Error(messages.join('\n'));
  }

  analyze(sgf: string, config?: Record<string, unknown>): void {
    if (!this.worker || !this.ready) throw new Error('Initialize the engine first.');
    if (this.running) throw new Error('An analysis is already running.');
    this.running = true;
    this.worker.postMessage({ type: 'analyze', sgf, config });
  }

  dispose(): void {
    this.generation++;
    this.cancelInitialization?.(); this.cancelInitialization = undefined;
    this.worker?.terminate(); this.worker = undefined; this.running = false; this.ready = false;
  }
}
