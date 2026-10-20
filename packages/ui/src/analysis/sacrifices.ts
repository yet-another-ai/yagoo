import type { CandidatePvLineage, MoveComparison, SacrificeAnnotation, SacrificeAssessment, SacrificeParams } from "./modules";
import type { CandidateSnapshot, EngineAnalysis } from "./types";
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
    || !Array.isArray(assessment.limitations) || !assessment.limitations.every((value) => typeof value === "string")
    || !validParameters(assessment.parameters)
    || !assessment.checks.every((check) => !!check && typeof check.groupId === "string"
      && comparison.context.groups.some((group) => group?.groupId === check.groupId)
      && reasons.includes(check.reason) && (check.referenceMove === null || validMove(check.referenceMove, size))
      && (check.reason === "supported"
        ? assessment.annotations.some((item) => item?.groupId === check.groupId && item.referenceMove === check.referenceMove)
        : check.referenceMove === null))
    || new Set(assessment.checks.map((check) => check.groupId)).size !== assessment.checks.length
    || new Set(assessment.annotations.map((item) => item?.groupId)).size !== assessment.annotations.length
    || (assessment.status === "unassessed" && assessment.annotations.length > 0)) return null;
  return assessment.annotations.every((item) => validAnnotation(item, comparison, assessment, size))
    ? assessment : null;
}

const reasons = ["supported", "invalid_evidence", "missing_preferred_pv", "insufficient_visits",
  "mixed_or_opponent_group", "too_few_stones", "original_stones_not_captured", "ownership_not_lost",
  "saving_alternative_unavailable", "global_value_declines", "compensation_unavailable"];

function validParameters(params: SacrificeParams | null | undefined): params is SacrificeParams {
  return !!params && Number.isInteger(params.minimumVisits) && params.minimumVisits > 0
    && Number.isInteger(params.minimumStones) && params.minimumStones > 0
    && [params.savingOwnershipMinimum, params.preferredOwnershipMaximum, params.endpointOwnershipMaximum]
      .every((value) => Number.isFinite(value) && Math.abs(value) <= 1)
    && [params.ownershipFlipMinimum, params.minimumCompensationBook, params.maximumScoreDecline,
      params.maximumWinrateDecline, params.maximumEndpointScoreDecline, params.maximumEndpointWinrateDecline]
      .every((value) => Number.isFinite(value) && value >= 0);
}

function validPoint(point: unknown, size: number): point is string {
  return typeof point === "string" && /^[A-HJ-Z][1-9][0-9]?$/.test(point) && parseGtpVertex(point, size) != null;
}

function validMove(move: unknown, size: number): move is string {
  return move === "pass" || validPoint(move, size);
}

function samePv(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
  return Array.isArray(left) && Array.isArray(right) && left.length > 0 && left.length === right.length
    && left.every((move, index) => move === right[index]);
}

function close(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-8;
}

function validAnalysis(analysis: EngineAnalysis | null | undefined, size: number, visits: number): boolean {
  return !!analysis && Number.isInteger(analysis.visits) && analysis.visits! >= visits
    && Number.isFinite(analysis.scoreLead) && Number.isFinite(analysis.winrate)
    && analysis.winrate! >= 0 && analysis.winrate! <= 1
    && Array.isArray(analysis.ownership) && analysis.ownership.length === size * size
    && analysis.ownership.every((value) => Number.isFinite(value) && Math.abs(value) <= 1);
}

function ownMean(map: number[], stones: string[], size: number, sign: number): number {
  return sign * stones.reduce((sum, stone) => {
    const [x, y] = parseGtpVertex(stone, size)!;
    return sum + map[y * size + x]!;
  }, 0) / stones.length;
}

/** Check links to the producer's legal replay; never run a second Go engine. */
function candidateLineage(comparison: MoveComparison, candidate: CandidateSnapshot, size: number): CandidatePvLineage | null {
  if (!Array.isArray(candidate.pv) || candidate.pv[0] !== candidate.move
    || !candidate.pv.every((move) => validMove(move, size))) return null;
  const line = comparison.context.pvLineages?.find((line) => !!line
    && line.rootPly === comparison.rootPly && line.move === candidate.move && samePv(line.pv, candidate.pv));
  if (!line || line.board?.size !== size || !Array.isArray(line.board.black) || !Array.isArray(line.board.white)
    || ![...line.board.black, ...line.board.white].every((point) => validPoint(point, size))
    || !Array.isArray(line.captures) || !line.captures.every((capture) => !!capture
      && (capture.color === "B" || capture.color === "W") && validPoint(capture.stone, size)
      && (capture.color === "B" ? comparison.context.board.black : comparison.context.board.white).includes(capture.stone)
      && Number.isInteger(capture.plyOffset) && capture.plyOffset > 0 && capture.plyOffset <= line.pv.length)
    || new Set(line.captures.map((capture) => `${capture.color}:${capture.stone}`)).size !== line.captures.length) return null;
  return line;
}

