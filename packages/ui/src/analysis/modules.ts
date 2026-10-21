import type {
  BoardSnapshot, CandidateSnapshot, ColorToken, EngineAnalysis,
  GroupSnapshot, GroupStatus, PvEndSnapshot,
} from "./types";

/**
 * Data contracts for review teaching modules.
 *
 * The reviewer renders a value when the reducer has one, and a labelled empty
 * state when the field is null. Nothing in the UI invents these objects.
 *
 * Specs: docs/modules/gain-loss-ledger.md, docs/modules/explanation-generation.md,
 * and issues #23–#29.
 */

export type LedgerBaseline = "pass" | "best";

export type LedgerLineKind =
  | "group"
  | "own_territory"
  | "reduce_opponent"
  | "other";

/** Branch pass probes are required before a tempo transition can be assessed. */
export type TempoChange = "unassessed" | "branch_pass_probes";

export interface LedgerStrengthChange {
  color: "B" | "W";
  reference: number;
  candidate: number;
  delta: number;
}

/** One attributed line of a per-move gain/loss ledger (#23). */
export interface GainLossLine {
  kind: LedgerLineKind;
  /** Teaching-group id when `kind` is `"group"`. */
  id?: string;
  /** Current producer emits `"strength_changed"`; not a life-status claim. */
  change?: string;
  /** Signed scaled points; null when book/search consistency fails. */
  points: number | null;
  /** Raw ownership contribution, never labelled as calibrated points. */
  bookValue: number;
  /** Signed share of the sum of absolute line contributions. */
  proportion: number;
  /** Exact root-board coordinates attributed to this line. */
  intersections: string[];
  strengthChanges?: LedgerStrengthChange[];
  tempo?: TempoChange | null;
  tempoChanges?: ComparisonGroupTempo[];
}

/**
 * Fact fragment from the gain/loss ledger module (#23).
 * `vs` is the baseline the points are measured against.
 */
export interface GainLossLedger {
  rootPly: number;
  mover: "B" | "W";
  move: string;
  vs: LedgerBaseline;
  referenceMove: string;
  value: number;
  ledger: GainLossLine[];
  /** False when book ownership and score-lead disagree beyond tolerance. */
  consistent: boolean;
  bookTotal: number;
  scaling: "score" | "proportions";
  inconsistency?: "zero_book" | "book_search_mismatch";
}

/**
 * Structured comparison of the actual move with KataGo's choice (#24).
 * Prose is not part of this object — that is commentary (#28).
 */
export interface MoveComparison {
  ply: number;
  rootPly: number;
  mover: ColorToken;
  actualMove: string;
  aiMove: string;
  /** Winrate of the player who played move p, as a fraction in [0, 1]. */
  actualWinrate: number;
  aiWinrate: number;
  /** Score lead from Black's perspective, matching `EngineAnalysis.scoreLead`. */
  actualScoreLead: number;
  aiScoreLead: number;
  /** Preferred minus actual in mover perspective; can be negative. */
  winrateLoss: number;
  scoreLoss: number;
  /**
   * Black-positive ownership of the actual line minus the AI line,
   * row-major from A19. Both maps come from the same historical root.
   */
  ownershipDelta: number[];
  /** Per-group ledger of actual versus AI. Depends on #23. */
  ledgerDiff: GainLossLedger | null;
  context: ComparisonContext;
  evidence: ComparisonEvidence;
  groupTempo: ComparisonGroupTempo[];
  sacrificeAssessment?: SacrificeAssessment | null;
}

export interface ComparisonEvidence {
  rootQueryId: string;
  actualQueryId: string;
  actualSource: "root_candidate" | "forced";
  requestedVisits: number;
  minimumCandidateVisits: number;
  rootVisits: number | null;
  actualVisits: number | null;
  aiVisits: number | null;
  rootHash: string | null;
  actualRootHash: string | null;
  limitations: string[];
}

export interface ComparisonBranch {
  toPlay: ColorToken;
  board: BoardSnapshot;
  root: EngineAnalysis;
  passProbe: EngineAnalysis | null;
  rootQueryId: string;
  passQueryId: string | null;
}

export interface ComparisonContext {
  rootPly: number;
  mover: ColorToken;
  board: BoardSnapshot;
  groups: GroupSnapshot[];
  root: EngineAnalysis;
  passProbe: EngineAnalysis | null;
  passQueryId: string | null;
  actual: CandidateSnapshot;
  preferred: CandidateSnapshot;
  actualBranch: ComparisonBranch | null;
  preferredBranch: ComparisonBranch | null;
  preferredPvEnd: PvEndSnapshot | null;
  preferredPvQueryId: string | null;
  rootCandidates?: CandidateSnapshot[];
  pvLineages?: CandidatePvLineage[];
  savingProbes?: SavingCandidateProbe[];
}

export interface SavingCandidateProbe {
  queryId: string;
  rootHash: string | null;
  candidate: CandidateSnapshot;
}

