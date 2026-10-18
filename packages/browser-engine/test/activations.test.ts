import { afterEach, expect, it, vi } from 'vitest';
import { RootActivationStore } from '../src/activations';
import type { InferenceSession } from 'onnxruntime-web/webgpu';

vi.mock('onnxruntime-web/webgpu', () => ({ Tensor: { fromGpuBuffer: (gpuBuffer: unknown, options: { dims: number[]; dataType: string; dispose: () => void }) => ({
  gpuBuffer, dims: options.dims, type: options.dataType, dispose: options.dispose,
}) } }));
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, COPY_SRC: 4, COPY_DST: 8 });
  const buffers: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const copy = vi.fn(); const submit = vi.fn();
  const device = { createBuffer: vi.fn(() => { const b = { destroy: vi.fn() }; buffers.push(b); return b; }),
    createCommandEncoder: () => ({ copyBufferToBuffer: copy, finish: () => ({}) }), queue: { submit } } as unknown as GPUDevice;
  const output = { location: 'gpu-buffer', type: 'float32', dims: [4, 384, 19, 19],
    gpuBuffer: { usage: 4 }, dispose: vi.fn(), get data() { throw new Error('Forbidden CPU readback'); } };
  const outputs = { trunkfinal: output } as unknown as InferenceSession.ReturnType;
  const root = { queryId: 'p1-scan-root', boardSize: 9, toPlay: 'W' as const };
  return { device, buffers, copy, submit, outputs, output, root };
}

it('retains only identity row zero on GPU and invalidates old handles on replacement or release', () => {
  const f = fixture(); const store = new RootActivationStore();
  const first = store.capture(f.device, f.outputs, ['trunkfinal'], f.root, 'model-sha', 4);
  expect(f.copy).toHaveBeenCalledWith(f.output.gpuBuffer, 0, f.buffers[0], 0, 384 * 361 * 4);
  expect(f.submit).toHaveBeenCalledOnce();
  expect(first.layers[0]).toMatchObject({ dims: [1, 384, 19, 19], bytes: 554496 });
  store.use(first.handle, tensors => expect(tensors.trunkfinal.dims).toEqual([1, 384, 19, 19]));
  const second = store.capture(f.device, f.outputs, ['trunkfinal'], f.root, 'model-sha', 4);
  expect(f.buffers[0].destroy).toHaveBeenCalledOnce();
  expect(() => store.use(first.handle, () => {})).toThrow(/expired/);
  store.clear(); store.clear();
  expect(f.buffers[1].destroy).toHaveBeenCalledOnce();
  expect(() => store.use(second.handle, () => {})).toThrow(/expired/);
  expect(f.output.dispose).not.toHaveBeenCalled(); // ORT owns the source until caller finally.
});

it('destroys partially created GPU buffers when a later activation is malformed', () => {
  const f = fixture(); const store = new RootActivationStore();
  expect(() => store.capture(f.device, f.outputs, ['trunkfinal', 'missing'], f.root, 'sha', 4)).toThrow(/Invalid GPU/);
  expect(f.buffers[0].destroy).toHaveBeenCalledOnce();
  expect(f.submit).not.toHaveBeenCalled();
});
