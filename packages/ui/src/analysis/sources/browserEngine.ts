import type {
  AnalysisEventSource,
  AnalysisSourceHandle,
  AnalysisSourceHandlers,
} from "./types";

export interface BrowserEngineSourceOptions {
  /** Optional handle to a future browser engine module (PR #7 / issue #5). */
  engine?: BrowserEngineAdapter | null;
  id?: string;
  label?: string;
}

/**
 * Minimal contract for a future in-browser KataGo engine.
 * Intentionally does **not** import unmerged PR #7 code.
 *
 * TODO(#20): provide a real adapter once PR #7 / issue #5 lands on main.
 */
export interface BrowserEngineAdapter {
  analyzeSgf(sgf: string): AsyncIterable<string> | ReadableStream<string>;
}

/**
 * (c) Browser engine adapter seam.
 *
 * PR #7 (browser KataGo / WebGPU) was **not** merged when this page landed.
 * When it merges, wire `BrowserEngineAdapter` to emit the same NDJSON event
 * lines and pass them through `parsePipelineEventLine` → reducer.
 *
 * TODO(#20): wire browser engine after #7 merges.
 */
export function createBrowserEngineSource(
  options: BrowserEngineSourceOptions = {},
): AnalysisEventSource {
  const engine = options.engine ?? null;
  return {
    id: options.id ?? "browser-engine",
    label: options.label ?? "Browser engine (not available yet)",
    start(handlers: AnalysisSourceHandlers): AnalysisSourceHandle {
      if (engine == null) {
        const err = new Error(
          "Browser engine is not available on this build. " +
            "See #20 (await merge of WebGPU/Wasm engine, issue #5 / PR #7), " +
            "then inject a BrowserEngineAdapter. Import NDJSON for now.",
        );
        queueMicrotask(() => handlers.onError?.(err));
        return { stop() {} };
      }

      let stopped = false;
      void (async () => {
        try {
          // TODO(#20): parsePipelineEventLine(line) → handlers.onEvent(...).
          const stream = engine.analyzeSgf("");
          if (Symbol.asyncIterator in stream) {
            for await (const _line of stream) {
              if (stopped) return;
            }
          }
          if (!stopped) handlers.onDone?.();
        } catch (err) {
          if (!stopped) {
            handlers.onError?.(
              err instanceof Error ? err : new Error(String(err)),
            );
          }
        }
      })();

      return {
        stop() {
          stopped = true;
        },
      };
    },
  };
}

export function isBrowserEngineAvailable(
  engine?: BrowserEngineAdapter | null,
): boolean {
  return engine != null;
}
