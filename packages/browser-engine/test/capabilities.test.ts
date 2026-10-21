import { describe, expect, it } from 'vitest';
import { threadPlan } from '../src/capabilities';

const capable = { isolated: true, sharedMemory: true, hardwareConcurrency: 32, backend: 'wasm' as const };
describe('shared CPU thread budget', () => {
  it('requires both isolation and shared Wasm memory', () => {
    for (const options of [{ isolated: false }, { sharedMemory: false }]) {
      const result = threadPlan({ ...capable, ...options, requested: 8 });
      expect(result.ortThreads).toBe(1);
      expect(result.reason).toBe('engine.singleThread');
    }
  });
  it('caps requested threads, leaves a core for the UI, and never adds a search pool', () => {
    expect(threadPlan({ ...capable, requested: 100 })).toMatchObject({ ortThreads: 8, searchThreads: 1 });
    expect(threadPlan({ ...capable, requested: 8, hardwareConcurrency: 4 }).ortThreads).toBe(3);
    expect(threadPlan({ ...capable, hardwareConcurrency: 1 }).ortThreads).toBe(1);
    expect(threadPlan(capable).ortThreads).toBe(4);
    expect(threadPlan({ ...capable, backend: 'webgpu' })).toEqual({ ortThreads: 1, searchThreads: 1 });
  });
  it('rejects invalid requests instead of silently changing them', () => {
    for (const requested of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => threadPlan({ ...capable, requested })).toThrow(/positive integer/);
    }
  });
});
