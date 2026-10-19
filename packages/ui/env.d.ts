/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.ndjson?raw" {
  const src: string;
  export default src;
}

declare module "*.ndjson" {
  const src: string;
  export default src;
}

declare module "*.sgf?raw" {
  const src: string;
  export default src;
}

declare module "*.sgf" {
  const src: string;
  export default src;
}

declare module "@sabaki/sgf" {
  interface SgfApi {
    parse(
      contents: string | Buffer,
      options?: { getId?: () => number | string },
    ): Array<Record<string, unknown>>;
    stringify(node: unknown, options?: Record<string, unknown>): string;
    escapeString(value: string): string;
    unescapeString(value: string): string;
    parseVertex(value: string): [number, number];
    stringifyVertex(value: [number, number]): string;
    parseCompressedVertices(value: string): Array<[number, number]>;
  }
  const sgf: SgfApi;
  export default sgf;
}

declare module "@sabaki/immutable-gametree" {
  export default class GameTree {
    constructor(options?: {
      getId?: () => number | string;
      merger?: (
        node: unknown,
        data: Record<string, string[]>,
      ) => Record<string, string[]> | null;
      root?: Record<string, unknown>;
    });
    root: {
      id: number | string;
      data: Record<string, string[]>;
      parentId: number | string | null;
      children: Array<Record<string, unknown>>;
    };
    get(id: number | string):
      | {
          id: number | string;
          data: Record<string, string[]>;
          parentId: number | string | null;
          children: Array<{ id: number | string }>;
        }
      | null;
    getSequence(id: number | string): IterableIterator<{
      id: number | string;
      data: Record<string, string[]>;
      parentId: number | string | null;
      children: Array<{ id: number | string }>;
    }>;
    navigate(
      id: number | string,
      step: number,
      currVariants?: Record<string, number | string>,
    ):
      | {
          id: number | string;
          data: Record<string, string[]>;
          parentId: number | string | null;
          children: Array<{ id: number | string }>;
        }
      | null;
  }
}

declare module "@sabaki/go-board" {
  export default class Board {
    constructor(signMap?: number[][], captures?: [number, number]);
    width: number;
    height: number;
    signMap: number[][];
    static fromDimensions(width: number, height?: number): Board;
    get(vertex: [number, number]): number;
    set(vertex: [number, number], sign: number): Board;
    makeMove(
      sign: number,
      vertex: [number, number],
      options?: Record<string, unknown>,
    ): Board;
    getCaptures(sign: number): number;
    setCaptures(sign: number, value: number): Board;
    isValid(): boolean;
  }
}
