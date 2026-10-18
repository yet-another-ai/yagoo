import type { BoardMap, HeatVertex, Vertex } from "../types";
import type { WinratePoint } from "../layout/WinrateGraph.vue";

/** Tiny 9×9 teaching sample with a comment and a side variation. */
export const SAMPLE_SGF = `(;FF[4]GM[1]SZ[9]
PB[AlphaGo]PW[Lee Sedol]BR[]WR[9p]
C[Demo game for the Yagoo reviewer layout.]
;B[dd]C[Black takes the upper-left corner.]
;W[ff]
;B[df]
;W[fd]C[White approaches.]
;B[cc]
;W[gg]
;B[fc]C[Connect — this shape is the demo "group" (块).]
;W[ee]
)`;

/** Static winrate series for the WinrateGraph demo (not from an engine). */
export const SAMPLE_WINRATE: WinratePoint[] = [
  { winrate: 50, change: 0 },
  { winrate: 52, change: 2 },
  { winrate: 48, change: -4 },
  { winrate: 55, change: 7 },
  { winrate: 53, change: -2 },
  { winrate: 58, change: 5 },
  { winrate: 61, change: 3 },
  { winrate: 57, change: -4 },
  { winrate: 63, change: 6 },
];

/** Stones around F3/C3/F7 used for the group-outline overlay demo (9×9). */
export const SAMPLE_GROUP_OUTLINE: Vertex[] = [
  [5, 2], // fc
  [3, 3], // dd area neighbors for a visible L
  [5, 3], // fd
];

export function sampleHeatMap(size = 9): BoardMap<HeatVertex | null> {
  const map: BoardMap<HeatVertex | null> = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );
  map[2]![5] = { strength: 9, text: "42%\n1.2k" };
  map[4]![4] = { strength: 4, text: "11%" };
  return map;
}