function referenceCandidate(comparison: MoveComparison, item: SacrificeAnnotation): CandidateSnapshot | null {
  const { context } = comparison;
  const evidence = item.evidence;
  const source = evidence.referenceSource ?? "root_candidate";
  if (source === "saving_forced") {
    const probe = Array.isArray(context.savingProbes) ? context.savingProbes.find((probe) => !!probe
      && probe.queryId === evidence.referenceQueryId && probe.candidate?.move === item.referenceMove) : null;
    if (!probe || !probe.queryId || typeof probe.rootHash !== "string" || !probe.rootHash
      || probe.rootHash !== comparison.evidence.rootHash || evidence.referenceRootHash !== probe.rootHash) return null;
    return probe.candidate;
  }
  if (source === "actual_forced") {
    return comparison.evidence.actualSource === "forced" && item.referenceMove === context.actual.move
      && evidence.referenceQueryId === comparison.evidence.actualQueryId
      && (evidence.referenceRootHash == null || evidence.referenceRootHash === comparison.evidence.actualRootHash)
      ? context.actual : null;
  }
  if (source !== "root_candidate" || evidence.referenceQueryId !== comparison.evidence.rootQueryId
    || (evidence.referenceRootHash != null && evidence.referenceRootHash !== comparison.evidence.rootHash)
    || (item.referenceMove === context.actual.move && comparison.evidence.actualSource === "forced")) return null;
  return (Array.isArray(context.rootCandidates)
    ? context.rootCandidates.find((candidate) => candidate?.move === item.referenceMove) : null)
    ?? (context.actual.move === item.referenceMove ? context.actual : null);
}

