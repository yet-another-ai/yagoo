import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(folder, '../../../../../packages/ui/package.json'));
const sgf = require('@sabaki/sgf');
const Board = require('@sabaki/go-board');
const cols = 'ABCDEFGHJKLMNOPQRST';
const loc = ([x, y]) => `${cols[x]}${19 - y}`;
const results = [];
for (const file of fs.readdirSync(folder).filter(file => file.endsWith('.original.sgf'))) {
  const text = fs.readFileSync(path.join(folder, file), 'utf8');
  const roots = sgf.parse(text);
  if (roots.length !== 1) throw new Error(`${file}: multiple trees`);
  let board = Board.fromDimensions(19), node = roots[0], ply = 0;
  const births = new Map(), moves = [], captures = [], positions = [];
  const originalMetadata = node.data;
  if (Number(originalMetadata.SZ?.[0] ?? 19) !== 19 || ['AB', 'AW', 'AE'].some(k => originalMetadata[k])) throw new Error('Unsupported setup');
  while (node) {
    if (node.data.B || node.data.W) {
      const sign = node.data.B ? 1 : -1, color = sign === 1 ? 'B' : 'W';
      const raw = (node.data.B ?? node.data.W)[0], vertex = sgf.parseVertex(raw);
      const next = board.makeMove(sign, vertex, { preventOverwrite: true, preventSuicide: true, preventKo: true });
      ply++;
      const move = raw ? loc(vertex) : 'pass';
      const removed = [];
      for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
        if (board.signMap[y][x] && !next.signMap[y][x]) {
          const point = loc([x, y]);
          removed.push({ point, color: board.signMap[y][x] === 1 ? 'B' : 'W', bornAt: births.get(point) });
          births.delete(point);
        }
      }
      births.set(move, ply);
      moves.push({ ply, color, move });
      if (removed.length) captures.push({ ply, color, move, removed, previous: moves.slice(-12, -1) });
      board = next;
      positions.push(board.signMap);
    }
    if (node.children.length > 1) throw new Error(`${file}: unexpected variation`);
    node = node.children[0];
  }
  const result = { file, originalMetadata, moveCount: ply, captures, moves };
  results.push(result);
  console.log(JSON.stringify({ file, moveCount: ply, captures: captures.filter(c => c.removed.length >= 2) }, null, 2));
}
fs.writeFileSync(path.join(folder, 'capture-map.json'), JSON.stringify(results, null, 2) + '\n');
