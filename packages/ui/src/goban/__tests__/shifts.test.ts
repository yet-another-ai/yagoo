import { describe, expect, it } from "vitest";
import {
  applyPlacementShift,
  cloneShiftMap,
  createRng,
  createShiftMap,
  randomInt,
  readjustShifts,
} from "../shifts";

describe("createRng / randomInt", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => randomInt(8, a));
    const seqB = Array.from({ length: 20 }, () => randomInt(8, b));
    expect(seqA).toEqual(seqB);
  });

  it("randomInt stays within [0, n]", () => {
    const rng = createRng(7);
    for (let i = 0; i < 100; i++) {
      const v = randomInt(8, rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(8);
    }
  });
});

describe("readjustShifts", () => {
  it("zeros a left neighbor that leans right into the current stone", () => {
    // 3x1 row: left leans right (3), current leans left (1) → left cleared
    const shiftMap = [[3, 1, 0]];
    readjustShifts(shiftMap, [1, 0]);
    expect(shiftMap[0]).toEqual([0, 1, 0]);
  });

  it("zeros a right neighbor that leans left into the current stone", () => {
    const shiftMap = [[0, 3, 1]];
    readjustShifts(shiftMap, [1, 0]);
    expect(shiftMap[0]).toEqual([0, 3, 0]);
  });

  it("zeros a top neighbor that leans down into the current stone", () => {
    const shiftMap = [[4], [2], [0]];
    readjustShifts(shiftMap, [0, 1]);
    expect(shiftMap.map((r) => r[0])).toEqual([0, 2, 0]);
  });

  it("zeros a bottom neighbor that leans up into the current stone", () => {
    const shiftMap = [[0], [4], [2]];
    readjustShifts(shiftMap, [0, 1]);
    expect(shiftMap.map((r) => r[0])).toEqual([0, 4, 0]);
  });

  it("clears diagonal-conflict neighbors (shift 5 vs 7)", () => {
    // Current leans up-left (5); left neighbor leans down-right (7) → left cleared
    const shiftMap = [
      [0, 0, 0],
      [7, 5, 0],
      [0, 0, 0],
    ];
    readjustShifts(shiftMap, [1, 1]);
    expect(shiftMap[1]![0]).toBe(0);
    expect(shiftMap[1]![1]).toBe(5);
  });

  it("leaves non-conflicting neighbors alone", () => {
    // Current leans left (1); left neighbor also leans left (1) — not in remove set
    const shiftMap = [[1, 1, 0]];
    readjustShifts(shiftMap, [1, 0]);
    expect(shiftMap[0]).toEqual([1, 1, 0]);
  });

  it("full-board pass visits every vertex", () => {
    const shiftMap = [
      [3, 1],
      [0, 0],
    ];
    readjustShifts(shiftMap);
    // [0,0]=3 leans right → clears [1,0] if it was in {1,5,8}; here 1 → cleared
    expect(shiftMap[0]![1]).toBe(0);
  });
});

describe("createShiftMap", () => {
  it("is stable for a given seed (no re-render jitter)", () => {
    const a = createShiftMap(5, 5, createRng(12345));
    const b = createShiftMap(5, 5, createRng(12345));
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    const a = createShiftMap(5, 5, createRng(1));
    const b = createShiftMap(5, 5, createRng(2));
    expect(a).not.toEqual(b);
  });

  it("only contains shifts in 0..8 after collision resolution", () => {
    const map = createShiftMap(9, 9, createRng(99));
    for (const row of map) {
      for (const s of row) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe("applyPlacementShift", () => {
  it("assigns a non-zero shift 1..8 at the placed vertex", () => {
    const shiftMap = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    applyPlacementShift(shiftMap, [1, 1], createRng(42));
    const placed = shiftMap[1]![1]!;
    expect(placed).toBeGreaterThanOrEqual(1);
    expect(placed).toBeLessThanOrEqual(8);
  });

  it("nudges a conflicting neighbor to 0 (collision behavior)", () => {
    // Neighbor to the left leans right (3). Placement that leans left (1)
    // should clear the neighbor — force the RNG to return 0 → randomInt(7)+1 = 1.
    const rng = () => 0; // randomInt(7, rng) === 0 → shift = 1
    const shiftMap = [
      [0, 0, 0],
      [3, 0, 0],
      [0, 0, 0],
    ];
    applyPlacementShift(shiftMap, [1, 1], rng);
    expect(shiftMap[1]![1]).toBe(1);
    expect(shiftMap[1]![0]).toBe(0);
  });

  it("is deterministic with a seeded rng", () => {
    const make = () => {
      const map = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      applyPlacementShift(map, [1, 1], createRng(777));
      return cloneShiftMap(map);
    };
    expect(make()).toEqual(make());
  });
});
