/**
 * Data contracts for review modules the pipeline does not emit yet.
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

/** Sente / gote change for one group between the move and its reference. */
export type TempoChange = "sente" | "gote" | "double_sente" | "unchanged";

/** One attributed line of a per-move gain/loss ledger (#23). */
export interface GainLossLine {
  kind: LedgerLineKind;
  /** Teaching-group id when `kind` is `"group"`. */
  id?: string;
  /** Status transition, for example `"weak->settled"`. */
  change?: string;
  /** Signed points in the mover's favor. Negative is a loss. */
  points: number;
  tempo?: TempoChange | null;
}

/**
 * Fact fragment from the gain/loss ledger module (#23).
 * `vs` is the baseline the points are measured against.
 */
export interface GainLossLedger {
  move: string;
  vs: LedgerBaseline | string;
  value: number;
  ledger: GainLossLine[];
  /** False when book ownership and score-lead disagree beyond tolerance. */
  consistent: boolean;
}

/**
 * Structured comparison of the actual move with KataGo's choice (#24).
 * Prose is not part of this object — that is commentary (#28).
 */
export interface MoveComparison {
  ply: number;
  actualMove: string;
  aiMove: string;
  /** Winrate of the side to play, as a fraction in \[0, 1\]. */
  actualWinrate: number | null;
  aiWinrate: number | null;
  /** Score lead from Black's perspective, matching `EngineAnalysis.scoreLead`. */
  actualScoreLead: number | null;
  aiScoreLead: number | null;
  /**
   * Black-positive ownership of the actual line minus the AI line,
   * row-major from A19. Absent until #24 emits it.
   */
  ownershipDelta?: number[] | null;
  /** Per-group ledger of actual versus AI. Depends on #23. */
  ledgerDiff: GainLossLedger | null;
}

/** A sacrifice (弃子) along the preferred line (#25). */
export interface SacrificeAnnotation {
  groupId: string;
  /**
   * How far the group's ownership flips toward the opponent along the PV.
   * Positive means the mover gives the group away.
   */
  ownershipFlip: number;
  /** Points gained elsewhere, when the ledger can price the exchange. */
  compensationPoints: number | null;
  /** Group ids (or region labels) that receive the compensation. */
  exchangedWith: string[];
  /** PV moves along which the sacrifice shows up. */
  pv: string[];
}

/** Opening or joseki match for the header (#27). */
export interface OpeningMatch {
  /** Fuseki or joseki display name from the licensed dictionary. */
  name: string;
  /** Corner-line name when the match is a joseki. */
  joseki: string | null;
  /** First ply that leaves the matched line, if the game deviates. */
  deviationPly: number | null;
  /** Data-source id. The matcher documents the licence; the UI only displays it. */
  source: string;
}

/**
 * Natural-language paraphrase of structured facts (#28).
 * Every claim in `text` is supposed to be traceable to `citedFactIds`.
 */
export interface LlmCommentary {
  text: string;
  citedFactIds: string[];
  provider: string;
  /** False when verification failed and `text` is the template fallback. */
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
