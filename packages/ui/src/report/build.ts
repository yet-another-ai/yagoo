import sgf from "@sabaki/sgf";
import type { AnalysisState, PipelineEvent } from "../analysis/types";
import { alignedSacrificeAssessment } from "../analysis/sacrifices";
import { reducePipelineEvents } from "../analysis/reduce";
import { matchSgfOpening } from "../analysis/openings";
import {
  buildCommentaryFacts, resolveCommentary,
  type CommentaryFact,
} from "../commentary";
import { isReportComparison, summarizeReview } from "./summary";
import type {
  ReviewCategory, ReviewRecommendation, ReviewReportDocument, ReviewReportMove,
} from "./types";

export interface ReviewReportOptions {
  sgf?: string;
  source?: string | null;
  /** Human-readable provenance; never treated as HTML or a link. */
  provenance?: string[];
}

function metadata(text: string | undefined): ReviewReportDocument["metadata"] {
  if (!text) return [];
  try {
    const data = (sgf.parse(text)[0]?.data ?? {}) as Record<string, string[] | undefined>;
    return [
      ["Game", "GN"], ["Black", "PB"], ["White", "PW"], ["Date", "DT"],
      ["Event", "EV"], ["Result recorded in SGF", "RE"], ["Source recorded in SGF", "SO"],
    ].flatMap(([label, key]) => {
      const value = data[key!]?.[0];
      return typeof value === "string" && value ? [{ label: label!, value }] : [];
    });
  } catch {
    return [];
  }
}

function categories(
  facts: CommentaryFact[], actual: string, preferred: string, assessedSacrifice: boolean,
): ReviewCategory[] {
  const ids = facts.map((f) => f.id.split("/")[1] ?? "");
  const result: ReviewCategory[] = [];
  if (ids.some((id) => id === "comparison-score-loss")) result.push("score_difference");
  if (ids.some((id) => id === "comparison-winrate-loss")) result.push("winrate_difference");
  if (actual === preferred) result.push("matches_preferred");
  if (facts.some((f) => f.id.includes("/comparison-ledger-") && f.target?.groupId)) {
    result.push("group_tradeoff");
  }
  if (facts.some((f) => f.id.includes("/comparison-ledger-line-") && f.evidence.some(
    (e) => e.path.endsWith("/kind") && ["own_territory", "reduce_opponent"].includes(String(e.value)),
  ))) {
    result.push("territory_tradeoff");
  }
  if (ids.some((id) => id.startsWith("comparison-tempo-"))) result.push("tempo_comparison");
  if (assessedSacrifice && ids.some((id) => id.startsWith("sacrifice-"))) {
    result.push("sacrifice_evidence");
  }
  return result;
}

function recommendations(facts: CommentaryFact[]): ReviewRecommendation[] {
  const result: ReviewRecommendation[] = [];
  const select = (test: (fact: CommentaryFact) => boolean, text: string) => {
    const ids = facts.filter(test).map((f) => f.id);
    if (ids.length) result.push({ text, factIds: ids });
  };
  select((f) => /\/comparison-(score|winrate)-loss$/.test(f.id),
    "Replay the actual and preferred moves from the preceding root and compare their reported search values.");
  select((f) => f.id.includes("/comparison-ledger-"),
    "Inspect the attributed intersections in both branches. Treat unpriced ownership shares as shares, not points.");
  select((f) => f.id.includes("/comparison-tempo-"),
    "Compare the fixed root groups under each branch's explicit pass probe before choosing a continuation.");
  select((f) => f.id.includes("/sacrifice-"),
    "Replay the supplied preferred line and check the sacrifice assessment and its evidence limits.");
  return result;
}

