// Offline candidate selection only. Low liberties plus tenuki is not a sacrifice label.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(folder, '../../../../../packages/ui/package.json'));
const Board = require('@sabaki/go-board');
const records = JSON.parse(fs.readFileSync(path.join(folder, 'capture-map.json'), 'utf8'));
const cols = 'ABCDEFGHJKLMNOPQRST';
const vertex = move => move === 'pass' ? [-1,-1] : [cols.indexOf(move[0]), 19 - Number(move.slice(1))];
const gtp = point => `${cols[point % 19]}${19 - Math.floor(point / 19)}`;
const all = [];
for (const record of records) {
  let board = Board.fromDimensions(19);
  const seen = new Set();
  for (const { ply, color, move } of record.moves) {
    const sign = color === 'B' ? 1 : -1, [mx, my] = vertex(move), unseen = new Set();
    for (let y=0;y<19;y++) for(let x=0;x<19;x++) if(board.signMap[y][x]===sign) unseen.add(y*19+x);
    while (unseen.size) {
      const start=unseen.values().next().value, stack=[start], group=[], liberties=new Set();
      unseen.delete(start);
      while(stack.length) {
        const point=stack.pop(),x=point%19,y=Math.floor(point/19); group.push(point);
        for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
          if(nx<0||nx>=19||ny<0||ny>=19) continue;
          const next=ny*19+nx;
          if(board.signMap[ny][nx]===0) liberties.add(next);
          else if(unseen.delete(next)) stack.push(next);
        }
      }
      const distance=Math.min(...group.map(point=>Math.abs(point%19-mx)+Math.abs(Math.floor(point/19)-my)));
      const key=group.sort((a,b)=>a-b).join(',');
      if(group.length>=2 && liberties.size<=2 && distance>=4 && !seen.has(key)) {
        seen.add(key);
        all.push({file:record.file,ply,color,move,stones:group.map(gtp),liberties:[...liberties].map(gtp),distance});
      }
    }
    board=board.makeMove(sign,[mx,my],{preventKo:true,preventOverwrite:true,preventSuicide:true});
  }
}
fs.writeFileSync(path.join(folder,'threat-candidates.json'),JSON.stringify(all,null,2)+'\n');
console.log(JSON.stringify(all,null,2));
