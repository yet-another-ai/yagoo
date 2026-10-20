import {
  type AnalysisState,
  type PipelineEvent,
  type PlyAnalysis,
  createInitialAnalysisState,
} from "./types";
import { isAlignedComparison } from "./comparison";
import { sacrificesFromComparison } from "./sacrifices";

function ensurePly(state: AnalysisState, ply: number): PlyAnalysis {
  const existing = state.plies[ply];
  if (existing) return existing;
  const created: PlyAnalysis = {
    ply,
    rootPartial: false,
    candidates: [],
    groups: [],
    complete: false,
    ledger: null,
    comparison: null,
    sacrifices: null,
    commentary: null,
  };
  state.plies[ply] = created;
  return created;
}

function cloneState(state: AnalysisState): AnalysisState {
  return {
    ...state,
    deepPlies: [...state.deepPlies],
    deepReasons: [...state.deepReasons],
    warnings: [...state.warnings],
    plies: Object.fromEntries(
      Object.entries(state.plies).map(([k, v]) => [
        k,
        {
          ...v,
          candidates: [...v.candidates],
          groups: [...(v.groups ?? [])],
          ledger: v.ledger ?? null,
          comparison: v.comparison ?? null,
          sacrifices: v.sacrifices ? [...v.sacrifices] : null,
          commentary: v.commentary ?? null,
          root: v.root ? { ...v.root } : v.root,
          passProbe: v.passProbe ? { ...v.passProbe } : v.passProbe,
          snapshot: v.snapshot,
        },
      ]),
    ),
  };
}

/**
 * Pure reducer for the `yagoo analyze` NDJSON event stream.
 *
 * Ordering expectations match `docs/pipeline/streaming.md`:
 * scan positionCompleted → deepPliesSelected → deep positionCompleted.
 * `stagePartial` updates are best-effort; `stageCompleted` / `positionCompleted`
 * overwrite them. Deep-phase updates replace scan data for the same ply.
 */
export function reducePipelineEvent(
  prev: AnalysisState,
  event: PipelineEvent,
): AnalysisState {
  const state = cloneState(prev);
  state.eventCount += 1;
  if (state.status === "idle") state.status = "streaming";

  switch (event.type) {
    case "gameStarted": {
      // A source can deliver another game without rebuilding the composable.
      Object.assign(state, createInitialAnalysisState(), { eventCount: 1 });
      state.schemaVersion = event.v;
      state.size = event.size;
      state.komi = event.komi;
      state.rules = event.rules?.trim() || "chinese";
      state.moveCount = event.moveCount;
      state.positionCount = event.positionCount;
      state.strategy = event.strategy;
      state.status = "streaming";
      break;
    }
    case "openingMatched": {
      state.opening = event.match;
      break;
    }
    case "phaseStarted": {
      state.currentPhase = event.phase;
      state.phaseVisits = event.visits;
      break;
    }
    case "phaseCompleted": {
      if (state.currentPhase === event.phase) {
        state.currentPhase = null;
        state.phaseVisits = null;
      }
      break;
    }
    case "deepPliesSelected": {
      state.deepPlies = [...event.plies];
      state.deepMode = event.mode;
      state.deepReasons = event.reasons ? [...event.reasons] : [];
      break;
    }
    case "positionStarted": {
      state.activePly = event.ply;
      const ply = ensurePly(state, event.ply);
      ply.toPlay = event.toPlay;
      ply.phase = event.phase;
      if (event.phase === "deep") {
        // Deepening replaces scan completeness; keep scan root until deep root arrives.
        ply.complete = false;
        ply.rootPartial = false;
        ply.comparison = null;
        ply.sacrifices = null;
      }
      break;
    }
    case "stagePartial": {
      if (event.stage !== "root" || event.root == null) break;
      const ply = ensurePly(state, event.ply);
      ply.phase = event.phase;
      ply.root = { ...event.root };
      ply.rootPartial = true;
      ply.complete = false;
      break;
    }
    case "stageCompleted": {
      const ply = ensurePly(state, event.ply);
      ply.phase = event.phase;
      if (event.stage === "root" && event.analysis != null) {
        ply.root = { ...event.analysis };
        ply.rootPartial = false;
      } else if (event.stage === "pass_probe" && event.analysis != null) {
        ply.passProbe = { ...event.analysis };
      }
      break;
    }
    case "positionCompleted": {
      const snap = event.snapshot;
      const ply = ensurePly(state, snap.ply);
      ply.phase = event.phase;
      ply.toPlay = snap.toPlay;
      ply.snapshot = snap;
      if (snap.root) {
        ply.root = { ...snap.root };
        ply.rootPartial = false;
      }
      if (snap.passProbe) {
        ply.passProbe = { ...snap.passProbe };
      }
      ply.candidates = snap.candidates ? [...snap.candidates] : [];
      // Teaching groups (块) — additive; empty until pipeline emits them.
      ply.groups = snap.groups ? [...snap.groups] : [];
      // The completed snapshot is authoritative, including omitted/null fields.
      ply.ledger = snap.ledger ?? null;
      ply.comparison = isAlignedComparison(snap.comparison, snap.ply, snap.board.size)
        ? snap.comparison : null;
      ply.sacrifices = sacrificesFromComparison(ply.comparison, snap.ply, snap.board.size);
      ply.complete = true;
      break;
    }
    case "gameCompleted": {
      state.status = "completed";
      state.activePly = null;
      state.currentPhase = null;
      state.phaseVisits = null;
      if (event.game) {
        state.game = event.game;
        // Older aggregates omit opening; preserve an earlier recognition event.
        if ("opening" in event.game) state.opening = event.game.opening ?? null;
      }
      break;
    }
    case "warning": {
      state.warnings.push(event.message);
      break;
    }
    case "error": {
      state.status = "error";
      state.lastError = event.message;
      break;
    }
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      break;
    }
  }

  return state;
}

export function reducePipelineEvents(
  events: readonly PipelineEvent[],
  initial: AnalysisState = createInitialAnalysisState(),
): AnalysisState {
  return events.reduce(reducePipelineEvent, initial);
}

/** Parse one NDJSON line; returns null for blank lines. */
export function parsePipelineEventLine(line: string): PipelineEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as PipelineEvent;
  if (parsed == null || typeof parsed !== "object" || !("type" in parsed)) {
    throw new Error("NDJSON line is not a PipelineEvent");
  }
  return parsed;
}

/** Parse a full NDJSON document (one event per line). */
export function parseNdjson(text: string): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const ev = parsePipelineEventLine(line);
    if (ev) events.push(ev);
  }
  return events;
}
