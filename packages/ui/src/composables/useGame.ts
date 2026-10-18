import Board from "@sabaki/go-board";
import GameTree from "@sabaki/immutable-gametree";
import sgf from "@sabaki/sgf";
import { computed, ref, shallowRef, type Ref } from "vue";
import type { BoardMap, Sign, Vertex } from "../types";

export interface GamePlayerInfo {
  name: string;
  rank: string;
  captures: number;
}

export interface UseGameResult {
  tree: Ref<GameTree | null>;
  currentId: Ref<number | string | null>;
  signMap: Ref<BoardMap<Sign>>;
  boardSize: Ref<number>;
  currentPlayer: Ref<Sign>;
  players: Ref<[GamePlayerInfo, GamePlayerInfo]>;
  comment: Ref<string>;
  moveNumber: Ref<number>;
  loadSgf: (contents: string) => void;
  goForward: (childIndex?: number) => boolean;
  goBack: () => boolean;
  goToVariation: (childIndex: number) => boolean;
  canGoForward: Ref<boolean>;
  canGoBack: Ref<boolean>;
  variationCount: Ref<number>;
}

function createIdFactory(): () => number {
  let id = 0;
  return () => id++;
}

function parseSize(sz: string | undefined): number {
  if (sz == null) return 19;
  const parts = sz.split(":");
  return Number.parseInt(parts[0] ?? "19", 10) || 19;
}

function parsePoint(raw: string): Vertex | null {
  const v = sgf.parseVertex(raw) as Vertex;
  if (v == null || v[0] < 0 || v[1] < 0) return null;
  return v;
}

function applySetup(
  board: Board,
  data: Record<string, string[]>,
): Board {
  let next = board;
  for (const [key, sign] of [
    ["AB", 1],
    ["AW", -1],
    ["AE", 0],
  ] as const) {
    for (const raw of data[key] ?? []) {
      const verts =
        (sgf.parseCompressedVertices?.(raw) as Vertex[] | undefined) ??
        ([parsePoint(raw)].filter(Boolean) as Vertex[]);
      for (const v of verts) {
        if (v[0] < 0) continue;
        next = next.set(v, sign);
      }
    }
  }
  return next;
}

function boardFromPath(
  tree: GameTree,
  nodeId: number | string,
): { board: Board; moveNumber: number; currentPlayer: Sign } {
  const size = parseSize(tree.root.data.SZ?.[0]);
  let board = Board.fromDimensions(size);
  board = applySetup(board, tree.root.data as Record<string, string[]>);

  let moveNumber = 0;
  let currentPlayer: Sign = tree.root.data.PL?.[0] === "W" ? -1 : 1;

  const path: Array<Record<string, string[]>> = [];
  let cur = tree.get(nodeId);
  while (cur != null) {
    path.push(cur.data as Record<string, string[]>);
    if (cur.parentId == null) break;
    cur = tree.get(cur.parentId);
  }
  path.reverse();

  for (let i = 1; i < path.length; i++) {
    const data = path[i]!;
    board = applySetup(board, data);

    if (data.B != null) {
      const raw = data.B[0] ?? "";
      const v = parsePoint(raw);
      board = board.makeMove(1, v ?? ([-1, -1] as Vertex));
      moveNumber += 1;
      currentPlayer = -1;
    } else if (data.W != null) {
      const raw = data.W[0] ?? "";
      const v = parsePoint(raw);
      board = board.makeMove(-1, v ?? ([-1, -1] as Vertex));
      moveNumber += 1;
      currentPlayer = 1;
    }
  }

  return { board, moveNumber, currentPlayer };
}

/**
 * Load an SGF string and navigate the game tree (main line + variations).
 * Uses `@sabaki/sgf` (parse only) + `@sabaki/immutable-gametree` + `@sabaki/go-board`.
 */
export function useGame(): UseGameResult {
  const tree = shallowRef<GameTree | null>(null);
  const currentId = ref<number | string | null>(null);
  const signMap = shallowRef<BoardMap<Sign>>([]);
  const boardSize = ref(19);
  const currentPlayer = ref<Sign>(1);
  const moveNumber = ref(0);
  const comment = ref("");
  const players = ref<[GamePlayerInfo, GamePlayerInfo]>([
    { name: "Black", rank: "", captures: 0 },
    { name: "White", rank: "", captures: 0 },
  ]);

  function syncFromNode(id: number | string) {
    const t = tree.value;
    if (t == null) return;
    const node = t.get(id);
    if (node == null) return;

    const { board, moveNumber: mn, currentPlayer: cp } = boardFromPath(t, id);
    signMap.value = board.signMap as BoardMap<Sign>;
    boardSize.value = board.width;
    currentPlayer.value = cp;
    moveNumber.value = mn;
    comment.value = (node.data.C ?? []).join("\n");
    players.value = [
      {
        name: t.root.data.PB?.[0] ?? "Black",
        rank: t.root.data.BR?.[0] ?? "",
        captures: board.getCaptures(1),
      },
      {
        name: t.root.data.PW?.[0] ?? "White",
        rank: t.root.data.WR?.[0] ?? "",
        captures: board.getCaptures(-1),
      },
    ];
    currentId.value = id;
  }

  function loadSgf(contents: string) {
    const idFactory = createIdFactory();
    const roots = sgf.parse(contents, { getId: idFactory });
    const root = roots[0];
    if (root == null) {
      throw new Error("SGF contained no game trees");
    }
    const gt = new GameTree({
      getId: idFactory,
      // Parsed SGF roots match GameTree node objects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      root: root as any,
    });
    tree.value = gt;
    syncFromNode(gt.root.id);
  }

  function goForward(childIndex = 0): boolean {
    const t = tree.value;
    const id = currentId.value;
    if (t == null || id == null) return false;
    const node = t.get(id);
    const child = node?.children[childIndex];
    if (child == null) return false;
    syncFromNode(child.id);
    return true;
  }

  function goBack(): boolean {
    const t = tree.value;
    const id = currentId.value;
    if (t == null || id == null) return false;
    const node = t.get(id);
    if (node?.parentId == null) return false;
    syncFromNode(node.parentId);
    return true;
  }

  function goToVariation(childIndex: number): boolean {
    return goForward(childIndex);
  }

  const canGoBack = computed(() => {
    const t = tree.value;
    const id = currentId.value;
    if (t == null || id == null) return false;
    return t.get(id)?.parentId != null;
  });

  const canGoForward = computed(() => {
    const t = tree.value;
    const id = currentId.value;
    if (t == null || id == null) return false;
    return (t.get(id)?.children.length ?? 0) > 0;
  });

  const variationCount = computed(() => {
    const t = tree.value;
    const id = currentId.value;
    if (t == null || id == null) return 0;
    return t.get(id)?.children.length ?? 0;
  });

  return {
    tree,
    currentId,
    signMap,
    boardSize,
    currentPlayer,
    players,
    comment,
    moveNumber,
    loadSgf,
    goForward,
    goBack,
    goToVariation,
    canGoForward,
    canGoBack,
    variationCount,
  };
}
