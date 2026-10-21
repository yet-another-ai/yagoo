/** Authentic candidate screening only. Requires exclusive engine ownership; never runs in CI. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(folder, '../../yagoo-variations/packages/ui/package.json'));
const Board = require('@sabaki/go-board');
const args = {};
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index].slice(2);
  if (!process.argv[index].startsWith('--') || !['engine', 'model', 'out', 'visits', 'plan-only'].includes(name)) {
    throw new Error(`Unknown argument ${process.argv[index]}`);
  }
  if (name === 'plan-only') {
    args[name] = true;
    if (process.argv[index + 1] === 'true') index++;
  } else {
    const value = process.argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    args[name] = value;
  }
}
if (process.env.CI) throw new Error('Live candidate screening is forbidden in CI');
const specs = JSON.parse(fs.readFileSync(path.join(folder, 'screen-plan.json'), 'utf8'));
const visits = Number(args.visits ?? 64), cols = 'ABCDEFGHJKLMNOPQRST';
if (!Number.isSafeInteger(visits) || visits < 8 || visits > 512) throw new Error('Invalid visits');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaFile = file => hash(fs.readFileSync(file));
const gtp = ([x, y]) => `${cols[x]}${19 - y}`;
const vertex = move => move.toLowerCase() === 'pass' ? [-1, -1] : [cols.indexOf(move[0]), 19 - Number(move.slice(1))];
const opposite = color => color === 'B' ? 'W' : 'B';
const own = (values, point, mover) => values[vertex(point)[1] * 19 + vertex(point)[0]] * (mover === 'B' ? 1 : -1);
const replayMove = (board, color, move) => board.makeMove(color === 'B' ? 1 : -1, vertex(move), {
  preventOverwrite: true, preventSuicide: true, preventKo: true,
});
for (const spec of specs) {
  const text = fs.readFileSync(path.join(folder, spec.sgf), 'utf8');
  const moves = [...text.matchAll(/;([BW])\[([a-s]{2}|)\]/g)].map(([, color, point]) =>
    [color, point ? gtp([point.charCodeAt(0) - 97, point.charCodeAt(1) - 97]) : 'pass']);
  if (moves.some(([color], index) => color !== (index % 2 ? 'W' : 'B'))) throw new Error('Nonalternating source');
  spec.moves = moves;
  spec.history = moves.slice(0, spec.ply - 1);
  spec.mover = moves[spec.ply - 1][0];
  spec.actualMove = moves[spec.ply - 1][1];
  spec.sourceSha256 = shaFile(path.join(folder, spec.sgf));
  let board = Board.fromDimensions(19);
  for (const [color, move] of spec.history) board = replayMove(board, color, move);
}
if (args['plan-only']) {
  console.log(JSON.stringify(specs.map(({ id, sgf, ply, mover, actualMove, history }) => ({
    id, sgf, ply, mover, actualMove, rootPly: history.length,
  })), null, 2));
  process.exit(0);
}
for (const name of ['engine', 'model', 'out']) if (!args[name]) throw new Error(`Missing --${name}`);
const out = path.resolve(args.out), engine = path.resolve(args.engine), model = path.resolve(args.model);
if (!out.startsWith(folder + path.sep)) throw new Error('Output must remain in the authorized research folder');
if (fs.existsSync(out)) throw new Error('Refusing to overwrite a recording');
fs.mkdirSync(out);
const config = fs.readFileSync(path.join(folder, '../recorded-comparison-sacrifice/analysis.cfg'), 'utf8');
fs.writeFileSync(path.join(out, 'analysis.cfg'), config);
fs.copyFileSync(fileURLToPath(import.meta.url), path.join(out, 'screen-positions.mjs'));
const version = spawnSync(engine, ['version'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
if (version.error || version.status !== 0) throw version.error ?? new Error(version.stderr);
fs.writeFileSync(path.join(out, 'engine-version.txt'), version.stdout + version.stderr);
const manifest = {
  schemaVersion: 1, state: 'recording', startedAt: new Date().toISOString(),
  purpose: 'Targeted real-game candidate screening, not expert-labelled positive calibration.',
  engine: { path: engine, sha256: shaFile(engine), version: version.stdout.trim() },
  model: { path: model, sha256: shaFile(model) },
  rules: 'chinese', komi: 0, boardSize: 19, visits, rootSymmetries: 8,
  fullHistory: true, perspective: 'BLACK', ownershipLayout: 'row-major A19 through T1',
  sourceProvenance: '../source-provenance.json',
  candidateSelection: '../screen-plan.json',
  queryCount: 0, cases: [],
};
const save = () => fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const child = spawn(engine, ['analysis', '-model', model, '-config', path.join(out, 'analysis.cfg')], {
  cwd: out, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
let pending = null, alive = true, cancellationSignal = null;
manifest.enginePid = child.pid ?? null;
const childClosed = new Promise(resolve => child.once('close', (code, signal) => {
  alive = false;
  manifest.engineExit = { code, signal };
  pending?.reject(new Error(`Engine closed ${code}/${signal}`));
  resolve();
}));
child.stderr.on('data', data => fs.appendFileSync(path.join(out, 'stderr.log'), data));
child.on('error', error => pending?.reject(error));
const cancel = signal => {
  cancellationSignal = signal;
  pending?.reject(new Error(`Recording cancelled by ${signal}`));
  child.kill();
};
const onSigint = () => cancel('SIGINT'), onSigterm = () => cancel('SIGTERM');
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);
child.stdin.on('error', error => pending?.reject(error));
save();
readline.createInterface({ input: child.stdout }).on('line', line => {
  fs.appendFileSync(path.join(out, 'responses.ndjson'), line + '\n');
  let response;
  try { response = JSON.parse(line); } catch (error) { pending?.reject(error); return; }
  if (response.isDuringSearch) return;
  // KataGo can emit warning envelopes with no root result before the final response.
  if (response.warning && !response.error && !response.rootInfo) return;
  if (!pending || response.id !== pending.id) { pending?.reject(new Error('Unexpected response id')); return; }
  const item = pending; pending = null;
  if (response.error) item.reject(new Error(JSON.stringify(response)));
  else item.resolve(response);
});
async function query(id, moves) {
  if (cancellationSignal) throw new Error(`Recording cancelled by ${cancellationSignal}`);
  if (!alive) throw new Error('Engine already closed');
  const request = {
    id, initialStones: [], moves, rules: 'chinese', komi: 0, boardXSize: 19, boardYSize: 19,
    maxVisits: visits, includeOwnership: true, includeMovesOwnership: true,
    includeOwnershipStdev: true, includeMovesOwnershipStdev: true, includePVVisits: true, analysisPVLen: 15,
  };
  fs.appendFileSync(path.join(out, 'queries.ndjson'), JSON.stringify(request) + '\n');
  manifest.queryCount++;
  console.log(`START ${id} full-history=${moves.length}`);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null;
      reject(new Error(`Query timeout: ${id}`));
      child.kill();
    }, 300_000);
    pending = { id, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
    child.stdin.write(JSON.stringify(request) + '\n');
  });
  if (result.ownership?.length !== 361 || !Number.isFinite(result.rootInfo?.scoreLead)) throw new Error('Incomplete engine response');
  console.log(`DONE ${id} top=${result.moveInfos?.find(move => move.order === 0)?.move}`);
  return result;
}
try {
  for (const spec of specs) {
    const root = await query(`${spec.id}-root`, spec.history);
    const best = root.moveInfos.find(move => move.order === 0);
    if (!best?.pv?.length || best.pv[0] !== best.move) throw new Error('Missing preferred PV');
    const pvHistory = [...spec.history, ...best.pv.map((move, index) => [index % 2 ? opposite(spec.mover) : spec.mover, move])];
    const endpoint = await query(`${spec.id}-pv-end`, pvHistory);
    const pass = await query(`${spec.id}-pass`, [...spec.history, [spec.mover, 'pass']]);
    let board = Board.fromDimensions(19);
    for (const [color, move] of spec.history) board = replayMove(board, color, move);
    const rootStones = new Set();
    for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
      if (board.signMap[y][x] === (spec.mover === 'B' ? 1 : -1)) rootStones.add(gtp([x, y]));
    }
    const captures = [], created = new Map(), capturedMoverNewStones = [];
    for (let i = 0; i < best.pv.length; i++) {
      const sign = (i % 2 ? opposite(spec.mover) : spec.mover) === 'B' ? 1 : -1;
      const next = replayMove(board, sign === 1 ? 'B' : 'W', best.pv[i]);
      for (const point of rootStones) {
        const [x, y] = vertex(point);
        if (board.signMap[y][x] && !next.signMap[y][x]) {
          captures.push({ point, pvPly: i + 1, capturingMove: best.pv[i],
            rootOwn: own(root.ownership, point, spec.mover),
            preferredOwn: own(best.ownership, point, spec.mover),
            endpointOwn: own(endpoint.ownership, point, spec.mover),
          });
          rootStones.delete(point);
        }
      }
      for (const [point, bornAtPvPly] of created) {
        const [x, y] = vertex(point);
        if (board.signMap[y][x] && !next.signMap[y][x]) {
          capturedMoverNewStones.push({ point, bornAtPvPly, capturedAtPvPly: i + 1,
            capturingMove: best.pv[i], endpointOwn: own(endpoint.ownership, point, spec.mover) });
          created.delete(point);
        }
      }
      if (sign === (spec.mover === 'B' ? 1 : -1) && best.pv[i].toLowerCase() !== 'pass') {
        created.set(best.pv[i], i + 1);
      }
      board = next;
    }
    manifest.cases.push({
      id: spec.id, sgf: spec.sgf, sourceSha256: spec.sourceSha256, actualPly: spec.ply, rootPly: spec.history.length,
      actualMove: spec.actualMove, mover: spec.mover, preferredMove: best.move, preferredVisits: best.visits,
      pv: best.pv, pvVisits: best.pvVisits, capturedMoverRootStones: captures, capturedMoverNewStones,
      rootScoreBlack: root.rootInfo.scoreLead, preferredScoreBlack: best.scoreLead, endpointScoreBlack: endpoint.rootInfo.scoreLead,
      preferredVsPassScoreMover: (best.scoreLead - pass.rootInfo.scoreLead) * (spec.mover === 'B' ? 1 : -1),
      healthyRootCaptureCount: captures.filter(capture => capture.rootOwn > 0.4).length,
      caveat: 'Score/ownership diagnostics are not sacrifice labels. Endpoint search is later-root evidence, not same-root move loss.',
    });
    save();
  }
  manifest.state = 'complete';
} catch (error) {
  manifest.state = cancellationSignal ? 'cancelled' : 'failed'; manifest.error = String(error); process.exitCode = 1;
  console.error(error); child.kill();
} finally {
  child.stdin.end();
  const forceStop = setTimeout(() => { if (alive) child.kill(); }, 3_000);
  let shutdownTimeout;
  await Promise.race([
    childClosed,
    new Promise(resolve => {
      shutdownTimeout = setTimeout(() => {
        manifest.shutdownUnconfirmed = true;
        manifest.state = 'failed';
        process.exitCode = 1;
        resolve();
      }, 10_000);
    }),
  ]);
  clearTimeout(forceStop);
  clearTimeout(shutdownTimeout);
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
  manifest.finishedAt = new Date().toISOString();
  manifest.files = Object.fromEntries(fs.readdirSync(out).filter(file => file !== 'manifest.json').map(file => [file, {
    sha256: shaFile(path.join(out, file)), bytes: fs.statSync(path.join(out, file)).size,
  }]));
  save();
  if (manifest.shutdownUnconfirmed) {
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    console.error(`Engine shutdown unconfirmed; exclusive ownership must remain held until PID ${manifest.enginePid} is verified stopped.`);
  }
}
