/** Wire types for `yagoo analyze` / `yagoo-pipeline` NDJSON events (schema v1). */

export const PIPELINE_SCHEMA_VERSION = 1;

export type AnalysisPhase = "scan" | "deep";
export type AnalysisStage = "root" | "pass_probe" | "pv_end";
export type ColorToken = "B" | "W";
export type OwnershipConvention = "black_positive";

export interface EngineAnalysis {
  visits?: number | null;
  winrate?: number | null;
  scoreLead?: number | null;
  scoreStdev?: number | null;
  utility?: number | null;
  /** Row-major from A19; black-positive. */
  ownership?: number[] | null;
  ownershipStdev?: number[] | null;
  policy?: number[] | null;
}

export interface CandidateSnapshot {
  move: string;
  order?: number | null;
  visits?: number | null;
  winrate?: number | null;
  scoreLead?: number | null;
  scoreStdev?: number | null;
  prior?: number | null;
  utility?: number | null;
  lcb?: number | null;
  pv?: string[] | null;
  pvVisits?: number[] | null;
  ownership?: number[] | null;
  ownershipStdev?: number[] | null;
}

export interface BoardSnapshot {
  size: number;
  black: string[];
  white: string[];
}

export interface ChainSnapshot {
  color: ColorToken;
  stones: string[];
  liberties: string[];
  libertyCount: number;
}

export interface PvEndSnapshot {
  fromMove: string;
  pv: string[];
  analysis: EngineAnalysis;
}

/**
 * Teaching group (块) — fate-correlated unit, **not** a rules chain (串).
 * Additive proposal: see `docs/pipeline/groups-proposal.md`. Pipeline does not
 * emit this yet; fixtures may set `source: "fixture_proposal"`.
 */
export type GroupKind = "simple" | "contested" | "bound";
export type GroupStatus =
  | "settled"
  | "weak"
  | "tempo_critical"
  | "dead"
  | "likely_seki";

export interface GroupMembers {
  blackStones: string[];
  whiteStones: string[];
  empty: string[];
}

export interface GroupPart {
  points: string[];
  chains?: string[];
}

export interface GroupStrength {
  black?: number;
  white?: number;
}

export interface GroupSnapshot {
  groupId: string;
  members: GroupMembers;
  chains?: string[];
  parts?: GroupPart[];
  kind: GroupKind;
  strength?: GroupStrength;
  certainty?: number;
  cohesion?: number;
  boundConfidence?: number | null;
  /** Tempo module status (docs/modules/tempo-sensitivity.md). */
  status?: GroupStatus;
  gPlus?: number | null;
  gMinus?: number | null;
  delta?: number | null;
  /** `"fixture_proposal"` = hand-authored demo until pipeline groups land. */
  source?: "pipeline" | "fixture_proposal";
}

export interface PositionSnapshot {
  schemaVersion: number;
  ply: number;
  toPlay: ColorToken;
  lastMove?: string | null;
  ownershipConvention: OwnershipConvention;
  board: BoardSnapshot;
  /** Rules chains (串) — not teaching groups. */
  chains: ChainSnapshot[];
  /**
   * Teaching groups (块). Optional / additive — see groups-proposal.md.
   * Absent until the pipeline groups module exists.
   */
  groups?: GroupSnapshot[];
  root?: EngineAnalysis | null;
  passProbe?: EngineAnalysis | null;
  passProbeSkipped?: string | null;
  candidates?: CandidateSnapshot[];
  pvEnds?: PvEndSnapshot[];
  phase?: string | null;
}

export interface GameSnapshot {
  schemaVersion: number;
  size: number;
  komi: number;
  rules?: string | null;
  ownershipConvention: OwnershipConvention;
  positions: PositionSnapshot[];
}

export interface DeepPlySelection {
  ply: number;
  score: number;
  winrateDelta: number;
  scoreLeadDelta: number;
  ownershipDelta: number;
}

export type PipelineEvent =
  | {
      type: "gameStarted";
      v: number;
      size: number;
      komi: number;
      rules?: string | null;
      moveCount: number;
      positionCount: number;
      strategy: string;
    }
  | {
      type: "phaseStarted";
      v: number;
      phase: AnalysisPhase;
      visits: number;
    }
  | { type: "phaseCompleted"; v: number; phase: AnalysisPhase }
  | {
      type: "deepPliesSelected";
      v: number;
      mode: string;
      plies: number[];
      reasons?: DeepPlySelection[];
    }
  | {
      type: "positionStarted";
      v: number;
      ply: number;
      toPlay: string;
      phase: AnalysisPhase;
    }
  | {
      type: "stagePartial";
      v: number;
      ply: number;
      phase: AnalysisPhase;
      stage: AnalysisStage;
      visits?: number | null;
      root?: EngineAnalysis | null;
    }
  | {
      type: "stageCompleted";
      v: number;
      ply: number;
      phase: AnalysisPhase;
      stage: AnalysisStage;
      analysis?: EngineAnalysis | null;
      skipped?: string | null;
    }
  | {
      type: "positionCompleted";
      v: number;
      phase: AnalysisPhase;
      snapshot: PositionSnapshot;
    }
  | {
      type: "gameCompleted";
      v: number;
      game?: GameSnapshot | null;
    }
  | { type: "warning"; v: number; message: string }
  | { type: "error"; v: number; message: string; ply?: number | null };

/** Per-ply analysis accumulated by the reducer (scan then deepen). */
export interface PlyAnalysis {
  ply: number;
  toPlay?: string;
  /** Latest root analysis (partial or complete). */
  root?: EngineAnalysis | null;
  /** True when the latest root update was a during-search partial. */
  rootPartial: boolean;
  phase?: AnalysisPhase;
  /** Authoritative snapshot when `positionCompleted` arrived for this phase. */
  snapshot?: PositionSnapshot | null;
  candidates: CandidateSnapshot[];
  /** Teaching groups (块) from the latest snapshot, if present. */
  groups: GroupSnapshot[];
  passProbe?: EngineAnalysis | null;
  complete: boolean;
}

export type StreamStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "error";

export interface AnalysisState {
  status: StreamStatus;
  schemaVersion: number | null;
  size: number | null;
  komi: number | null;
  /** Missing RU → treat as Chinese (matches pipeline / SGF parser). */
  rules: string;
  moveCount: number | null;
  positionCount: number | null;
  strategy: string | null;
  currentPhase: AnalysisPhase | null;
  phaseVisits: number | null;
  deepPlies: number[];
  deepMode: string | null;
  deepReasons: DeepPlySelection[];
  /** Ply currently being analyzed (positionStarted). */
  activePly: number | null;
  plies: Record<number, PlyAnalysis>;
  eventCount: number;
  warnings: string[];
  lastError: string | null;
  game: GameSnapshot | null;
}

export function createInitialAnalysisState(): AnalysisState {
  return {
    status: "idle",
    schemaVersion: null,
    size: null,
    komi: null,
    rules: "chinese",
    moveCount: null,
    positionCount: null,
    strategy: null,
    currentPhase: null,
    phaseVisits: null,
    deepPlies: [],
    deepMode: null,
    deepReasons: [],
    activePly: null,
    plies: {},
    eventCount: 0,
    warnings: [],
    lastError: null,
    game: null,
  };
}
