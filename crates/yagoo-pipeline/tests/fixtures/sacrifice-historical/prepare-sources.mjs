import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(folder, '../../../../../packages/ui/package.json'));
const sgf = require('@sabaki/sgf');
const files = [
  ['shusaku-gennan-1846', 'https://homepages.cwi.nl/~aeb/go/games/games/Shusaku/126.sgf'],
  ['akaboshi-jowa-1835', 'https://homepages.cwi.nl/~aeb/go/games/games/ancient/Honinbo_Jowa/276.sgf'],
  ['dosaku-santetsu-1669', 'https://homepages.cwi.nl/~aeb/go/games/games/Dosaku/047.sgf'],
  ['chitetsu-dosaku-1668', 'https://homepages.cwi.nl/~aeb/go/games/games/Dosaku/024.sgf'],
];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const records = [];
for (const [stem, url] of files) {
  const original = fs.readFileSync(path.join(folder, `${stem}.original.sgf`));
  const root = sgf.parse(original.toString('utf8'))[0];
  let node = root;
  const moves = [];
  while (node) {
    if (node.data.B || node.data.W) {
      const color = node.data.B ? 'B' : 'W';
      moves.push(`;${color}[${sgf.escapeString(node.data[color][0])}]`);
    }
    if (node.children.length > 1) throw new Error('Unexpected variation');
    node = node.children[0];
  }
  const normalized = `(;FF[4]GM[1]SZ[19]KM[0]RU[Chinese]GN[${stem}; analysis rules explicitly Chinese]` +
    ['PB', 'BR', 'PW', 'WR', 'RE', 'DT'].filter(key => root.data[key]).map(key =>
      `${key}[${sgf.escapeString(root.data[key][0])}]`).join('') + '\n' + moves.join('\n') + ')\n';
  fs.writeFileSync(path.join(folder, `${stem}.chinese.sgf`), normalized);
  records.push({
    originalFile: `${stem}.original.sgf`, originalSha256: hash(original), originalBytes: original.length,
    sourceUrl: url, moveCount: moves.length, sourceMetadata: root.data,
    analysisFile: `${stem}.chinese.sgf`, analysisSha256: hash(normalized),
    changesForAnalysis: 'Preserve exact mainline move order, colors and coordinates; make SZ[19], KM[0] and RU[Chinese] explicit. These are chosen analysis settings consistent with the existing corpus, not a claim about historical rules. No commentary or variations added.',
  });
}
fs.writeFileSync(path.join(folder, 'source-provenance.json'), JSON.stringify({
  preparedAt: new Date().toISOString(),
  archive: 'https://homepages.cwi.nl/~aeb/go/games/',
  archiveRightsStatement: 'The archive states that its games are in the public domain and the collector claims no rights on the collection.',
  scope: 'Research-only source records and candidate selection. No position has been labelled an expert-confirmed positive sacrifice.',
  candidateReferences: [
    {
      url: 'https://www.inaf-go.org/2021/09/new-lectures-by-michael-redmond-9p-and-tsuruyama-atsushi-8p-sponsored-by-inaf/',
      kind: 'Primary lecture sponsor announcement',
      relevance: 'INAF identifies a Nihon Kiin lecture by Michael Redmond 9p about sacrifice in a Dosaku–Yasui Santetsu game. This verifies the topic and players, not the precise move numbers.',
      video: 'https://www.youtube.com/watch?v=C-nS2xpqfQ4',
    },
    {
      url: 'https://gomagic.org/dosaku-the-go-saint/',
      kind: 'Secondary candidate-selection lead, not positive ground truth',
      relevance: 'Connects the lecture to 1669-09-16 and also discusses sacrifice in the 1668-07-10 Chitetsu game. Exact positions still require replay and independent evidence.',
    },
    {
      url: 'https://raw.githubusercontent.com/lightvector/KataGo/master/docs/Analysis_Engine.md',
      kind: 'Primary engine protocol documentation',
      relevance: 'Root and move ownership are predictions. Therefore an ownership flip alone does not establish sacrifice intent, and a healthy-root requirement can miss an already-foreseen sacrifice.',
    },
  ],
  records,
}, null, 2) + '\n');
console.log(JSON.stringify(records.map(({ originalFile, moveCount, originalSha256, analysisSha256 }) => ({
  originalFile, moveCount, originalSha256, analysisSha256,
})), null, 2));
