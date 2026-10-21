import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, type Ref } from "vue";
import {
  buildBoardOverlays,
  buildReviewSeries,
  formatAnalysisComment,
  type ReviewSeriesPoint,
} from "./display";
import { reducePipelineEvent } from "./reduce";
import {
  createInitialAnalysisState,
  type AnalysisState,
  type PipelineEvent,
} from "./types";
import type {
  AnalysisEventSource,
  AnalysisSourceHandle,
} from "./sources/types";

export interface UseAnalysisStreamResult {
  state: Ref<AnalysisState>;
  series: Ref<ReviewSeriesPoint[]>;
  deepPlySet: Ref<Set<number>>;
  isStreaming: Ref<boolean>;
  sourceLabel: Ref<string | null>;
  reset: () => void;
  applyEvent: (event: PipelineEvent) => void;
  attachSource: (source: AnalysisEventSource) => void;
  stop: () => void;
  overlaysFor: (
    ply: number,
    size: number,
    opts?: {
      selectedCandidate?: number;
      previewCandidate?: number | null;
    },
  ) => ReturnType<typeof buildBoardOverlays>;
  commentFor: (ply: number, sgfComment: string) => string;
}

export function useAnalysisStream(): UseAnalysisStreamResult {
  const state = shallowRef<AnalysisState>(createInitialAnalysisState());
  const sourceLabel = ref<string | null>(null);
  let handle: AnalysisSourceHandle | null = null;
  let generation = 0;

  function reset() {
    stop();
    state.value = createInitialAnalysisState();
    sourceLabel.value = null;
  }

  function applyEvent(event: PipelineEvent) {
    state.value = reducePipelineEvent(state.value, event);
  }

  function stop() {
    generation += 1;
    handle?.stop();
    handle = null;
    if (state.value.status === "streaming") {
      state.value = { ...state.value, status: "idle" };
    }
  }

  if (getCurrentScope()) onScopeDispose(stop);

  function attachSource(source: AnalysisEventSource) {
    stop();
    const current = generation;
    sourceLabel.value = source.label;
    state.value = { ...state.value, status: "streaming", lastError: null };
    const next = source.start({
      onEvent: (event) => { if (current === generation) applyEvent(event); },
      onDone: () => {
        if (current !== generation) return;
        if (state.value.status === "streaming") {
          state.value = { ...state.value, status: "completed" };
        }
      },
      onError: (err) => {
        if (current !== generation) return;
        state.value = {
          ...state.value,
          status: "error",
          lastError: err.message,
        };
      },
    });
    if (current === generation) handle = next;
    else next.stop();
  }

  const series = computed(() => buildReviewSeries(state.value));
  const deepPlySet = computed(() => new Set(state.value.deepPlies));
  const isStreaming = computed(() => state.value.status === "streaming");

  function overlaysFor(
    ply: number,
    size: number,
    opts?: {
      selectedCandidate?: number;
      previewCandidate?: number | null;
    },
  ) {
    return buildBoardOverlays(state.value, ply, {
      size,
      selectedCandidate: opts?.selectedCandidate ?? 0,
      previewCandidate: opts?.previewCandidate ?? null,
    });
  }

  function commentFor(ply: number, sgfComment: string) {
    return formatAnalysisComment(state.value, ply, sgfComment);
  }

  return {
    state,
    series,
    deepPlySet,
    isStreaming,
    sourceLabel,
    reset,
    applyEvent,
    attachSource,
    stop,
    overlaysFor,
    commentFor,
  };
}
