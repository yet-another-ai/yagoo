export {
  REVIEW_MODULE_ISSUES,
} from "./modules";
export type {
  ComparisonBranch,
  ComparisonContext,
  ComparisonEvidence,
  ComparisonGroupTempo,
  GainLossLedger,
  GainLossLine,
  LedgerBaseline,
  LedgerLineKind,
  LedgerStrengthChange,
  LlmCommentary,
  MoveComparison,
  OpeningMatch,
  ReviewReportDocument,
  ReviewReportMove,
  SacrificeAnnotation,
  SacrificeAssessment,
  SacrificeEvidence,
  SacrificeExchange,
  SacrificeParams,
  SacrificeReason,
  CandidatePvLineage,
  TempoChange,
} from "./modules";

export { isAlignedComparison } from "./comparison";
export { alignedSacrificeAssessment, sacrificesFromComparison } from "./sacrifices";

export {
  PIPELINE_SCHEMA_VERSION,
  createInitialAnalysisState,
} from "./types";
export type {
  AnalysisPhase,
  AnalysisStage,
  AnalysisState,
  CandidateSnapshot,
  DeepPlySelection,
  EngineAnalysis,
  GameSnapshot,
  GroupKind,
  GroupMembers,
  GroupPart,
  GroupSnapshot,
  GroupStatus,
  GroupStrength,
  PipelineEvent,
  PlyAnalysis,
  PositionSnapshot,
  StreamStatus,
} from "./types";

export {
  buildGroupOutlines,
  buildGroupVertexIndex,
  dimVerticesOutsideGroup,
  groupMemberVertices,
  groupOutlineColor,
  groupPrimaryColor,
  groupStatusLabel,
  groupStoneCount,
  groupStoneVertices,
  groupValueLabel,
} from "./groups";
export type { GroupOutlineSpec } from "./groups";

export {
  parseNdjson,
  parsePipelineEventLine,
  reducePipelineEvent,
  reducePipelineEvents,
} from "./reduce";

export {
  emptyBoardMap,
  formatGtpVertex,
  OWNERSHIP_PAINT_STRENGTH,
  ownershipToHeatMap,
  ownershipToPaintMap,
  parseGtpVertex,
} from "./coords";

export {
  buildBoardOverlays,
  buildPvPreview,
  buildReviewSeries,
  colorToSign,
  formatAnalysisComment,
  plyAt,
  resolveSgfRules,
  rootForPly,
} from "./display";
export type { PlyBoardOverlays, ReviewSeriesPoint } from "./display";

export { useAnalysisStream } from "./useAnalysisStream";
export type { UseAnalysisStreamResult } from "./useAnalysisStream";

export type {
  AnalysisEventSource,
  AnalysisSourceHandle,
  AnalysisSourceHandlers,
} from "./sources/types";

export {
  createNdjsonEventsSource,
  createNdjsonFileSource,
  createNdjsonTextSource,
} from "./sources/ndjsonFile";
export type { NdjsonFileSourceOptions } from "./sources/ndjsonFile";

export {
  createLiveNativeSource,
  isLiveNativeAvailable,
} from "./sources/liveNative";
export type { LiveNativeSourceOptions } from "./sources/liveNative";

export {
  createBrowserEngineSource,
  isBrowserEngineAvailable,
} from "./sources/browserEngine";
export type {
  BrowserEngineAdapter,
  BrowserEngineSourceOptions,
} from "./sources/browserEngine";
