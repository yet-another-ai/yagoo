import type { MoveComparison } from "./modules";
import type { BoardMap, Marker, Sign } from "../types";
import { emptyBoardMap, parseGtpVertex } from "./coords";
import { validPlayedEvidence } from "./playedLedger";

/** Reject a mismatched/partial comparison before placing it on a board. */
export function isAlignedComparison(
  comparison: MoveComparison | null | undefined,
  ply: number,
  size: number,
): comparison is MoveComparison {
  if (!comparison?.context || !comparison.evidence) return false;
  const { context, evidence } = comparison;
  return Number.isInteger(size) && size >= 2 && size <= 25
    && comparison.ply === ply
    && Number.isInteger(comparison.rootPly) && comparison.rootPly >= 0
    && comparison.rootPly + 1 === ply
    && context.rootPly === comparison.rootPly
    && (comparison.mover === "B" || comparison.mover === "W")
    && context.mover === comparison.mover
    && context.board?.size === size
    && Array.isArray(context.board.black) && Array.isArray(context.board.white)
    && [...context.board.black, ...context.board.white].every((stone) =>
      typeof stone === "string" && parseGtpVertex(stone, size) != null)
    && typeof comparison.actualMove === "string" && typeof comparison.aiMove === "string"
    && context.actual?.move === comparison.actualMove
    && context.preferred?.move === comparison.aiMove
    && Array.isArray(context.groups) && Array.isArray(comparison.groupTempo)
    && Array.isArray(evidence.limitations)
    && [comparison.actualWinrate, comparison.aiWinrate,
      comparison.actualScoreLead, comparison.aiScoreLead,
      comparison.scoreLoss, comparison.winrateLoss].every(Number.isFinite)
    && comparison.actualWinrate >= 0 && comparison.actualWinrate <= 1
    && comparison.aiWinrate >= 0 && comparison.aiWinrate <= 1
    && Array.isArray(comparison.ownershipDelta)
    && comparison.ownershipDelta.length === size * size
    && comparison.ownershipDelta.every((value) => Number.isFinite(value) && Math.abs(value) <= 2)
    && (!comparison.ledgerDiff || (
      comparison.ledgerDiff.rootPly === comparison.rootPly
      && comparison.ledgerDiff.mover === comparison.mover
      && comparison.ledgerDiff.move === comparison.actualMove
      && comparison.ledgerDiff.referenceMove === comparison.aiMove))
    && !(evidence.rootHash && evidence.actualRootHash && evidence.rootHash !== evidence.actualRootHash)
    && validPlayedEvidence(comparison);
}

export function comparisonBoard(comparison: MoveComparison): BoardMap<Sign> {
  const { board } = comparison.context;
  const map = emptyBoardMap<Sign>(board.size, 0);
  for (const [stones, sign] of [[board.black, 1], [board.white, -1]] as const) {
    for (const stone of stones) {
      const vertex = parseGtpVertex(stone, board.size);
      if (vertex) map[vertex[1]]![vertex[0]] = sign;
    }
  }
  return map;
}

export function comparisonMarkers(comparison: MoveComparison): BoardMap<Marker | null> {
  const size = comparison.context.board.size;
  const map = emptyBoardMap<Marker | null>(size, null);
  for (const [move, label] of [
    [comparison.actualMove, comparison.actualMove === comparison.aiMove ? "A=AI" : "A"],
    [comparison.aiMove, comparison.actualMove === comparison.aiMove ? "A=AI" : "AI"],
  ]) {
    const vertex = parseGtpVertex(move!, size);
    if (vertex) map[vertex[1]]![vertex[0]] = { type: "label", label };
  }
  return map;
}
