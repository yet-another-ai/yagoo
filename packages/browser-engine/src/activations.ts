import { Tensor, type InferenceSession } from 'onnxruntime-web/webgpu';
import { coded } from './errors';

export const ROOT_LAYERS = [...Array.from({ length: 18 }, (_, i) => `trunk_after_block${i}`), 'trunkfinal'];
export type RootContext = { queryId: string; boardSize: number; toPlay: 'B' | 'W' };
export type ActivationLease = RootContext & {
  handle: string; modelSha256: string; location: 'gpu-buffer'; sampleSymmetry: 'identity';
  layers: { name: string; dims: number[]; type: 'float32' | 'float16'; bytes: number }[];
};

/** One ephemeral root, owned by this worker. Never serializes tensor values.
 * Consumers run here, on the ORT device, and submit GPU work synchronously inside
 * use(). The next root/release invalidates the handle. This is not a concept head.
 * TODO(#13): concept-head consumers, activation visualization, persistent storage.
 */
export class RootActivationStore {
  private serial = 0;
  private current?: { lease: ActivationLease; tensors: Record<string, Tensor> };

  clear(): void {
    if (this.current) Object.values(this.current.tensors).forEach(tensor => tensor.dispose());
    this.current = undefined;
  }

  capture(device: GPUDevice, outputs: InferenceSession.ReturnType, names: string[], context: RootContext,
    modelSha256: string, batch: number): ActivationLease {
    this.clear();
    const tensors: Record<string, Tensor> = {};
    const layers: ActivationLease['layers'] = [];
    const command = device.createCommandEncoder();
    try {
      for (const name of names) {
        const tensor = outputs[name];
        if (!tensor || tensor.location !== 'gpu-buffer' || !['float32', 'float16'].includes(tensor.type) ||
          tensor.dims.length !== 4 || tensor.dims[0] !== batch || tensor.dims[1] !== 384 || tensor.dims[2] !== 19 || tensor.dims[3] !== 19) {
          throw coded('engine.activationInvalid', `Invalid GPU root activation ${name}.`, { name });
        }
        const type = tensor.type as 'float32' | 'float16';
        if (!(tensor.gpuBuffer.usage & GPUBufferUsage.COPY_SRC)) throw coded('engine.activationCopy', `GPU activation ${name} is not copyable.`, { name });
        const dims = [1, 384, 19, 19];
        const bytes = 384 * 19 * 19 * (type === 'float32' ? 4 : 2);
        // Copy only identity row zero, entirely on the GPU. Other symmetry rows
        // and ORT output tensors can then be released with the inference outputs.
        const buffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        try {
          command.copyBufferToBuffer(tensor.gpuBuffer, 0, buffer, 0, bytes);
          tensors[name] = Tensor.fromGpuBuffer(buffer, { dataType: type, dims, dispose: () => buffer.destroy() });
        } catch (error) { buffer.destroy(); throw error; }
        layers.push({ name, dims, type, bytes });
      }
      device.queue.submit([command.finish()]);
      const lease: ActivationLease = { ...context, handle: `root-${++this.serial}`, modelSha256,
        location: 'gpu-buffer', sampleSymmetry: 'identity', layers };
      this.current = { lease, tensors };
      return lease;
    } catch (error) {
      Object.values(tensors).forEach(tensor => tensor.dispose());
      throw error;
    }
  }

  use(handle: string, consume: (tensors: Readonly<Record<string, Tensor>>) => void): void {
    if (!this.current || this.current.lease.handle !== handle) throw coded('engine.activationExpired', 'Root activation handle has expired.');
    consume(this.current.tensors);
  }
}
