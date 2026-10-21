import Board from "@sabaki/go-board";
import GameTree from "@sabaki/immutable-gametree";
import sgf from "@sabaki/sgf";
import { computed, ref, shallowRef, type Ref } from "vue";
import { formatGtpVertex } from "../analysis/coords";
import type { BoardMap, Sign, Vertex } from "../types";
import { boardKey, playPosition, type GamePosition } from "./gamePosition";

export interface GamePlayerInfo {
  name: string;
  rank: string;
  captures: number;
}

/** A child of the current SGF node, labelled with a GTP move. */
export interface GameChildInfo {
  index: number;
  label: string;
}

export interface UseGameResult {
  tree: Ref<GameTree | null>;
  currentId: Ref<number | string | null>;
  signMap: Ref<BoardMap<Sign>>;
  position: Ref<GamePosition | null>;
  /** Current ancestry serialized as a single SGF line, with setup/history intact. */
  positionSgf: Ref<string>;
  boardSize: Ref<number>;
  currentPlayer: Ref<Sign>;
  players: Ref<[GamePlayerInfo, GamePlayerInfo]>;
  comment: Ref<string>;
  moveNumber: Ref<number>;
  /** False when the current node is not on the first-child path from the root. */
  onMainLine: Ref<boolean>;
  /** Variations available at the current node. */
  children: Ref<GameChildInfo[]>;
  /** Last failed load/navigation; the previous valid position is retained. */
  error: Ref<string | null>;
  loadSgf: (contents: string) => boolean;
  goForward: (childIndex?: number) => boolean;
  goBack: () => boolean;
  goToPly: (ply: number) => boolean;
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

function childMoveLabel(
  data: Record<string, string[]>,
  size: number,
): string {
  const black = data.B?.[0];
  const white = data.W?.[0];
  if (black != null) {
    const v = parsePoint(black, size);
    return v ? `B ${formatGtpVertex(v, size)}` : "B pass";
  }
  if (white != null) {
    const v = parsePoint(white, size);
    return v ? `W ${formatGtpVertex(v, size)}` : "W pass";
  }
  return "node";
}

function parsePoint(raw: string, size = 19): Vertex | null {
  if (raw.toLowerCase() === "tt" && size <= 19) return null;
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
): { position: GamePosition; moveNumber: number } {
  const size = parseSize(tree.root.data.SZ?.[0]);
  let board = Board.fromDimensions(size);
  let moveNumber = 0;
  const handicap = Number(tree.root.data.HA?.[0] ?? 0);
  let currentPlayer: Sign = handicap >= 2 && !tree.root.data.AW?.length ? -1 : 1;
  const ru = tree.root.data.RU?.[0]?.toLowerCase();
  let position: GamePosition = {
    board, toPlay: currentPlayer, history: [boardKey(board)],
    previousBoard: null, positionalSuperko: ru !== "japanese" && ru !== "jp",
  };

  const path: Array<Record<string, string[]>> = [];
  let cur = tree.get(nodeId);
  while (cur != null) {
    path.push(cur.data as Record<string, string[]>);
    if (cur.parentId == null) break;
    cur = tree.get(cur.parentId);
  }
  path.reverse();

  for (let i = 0; i < path.length; i++) {
    const data = path[i]!;
    if (data.AB || data.AW || data.AE || data.PL) {
      board = applySetup(position.board, data);
      currentPlayer = data.PL?.[0] === "W" ? -1 : data.PL?.[0] === "B" ? 1 : currentPlayer;
      position = { ...position, board, toPlay: currentPlayer, history: [boardKey(board)], previousBoard: null };
    }

    if (data.B != null || data.W != null) {
      const toPlay: Sign = data.B != null ? 1 : -1;
      const raw = (data.B ?? data.W)?.[0] ?? "";
      const v = parsePoint(raw, size);
      const next = playPosition({ ...position, toPlay }, v ?? [-1, -1]);
      if (next == null) throw new Error(`Illegal SGF move ${moveNumber + 1}`);
      position = next;
      moveNumber += 1;
      currentPlayer = position.toPlay;
    }
  }

  return { position, moveNumber };
}

/**
 * Load an SGF string and navigate the game tree (main line + variations).
 * Uses `@sabaki/sgf` (parse only) + `@sabaki/immutable-gametree` + `@sabaki/go-board`.
 */
export function useGame(): UseGameResult {
  const tree = shallowRef<GameTree | null>(null);
  const currentId = ref<number | string | null>(null);
  const signMap = shallowRef<BoardMap<Sign>>([]);
  const position = shallowRef<GamePosition | null>(null);
  const boardSize = ref(19);
  const currentPlayer = ref<Sign>(1);
  const moveNumber = ref(0);
  const comment = ref("");
  const error = ref<string | null>(null);
  const players = ref<[GamePlayerInfo, GamePlayerInfo]>([
    { name: "Black", rank: "", captures: 0 },
    { name: "White", rank: "", captures: 0 },
  ]);

  function syncFromNode(id: number | string, t = tree.value): boolean {
    if (t == null) return false;
    const node = t.get(id);
    if (node == null) return false;

    let replay: ReturnType<typeof boardFromPath>;
    try {
      replay = boardFromPath(t, id);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
    // Commit the tree and position together only after the complete path is valid.
    const { position: nextPosition, moveNumber: mn } = replay;
    tree.value = t;
    position.value = nextPosition;
    const { board, toPlay: cp } = nextPosition;
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
    error.value = null;
    return true;
  }

  function loadSgf(contents: string): boolean {
    try {
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
      return syncFromNode(gt.root.id, gt);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }

  function goForward(childIndex = 0): boolean {
    const t = tree.value;
    const id = currentId.value;
    if (t == null || id == null) return false;
    const node = t.get(id);
    const child = node?.children[childIndex];
    if (child == null) return false;
    return syncFromNode(child.id);
  }

  function goBack(): boolean {
    const t = tree.value;
    const id = currentId.value;
    if (t == null || id == null) return false;
    const node = t.get(id);
    if (node?.parentId == null) return false;
    return syncFromNode(node.parentId);
  }

  function goToVariation(childIndex: number): boolean {
    return goForward(childIndex);
  }

  /** Jump to a main-line ply (0 = root / setup). */
  function goToPly(ply: number): boolean {
    const t = tree.value;
    if (t == null) return false;
    const target = Math.max(0, Math.floor(ply));
    let id: number | string = t.root.id;
    let depth = t.root.data.B != null || t.root.data.W != null ? 1 : 0;
    while (depth < target) {
      const node = t.get(id);
      const child = node?.children[0];
      if (child == null) break;
      id = child.id;
      if (t.get(id)?.data.B != null || t.get(id)?.data.W != null) depth += 1;
    }
    return syncFromNode(id) && depth === target;
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

  const onMainLine = computed(() => {
    const t = tree.value;
    let id = currentId.value;
    if (t == null || id == null) return true;
    while (id != null) {
      const node = t.get(id);
      if (node?.parentId == null) return true;
      const parent = t.get(node.parentId);
      if (parent == null) return true;
      if (parent.children[0]?.id !== id) return false;
      id = node.parentId;
    }
    return true;
  });

  const children = computed<GameChildInfo[]>(() => {
    const t = tree.value;
    const id = currentId.value;
    if (t == null || id == null) return [];
    const node = t.get(id);
    const size = boardSize.value;
    return (node?.children ?? []).map((child, index) => {
      const data =
        (child as { data?: Record<string, string[]> }).data ?? {};
      return {
        index,
        label: childMoveLabel(data, size),
      };
    });
  });

  const positionSgf = computed(() => {
    const t = tree.value;
    if (!t || currentId.value == null) return "";
    const path: Record<string, string[]>[] = [];
    let node = t.get(currentId.value);
    while (node) {
      path.unshift(node.data);
      node = node.parentId == null ? null : t.get(node.parentId);
    }
    // Explicit ancestry avoids choosing a sibling with the same ply number.
    return `(${path.map((data) => ";" + Object.entries(data).map(([key, values]) => {
      const expanded = ["AB", "AW", "AE"].includes(key)
        ? values.flatMap((value) => sgf.parseCompressedVertices(value).map(sgf.stringifyVertex))
        : values;
      return key + expanded.map((value) => `[${sgf.escapeString(value)}]`).join("");
    }).join("")).join("")})`;
  });

  return {
    tree,
    currentId,
    signMap,
    position,
    positionSgf,
    boardSize,
    currentPlayer,
    players,
    comment,
    moveNumber,
    onMainLine,
    children,
    error,
    loadSgf,
    goForward,
    goBack,
    goToPly,
    goToVariation,
    canGoForward,
    canGoBack,
    variationCount,
  };
}
