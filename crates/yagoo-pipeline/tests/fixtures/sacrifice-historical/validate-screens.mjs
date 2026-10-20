import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(folder, '../../../../../packages/ui/package.json'));
const Board = require('@sabaki/go-board');
const out = path.resolve(process.argv[2]);
if (!out.startsWith(folder + path.sep)) throw new Error('Recording must be inside candidate research folder');
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
const allPlan = JSON.parse(fs.readFileSync(path.join(folder, 'screen-plan.json'), 'utf8'));
const selectedIds = manifest.requestedCaseIds ?? allPlan.map(spec => spec.id);
if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some(id => !allPlan.some(spec => spec.id === id))) throw new Error('Invalid selected case ids');
const plan = allPlan.filter(spec => selectedIds.includes(spec.id));
const provenance = JSON.parse(fs.readFileSync(path.join(folder, 'source-provenance.json'), 'utf8'));
const lines = file => fs.readFileSync(path.join(out, file), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const queries = lines('queries.ndjson'), envelopes = lines('responses.ndjson');
const results = envelopes.filter(response => response.rootInfo && !response.isDuringSearch);
const warnings = envelopes.filter(response => response.warning && !response.rootInfo);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cols = 'ABCDEFGHJKLMNOPQRST';
const gtp = ([x, y]) => `${cols[x]}${19 - y}`;
const vertex = move => move.toLowerCase() === 'pass' ? [-1, -1] : [cols.indexOf(move[0]), 19 - Number(move.slice(1))];
const replay = moves => {
  let board = Board.fromDimensions(19);
  for (const [color, move] of moves) board = board.makeMove(color === 'B' ? 1 : -1, vertex(move), {
    preventKo: true, preventOverwrite: true, preventSuicide: true,
  });
  return board;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const arrayCheck = (values, name) => assert(values?.length === 361 && values.every(Number.isFinite), `${name}: ownership missing`);
assert(manifest.state === 'complete' && !manifest.shutdownUnconfirmed, 'Recording incomplete');
assert(manifest.cases.length === plan.length && manifest.cases.every(item => selectedIds.includes(item.id)), 'Recorded case selection mismatch');
if (manifest.candidateSelectionSha256) assert(hash(fs.readFileSync(path.join(folder, 'screen-plan.json'))) === manifest.candidateSelectionSha256, 'Candidate selection hash mismatch');
if (manifest.sourceProvenanceSha256) assert(hash(fs.readFileSync(path.join(folder, 'source-provenance.json'))) === manifest.sourceProvenanceSha256, 'Source provenance hash mismatch');
assert(envelopes.every(response => !response.error), 'Engine error envelope present');
assert(queries.length === plan.length * 3 && results.length === queries.length, 'Response count mismatch');
assert(new Set(queries.map(query => query.id)).size === queries.length, 'Duplicate query id');
for (const [file, metadata] of Object.entries(manifest.files)) {
  assert(hash(fs.readFileSync(path.join(out, file))) === metadata.sha256, `${file}: hash mismatch`);
}
for (const request of queries) {
  const result = results.find(response => response.id === request.id);
  assert(result && !result.error, `${request.id}: missing result`);
  assert(request.rules === 'chinese' && request.komi === 0 && request.initialStones.length === 0, 'Unexpected settings');
  arrayCheck(result.ownership, request.id);
  assert(Number.isFinite(result.rootInfo.scoreLead) && Number.isFinite(result.rootInfo.winrate), 'Invalid root value');
  replay(request.moves);
}
const cases = [];
for (const spec of plan) {
  const rootQuery = queries.find(query => query.id === `${spec.id}-root`);
  const root = results.find(response => response.id === `${spec.id}-root`);
  const endpoint = results.find(response => response.id === `${spec.id}-pv-end`);
  const best = root.moveInfos.find(move => move.order === 0);
  const sign = spec.ply % 2 ? 1 : -1, mover = sign === 1 ? 'B' : 'W';
  const source = fs.readFileSync(path.join(folder, spec.sgf), 'utf8');
  const sourceHash = hash(fs.readFileSync(path.join(folder, spec.sgf)));
  assert(sourceHash === manifest.cases.find(item => item.id === spec.id).sourceSha256 &&
    sourceHash === provenance.records.find(record => record.analysisFile === spec.sgf).analysisSha256,
  `${spec.id}: source hash mismatch`);
  const historical = [...source.matchAll(/;([BW])\[([a-s]{2}|)\]/g)].map(([, color, point]) =>
    [color, point ? gtp([point.charCodeAt(0) - 97, point.charCodeAt(1) - 97]) : 'pass']);
  assert(same(rootQuery.moves, historical.slice(0, spec.ply - 1)), 'History does not match source prefix');
  assert(same(queries.find(query => query.id === `${spec.id}-pv-end`).moves,
    [...rootQuery.moves, ...best.pv.map((move, index) => [index % 2 ? (mover === 'B' ? 'W' : 'B') : mover, move])]), 'Endpoint history mismatch');
  assert(same(queries.find(query => query.id === `${spec.id}-pass`).moves,
    [...rootQuery.moves, [mover, 'pass']]), 'Pass history mismatch');
  arrayCheck(best.ownership, `${spec.id}: preferred`);
  const recorded = manifest.cases.find(item => item.id === spec.id);
  const board = replay(rootQuery.moves), groups = [], unseen = new Set();
  let pvBoard = board;
  const identities = new Map(), derivedCaptures = [], derivedNewCaptures = [];
  for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
    if (board.signMap[y][x] === sign) identities.set(gtp([x, y]), 0);
  }
  for (let index = 0; index < best.pv.length; index++) {
    const move = best.pv[index], moveSign = index % 2 ? -sign : sign;
    const next = pvBoard.makeMove(moveSign, vertex(move), {
      preventKo: true, preventOverwrite: true, preventSuicide: true,
    });
    for (const [point, bornAt] of identities) {
      const [x, y] = vertex(point);
      if (next.signMap[y][x] !== sign) {
        if (bornAt === 0) derivedCaptures.push({ point, pvPly: index + 1, capturingMove: move });
        else derivedNewCaptures.push({ point, bornAtPvPly: bornAt, capturedAtPvPly: index + 1, capturingMove: move });
        identities.delete(point);
      }
    }
    if (moveSign === sign && move.toLowerCase() !== 'pass') identities.set(move, index + 1);
    pvBoard = next;
  }
  const byIdentity = rows => [...rows].sort((a, b) => a.point.localeCompare(b.point) ||
    (a.pvPly ?? a.capturedAtPvPly) - (b.pvPly ?? b.capturedAtPvPly));
  assert(same(byIdentity(derivedCaptures), byIdentity(recorded.capturedMoverRootStones.map(({ point, pvPly, capturingMove }) =>
    ({ point, pvPly, capturingMove })))), `${spec.id}: original-stone lineage mismatch`);
  assert(same(byIdentity(derivedNewCaptures), byIdentity(recorded.capturedMoverNewStones.map(({ point, bornAtPvPly, capturedAtPvPly, capturingMove }) =>
    ({ point, bornAtPvPly, capturedAtPvPly, capturingMove })))), `${spec.id}: new-stone lineage mismatch`);
  const lastCapture = Math.max(0, ...derivedCaptures.map(capture => capture.pvPly), ...derivedNewCaptures.map(capture => capture.capturedAtPvPly));
  assert(Array.isArray(best.pvVisits) && best.pvVisits.length >= lastCapture, `${spec.id}: missing PV visit evidence through capture`);
  for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) if (board.signMap[y][x] === sign) unseen.add(y * 19 + x);
  while (unseen.size) {
    const first = unseen.values().next().value, stack = [first], group = [];
    unseen.delete(first);
    while (stack.length) {
      const point = stack.pop(), x = point % 19, y = Math.floor(point / 19);
      group.push(point);
      for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
        const adjacent = ny * 19 + nx;
        if (nx >= 0 && nx < 19 && ny >= 0 && ny < 19 && unseen.delete(adjacent)) stack.push(adjacent);
      }
    }
    groups.push(group);
  }
  const groupEvidence = groups.map(points => {
    const stoneNames = points.map(point => gtp([point % 19, Math.floor(point / 19)]));
    const captured = recorded.capturedMoverRootStones.filter(capture => stoneNames.includes(capture.point));
    if (!captured.length) return null;
    const groupMean = values => average(points.map(point => values[point] * sign));
    const preferredMean = groupMean(best.ownership), rootMean = groupMean(root.ownership), endpointMean = groupMean(endpoint.ownership);
    const alternatives = root.moveInfos.filter(move => move.move !== best.move && move.ownership?.length === 361)
      .map(move => {
        const savingMean = groupMean(move.ownership);
        const captureHorizon = Math.max(...captured.map(capture => capture.pvPly));
        let retainedThroughCaptureHorizon = move.pv.length < captureHorizon ? null : true;
        let alternativeBoard = board;
        for (let step = 0; step < Math.min(move.pv.length, captureHorizon); step++) {
          alternativeBoard = alternativeBoard.makeMove(step % 2 ? -sign : sign, vertex(move.pv[step]), {
            preventKo: true, preventOverwrite: true, preventSuicide: true,
          });
          if (points.some(point => alternativeBoard.signMap[Math.floor(point / 19)][point % 19] !== sign)) {
            retainedThroughCaptureHorizon = false;
            break;
          }
        }
        let elsewhereOwnershipDeltaSum = 0;
        const members = new Set(points);
        for (let index = 0; index < 361; index++) if (!members.has(index)) {
          elsewhereOwnershipDeltaSum += (best.ownership[index] - move.ownership[index]) * sign;
        }
        return { move: move.move, order: move.order, visits: move.visits, ownMean: savingMean,
          pv: move.pv, pvVisits: move.pvVisits, retainedThroughCaptureHorizon,
          preferredMinusAlternativeScoreMover: (best.scoreLead - move.scoreLead) * sign,
          preferredMinusAlternativeWinrateMover: (best.winrate - move.winrate) * sign,
          elsewhereOwnershipDeltaSum,
          sacrificedGroupOwnershipCost: (savingMean - preferredMean) * points.length,
          ownershipGateOnlyAtFixedThresholds: points.length >= 2 && savingMean >= 0.6 && preferredMean <= -0.4 &&
            savingMean - preferredMean >= 1 && endpointMean <= -0.6 };
      }).sort((a, b) => b.ownMean - a.ownMean);
    return { stones: stoneNames, rootMean, preferredMean, endpointMean, captured,
      minimumPvVisitsThroughCapture: Math.min(...best.pvVisits.slice(0, Math.max(...captured.map(capture => capture.pvPly)))),
      alternatives };
  }).filter(Boolean);
  cases.push({ id: spec.id, actualMove: historical[spec.ply - 1][1], preferredMove: best.move,
    preferredVisits: best.visits, rootScoreBlack: root.rootInfo.scoreLead, preferredScoreBlack: best.scoreLead,
    preferredWinrateBlack: best.winrate, endpointScoreBlack: endpoint.rootInfo.scoreLead,
    endpointWinrateBlack: endpoint.rootInfo.winrate, pv: best.pv, pvVisits: best.pvVisits, capturedRootGroups: groupEvidence,
    capturedMoverNewStones: recorded.capturedMoverNewStones,
    assessment: 'Unlabelled candidate evidence; threshold contrast is not expert ground truth or a confirmed sacrifice.' });
}
const report = { valid: true, engineShutdownConfirmed: true, queries: queries.length, finalResponses: results.length,
  warningEnvelopes: warnings.length, sourceCount: new Set(plan.map(spec => spec.sgf)).size, cases };
fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
