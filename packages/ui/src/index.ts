export { default as Goban } from "./goban/Goban.vue";
export { default as OverlayLayer } from "./overlays/OverlayLayer.vue";
export { default as ReviewerLayout } from "./layout/ReviewerLayout.vue";
export { default as AnalysisReviewer } from "./layout/AnalysisReviewer.vue";
export { default as BottomBar } from "./layout/BottomBar.vue";
export { default as CandidatesPanel } from "./layout/CandidatesPanel.vue";
export { default as CommentBox } from "./layout/CommentBox.vue";
export { default as GroupsPanel } from "./layout/GroupsPanel.vue";
export { default as WinrateGraph } from "./layout/WinrateGraph.vue";
export type { WinratePoint } from "./layout/WinrateGraph.vue";
export type { InspectorPerspective } from "./reviewer/MoveInspector.vue";
export type { KeyMoveRow } from "./reviewer/keyMoves";
export { keyMovesFromState } from "./reviewer/keyMoves";

export { useGame } from "./composables/useGame";
export type { GamePosition } from "./composables/gamePosition";
export type {
  GameChildInfo,
  GamePlayerInfo,
  UseGameResult,
} from "./composables/useGame";

export {
  PIPELINE_SCHEMA_VERSION,
  REVIEW_MODULE_ISSUES,
  OWNERSHIP_PAINT_STRENGTH,
  buildBoardOverlays,
  buildGroupOutlines,
  buildGroupVertexIndex,
  buildPvPreview,
  buildReviewSeries,
  colorToSign,
  createBrowserEngineSource,
  createInitialAnalysisState,
  createLiveNativeSource,
  createNdjsonEventsSource,
  createNdjsonFileSource,
  createNdjsonTextSource,
  dimVerticesOutsideGroup,
  formatAnalysisComment,
  formatGtpVertex,
  groupMemberVertices,
  groupOutlineColor,
  groupPrimaryColor,
  groupStatusLabel,
  groupStoneCount,
  groupStoneVertices,
  groupValueLabel,
  isBrowserEngineAvailable,
  isAlignedComparison,
  alignedSacrificeAssessment,
  sacrificesFromComparison,
  isLiveNativeAvailable,
  matchOpening,
  matchSgfOpening,
  ownershipToHeatMap,
  ownershipToPaintMap,
  parseGtpVertex,
  parseNdjson,
  parsePipelineEventLine,
  reducePipelineEvent,
  reducePipelineEvents,
  resolveSgfRules,
  useAnalysisStream,
} from "./analysis";
export type {
  ComparisonBranch,
  ComparisonContext,
  ComparisonEvidence,
  ComparisonGroupTempo,
  AnalysisEventSource,
  AnalysisPhase,
  GainLossLedger,
  GainLossLine,
  LedgerStrengthChange,
  LlmCommentary,
  MoveComparison,
  OpeningMatch,
  OpeningMove,
  ReviewReportDocument,
  ReviewReportMove,
  SacrificeAnnotation,
  SacrificeAssessment,
  SacrificeEvidence,
  SacrificeExchange,
  SacrificeParams,
  SacrificeReason,
  CandidatePvLineage,
  AnalysisState,
  AnalysisStage,
  BrowserEngineAdapter,
  CandidateSnapshot,
  DeepPlySelection,
  EngineAnalysis,
  GroupKind,
  GroupOutlineSpec,
  GroupSnapshot,
  GroupStatus,
  PipelineEvent,
  PlyAnalysis,
  PositionSnapshot,
  PositionAnalysisRequest,
  PositionSourceFactory,
  ReviewSeriesPoint,
  StreamStatus,
} from "./analysis";

export {
  createBoardGeometry,
  pixelToVertex,
  vertexToPixel,
  verticesToOutlinePath,
} from "./overlays/BoardGeometry";
export type { BoardGeometry } from "./overlays/BoardGeometry";
export type {
  OverlayData,
  OverlayField,
  OverlayLine,
  OverlayPolygon,
  OverlayRenderer,
} from "./overlays/OverlayRenderer";
export { SvgOverlayRenderer } from "./overlays/SvgOverlayRenderer";

export {
  applyPlacementShift,
  createRandomMap,
  createRng,
  createShiftMap,
  randomInt,
  readjustShifts,
} from "./goban/shifts";
export {
  alpha,
  diffSignMap,
  getHoshis,
  neighborhood,
  range,
  vertexEquals,
} from "./goban/helper";

export {
  registerYagooBoard,
  YagooBoardElement,
} from "./elements/yagoo-board";

export type {
  BoardMap,
  GhostStone,
  HeatVertex,
  LineMarker,
  Marker,
  Sign,
  Vertex,
  VertexEventName,
} from "./types";

export {
  SAMPLE_GROUP_OUTLINE,
  SAMPLE_SGF,
  SAMPLE_WINRATE,
  sampleHeatMap,
} from "./demo/sampleData";
export * from "./commentary";
