/**
 * Helpers ported from SabakiHQ/Shudan (MIT).
 * See styles/SHUDAN_LICENSE.txt.
 */

import type { BoardMap, Sign, Vertex } from "../types";

export const alpha = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

export const avg = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;

export const range = (n: number): number[] =>
  Array(n)
    .fill(0)
    .map((_, i) => i);

/** Inclusive integer in `[0, n]` — matches Shudan's `random(n)`. */
export const random = (n: number): number =>
  Math.floor(Math.random() * (n + 1));

export const neighborhood = ([x, y]: Vertex): Vertex[] => [
  [x, y],
  [x - 1, y],
  [x + 1, y],
  [x, y - 1],
  [x, y + 1],
];

export const vertexEquals = (
  [x1, y1]: Vertex,
  [x2, y2]: Vertex,
): boolean => x1 === x2 && y1 === y2;

export const signEquals = (...xs: Array<number | null | undefined>): boolean =>
  xs.length === 0
    ? true
    : xs.every((x) => Math.sign(x ?? 0) === Math.sign(xs[0] ?? 0));

export function getHoshis(width: number, height: number): Vertex[] {
  if (Math.min(width, height) <= 6) return [];

  const [nearX, nearY] = [width, height].map((x) => (x >= 13 ? 3 : 2)) as [
    number,
    number,
  ];
  const [farX, farY] = [width - nearX - 1, height - nearY - 1];
  const [middleX, middleY] = [width, height].map((x) => (x - 1) / 2) as [
    number,
    number,
  ];

  const result: Vertex[] = [
    [nearX, farY],
    [farX, nearY],
    [farX, farY],
    [nearX, nearY],
  ];

  if (width % 2 !== 0 && height % 2 !== 0 && width !== 7 && height !== 7) {
    result.push([middleX, middleY]);
  }
  if (width % 2 !== 0 && width !== 7) {
    result.push([middleX, nearY], [middleX, farY]);
  }
  if (height % 2 !== 0 && height !== 7) {
    result.push([nearX, middleY], [farX, middleY]);
  }

  return result;
}

/**
 * Vertices that gained a stone (`0 → ±1`) between two sign maps.
 * Used to trigger placement animation (Shudan `diffSignMap`).
 */
export function diffSignMap(
  before: BoardMap<Sign> | undefined,
  after: BoardMap<Sign> | undefined,
): Vertex[] {
  if (
    before == null ||
    after == null ||
    before === after ||
    before.length === 0 ||
    before.length !== after.length ||
    (before[0]?.length ?? 0) !== (after[0]?.length ?? 0)
  ) {
    return [];
  }

  const result: Vertex[] = [];

  for (let y = 0; y < before.length; y++) {
    const beforeRow = before[y]!;
    const afterRow = after[y];
    for (let x = 0; x < beforeRow.length; x++) {
      if (beforeRow[x] === 0 && afterRow != null && afterRow[x]) {
        result.push([x, y]);
      }
    }
  }

  return result;
}
