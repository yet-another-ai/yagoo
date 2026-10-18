/** Board vertex `[x, y]` — `[0, 0]` is the upper-left intersection. */
export type Vertex = [x: number, y: number];

/** Row-major map: `map[y][x]`. */
export type BoardMap<T> = T[][];

export type Sign = 0 | 1 | -1;

export interface Marker {
  type?:
    | "circle"
    | "cross"
    | "triangle"
    | "square"
    | "point"
    | "loader"
    | "label"
    | null;
  label?: string | null;
  tooltip?: string | null;
}

export interface GhostStone {
  sign: Sign;
  type?: "good" | "interesting" | "doubtful" | "bad" | null;
  faint?: boolean | null;
}

export interface HeatVertex {
  strength: number;
  text?: string | null;
}

export interface LineMarker {
  v1: Vertex;
  v2: Vertex;
  type?: "line" | "arrow";
}

export type VertexEventName =
  | "Click"
  | "MouseDown"
  | "MouseUp"
  | "MouseMove"
  | "MouseEnter"
  | "MouseLeave"
  | "PointerDown"
  | "PointerUp"
  | "PointerMove"
  | "PointerEnter"
  | "PointerLeave";

export const VERTEX_EVENTS: VertexEventName[] = [
  "Click",
  "MouseDown",
  "MouseUp",
  "MouseMove",
  "MouseEnter",
  "MouseLeave",
  "PointerDown",
  "PointerUp",
  "PointerMove",
  "PointerEnter",
  "PointerLeave",
];
