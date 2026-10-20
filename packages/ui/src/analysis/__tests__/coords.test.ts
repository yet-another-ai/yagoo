import { describe, expect, it } from "vitest";
import {
  OWNERSHIP_PAINT_STRENGTH,
  ownershipToHeatMap,
  ownershipToPaintMap,
  formatGtpVertex,
  parseGtpVertex,
} from "../coords";
import { resolveSgfRules } from "../display";

describe("parseGtpVertex", () => {
  it("maps A19-style GTP to upper-left vertex", () => {
    expect(parseGtpVertex("A9", 9)).toEqual([0, 0]);
    expect(parseGtpVertex("C7", 9)).toEqual([2, 2]);
    expect(parseGtpVertex("G3", 9)).toEqual([6, 6]);
    expect(parseGtpVertex("pass", 9)).toBeNull();
  });

  it("skips the I column", () => {
    expect(parseGtpVertex("J1", 19)?.[0]).toBe(8);
  });
});

describe("ownership maps", () => {
  it("builds heat and fractional paint maps from black-positive ownership", () => {
    const own = Array.from({ length: 9 }, (_, i) =>
      i === 0 ? 0.8 : i === 1 ? -0.6 : 0,
    );
    const heat = ownershipToHeatMap(own, 3);
    expect(heat[0]![0]?.strength).toBeGreaterThanOrEqual(7);
    expect(heat[0]![1]?.strength).toBeGreaterThanOrEqual(5);
    const paint = ownershipToPaintMap(own, 3);
    expect(Math.abs(paint[0]![0]!)).toBeGreaterThan(0.4);
    expect(paint[0]![0]).toBeGreaterThan(0);
    expect(paint[0]![1]).toBeLessThan(0);
    expect(Math.abs(paint[0]![0]!)).toBeLessThanOrEqual(OWNERSHIP_PAINT_STRENGTH);
  });

  it("scales paint maps to 19×19 without ownership numeric labels", () => {
    const own = Array.from({ length: 19 * 19 }, (_, i) =>
      i === 0 ? 1 : i === 18 ? -1 : 0,
    );
    const heat = ownershipToHeatMap(own, 19);
    expect(heat).toHaveLength(19);
    expect(heat[0]).toHaveLength(19);
    expect(heat[0]![0]?.strength).toBe(9);
    expect(heat[0]![0]?.text).toBeNull();
    expect(heat[0]![18]?.strength).toBe(9);
    expect(heat[0]![18]?.text).toBeNull();
    const paint = ownershipToPaintMap(own, 19);
    expect(paint[0]![0]).toBeCloseTo(OWNERSHIP_PAINT_STRENGTH, 5);
    expect(paint[0]![18]).toBeCloseTo(-OWNERSHIP_PAINT_STRENGTH, 5);
  });

  it("skips near-zero ownership cells", () => {
    const own = Array.from({ length: 9 }, (_, i) => (i === 0 ? 0.05 : 0));
    const heat = ownershipToHeatMap(own, 3);
    expect(heat[0]![0]).toBeNull();
    const paint = ownershipToPaintMap(own, 3);
    expect(paint[0]![0]).toBe(0);
  });
});

describe("parseGtpVertex on 19×19", () => {
  it("maps star points and edges", () => {
    expect(parseGtpVertex("D4", 19)).toEqual([3, 15]);
    expect(parseGtpVertex("Q16", 19)).toEqual([15, 3]);
    expect(parseGtpVertex("K10", 19)).toEqual([9, 9]);
    expect(formatGtpVertex([15, 3], 19)).toBe("Q16");
    expect(formatGtpVertex([-1, -1], 19)).toBe("pass");
  });
});

describe("resolveSgfRules", () => {
  it("defaults missing RU to chinese", () => {
    expect(resolveSgfRules("(;SZ[9]KM[7.5];B[cc])")).toBe("chinese");
    expect(resolveSgfRules("(;SZ[9]RU[Japanese];B[cc])")).toBe("Japanese");
  });
});
