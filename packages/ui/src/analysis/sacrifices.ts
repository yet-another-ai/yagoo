import type { MoveComparison, SacrificeAnnotation, SacrificeAssessment } from "./modules";
import { isAlignedComparison } from "./comparison";
import { parseGtpVertex } from "./coords";

/** The snapshot is authoritative. Never promote root/end ownership to a claim. */
export function alignedSacrificeAssessment(
  comparison: MoveComparison | null | undefined, ply: number, size: number,
): SacrificeAssessment | null {
  if (!isAlignedComparison(comparison, ply, size)) return null;
  const assessment = comparison.sacrificeAssessment;
  if (!assessment || assessment.rootPly !== comparison.rootPly
    || assessment.mover !== comparison.mover || assessment.preferredMove !== comparison.aiMove
    || !["assessed", "unassessed"].includes(assessment.status)
    || !Array.isArray(assessment.annotations) || !Array.isArray(assessment.checks)
    || !Array.isArray(assessment.limitations) || !assessment.parameters
    || !Number.isInteger(assessment.parameters.minimumVisits)
    || assessment.parameters.minimumVisits < 1
    || !Number.isInteger(assessment.parameters.minimumStones)
    || assessment.parameters.minimumStones < 1
    || (assessment.status === "unassessed" && assessment.annotations.length > 0)) return null;
  return assessment.annotations.every((item) => validAnnotation(item, comparison, assessment, size))
    ? assessment : null;
}

function validAnnotation(
  item: SacrificeAnnotation, comparison: MoveComparison, assessment: SacrificeAssessment, size: number,
): boolean {
  if (!item || typeof item.groupId !== "string") return false;
  const context = comparison.context;
  const group = context.groups.find((group) => group?.groupId === item.groupId);
  const stones = comparison.mover === "B" ? group?.members?.blackStones : group?.members?.whiteStones;
  const sameStones = (a: string[] | undefined, b: string[] | undefined) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && new Set(a).size === a.length && a.every((stone) => b.includes(stone));
  const evidence = item.evidence;
  return item.rootPly === comparison.rootPly && item.mover === comparison.mover
    && item.preferredMove === comparison.aiMove && item.referenceMove !== comparison.aiMove
    && sameStones(stones, item.stones) && sameStones(item.stones, item.capturedStones)
    && item.stones.length >= assessment.parameters.minimumStones
    && item.stones.every((stone) => parseGtpVertex(stone, size) != null)
    && [item.ownershipFlip, item.referenceOwnership, item.preferredOwnership,
      item.endpointOwnership, item.costBook, item.compensationBook].every(Number.isFinite)
    && item.ownershipFlip > 0 && item.costBook > 0 && item.compensationBook >= item.costBook
    && (item.rootOwnership == null || Number.isFinite(item.rootOwnership))
    && (item.compensationPoints == null || Number.isFinite(item.compensationPoints))
    && Array.isArray(item.exchangedWith) && Array.isArray(item.exchanges)
    && item.exchanges.every((line) => !!line && typeof line.kind === "string" && Number.isFinite(line.bookValue)
      && Number.isFinite(line.proportion) && (line.points == null || Number.isFinite(line.points))
      && Array.isArray(line.intersections)
      && line.intersections.every((point) => typeof point === "string" && parseGtpVertex(point, size) != null))
    && Array.isArray(item.pv) && item.pv[0] === comparison.aiMove
    && !!evidence && evidence.rootQueryId === comparison.evidence.rootQueryId
    && evidence.preferredPvQueryId === context.preferredPvQueryId
    && evidence.rootHash === comparison.evidence.rootHash
    && (evidence.referenceQueryId === comparison.evidence.rootQueryId
      || (item.referenceMove === comparison.actualMove
        && evidence.referenceQueryId === comparison.evidence.actualQueryId))
    && [evidence.preferredVisits, evidence.referenceVisits, evidence.endpointVisits]
      .every((visits) => Number.isInteger(visits) && visits >= assessment.parameters.minimumVisits)
    && [evidence.scoreAdvantage, evidence.winrateAdvantage, evidence.endpointScoreChange,
      evidence.endpointWinrateChange].every(Number.isFinite)
    && Number.isInteger(evidence.preferredCapturePlyOffset)
    && evidence.preferredCapturePlyOffset > 0 && evidence.preferredCapturePlyOffset <= item.pv.length
    && Array.isArray(evidence.referencePv) && evidence.referencePv[0] === item.referenceMove
    && evidence.referencePv.length >= evidence.preferredCapturePlyOffset;
}

export function sacrificesFromComparison(
  comparison: MoveComparison | null | undefined, ply: number, size: number,
): SacrificeAnnotation[] | null {
  const assessment = alignedSacrificeAssessment(comparison, ply, size);
  return assessment?.status === "assessed" ? [...assessment.annotations] : null;
}
