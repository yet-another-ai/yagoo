import Board from "@sabaki/go-board";
import type { BoardMap, Sign, Vertex } from "../types";
import { boardKey, playPosition, type GamePosition } from "../composables/gamePosition";

export interface TryNode {
  id: string;
  parentId: string | null;
  vertex: Vertex;
  sign: Sign;
  label: string;
}

/** Stones captured by the try moves themselves, not the anchor game. */
export interface TryCaptures {
  black: number;
  white: number;
}

export interface TryPosition {
  signMap: BoardMap<Sign>;
  toPlay: Sign;
  captures: TryCaptures;
}

/**
 * Replay a try path from the game's full anchor position.
 * Returns null for illegal moves, including simple ko and positional superko.
 * Capture counts are deltas from the anchor; analysis comes from the engine.
 */
export function applyTryMoves(
  size: number,
  anchor: BoardMap<Sign>,
  toPlay: Sign,
  moves: readonly Vertex[],
  anchorPosition?: GamePosition | null,
): TryPosition | null {
  // The optional fallback is for callers supplying a genuinely new setup board.
  // Reviewer anchors always pass the replayed position, never a stone-only copy.
  const board = anchorPosition?.board ?? new Board(anchor.map((row) => [...row]));
  if (board.width !== size || board.height !== size) return null;
  let position: GamePosition = anchorPosition ?? {
    board, toPlay: toPlay === -1 ? -1 : 1,
    history: [boardKey(board)], previousBoard: null, positionalSuperko: true,
  };
  const before = { black: board.getCaptures(1) ?? 0, white: board.getCaptures(-1) ?? 0 };
  for (const vertex of moves) {
    const next = playPosition(position, vertex);
    if (!next) return null;
    position = next;
  }

  return {
    signMap: position.board.signMap as BoardMap<Sign>,
    toPlay: position.toPlay,
    captures: {
      black: (position.board.getCaptures(1) ?? 0) - before.black,
      white: (position.board.getCaptures(-1) ?? 0) - before.white,
    },
  };
}

/** Parent-first depth-first order keeps siblings under the correct ancestor. */
export function orderedTryNodes(nodes: readonly TryNode[]): TryNode[] {
  const result: TryNode[] = [];
  const seen = new Set<string>();
  function visit(parentId: string | null) {
    for (const node of nodes) {
      if (node.parentId !== parentId || seen.has(node.id)) continue;
      seen.add(node.id);
      result.push(node);
      visit(node.id);
    }
  }
  visit(null);
  return result;
}

export function tryPath(
  nodes: readonly TryNode[],
  cursorId: string | null,
): TryNode[] {
  if (cursorId == null) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: TryNode[] = [];
  let id: string | null = cursorId;
  const guard = new Set<string>();
  while (id != null) {
    if (guard.has(id)) break;
    guard.add(id);
    const node = byId.get(id);
    if (node == null) break;
    path.push(node);
    id = node.parentId;
  }
  path.reverse();
  return path;
}
