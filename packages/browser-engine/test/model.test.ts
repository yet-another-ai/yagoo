import { expect, it } from 'vitest';
import { validateManifest } from '../src/model';

function manifest() {
  const artifact = { url: 'model.onnx', bytes: 10, sha256: 'a'.repeat(64), integrity: 'unused' };
  return { schemaVersion: 1, model: 'kata1-b18c384nbt-s9996604416-d4316597426', swa: true, modelVersion: 14,
    inputVersion: 7, boardSize: 19, batch: 0, maxBatch: 4, checkpointSha256: 'ed3f2681be01604fd51b467925de77cea4f19cf125383493449d8c002fb91a24',
    upstreamRevision: 'd91ea855110dae533f0aada947b2b7d78cc8a4e1', outputs: ['policy', 'value', 'miscvalue', 'moremiscvalue', 'ownership', 'scoring', 'scorebelief_logprobs', 'seki', 'futurepos'],
    variants: { fp32: artifact }, warmup: artifact, license: 'LICENSE', source: 'https://example.test/official-checkpoint',
    postprocess: { scoremean_multiplier: 20, scorestdev_multiplier: 20, lead_multiplier: 20 } };
}

it('requires all extra heads and the selected official checkpoint identity', () => {
  expect(validateManifest(manifest()).outputs).toContain('futurepos');
  for (const name of ['seki', 'futurepos', 'scorebelief_logprobs']) {
    const m = manifest(); m.outputs = m.outputs.filter(output => output !== name);
    expect(() => validateManifest(m)).toThrow(/missing/);
  }
  const m = manifest(); m.checkpointSha256 = '0'.repeat(64);
  expect(() => validateManifest(m)).toThrow(/validated b18/);
});
