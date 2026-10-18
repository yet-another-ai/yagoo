import { describe, expect, it } from "vitest";
import {
  createBoardGeometry,
  pixelToVertex,
  vertexToPixel,
  verticesToOutlinePath,
} from "../BoardGeometry";

describe("BoardGeometry", () => {
  const geo = createBoardGeometry({ vertexSize: 20, width: 9, height: 9 });

  it("maps vertex centers to pixel midpoints", () => {
    expect(vertexToPixel(geo, [0, 0])).toEqual({ x: 10, y: 10 });
    expect(vertexToPixel(geo, [2, 3])).toEqual({ x: 50, y: 70 });
  });

  it("round-trips pixel → vertex", () => {
    expect(pixelToVertex(geo, 10, 10)).toEqual([0, 0]);
    expect(pixelToVertex(geo, 50, 70)).toEqual([2, 3]);
    expect(pixelToVertex(geo, -1, 0)).toBeNull();
  });

  it("builds a closed outline path for a group", () => {
    const d = verticesToOutlinePath(geo, [
      [1, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
});
