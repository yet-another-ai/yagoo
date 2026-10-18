import type { BoardGeometry } from "./BoardGeometry";

/** Continuous scalar field over the board (e.g. ownership). Row-major Float32. */
export interface OverlayField {
  width: number;
  height: number;
  values: Float32Array;
}

export interface OverlayPolygon {
  /** Closed polygon in board pixel space, or vertex list expanded by geometry. */
  vertices: Array<[number, number]>;
  color?: string;
  label?: string;
}

export interface OverlayLine {
  from: [number, number];
  to: [number, number];
  color?: string;
  arrow?: boolean;
}

/** Plain overlay payload — renderer-agnostic. */
export interface OverlayData {
  fields?: OverlayField[];
  polygons?: OverlayPolygon[];
  lines?: OverlayLine[];
  /** Group outline demo: list of board vertices to outline. */
  groupOutlines?: Array<{
    vertices: Array<[number, number]>;
    color?: string;
  }>;
}

/**
 * Backend-agnostic overlay renderer.
 * SVG / canvas2d today; a WebGPU implementation can be swapped in later
 * without changing Goban / ReviewerLayout callers.
 */
export interface OverlayRenderer {
  readonly kind: "svg" | "canvas2d" | "webgpu";
  setGeometry(geometry: BoardGeometry): void;
  draw(data: OverlayData): void;
  clear(): void;
  dispose(): void;
}
