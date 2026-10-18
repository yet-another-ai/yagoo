import type { Vertex } from "../types";

/**
 * Shared board coordinate transforms for overlays (SVG today, WebGPU later).
 * Origin is the upper-left of the board content box; vertices are intersections.
 */
export interface BoardGeometry {
  /** Pixel size of one intersection cell. */
  vertexSize: number;
  /** Board width in intersections. */
  width: number;
  /** Board height in intersections. */
  height: number;
  /** Visible X range (inclusive). */
  rangeX: [number, number];
  /** Visible Y range (inclusive). */
  rangeY: [number, number];
  /** Pixel offset of the board content origin within the host. */
  offsetX: number;
  offsetY: number;
}

export function createBoardGeometry(
  partial: Partial<BoardGeometry> &
    Pick<BoardGeometry, "vertexSize" | "width" | "height">,
): BoardGeometry {
  return {
    rangeX: [0, partial.width - 1],
    rangeY: [0, partial.height - 1],
    offsetX: 0,
    offsetY: 0,
    ...partial,
  };
}

/** Center of vertex `[x,y]` in board-content pixel space. */
export function vertexToPixel(
  geometry: BoardGeometry,
  [x, y]: Vertex,
): { x: number; y: number } {
  return {
    x:
      geometry.offsetX +
      (x - geometry.rangeX[0] + 0.5) * geometry.vertexSize,
    y:
      geometry.offsetY +
      (y - geometry.rangeY[0] + 0.5) * geometry.vertexSize,
  };
}

/** Nearest vertex for a pixel in board-content space (or null if off-board). */
export function pixelToVertex(
  geometry: BoardGeometry,
  px: number,
  py: number,
): Vertex | null {
  const x = Math.floor(
    (px - geometry.offsetX) / geometry.vertexSize + geometry.rangeX[0],
  );
  const y = Math.floor(
    (py - geometry.offsetY) / geometry.vertexSize + geometry.rangeY[0],
  );
  if (
    x < geometry.rangeX[0] ||
    x > geometry.rangeX[1] ||
    y < geometry.rangeY[0] ||
    y > geometry.rangeY[1]
  ) {
    return null;
  }
  return [x, y];
}

/** Axis-aligned outline around a set of vertices (for group polygons). */
export function verticesToOutlinePath(
  geometry: BoardGeometry,
  vertices: Vertex[],
  padding = 0.35,
): string {
  if (vertices.length === 0) return "";

  const pads = padding * geometry.vertexSize;
  const points = vertices.map((v) => vertexToPixel(geometry, v));
  const minX = Math.min(...points.map((p) => p.x)) - pads;
  const maxX = Math.max(...points.map((p) => p.x)) + pads;
  const minY = Math.min(...points.map((p) => p.y)) - pads;
  const maxY = Math.max(...points.map((p) => p.y)) + pads;

  // Simple rounded rect path for the MVP group-outline demo.
  const r = geometry.vertexSize * 0.2;
  return [
    `M ${minX + r} ${minY}`,
    `L ${maxX - r} ${minY}`,
    `Q ${maxX} ${minY} ${maxX} ${minY + r}`,
    `L ${maxX} ${maxY - r}`,
    `Q ${maxX} ${maxY} ${maxX - r} ${maxY}`,
    `L ${minX + r} ${maxY}`,
    `Q ${minX} ${maxY} ${minX} ${maxY - r}`,
    `L ${minX} ${minY + r}`,
    `Q ${minX} ${minY} ${minX + r} ${minY}`,
    "Z",
  ].join(" ");
}
