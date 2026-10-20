import Board from "@sabaki/go-board";
import type { BoardMap, Sign, Vertex } from "../types";

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
 * Replay anchor stones plus a try-move path.
 * Returns null when a move overwrites, is suicide, or repeats a simple ko.
 * This does not invent analysis; it only updates the local board.
 * Capture counts are only those made by `moves` (`set` does not record them).
 */
export function applyTryMoves(
  size: number,
  anchor: BoardMap<Sign>,
  toPlay: Sign,
  moves: readonly Vertex[],
): TryPosition | null {
  let board = Board.fromDimensions(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sign = anchor[y]?.[x] ?? 0;
      if (sign !== 0) board.set([x, y], sign);
    }
  }

  let player: Sign = toPlay === -1 ? -1 : 1;
  for (const vertex of moves) {
    try {
      board = board.makeMove(player, vertex, {
        preventSuicide: true,
        preventOverwrite: true,
        preventKo: true,
      });
    } catch {
      return null;
    }
    player = player === 1 ? -1 : 1;
  }

  return {
    signMap: board.signMap as BoardMap<Sign>,
    toPlay: player,
    captures: {
      black: board.getCaptures(1) ?? 0,
      white: board.getCaptures(-1) ?? 0,
    },
  };
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
