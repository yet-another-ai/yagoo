import { coded } from './errors';

export const MAX_WASM_THREADS = 8;
/** Stable key. The Vue reviewer translates `engine.singleThread`. */
export const SINGLE_THREAD_CODE = 'engine.singleThread';
/** English note for the non-Vue engine page. Not an analysis error. */
export const SINGLE_THREAD_NOTE =
  'Wasm is running on one thread: cross-origin isolation and shared WebAssembly memory are required for multiple threads.';
export type ThreadPlan = { ortThreads: number; searchThreads: 1; reason?: string };

export function threadPlan(options: {
  isolated: boolean; sharedMemory: boolean; hardwareConcurrency: number;
  requested?: number; backend: 'wasm' | 'webgpu';
}): ThreadPlan {
  const { isolated, sharedMemory, requested, backend } = options;
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) {
    throw coded('engine.threadCount', 'Wasm thread count must be a positive integer.');
  }
  if (backend === 'webgpu') return { ortThreads: 1, searchThreads: 1 };
  if (!isolated || !sharedMemory) return {
    ortThreads: 1, searchThreads: 1,
    reason: SINGLE_THREAD_CODE,
  };
  const cores = Number.isFinite(options.hardwareConcurrency) ? Math.max(1, Math.floor(options.hardwareConcurrency)) : 2;
  // ORT counts its calling engine worker as one of these threads. Rust MCTS runs
  // on that same worker and is suspended during inference, not a second pool.
  return { ortThreads: Math.max(1, Math.min(requested ?? 4, MAX_WASM_THREADS, cores - 1)), searchThreads: 1 };
}

export function sharedMemoryAvailable(): boolean {
  try {
    return typeof SharedArrayBuffer === 'function' &&
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof SharedArrayBuffer;
  } catch { return false; }
}
