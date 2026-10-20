import type { WinratePoint } from "../layout/WinrateGraph.vue";
import type {
  BoardMap,
  GhostStone,
  HeatVertex,
  LineMarker,
  Marker,
  Sign,
} from "../types";
import {
  emptyBoardMap,
  ownershipToPaintMap,
  parseGtpVertex,
} from "./coords";
import type {
  AnalysisState,
  CandidateSnapshot,
  EngineAnalysis,
  PlyAnalysis,
} from "./types";

export interface PlyBoardOverlays {
  heatMap: BoardMap<HeatVertex | null>;
  paintMap: BoardMap<number>;
  ghostStoneMap: BoardMap<GhostStone | null>;
  markerMap: BoardMap<Marker | null>;
  lines: LineMarker[];
}

export interface ReviewSeriesPoint extends WinratePoint {
  /** Black score lead in points (positive = Black ahead). */
  scoreLead: number | null;
  /** Whether this ply was selected for deepening. */
  deepSelected: boolean;
  /** Scan vs deep completeness. */
  phase: "scan" | "deep" | null;
  partial: boolean;
}

const GHOST_TYPES: Array<NonNullable<GhostStone["type"]>> = [
  "good",
  "interesting",
  "doubtful",
  "bad",
];

function ghostTypeForOrder(order: number | null | undefined): GhostStone["type"] {
  if (order == null || order < 0) return "interesting";
  return GHOST_TYPES[Math.min(order, GHOST_TYPES.length - 1)] ?? "interesting";
}

/** `B` → black (1), `W` → white (−1). Defaults to black. */
export function colorToSign(toPlay: string | undefined | null): Sign {
  return toPlay === "W" || toPlay === "w" ? -1 : 1;
}

export function plyAt(state: AnalysisState, ply: number): PlyAnalysis | null {
  return state.plies[ply] ?? null;
}

export function rootForPly(
  state: AnalysisState,
  ply: number,
): EngineAnalysis | null {
  return plyAt(state, ply)?.root ?? null;
}

/**
 * Build winrate / score-lead series aligned to ply indices 0..maxPly.
 * Winrate is stored as black winrate **percent** for `WinrateGraph`.
 */
export function buildReviewSeries(state: AnalysisState): ReviewSeriesPoint[] {
  const plyKeys = Object.keys(state.plies).map(Number);
  const maxFromPlies = plyKeys.length ? Math.max(...plyKeys) : -1;
  const maxFromCount =
    state.positionCount != null ? state.positionCount - 1 : -1;
  const maxPly = Math.max(maxFromPlies, maxFromCount, state.moveCount ?? -1);
  if (maxPly < 0) return [];

  const deep = new Set(state.deepPlies);
  const points: ReviewSeriesPoint[] = [];
  let prevWr: number | null = null;

  for (let ply = 0; ply <= maxPly; ply++) {
    const info = state.plies[ply];
    const wrFrac = info?.root?.winrate;
    const wr =
      wrFrac != null && Number.isFinite(wrFrac) ? wrFrac * 100 : null;
    const change =
      wr != null && prevWr != null ? wr - prevWr : wr != null ? 0 : null;
    if (wr != null) prevWr = wr;

    points.push({
      winrate: wr,
      change,
      scoreLead:
        info?.root?.scoreLead != null && Number.isFinite(info.root.scoreLead)
          ? info.root.scoreLead
          : null,
      deepSelected: deep.has(ply),
      phase: info?.phase ?? null,
      partial: info?.rootPartial ?? false,
    });
  }
  return points;
}

