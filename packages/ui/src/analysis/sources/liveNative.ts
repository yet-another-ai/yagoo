import type {
  AnalysisEventSource,
  AnalysisSourceHandle,
  AnalysisSourceHandlers,
} from "./types";

export interface LiveNativeSourceOptions {
  /**
   * WebSocket or SSE URL for a future `yagoo analyze --serve` endpoint.
   * Default targets a local docs/dev server convention.
   */
  url?: string;
  id?: string;
  label?: string;
}

/**
 * (b) Live connection to a locally running native engine.
 *
 * **Not implemented yet** — `yagoo analyze` currently only writes NDJSON to a
 * file/stdout. Adding `--serve` (WebSocket or SSE) is tracked as a follow-up.
 * This adapter is the seam: when a server exists, replace `start()` with a real
 * stream consumer that parses the same `PipelineEvent` lines.
 */
export function createLiveNativeSource(
  options: LiveNativeSourceOptions = {},
): AnalysisEventSource {
  const url = options.url ?? "ws://127.0.0.1:8710/analyze";
  return {
    id: options.id ?? "live-native",
    label: options.label ?? "Local native engine (not available yet)",
    start(handlers: AnalysisSourceHandlers): AnalysisSourceHandle {
      const err = new Error(
        `Live native analysis is not wired yet (planned: yagoo analyze --serve). ` +
          `Expected stream endpoint: ${url}. Import an NDJSON file for now.`,
      );
      queueMicrotask(() => handlers.onError?.(err));
      return { stop() {} };
    },
  };
}

/** Capability probe for UI chrome — always false until `--serve` ships. */
export function isLiveNativeAvailable(): boolean {
  return false;
}
