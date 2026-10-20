/** Offline verification and evidence index; never starts an engine. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(folder, '../../../../../packages/ui/package.json'));
const Board = require('@sabaki/go-board');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const lines = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const cols = 'ABCDEFGHJKLMNOPQRST';
const vertex = move => move.toLowerCase() === 'pass' ? [-1, -1] : [cols.indexOf(move[0]), 19 - Number(move.slice(1))];
const replay = moves => moves.reduce((board, [color, move]) => board.makeMove(color === 'B' ? 1 : -1, vertex(move), {
  preventKo: true, preventSuicide: true, preventOverwrite: true,
}), Board.fromDimensions(19));
const provenance = read(path.join(folder, 'source-provenance.json'));
for (const source of provenance.records) {
  assert.equal(hash(path.join(folder, source.originalFile)), source.originalSha256);
  assert.equal(hash(path.join(folder, source.analysisFile)), source.analysisSha256);
}
const names = ['screen-64-20261020', 'screen-256-20261020', 'supplement-64-20261020'];
const recordings = names.map(name => {
  const dir = path.join(folder, name), manifest = read(path.join(dir, 'manifest.json'));
  assert.equal(manifest.state, 'complete');
  assert.equal(manifest.shutdownUnconfirmed, undefined);
  assert.equal(manifest.engineExit.code, 0);
  for (const [file, value] of Object.entries(manifest.files)) assert.equal(hash(path.join(dir, file)), value.sha256, `${name}/${file}`);
  const shutdown = read(path.join(dir, 'process-shutdown.json'));
  assert.equal(shutdown.remainingCount, 0);
  const queries = lines(path.join(dir, 'queries.ndjson'));
  const envelopes = lines(path.join(dir, 'responses.ndjson'));
  assert(envelopes.every(result => !result.error));
  const results = envelopes.filter(result => result.rootInfo && !result.isDuringSearch);
  assert.equal(queries.length, results.length);
  assert.equal(queries.length, manifest.queryCount);
  assert.equal(new Set(queries.map(query => query.id)).size, queries.length);
  for (const query of queries) {
    const result = results.find(result => result.id === query.id);
    assert(result);
    assert.equal(result.ownership.length, 361);
    assert(result.ownership.every(Number.isFinite));
    assert(Number.isFinite(result.rootInfo.scoreLead) && Number.isFinite(result.rootInfo.winrate));
    replay(query.moves);
    for (const candidate of result.moveInfos) {
      const first = query.moves.length % 2 ? 'W' : 'B';
      replay([...query.moves, ...candidate.pv.map((move, index) => [index % 2 ? (first === 'B' ? 'W' : 'B') : first, move])]);
    }
    if (manifest.sourceRoots) {
      const expected = manifest.sourceRoots[query.id];
      assert.equal(result.rootInfo.thisHash, expected.rootHash);
      assert(result.moveInfos.some(move => move.move === expected.forcedMove));
    }
  }
  if (manifest.sourceRoots) {
    assert.deepEqual(queries, read(path.join(dir, 'query-plan.json')));
  } else {
    const validation = read(path.join(dir, 'validation.json'));
    assert.equal(validation.valid, true);
    assert.equal(validation.queries, queries.length);
  }
  return {
    directory: name, manifestSha256: hash(path.join(dir, 'manifest.json')),
    startedAt: manifest.startedAt, finishedAt: manifest.finishedAt,
    queryCount: queries.length, finalResponses: results.length,
    warningEnvelopes: envelopes.filter(result => result.warning && !result.rootInfo).length,
    processShutdown: shutdown, engine: manifest.engine, model: manifest.model,
    rules: manifest.rules, komi: manifest.komi, fullHistory: manifest.fullHistory,
    perspective: manifest.perspective, cases: manifest.cases ?? manifest.completedIds,
  };
});
const summary = {
  generatedAt: new Date().toISOString(), valid: true, recordings,
  verifierRuntime: { node: process.version, platform: process.platform, arch: process.arch },
  sourceProvenance: 'source-provenance.json', sensitivityPlan: 'sensitivity-plan.json',
  positiveCalibration: 'Unverified. Legal capture and native provenance do not establish a supported sacrifice or expert intent; use the fixed-default production replay assessment.',
  sourceCaveats: 'CWI source collector states public domain. Chitetsu/Dosaku source warns that other records reverse player names and disagree about result. Chinese rules, zero komi are explicit analysis settings, not historical reconstruction.',
};
fs.writeFileSync(path.join(folder, 'calibration-summary.json'), JSON.stringify(summary, null, 2) + '\n');
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'artifact-hashes.json') continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else files.push({ path: path.relative(folder, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: hash(file) });
  }
}
walk(folder);
fs.writeFileSync(path.join(folder, 'artifact-hashes.json'), JSON.stringify({ generatedAt: summary.generatedAt, files }, null, 2) + '\n');
console.log(JSON.stringify({ valid: true, recordings: recordings.length, queries: recordings.reduce((n, item) => n + item.queryCount, 0), hashedFiles: files.length }, null, 2));