export function formatAnalysisComment(
  state: AnalysisState,
  ply: number,
  sgfComment: string,
): string {
  const info = plyAt(state, ply);
  const lines: string[] = [];

  if (sgfComment.trim()) lines.push(sgfComment.trim());

  if (info?.root) {
    const r = info.root;
    const wr =
      r.winrate != null ? `${(r.winrate * 100).toFixed(1)}%` : "—";
    const sl =
      r.scoreLead != null
        ? `${r.scoreLead >= 0 ? "+" : ""}${r.scoreLead.toFixed(1)}`
        : "—";
    const visits = r.visits != null ? String(r.visits) : "—";
    const phase = info.phase ?? "?";
    const tag = info.rootPartial
      ? "partial"
      : info.complete
        ? "complete"
        : "in progress";
    lines.push(
      `[${phase} · ${tag}] Black WR ${wr} · lead ${sl} · visits ${visits}`,
    );
  } else if (state.status === "streaming" || state.status === "completed") {
    lines.push("Waiting for analysis at this ply…");
  }

  if (state.deepPlies.includes(ply)) {
    const reason = state.deepReasons.find((r) => r.ply === ply);
    if (reason) {
      lines.push(
        `Deepened (swing): ΔWR ${(reason.winrateDelta * 100).toFixed(1)}pp · ΔSL ${reason.scoreLeadDelta.toFixed(1)} · Δown ${reason.ownershipDelta.toFixed(3)}`,
      );
    } else {
      lines.push("Selected for deep analysis.");
    }
  }

  if (info?.candidates?.length) {
    const topVisits = topCandidateVisits(info.candidates);
    const reliable = info.candidates.filter((c) =>
      candidateVisitsReliable(c, topVisits),
    );
    const hidden = info.candidates.length - reliable.length;
    const top = reliable
      .slice(0, 4)
      .map((c, i) => {
        const wr = candidateWinrateAuthoritative(c, topVisits)
          ? `${((c.winrate ?? 0) * 100).toFixed(0)}%`
          : "low";
        const v = c.visits != null ? `${c.visits}v` : "";
        return `${i + 1}. ${c.move} ${wr} ${v}`.trim();
      })
      .join(" · ");
    const suffix =
      hidden > 0 ? `${top ? " · " : ""}${hidden} low-visit hidden` : "";
    lines.push(`Candidates: ${top}${suffix}`);
  }

  if (state.lastError) lines.push(`Error: ${state.lastError}`);

  return lines.join("\n") || "—";
}

/**
 * Sabaki-style PV preview: numbered translucent stones in alternating colors,
 * starting from `startSign` at the first PV vertex (the candidate itself).
 * Passes are skipped for placement but still advance the color.
 */
export function buildPvPreview(
  pv: string[],
  size: number,
  startSign: Sign,
): {
  ghostStoneMap: BoardMap<GhostStone | null>;
  markerMap: BoardMap<Marker | null>;
} {
  const ghostStoneMap = emptyBoardMap<GhostStone | null>(size, null);
  const markerMap = emptyBoardMap<Marker | null>(size, null);
  let sign: Sign = startSign === -1 ? -1 : 1;
  let n = 0;

  for (const move of pv) {
    const v = parseGtpVertex(move, size);
    if (v == null) {
      sign = sign === 1 ? -1 : 1;
      continue;
    }
    n += 1;
    const [x, y] = v;
    ghostStoneMap[y]![x] = { sign, faint: false };
    markerMap[y]![x] = {
      type: "label",
      label: String(n),
      tooltip: `PV ${n}: ${move}`,
    };
    sign = sign === 1 ? -1 : 1;
  }

  return { ghostStoneMap, markerMap };
}

/**
 * Ghost stones + ownership paint for the current ply.
 * PV is shown only while `previewCandidate` is set (hover / tap) — no arrows.
 */
export function buildBoardOverlays(
  state: AnalysisState,
  ply: number,
  options: {
    size: number;
    showOwnership?: boolean;
    showCandidates?: boolean;
    /** Highlighted candidate when not previewing (best = 0). */
    selectedCandidate?: number;
    /**
     * When set, replace candidate ghosts with a Sabaki-style numbered PV
     * preview for that candidate index. `null` / omitted → normal candidates.
     */
    previewCandidate?: number | null;
  },
): PlyBoardOverlays {
  const size = options.size;
  const info = plyAt(state, ply);
  const root = info?.root;
  const showOwnership = options.showOwnership !== false;
  const showCandidates = options.showCandidates !== false;
  const selected = options.selectedCandidate ?? 0;
  const previewIdx = options.previewCandidate;

  // Sabaki-like medium B/W territory paint (fractional opacity via |paint|).
  const heatMap = emptyBoardMap<HeatVertex | null>(size, null);
  const paintMap = showOwnership
    ? ownershipToPaintMap(root?.ownership, size)
    : emptyBoardMap(size, 0);

  const lines: LineMarker[] = [];

  if (
    previewIdx != null &&
    previewIdx >= 0 &&
    info?.candidates?.[previewIdx] != null
  ) {
    const focus = info.candidates[previewIdx]!;
    const pv =
      focus.pv && focus.pv.length > 0 ? focus.pv : [focus.move];
    const startSign = colorToSign(info.toPlay);
    const preview = buildPvPreview(pv, size, startSign);
    return {
      heatMap,
      paintMap,
      ghostStoneMap: preview.ghostStoneMap,
      markerMap: preview.markerMap,
      lines,
    };
  }

  const ghostStoneMap = emptyBoardMap<GhostStone | null>(size, null);
  const markerMap = emptyBoardMap<Marker | null>(size, null);

  if (showCandidates && info?.candidates?.length) {
    applyCandidates(
      info.candidates,
      size,
      selected,
      root?.visits ?? null,
      ghostStoneMap,
      markerMap,
    );
  }

  return { heatMap, paintMap, ghostStoneMap, markerMap, lines };
}

