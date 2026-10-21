import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from "vue";
import { coded, serializeError } from "../i18n";
import { reducePipelineEvent } from "./reduce";
import { createInitialAnalysisState, type AnalysisState } from "./types";
import type { AnalysisSourceHandle, PositionAnalysisRequest, PositionSourceFactory } from "./sources/types";

/** Node-local results; cancelled/stale runs can never replace the selected node. */
export function useVariationAnalysis() {
  const selectedKey = ref<string | null>(null);
  const entries = shallowRef<Record<string, AnalysisState>>({});
  let generation = 0;
  let handle: AnalysisSourceHandle | null = null;
  const state = computed(() => selectedKey.value == null
    ? createInitialAnalysisState()
    : entries.value[selectedKey.value] ?? createInitialAnalysisState());

  function stop() {
    generation++;
    handle?.stop();
    handle = null;
    const key = selectedKey.value;
    if (key != null && entries.value[key]?.status === "streaming") {
      entries.value = { ...entries.value, [key]: { ...entries.value[key]!, status: "idle" } };
    }
  }

  function clear() {
    stop();
    selectedKey.value = null;
    entries.value = {};
  }

  function select(key: string, request: PositionAnalysisRequest, source?: PositionSourceFactory | null, force = false) {
    stop();
    selectedKey.value = key;
    if (!source || (!force && entries.value[key]?.status === "completed")) return;
    const current = generation;
    const expectedPly = request.ply + (request.moves?.length ?? 0);
    const initial = { ...createInitialAnalysisState(), status: "streaming" as const };
    entries.value = { ...entries.value, [key]: initial };
    function update(next: AnalysisState) {
      if (current !== generation || selectedKey.value !== key) return;
      entries.value = { ...entries.value, [key]: next };
    }
    function fail(error: unknown) {
      update({
        ...entries.value[key]!,
        status: "error",
        lastError: serializeError(error),
      });
    }
    try {
      handle = source(request).start({
        onEvent(event) {
          if (current !== generation || selectedKey.value !== key) return;
          if (event.type === "positionCompleted" && event.snapshot.ply !== expectedPly) {
            fail(coded("tree.mismatch", "The engine returned a different variation position."));
            return;
          }
          update(reducePipelineEvent(entries.value[key]!, event));
        },
        onError: fail,
        onDone() {
          if (current !== generation || selectedKey.value !== key) return;
          handle = null;
          const entry = entries.value[key]!;
          if (entry.status === "error") return;
          if (!entry.plies[expectedPly]?.complete) {
            fail(coded("tree.closedEarly", "The engine closed before completing this variation."));
          } else update({ ...entry, status: "completed" });
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (getCurrentScope()) onScopeDispose(stop);
  return { state, selectedKey, select, stop, clear };
}
