import { describe, expect, it } from "vitest";
import {
  ownershipToHeatMap,
  ownershipToPaintMap,
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
  it("builds heat and paint maps from black-positive ownership", () => {
    const own = Array.from({ length: 9 }, (_, i) =>
      i === 0 ? 0.8 : i === 1 ? -0.6 : 0,
    );
    const heat = ownershipToHeatMap(own, 3);
    expect(heat[0]![0]?.strength).toBeGreaterThanOrEqual(7);
    expect(heat[0]![1]?.strength).toBeGreaterThanOrEqual(5);
    const paint = ownershipToPaintMap(own, 3);
    expect(paint[0]![0]).toBe(1);
    expect(paint[0]![1]).toBe(-1);
  });
});

describe("resolveSgfRules", () => {
  it("defaults missing RU to chinese", () => {
    expect(resolveSgfRules("(;SZ[9]KM[7.5];B[cc])")).toBe("chinese");
    expect(resolveSgfRules("(;SZ[9]RU[Japanese];B[cc])")).toBe("Japanese");
  });
});