export interface CandidatePvLineage {
  rootPly: number;
  move: string;
  pv: string[];
  board: BoardSnapshot;
  captures: { color: ColorToken; stone: string; plyOffset: number }[];
}

export interface ComparisonGroupTempo {
  groupId: string;
  color: ColorToken;
  /** Root coordinates retained across both branches, including capture. */
  stones: string[];
  actualStatus: GroupStatus;
  preferredStatus: GroupStatus;
  actualGPlus: number;
  actualGMinus: number;
  preferredGPlus: number;
  preferredGMinus: number;
}

/** A supported sacrifice candidate; not proof of intention or calibrated value. */
export interface SacrificeAnnotation {
  rootPly: number;
  mover: ColorToken;
  groupId: string;
  stones: string[];
  capturedStones: string[];
  preferredMove: string;
  referenceMove: string;
  /** Saving-alternative own-color mean minus preferred own-color mean. */
  ownershipFlip: number;
  rootOwnership: number | null;
  referenceOwnership: number;
  preferredOwnership: number;
  endpointOwnership: number;
  costBook: number;
  /** NET elsewhere benefit in uncalibrated ownership-book units. */
  compensationBook: number;
  /** Net elsewhere points only with consistent, sign-preserving scaling. */
  compensationPoints: number | null;
  exchangedWith: string[];
  exchanges: SacrificeExchange[];
  pv: string[];
  evidence: SacrificeEvidence;
}

export interface SacrificeExchange {
  kind: LedgerLineKind;
  id: string | null;
  intersections: string[];
  /** Preferred minus saving, mover-positive; negative means another cost. */
  bookValue: number;
  proportion: number;
  points: number | null;
}

export interface SacrificeEvidence {
  rootQueryId: string;
  referenceQueryId: string;
  /** Omitted by legacy producers, where the reference was a retained root candidate. */
  referenceSource?: "root_candidate" | "actual_forced" | "saving_forced";
  referenceRootHash?: string | null;
  preferredPvQueryId: string;
  rootHash: string | null;
  preferredVisits: number;
  referenceVisits: number;
  endpointVisits: number;
  preferredCapturePlyOffset: number;
  referencePv: string[];
  scoreAdvantage: number;
  winrateAdvantage: number;
  endpointScoreChange: number;
  endpointWinrateChange: number;
}

export interface SacrificeParams {
  minimumStones: number;
  minimumVisits: number;
  savingOwnershipMinimum: number;
  preferredOwnershipMaximum: number;
  endpointOwnershipMaximum: number;
  ownershipFlipMinimum: number;
  minimumCompensationBook: number;
  maximumScoreDecline: number;
  maximumWinrateDecline: number;
  maximumEndpointScoreDecline: number;
  maximumEndpointWinrateDecline: number;
}

export type SacrificeReason = "supported" | "invalid_evidence" | "missing_preferred_pv"
  | "insufficient_visits" | "mixed_or_opponent_group" | "too_few_stones"
  | "original_stones_not_captured" | "ownership_not_lost" | "saving_alternative_unavailable"
  | "global_value_declines" | "compensation_unavailable";

export interface SacrificeAssessment {
  rootPly: number;
  mover: ColorToken;
  preferredMove: string;
  status: "assessed" | "unassessed";
  annotations: SacrificeAnnotation[];
  checks: { groupId: string; reason: SacrificeReason; referenceMove: string | null }[];
  parameters: SacrificeParams;
  limitations: string[];
}

/** Opening or joseki match for the header (#27). */
export interface OpeningMatch {
  /** Fuseki or joseki display name from the licensed dictionary. */
  name: string;
  /** Corner-line name when the match is a joseki. */
  joseki: string | null;
  /** First global ply outside the stored continuation; not a move-quality verdict. */
  deviationPly: number | null;
  /** Data-source id. The matcher documents the licence; the UI only displays it. */
  source: string;
}

/**
 * Grounded sentences selected from structured facts (#28).
 * The bounded renderer, not a provider, constructs `text` from cited facts.
 */
export interface LlmCommentary {
  text: string;
  citedFactIds: string[];
  provider: string;
  /** True only for a validated clause-selection response; not a free-prose truth score. */
  verified: boolean;
}

/** One key move inside an automatic review report (#29). */
export interface ReviewReportMove {
  ply: number;
  move: string | null;
  comparison: MoveComparison | null;
  ledger: GainLossLedger | null;
  sacrifices: SacrificeAnnotation[] | null;
  commentary: LlmCommentary | null;
}

/**
 * Exportable automatic review (#29).
 * Stays null on `AnalysisState` until the pipeline emits it.
 */
export interface ReviewReportDocument {
  markdown: string | null;
  moves: ReviewReportMove[];
}

/** Issue numbers for the modules this UI reserves a place for. */
export const REVIEW_MODULE_ISSUES = {
  ledger: 23,
  comparison: 24,
  sacrifice: 25,
  tryMove: 26,
  opening: 27,
  commentary: 28,
  report: 29,
  liveNative: 19,
  browserEngine: 20,
  modelIsland: 22,
} as const;
