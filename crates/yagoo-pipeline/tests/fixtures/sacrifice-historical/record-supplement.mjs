/** Sequential genuine native queries using the existing screen's engine/model/config. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const folder = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((out, arg, index, all) => {
  if (index % 2 === 0) {
    if (!['--source', '--queries', '--out'].includes(arg) || !all[index + 1]) throw new Error('Invalid arguments');
    out.push([arg.slice(2), all[index + 1]]);
  }
  return out;
}, []));
if (process.env.CI) throw new Error('Native recording is forbidden in CI');
for (const key of ['source', 'queries', 'out']) if (!args[key]) throw new Error(`Missing --${key}`);
const source = path.resolve(args.source), queryFile = path.resolve(args.queries), out = path.resolve(args.out);
for (const item of [source, queryFile, out]) if (!item.startsWith(folder + path.sep)) throw new Error('Outside research folder');
if (fs.existsSync(out)) throw new Error('Refusing to overwrite a recording');
const base = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
if (base.state !== 'complete' || base.shutdownUnconfirmed || !base.engineExit) throw new Error('Prior recording must be complete with confirmed shutdown');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => hash(fs.readFileSync(file));
if (hashFile(base.engine.path) !== base.engine.sha256 || hashFile(base.model.path) !== base.model.sha256) throw new Error('Engine/model hash mismatch');
const queries = JSON.parse(fs.readFileSync(queryFile, 'utf8'));
const ndjson = name => fs.readFileSync(path.join(source, name), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const rootQueries = ndjson('queries.ndjson').filter(query => query.id.endsWith('-root'));
const sourceResults = ndjson('responses.ndjson').filter(result => result.rootInfo && !result.isDuringSearch);
const matches = new Map();
if (!Array.isArray(queries) || !queries.length || new Set(queries.map(q => q.id)).size !== queries.length) throw new Error('Invalid query plan');
for (const q of queries) {
  if (!q.id || !Array.isArray(q.moves) || q.rules?.toLowerCase() !== 'chinese' || q.komi !== 0 ||
      q.boardXSize !== 19 || q.boardYSize !== 19 || (q.initialStones ?? []).length !== 0 ||
      (q.initialPlayer ?? 'B') !== 'B' ||
      !Number.isInteger(q.maxVisits) || q.maxVisits < 16 || q.maxVisits > 512) throw new Error('Invalid query settings');
  const rootQuery = rootQueries.find(root => JSON.stringify(root.moves) === JSON.stringify(q.moves));
  const rootResult = sourceResults.find(result => result.id === rootQuery?.id);
  const allow = q.allowMoves;
  if (!rootResult || !rootResult.rootInfo.thisHash || allow?.length !== 1 || allow[0].untilDepth !== 1 ||
      allow[0].moves?.length !== 1 || allow[0].player !== (q.moves.length % 2 ? 'W' : 'B') ||
      q.includeOwnership !== true || q.includeMovesOwnership !== true) throw new Error('Supplement must be a forced candidate at an exact recorded root');
  matches.set(q.id, { sourceRootId: rootQuery.id, rootHash: rootResult.rootInfo.thisHash, forcedMove: allow[0].moves[0] });
}
fs.mkdirSync(out);
fs.copyFileSync(path.join(source, 'analysis.cfg'), path.join(out, 'analysis.cfg'));
fs.copyFileSync(fileURLToPath(import.meta.url), path.join(out, 'record-supplement.mjs'));
fs.copyFileSync(queryFile, path.join(out, 'query-plan.json'));
const manifest = {
  schemaVersion: 1, state: 'recording', startedAt: new Date().toISOString(),
  recorderRuntime: { node: process.version, platform: process.platform, arch: process.arch },
  purpose: 'Supplemental genuine queries for fixed-default pipeline replay; not expert-labelled calibration.',
  sourceRecording: path.relative(folder, source), sourceManifestSha256: hashFile(path.join(source, 'manifest.json')),
  engine: base.engine, model: base.model, rules: base.rules, komi: base.komi, boardSize: base.boardSize,
  perspective: base.perspective, fullHistory: true, queryPlanSha256: hashFile(queryFile), queryCount: 0, completedIds: [],
  sourceRoots: Object.fromEntries(matches),
};
const save = () => fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const child = spawn(base.engine.path, ['analysis', '-model', base.model.path, '-config', path.join(out, 'analysis.cfg')], {
  cwd: out, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
manifest.enginePid = child.pid ?? null;
let pending = null, alive = true, cancelled = false;
const childClosed = new Promise(resolve => child.once('close', (code, signal) => {
  alive = false; manifest.engineExit = { code, signal }; pending?.reject(new Error(`Engine closed ${code}/${signal}`)); resolve();
}));
child.on('error', error => pending?.reject(error));
child.stdin.on('error', error => pending?.reject(error));
child.stderr.on('data', bytes => fs.appendFileSync(path.join(out, 'stderr.log'), bytes));
const cancel = () => { cancelled = true; pending?.reject(new Error('Recording cancelled')); child.kill(); };
process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
readline.createInterface({ input: child.stdout }).on('line', line => {
  fs.appendFileSync(path.join(out, 'responses.ndjson'), line + '\n');
  let result;
  try { result = JSON.parse(line); } catch (error) { pending?.reject(error); return; }
  if (result.isDuringSearch || (result.warning && !result.error && !result.rootInfo)) return;
  if (!pending || result.id !== pending.id) { pending?.reject(new Error('Unexpected response')); return; }
  const item = pending; pending = null;
  if (result.error || !result.rootInfo || result.ownership?.length !== 361) item.reject(new Error(`Invalid final ${result.id}`));
  else item.resolve(result);
});
save();
try {
  for (const request of queries) {
    if (!alive || cancelled) throw new Error('Engine unavailable');
    fs.appendFileSync(path.join(out, 'queries.ndjson'), JSON.stringify(request) + '\n');
    manifest.queryCount++; save();
    console.log(`START ${request.id} visits=${request.maxVisits}`);
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending = null; reject(new Error(`Timeout ${request.id}`)); child.kill(); }, 300_000);
      pending = { id: request.id, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
      child.stdin.write(JSON.stringify(request) + '\n');
    });
    const expected = matches.get(request.id);
    if (result.rootInfo.thisHash !== expected.rootHash || !result.moveInfos.some(move => move.move === expected.forcedMove)) {
      throw new Error(`Forced query changed root hash or omitted requested move: ${request.id}`);
    }
    manifest.completedIds.push(result.id); save();
    console.log(`DONE ${request.id} top=${result.moveInfos.find(move => move.order === 0)?.move}`);
  }
  manifest.state = 'complete';
} catch (error) {
  manifest.state = cancelled ? 'cancelled' : 'failed'; manifest.error = String(error); process.exitCode = 1; child.kill(); console.error(error);
} finally {
  child.stdin.end();
  const forceStop = setTimeout(() => { if (alive) child.kill(); }, 3_000);
  let shutdownTimer;
  await Promise.race([childClosed, new Promise(resolve => {
    shutdownTimer = setTimeout(() => { manifest.shutdownUnconfirmed = true; manifest.state = 'failed'; process.exitCode = 1; resolve(); }, 10_000);
  })]);
  clearTimeout(forceStop); clearTimeout(shutdownTimer);
  process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
  manifest.finishedAt = new Date().toISOString();
  manifest.files = Object.fromEntries(fs.readdirSync(out).filter(name => name !== 'manifest.json').map(name => [name, {
    sha256: hashFile(path.join(out, name)), bytes: fs.statSync(path.join(out, name)).size,
  }]));
  save();
  if (manifest.shutdownUnconfirmed) {
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
    console.error(`Shutdown unconfirmed; do not release engine PID ${manifest.enginePid}`);
  }
}
