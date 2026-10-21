import type { MoveComparison, OpeningMatch } from "../analysis/modules";
import type { ColorToken, StreamStatus } from "../analysis/types";
import type { CommentaryFact, GroundedCommentary } from "../commentary";

/** Wire metadata emitted by the pipeline, without presentation or LLM text. */
export interface ReviewSummary {
  schemaVersion: 1;
  moveCount: number;
  completedPositionPlies: number[];
  comparedMovePlies: number[];
  missingPositionPlies: number[];
  missingComparisonPlies: number[];
  rankedMoves: ReviewMoveReference[];
  limitations: string[];
}

export interface ReviewMoveReference {
  ply: number;
  rootPly: number;
  mover: ColorToken;
  actualMove: string;
  aiMove: string;
  /** AI minus actual, in mover perspective. Can be negative. */
  scoreLoss: number;
  winrateLoss: number;
}

export type ReviewCategory =
  | "score_difference"
  | "winrate_difference"
  | "matches_preferred"
  | "group_tradeoff"
  | "territory_tradeoff"
  | "tempo_comparison"
  | "sacrifice_evidence";

export interface ReviewRecommendation {
  text: string;
  /** Every recommendation refers to facts present on this report move. */
  factIds: string[];
}

/** Deterministic report clauses, independent of the optional three-sentence notes. */
export interface ReviewEvidenceSection {
  id: "group_tradeoffs" | "tempo_changes" | "sacrifices";
  title: string;
  facts: CommentaryFact[];
  omittedFacts: number;
  emptyMessage?: string;
}

export interface ReviewReportMove extends ReviewMoveReference {
  rank: number;
  comparison: MoveComparison;
  categories: ReviewCategory[];
  facts: CommentaryFact[];
  explanation: GroundedCommentary;
  evidenceSections: ReviewEvidenceSection[];
  recommendations: ReviewRecommendation[];
  missingEvidence: string[];
}

export interface ReviewReportDocument {
  schemaVersion: 1;
  /** Complete means full position AND played-move comparison coverage. */
  status: "empty" | "in_progress" | "partial" | "complete";
  streamStatus: StreamStatus;
  source: string;
  metadata: Array<{ label: string; value: string }>;
  coverage: ReviewSummary;
  overview: {
    comparedMoves: number;
    positiveScoreDifferences: number;
    matchesPreferred: number;
    largestScoreLoss: number | null;
    /** Search estimates over compared moves only, never a full-game rating. */
    blackPositiveScoreLoss: number;
    whitePositiveScoreLoss: number;
  };
  opening: OpeningMatch | null;
  moves: ReviewReportMove[];
  /** Scan prioritization is a review lead, never a mistake classification. */
  unassessedPlies: number[];
  warnings: string[];
}