function validAnnotation(
  item: SacrificeAnnotation, comparison: MoveComparison, assessment: SacrificeAssessment, size: number,
): boolean {
  if (!item || typeof item.groupId !== "string") return false;
  const context = comparison.context;
  const group = context.groups.find((group) => group?.groupId === item.groupId);
  const stones = comparison.mover === "B" ? group?.members?.blackStones : group?.members?.whiteStones;
  const opponents = comparison.mover === "B" ? group?.members?.whiteStones : group?.members?.blackStones;
  const sameStones = (a: string[] | undefined, b: string[] | undefined) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && new Set(a).size === a.length && a.every((stone) => b.includes(stone));
  const evidence = item.evidence;
  if (!(item.rootPly === comparison.rootPly && item.mover === comparison.mover
    && item.preferredMove === comparison.aiMove && item.referenceMove !== comparison.aiMove
    && sameStones(stones, item.stones) && sameStones(item.stones, item.capturedStones)
    && item.stones.length >= assessment.parameters.minimumStones
    && item.stones.every((stone) => validPoint(stone, size)
      && (comparison.mover === "B" ? context.board.black : context.board.white).includes(stone))
    && Array.isArray(opponents) && opponents.length === 0
    && [item.ownershipFlip, item.referenceOwnership, item.preferredOwnership,
      item.endpointOwnership, item.costBook, item.compensationBook].every(Number.isFinite)
    && item.ownershipFlip > 0 && item.costBook > 0 && item.compensationBook >= item.costBook
    && (item.rootOwnership == null || Number.isFinite(item.rootOwnership))
    && (item.compensationPoints == null || Number.isFinite(item.compensationPoints))
    && Array.isArray(item.exchangedWith) && item.exchangedWith.every((id) => typeof id === "string")
    && Array.isArray(item.exchanges)
    && item.exchanges.every((line) => !!line && ["group", "own_territory", "reduce_opponent", "other"].includes(line.kind)
      && (line.id === null || typeof line.id === "string") && Number.isFinite(line.bookValue)
      && Number.isFinite(line.proportion) && (line.points == null || Number.isFinite(line.points))
      && Array.isArray(line.intersections)
      && line.intersections.every((point) => validPoint(point, size)))
    && Array.isArray(item.pv) && item.pv[0] === comparison.aiMove
    && !!evidence && evidence.rootQueryId === comparison.evidence.rootQueryId
    && evidence.preferredPvQueryId === context.preferredPvQueryId
    && evidence.rootHash === comparison.evidence.rootHash
    && typeof evidence.referenceQueryId === "string" && evidence.referenceQueryId.length > 0
    && (evidence.referenceRootHash == null || typeof evidence.referenceRootHash === "string")
    && [evidence.preferredVisits, evidence.referenceVisits, evidence.endpointVisits]
      .every((visits) => Number.isInteger(visits) && visits >= assessment.parameters.minimumVisits)
    && [evidence.scoreAdvantage, evidence.winrateAdvantage, evidence.endpointScoreChange,
      evidence.endpointWinrateChange].every(Number.isFinite)
    && Number.isInteger(evidence.preferredCapturePlyOffset)
    && evidence.preferredCapturePlyOffset > 0 && evidence.preferredCapturePlyOffset <= item.pv.length
    && Array.isArray(evidence.referencePv) && evidence.referencePv[0] === item.referenceMove
    && evidence.referencePv.length >= evidence.preferredCapturePlyOffset)) return false;

  const params = assessment.parameters;
  const preferred = context.preferred;
  const reference = referenceCandidate(comparison, item);
  const endpoint = context.preferredPvEnd;
  if (!reference || !endpoint || !Array.isArray(context.pvLineages)
    || !validAnalysis(preferred, size, params.minimumVisits)
    || !validAnalysis(reference, size, params.minimumVisits)
    || !validAnalysis(endpoint.analysis, size, params.minimumVisits)
    || !samePv(item.pv, preferred.pv) || !samePv(item.pv, endpoint.pv)
    || endpoint.fromMove !== preferred.move || !samePv(evidence.referencePv, reference.pv)
    || evidence.preferredVisits !== preferred.visits || evidence.referenceVisits !== reference.visits
    || evidence.endpointVisits !== endpoint.analysis.visits
    || !evidence.rootQueryId || !evidence.preferredPvQueryId
    || !assessment.checks.some((check) => check.groupId === item.groupId && check.reason === "supported"
      && check.referenceMove === item.referenceMove)) return false;
  const preferredLine = candidateLineage(comparison, preferred, size);
  const referenceLine = candidateLineage(comparison, reference, size);
  if (!preferredLine || !referenceLine) return false;
  const captures = preferredLine.captures.filter((capture) => capture.color === comparison.mover && item.stones.includes(capture.stone));
  if (captures.length !== item.stones.length || !item.stones.every((stone) => captures.some((capture) => capture.stone === stone))
    || Math.max(...captures.map((capture) => capture.plyOffset)) !== evidence.preferredCapturePlyOffset
    || referenceLine.captures.some((capture) => capture.color === comparison.mover && item.stones.includes(capture.stone))
    || !item.stones.every((stone) => (comparison.mover === "B" ? referenceLine.board.black : referenceLine.board.white).includes(stone))) return false;

  const sign = comparison.mover === "B" ? 1 : -1;
  return close(item.referenceOwnership, ownMean(reference.ownership!, item.stones, size, sign))
    && close(item.preferredOwnership, ownMean(preferred.ownership!, item.stones, size, sign))
    && close(item.endpointOwnership, ownMean(endpoint.analysis.ownership!, item.stones, size, sign))
    && close(item.ownershipFlip, item.referenceOwnership - item.preferredOwnership)
    && item.referenceOwnership >= params.savingOwnershipMinimum
    && item.preferredOwnership <= params.preferredOwnershipMaximum
    && item.endpointOwnership <= params.endpointOwnershipMaximum
    && item.ownershipFlip >= params.ownershipFlipMinimum
    && item.compensationBook >= params.minimumCompensationBook
    // The producer omits exchange rows smaller than 1e-6 book units.
    && Math.abs(item.compensationBook - item.exchanges.reduce((sum, exchange) => sum + exchange.bookValue, 0))
      <= (context.groups.length + 3) * 1e-6
    && close(evidence.scoreAdvantage, sign * (preferred.scoreLead! - reference.scoreLead!))
    && close(evidence.winrateAdvantage, sign * (preferred.winrate! - reference.winrate!))
    && close(evidence.endpointScoreChange, sign * (endpoint.analysis.scoreLead! - preferred.scoreLead!))
    && close(evidence.endpointWinrateChange, sign * (endpoint.analysis.winrate! - preferred.winrate!))
    && evidence.scoreAdvantage >= -params.maximumScoreDecline
    && evidence.winrateAdvantage >= -params.maximumWinrateDecline
    && evidence.endpointScoreChange >= -params.maximumEndpointScoreDecline
    && evidence.endpointWinrateChange >= -params.maximumEndpointWinrateDecline;
}

export function sacrificesFromComparison(
  comparison: MoveComparison | null | undefined, ply: number, size: number,
): SacrificeAnnotation[] | null {
  const assessment = alignedSacrificeAssessment(comparison, ply, size);
  return assessment?.status === "assessed" ? [...assessment.annotations] : null;
}
