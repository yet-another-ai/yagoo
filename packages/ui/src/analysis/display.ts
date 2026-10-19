import type { WinratePoint } from "../layout/WinrateGraph.vue";
import type {
  BoardMap,
  GhostStone,
  HeatVertex,
  LineMarker,
  Marker,
  Sign,
  Vertex,
} from "../types";
import {
  emptyBoardMap,
  ownershipToHeatMap,
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
    const top = info.candidates
      .slice(0, 4)
      .map((c, i) => {
        const wr =
          c.winrate != null ? `${(c.winrate * 100).toFixed(0)}%` : "?";
        const v = c.visits != null ? `${c.visits}v` : "";
        return `${i + 1}. ${c.move} ${wr} ${v}`.trim();
      })
      .join(" · ");
    lines.push(`Candidates: ${top}`);
  }

  if (state.lastError) lines.push(`Error: ${state.lastError}`);

  return lines.join("\n") || "—";
}

/**
 * Ghost stones + PV arrows + ownership heat/paint for the current ply.
 */
export function buildBoardOverlays(
  state: AnalysisState,
  ply: number,
  options: {
    size: number;
    showOwnership?: boolean;
    showCandidates?: boolean;
    selectedCandidate?: number;
  },
): PlyBoardOverlays {
  const size = options.size;
  const info = plyAt(state, ply);
  const root = info?.root;
  const showOwnership = options.showOwnership !== false;
  const showCandidates = options.showCandidates !== false;
  const selected = options.selectedCandidate ?? 0;

  const heatMap = showOwnership
    ? ownershipToHeatMap(root?.ownership, size)
    : emptyBoardMap<HeatVertex | null>(size, null);
  const paintMap = showOwnership
    ? ownershipToPaintMap(root?.ownership, size)
    : emptyBoardMap(size, 0);

  const ghostStoneMap = emptyBoardMap<GhostStone | null>(size, null);
  const markerMap = emptyBoardMap<Marker | null>(size, null);
  const lines: LineMarker[] = [];

  if (showCandidates && info?.candidates?.length) {
    applyCandidates(
      info.candidates,
      size,
      selected,
      ghostStoneMap,
      markerMap,
      lines,
    );
  }

  return { heatMap, paintMap, ghostStoneMap, markerMap, lines };
}

function applyCandidates(
  candidates: CandidateSnapshot[],
  size: number,
  selected: number,
  ghostStoneMap: BoardMap<GhostStone | null>,
  markerMap: BoardMap<Marker | null>,
  lines: LineMarker[],
): void {
  const toPlaySign: Sign = 1; // overlays are decorative; ghost sign follows order coloring

  candidates.forEach((c, idx) => {
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
      c.winrate != null ? `${(c.winrate * 100).toFixed(0)}%` : "";
    const text = [wrLabel, visitsLabel].filter(Boolean).join("\n") || null;

    ghostStoneMap[y]![x] = {
      sign: toPlaySign,
      type: ghostTypeForOrder(c.order ?? idx),
      faint: idx !== selected,
    };
    markerMap[y]![x] = {
      type: "label",
      label: text,
      tooltip: `${c.move} · order ${c.order ?? idx}`,
    };
  });

  const focus = candidates[selected] ?? candidates[0];
  if (focus?.pv && focus.pv.length >= 2) {
    for (let i = 0; i < focus.pv.length - 1; i++) {
      const a = parseGtpVertex(focus.pv[i]!, size);
      const b = parseGtpVertex(focus.pv[i + 1]!, size);
      if (a == null || b == null) continue;
      lines.push({ v1: a, v2: b, type: "arrow" });
    }
  }
}

/** Default Chinese rules when SGF has no RU (matches `yagoo-sgf` / pipeline). */
export function resolveSgfRules(sgf: string): string {
  const match = /RU\[([^\]]*)\]/i.exec(sgf);
  const ru = match?.[1]?.trim();
  return ru && ru.length > 0 ? ru : "chinese";
}