/** Pure, deterministic enrichment of authoritative streamed evidence. No services. */
export function buildReviewReport(
  state: AnalysisState,
  options: ReviewReportOptions = {},
): ReviewReportDocument {
  const coverage = summarizeReview(state);
  const moves: ReviewReportMove[] = [];
  for (const reference of coverage.rankedMoves) {
    const row = state.plies[reference.ply]!;
    if (!isReportComparison(row.comparison, reference.ply)) continue;
    // #25's additive assessment owns its root and preferred line. A legacy
    // standalone sacrifices array cannot establish that alignment.
    const assessment = alignedSacrificeAssessment(
      row.comparison, reference.ply, row.comparison.context.board.size,
    );
    const sacrifices = assessment?.status === "assessed" ? assessment.annotations : null;
    // The comparison registry resolves p-1 context itself. In particular, do
    // not pass snapshot p's next-mover ledger/groups as reasons for move p.
    const facts = buildCommentaryFacts({
      ply: reference.ply,
      comparison: row.comparison,
      sacrifices,
    }).filter((f) => f.id.includes("/comparison-") || f.id.includes("/sacrifice-"));
    moves.push({
      ...reference, rank: moves.length + 1, comparison: row.comparison,
      facts, explanation: resolveCommentary(facts, row.commentary),
      categories: categories(facts, reference.actualMove, reference.aiMove, !!sacrifices?.length),
      recommendations: recommendations(facts),
      missingEvidence: [
        ...(!row.comparison.ledgerDiff ? ["No actual-versus-preferred attribution was emitted."] : []),
        ...(!row.comparison.groupTempo.length ? ["No explicit branch tempo comparison was emitted."] : []),
        ...(sacrifices === null ? ["Sacrifice assessment is unassessed."] : []),
      ],
    });
  }
  const hasPositions = coverage.completedPositionPlies.length > 0;
  const full = coverage.missingPositionPlies.length === 0 &&
    coverage.missingComparisonPlies.length === 0 && state.moveCount !== null;
  const warnings = [
    ...state.warnings,
    ...(state.lastError ? [state.lastError] : []),
    ...(options.provenance ?? []),
    ...coverage.limitations,
    ...moves.flatMap((row) => row.comparison.evidence.limitations
      .map((limitation) => `Move ${row.ply}: ${limitation}`)),
  ];
  const source = options.source ?? "Unspecified analysis source";
  // The historical bundled corpus predates full-history queries. Do not pass
  // off its scan deltas as authentic played-move comparisons.
  if (/bundled sample/i.test(source) && !moves.length) {
    warnings.push("Historical bundled sample: some recorded queries omitted history and admit a ko-illegal candidate. This corpus has no validated played-move comparisons; scan swings are unassessed leads only.");
  }
  return {
    schemaVersion: 1,
    status: state.status === "streaming" ? "in_progress"
      : !hasPositions ? "empty"
        : full && state.status === "completed" && state.pipelineCompleted ? "complete" : "partial",
    streamStatus: state.status, source, metadata: metadata(options.sgf),
    coverage,
    overview: {
      comparedMoves: moves.length,
      positiveScoreDifferences: moves.filter((m) => m.scoreLoss > 0).length,
      matchesPreferred: moves.filter((m) => m.actualMove === m.aiMove).length,
      largestScoreLoss: moves.length ? Math.max(...moves.map((m) => m.scoreLoss)) : null,
      blackPositiveScoreLoss: moves.filter((m) => m.mover === "B")
        .reduce((sum, m) => sum + Math.max(0, m.scoreLoss), 0),
      whitePositiveScoreLoss: moves.filter((m) => m.mover === "W")
        .reduce((sum, m) => sum + Math.max(0, m.scoreLoss), 0),
    },
    opening: options.sgf ? matchSgfOpening(options.sgf) : state.opening,
    moves,
    // Range/all deepening targets do not establish scan swings; only emitted
    // selection reasons identify leads, and ply 0 is not a played move.
    unassessedPlies: [...new Set(state.deepReasons.map((reason) => reason.ply))]
      .filter((p) => Number.isSafeInteger(p) && p > 0 && p <= coverage.moveCount &&
        !coverage.comparedMovePlies.includes(p)).sort((a, b) => a - b),
    warnings: [...new Set(warnings)],
  };
}

/** Offline orchestration for consumers of the CLI/browser/native event format. */
export function reviewPipelineEvents(
  events: readonly PipelineEvent[], options: ReviewReportOptions = {},
): ReviewReportDocument {
  return buildReviewReport(reducePipelineEvents(events), options);
}
