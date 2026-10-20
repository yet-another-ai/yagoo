import type { AnalysisState, CandidateSnapshot } from "../analysis/types";

/**
 * A swing ply already chosen by the pipeline (`deepPliesSelected`).
 * Deltas are copied from `deepReasons`. `topMove` is the candidate with
 * the lowest pipeline `order` — not a client-side judgement.
 */
export interface KeyMoveRow {
  ply: number;
  winrateDelta: number | null;
  scoreLeadDelta: number | null;
  ownershipDelta: number | null;
  topMove: string | null;
}

function topCandidateMove(
  candidates: CandidateSnapshot[] | undefined,
): string | null {
  if (candidates == null || candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestOrder = best.order ?? 0;
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const order = candidate.order ?? i;
    if (order < bestOrder) {
      best = candidate;
      bestOrder = order;
    }
  }
  return best.move;
}

/** Key moves in ply order, using only fields the event stream already stores. */
export function keyMovesFromState(state: AnalysisState): KeyMoveRow[] {
  return [...state.deepPlies]
    .sort((a, b) => a - b)
    .map((ply) => {
      const reason = state.deepReasons.find((row) => row.ply === ply);
      return {
        ply,
        winrateDelta: reason?.winrateDelta ?? null,
        scoreLeadDelta: reason?.scoreLeadDelta ?? null,
        ownershipDelta: reason?.ownershipDelta ?? null,
        topMove: topCandidateMove(state.plies[ply]?.candidates),
      };
    });
}

export function formatDeltaPoints(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

/** Winrate deltas on the wire are fractions. Display them as percentage points. */
export function formatWinratePoints(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pp`;
}
