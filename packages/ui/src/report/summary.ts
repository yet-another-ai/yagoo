import type { MoveComparison } from "../analysis/modules";
import type { AnalysisState } from "../analysis/types";
import { isAlignedComparison } from "../analysis/comparison";
import type { ReviewMoveReference, ReviewSummary } from "./types";

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8;
const move = (s: unknown): s is string =>
  typeof s === "string" && /^(?:[A-HJ-Z](?:[1-9]|1\d|2[0-5])|pass)$/i.test(s);

/** Reject malformed or misaligned imported evidence before making a loss claim. */
export function isReportComparison(
  comparison: MoveComparison | null | undefined,
  ply: number,
): comparison is MoveComparison {
  if (!comparison || comparison.ply !== ply || comparison.rootPly + 1 !== ply ||
      !["B", "W"].includes(comparison.mover) ||
      !move(comparison.actualMove) || !move(comparison.aiMove) ||
      !finite(comparison.scoreLoss) || !finite(comparison.winrateLoss) ||
      !finite(comparison.actualScoreLead) || !finite(comparison.aiScoreLead) ||
      !finite(comparison.actualWinrate) || !finite(comparison.aiWinrate) ||
      comparison.actualWinrate < 0 || comparison.actualWinrate > 1 ||
      comparison.aiWinrate < 0 || comparison.aiWinrate > 1) return false;
  const context = comparison.context;
  const evidence = comparison.evidence;
  if (!isAlignedComparison(comparison, ply, context?.board?.size ?? 0)) return false;
  if (!context || context.rootPly !== comparison.rootPly ||
      context.mover !== comparison.mover ||
      context.actual?.move !== comparison.actualMove ||
      context.preferred?.move !== comparison.aiMove ||
      !evidence?.rootQueryId || !evidence.actualQueryId ||
      !(evidence.actualVisits! > 0) || !(evidence.aiVisits! > 0) ||
      (evidence.rootHash && evidence.actualRootHash &&
        evidence.rootHash !== evidence.actualRootHash)) return false;
  const sign = comparison.mover === "B" ? 1 : -1;
  return close(comparison.scoreLoss, sign * (comparison.aiScoreLead - comparison.actualScoreLead)) &&
    close(comparison.winrateLoss, comparison.aiWinrate - comparison.actualWinrate);
}

export function compareReportMoves(a: ReviewMoveReference, b: ReviewMoveReference): number {
  return b.scoreLoss - a.scoreLoss || b.winrateLoss - a.winrateLoss || a.ply - b.ply;
}

export function comparisonReference(c: MoveComparison): ReviewMoveReference {
  return {
    ply: c.ply, rootPly: c.rootPly, mover: c.mover,
    actualMove: c.actualMove, aiMove: c.aiMove,
    scoreLoss: c.scoreLoss, winrateLoss: c.winrateLoss,
  };
}

/** Same metadata as the final pipeline event; also works on interrupted streams. */
export function summarizeReview(state: AnalysisState): ReviewSummary {
  const moveCount = Number.isSafeInteger(state.moveCount) && state.moveCount! >= 0
    ? state.moveCount! : 0;
  const completedPositionPlies: number[] = [];
  const rankedMoves: ReviewMoveReference[] = [];
  for (let ply = 0; ply <= moveCount; ply++) {
    const row = state.plies[ply];
    if (!row?.complete || row.rootPartial || !row.snapshot?.root) continue;
    completedPositionPlies.push(ply);
    if (ply > 0 && isReportComparison(row.comparison, ply)) {
      rankedMoves.push(comparisonReference(row.comparison));
    }
  }
  rankedMoves.sort(compareReportMoves);
  const comparedMovePlies = rankedMoves.map((r) => r.ply).sort((a, b) => a - b);
  const completed = new Set(completedPositionPlies);
  const compared = new Set(comparedMovePlies);
  const missingPositionPlies = Array.from({ length: moveCount + 1 }, (_, p) => p)
    .filter((p) => !completed.has(p));
  const missingComparisonPlies = Array.from({ length: moveCount }, (_, p) => p + 1)
    .filter((p) => !compared.has(p));
  return {
    schemaVersion: 1, moveCount, completedPositionPlies, comparedMovePlies,
    missingPositionPlies, missingComparisonPlies, rankedMoves,
    limitations: [
      "Rankings use only actual-versus-preferred comparisons at the same preceding root.",
      "Finite-visit search estimates are not proof of optimal play; negative differences are retained.",
      "Scan swing magnitudes prioritize analysis and do not establish played-move loss.",
    ],
  };
}
