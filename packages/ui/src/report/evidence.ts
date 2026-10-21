import type { ComparisonContext, SacrificeAssessment } from "../analysis/modules";
import type { CommentaryFact, FactEvidence } from "../commentary";
import type { ReviewEvidenceSection } from "./types";

const SECTION_LIMIT = 4;
const number = (value: number) => (Object.is(value, -0) ? 0 : value).toFixed(2);

/**
 * Only call after alignedSacrificeAssessment validates the complete comparison.
 * These are recorded claims, not another detector or a calibration result.
 */
export function buildReportSacrificeFacts(
  ply: number, assessment: SacrificeAssessment | null, context: ComparisonContext,
): CommentaryFact[] {
  if (assessment?.status !== "assessed") return [];
  const base = `/plies/${ply}/comparison/sacrificeAssessment`;
  return assessment.annotations.map((item, index) => {
    const path = `${base}/annotations/${index}`;
    const ref = (suffix: string, value: unknown): FactEvidence => ({
      path: `${path}/${suffix}`, value: structuredClone(value),
    });
    const captured = item.capturedStones.length;
    const lineageEvidence: FactEvidence[] = [];
    for (const [move, pv] of [[item.preferredMove, item.pv], [item.referenceMove, item.evidence.referencePv]] as const) {
      const index = context.pvLineages?.findIndex((line) => !!line && line.rootPly === item.rootPly
        && line.move === move && Array.isArray(line.pv) && line.pv.length === pv.length
        && line.pv.every((point, offset) => point === pv[offset])) ?? -1;
      if (index < 0) continue; // The assessment validator requires both records.
      const line = context.pvLineages![index]!;
      const path = `/plies/${ply}/comparison/context/pvLineages/${index}`;
      for (const field of ["rootPly", "move", "pv", "captures", "board"] as const) {
        lineageEvidence.push({ path: `${path}/${field}`, value: structuredClone(line[field]) });
      }
    }
    return {
      id: `ply-${ply}/sacrifice-${index}`, priority: 75,
      variants: [
        `At root ply ${item.rootPly}, the sacrifice module reports a supported candidate for ${item.mover === "B" ? "Black" : "White"} group ${item.groupId}. ` +
        `The preferred ${item.preferredMove} line captures ${captured} original ${captured === 1 ? "stone" : "stones"} by PV move ${item.evidence.preferredCapturePlyOffset}; ` +
        `the saving alternative ${item.referenceMove} retains them through that horizon. ` +
        `The recorded ownership flip is ${number(item.ownershipFlip)}, with group cost ${number(item.costBook)} and net compensation elsewhere ${number(item.compensationBook)} ownership-book units. ` +
        "These book units are uncalibrated and do not establish intention or point value.",
      ],
      evidence: [
        { path: `${base}/status`, value: assessment.status },
        { path: `${base}/parameters`, value: structuredClone(assessment.parameters) },
        { path: `${base}/limitations`, value: [...assessment.limitations] },
        ref("rootPly", item.rootPly), ref("mover", item.mover), ref("groupId", item.groupId),
        ref("preferredMove", item.preferredMove), ref("referenceMove", item.referenceMove),
        ref("stones", item.stones), ref("capturedStones", item.capturedStones),
        ref("pv", item.pv), ref("evidence/referencePv", item.evidence.referencePv),
        ref("evidence/preferredCapturePlyOffset", item.evidence.preferredCapturePlyOffset),
        ref("ownershipFlip", item.ownershipFlip), ref("costBook", item.costBook),
        ref("compensationBook", item.compensationBook), ref("exchanges", item.exchanges),
        ref("evidence/rootQueryId", item.evidence.rootQueryId),
        ref("evidence/referenceQueryId", item.evidence.referenceQueryId),
        ...(item.evidence.referenceSource == null ? [] : [ref("evidence/referenceSource", item.evidence.referenceSource)]),
        ...(item.evidence.referenceRootHash == null ? [] : [ref("evidence/referenceRootHash", item.evidence.referenceRootHash)]),
        ref("evidence/preferredPvQueryId", item.evidence.preferredPvQueryId),
        ref("evidence/rootHash", item.evidence.rootHash),
        ref("evidence/preferredVisits", item.evidence.preferredVisits),
        ref("evidence/referenceVisits", item.evidence.referenceVisits),
        ref("evidence/endpointVisits", item.evidence.endpointVisits),
        ...lineageEvidence,
      ],
      target: { groupId: item.groupId, intersections: [...item.capturedStones] },
    };
  });
}

/** Each category has its own budget, so scalar score facts cannot displace it. */
export function buildReportEvidenceSections(
  facts: readonly CommentaryFact[], assessment: SacrificeAssessment | null,
): ReviewEvidenceSection[] {
  const section = (
    id: ReviewEvidenceSection["id"], title: string,
    selected: CommentaryFact[], emptyMessage: string,
  ): ReviewEvidenceSection => ({
    id, title, facts: selected.slice(0, SECTION_LIMIT),
    omittedFacts: Math.max(0, selected.length - SECTION_LIMIT),
    ...(selected.length ? {} : { emptyMessage }),
  });
  return [
    section("group_tradeoffs", "Group and territory trade-offs", facts.filter((fact) =>
      fact.id.includes("/comparison-ledger-line-") && fact.evidence.some((entry) =>
        entry.path.endsWith("/kind") && ["group", "own_territory", "reduce_opponent"].includes(String(entry.value)))),
    "No group or territory trade-off facts are available."),
    section("tempo_changes", "Group tempo comparison", facts.filter((fact) =>
      fact.id.includes("/comparison-tempo-")),
    "No supported branch tempo comparison was emitted."),
    section("sacrifices", "Supported sacrifice evidence", assessment?.status === "assessed"
      ? facts.filter((fact) => fact.id.includes("/sacrifice-")) : [], assessment?.status === "assessed"
      ? "No supported sacrifice candidate was reported for the assessed groups."
      : "Sacrifice assessment is unassessed."),
  ];
}
