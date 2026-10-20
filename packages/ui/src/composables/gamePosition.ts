import Board from "@sabaki/go-board";
import type { Sign, Vertex } from "../types";

/** Replayed position, including the history required by both ko rules. */
export interface GamePosition {
  board: Board;
  toPlay: Sign;
  history: readonly string[];
  previousBoard: string | null;
  positionalSuperko: boolean;
}

export function boardKey(board: Board): string {
  return JSON.stringify(board.signMap);
}

export function playPosition(position: GamePosition, vertex: Vertex): GamePosition | null {
  const pass = vertex[0] === -1 && vertex[1] === -1;
  if (!pass && (!Number.isInteger(vertex[0]) || !Number.isInteger(vertex[1]) ||
    vertex[0] < 0 || vertex[1] < 0 ||
    vertex[0] >= position.board.width || vertex[1] >= position.board.height)) return null;
  try {
    const board = position.board.makeMove(position.toPlay, vertex, {
      preventSuicide: true,
      preventOverwrite: true,
      // Track ko explicitly: go-board preserves its internal ko point after passes.
      preventKo: false,
    });
    const key = boardKey(board);
    if (!pass && (key === position.previousBoard ||
      (position.positionalSuperko && position.history.includes(key)))) return null;
    return {
      board,
      toPlay: position.toPlay === 1 ? -1 : 1,
      history: pass ? position.history : [...position.history, key],
      previousBoard: pass ? null : boardKey(position.board),
      positionalSuperko: position.positionalSuperko,
    };
  } catch {
    return null;
  }
}