/** Sabaki-style: only the top few on-threshold candidates get board labels. */
const MAX_CANDIDATE_LABELS = 5;
/** Floor for the visit gate when root visits are tiny. */
const MIN_CANDIDATE_VISIT_FLOOR = 3;
/** Hide board ghosts/labels below this fraction of root visits (Sabaki-like). */
const CANDIDATE_VISIT_FRAC = 0.02;

/** Visits required to show a candidate on the board (list may still show it). */
export function candidateBoardVisitThreshold(
  rootVisits: number | null | undefined,
): number {
  const root = rootVisits != null && rootVisits > 0 ? rootVisits : 0;
  return Math.max(MIN_CANDIDATE_VISIT_FLOOR, Math.ceil(root * CANDIDATE_VISIT_FRAC));
}

/** Whether a candidate earns a board ghost/label (still listable when false). */
export function candidateVisibleOnBoard(
  candidate: CandidateSnapshot,
  rootVisits: number | null | undefined,
): boolean {
  const v = candidate.visits ?? 0;
  return v >= candidateBoardVisitThreshold(rootVisits);
}

/**
 * Winrate is shown only when visits are in the same ballpark as the leading
 * candidate. A handful of visits can print 80%+ before the search has
 * settled; that number is not treated as a result.
 */
const CANDIDATE_AUTHORITATIVE_FRAC = 0.05;

export function topCandidateVisits(
  candidates: readonly CandidateSnapshot[],
): number {
  let top = 0;
  for (const candidate of candidates) {
    const visits = candidate.visits ?? 0;
    if (visits > top) top = visits;
  }
  return top;
}

/** Visits are high enough, relative to the leading candidate, to trust a winrate. */
export function candidateVisitsReliable(
  candidate: CandidateSnapshot,
  topVisits: number,
): boolean {
  const visits = candidate.visits ?? 0;
  if (visits <= 0 || topVisits <= 0) return false;
  if (visits >= topVisits) return true;
  const threshold = Math.max(
    MIN_CANDIDATE_VISIT_FLOOR,
    Math.ceil(topVisits * CANDIDATE_AUTHORITATIVE_FRAC),
  );
  return visits >= threshold;
}

export function candidateWinrateAuthoritative(
  candidate: CandidateSnapshot,
  topVisits: number,
): boolean {
  return (
    candidate.winrate != null &&
    candidateVisitsReliable(candidate, topVisits)
  );
}

function applyCandidates(
  candidates: CandidateSnapshot[],
  size: number,
  selected: number,
  rootVisits: number | null,
  ghostStoneMap: BoardMap<GhostStone | null>,
  markerMap: BoardMap<Marker | null>,
): void {
  const onBoard = candidates.filter((c) =>
    candidateVisibleOnBoard(c, rootVisits),
  );
  const labeled = onBoard.slice(0, MAX_CANDIDATE_LABELS);
  const topVisits = topCandidateVisits(candidates);

  labeled.forEach((c, idx) => {
    const v = parseGtpVertex(c.move, size);
    if (v == null) return;
    const [x, y] = v;
    const visitsLabel =
      c.visits != null
        ? c.visits >= 1000
          ? `${(c.visits / 1000).toFixed(1)}k`
          : String(c.visits)
        : "";
    const wrLabel =
      candidateWinrateAuthoritative(c, topVisits) && c.winrate != null
        ? `${(c.winrate * 100).toFixed(0)}%`
        : "";
    const text = [wrLabel, visitsLabel].filter(Boolean).join("\n") || null;
    const isBest = idx === 0 || (c.order ?? idx) === 0;
    const isSelected = idx === selected;

    ghostStoneMap[y]![x] = {
      // Black ring fill; type carries Sabaki candidate coloring.
      sign: 1,
      type: ghostTypeForOrder(c.order ?? idx),
      faint: !isBest && !isSelected,
    };
    markerMap[y]![x] = {
      type: "label",
      label: text,
      tooltip: `${c.move} · order ${c.order ?? idx}`,
    };
  });
}

/** Default Chinese rules when SGF has no RU (matches `yagoo-sgf` / pipeline). */
export function resolveSgfRules(sgf: string): string {
  const match = /RU\[([^\]]*)\]/i.exec(sgf);
  const ru = match?.[1]?.trim();
  return ru && ru.length > 0 ? ru : "chinese";
}
