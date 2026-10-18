/**
 * Fuzzy stone placement / collision logic ported from SabakiHQ/Shudan (MIT).
 *
 * Shift codes `1..8` map to CSS classes `shudan-shift_1..8` (directional offsets).
 * `0` means centered (no fuzzy offset).
 *
 * When a stone is placed with a direction that would overlap a neighbor's
 * opposing offset, `readjustShifts` zeros the neighbor's shift (the "nudge").
 */

import type { BoardMap, Vertex } from "../types";
import { range } from "./helper";

export type Shift = number;
export type ShiftMap = BoardMap<Shift>;
export type RandomMap = BoardMap<number>;

export type Rng = () => number;

/**
 * Mulberry32 — tiny seeded PRNG. Returns floats in `[0, 1)`.
 * Same seed → same sequence (deterministic re-renders / tests).
 */
export function createRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive integer in `[0, n]` — Shudan `random(n)`. */
export function randomInt(n: number, rng: Rng = Math.random): number {
  return Math.floor(rng() * (n + 1));
}

/**
 * Resolve overlapping fuzzy offsets.
 *
 * Shudan algorithm: for each direction the current vertex leans toward a
 * neighbor, if that neighbor leans back (or diagonally into the shared edge),
 * clear the neighbor's shift so stones do not collide.
 */
export function readjustShifts(
  shiftMap: ShiftMap,
  vertex: Vertex | null = null,
): ShiftMap {
  if (vertex == null) {
    for (let y = 0; y < shiftMap.length; y++) {
      const row = shiftMap[y]!;
      for (let x = 0; x < row.length; x++) {
        readjustShifts(shiftMap, [x, y]);
      }
    }
  } else {
    const [x, y] = vertex;
    const direction = shiftMap[y]![x]!;

    const data: Array<[number[], Vertex, number[]]> = [
      // Left
      [[1, 5, 8], [x - 1, y], [3, 7, 6]],
      // Top
      [[2, 5, 6], [x, y - 1], [4, 7, 8]],
      // Right
      [[3, 7, 6], [x + 1, y], [1, 5, 8]],
      // Bottom
      [[4, 7, 8], [x, y + 1], [2, 5, 6]],
    ];

    for (const [directions, [qx, qy], removeShifts] of data) {
      if (!directions.includes(direction)) continue;

      const neighborRow = shiftMap[qy!];
      if (
        neighborRow != null &&
        removeShifts.includes(neighborRow[qx!]!)
      ) {
        neighborRow[qx!] = 0;
      }
    }
  }

  return shiftMap;
}

/** Initial board-wide fuzzy offsets (Shudan board-size-change path). */
export function createShiftMap(
  width: number,
  height: number,
  rng: Rng = Math.random,
): ShiftMap {
  const shiftMap: ShiftMap = range(height).map(() =>
    range(width).map(() => randomInt(8, rng)),
  );
  return readjustShifts(shiftMap);
}

/** Per-vertex stone image variation seeds in `[0, 1)`. */
export function createRandomMap(
  width: number,
  height: number,
  rng: Rng = Math.random,
): RandomMap {
  return range(height).map(() => range(width).map(() => rng()));
}

/**
 * Assign a fresh fuzzy shift for a newly placed stone and nudge neighbors.
 * Matches Shudan `componentDidUpdate` placement animation:
 *   `shiftMap[y][x] = random(7) + 1; readjustShifts(shiftMap, [x, y]);`
 */
export function applyPlacementShift(
  shiftMap: ShiftMap,
  vertex: Vertex,
  rng: Rng = Math.random,
): ShiftMap {
  const [x, y] = vertex;
  const row = shiftMap[y];
  if (row == null || row[x] === undefined) return shiftMap;

  row[x] = randomInt(7, rng) + 1;
  return readjustShifts(shiftMap, vertex);
}

/** Deep-clone a shift map (tests / immutable snapshots). */
export function cloneShiftMap(shiftMap: ShiftMap): ShiftMap {
  return shiftMap.map((row) => row.slice());
}
