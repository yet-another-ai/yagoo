import { parsePipelineEventLine } from "../reduce";
import type {
  AnalysisEventSource,
  AnalysisSourceHandle,
  AnalysisSourceHandlers,
} from "./types";

export interface BrowserEngineSourceOptions {
  /** In-browser KataGo engine. Null until the reviewer has a local model staged. */
  engine?: BrowserEngineAdapter | null;
  /** SGF the engine should analyze. Recorded fixtures stay in place until this runs. */
  sgf?: string;
  id?: string;
  label?: string;
}

/** In-browser engine that yields the same NDJSON lines as `yagoo analyze`. */
export interface BrowserEngineAdapter {
  analyzeSgf(sgf: string): AsyncIterable<string> | ReadableStream<string>;
  stop?: () => void;
}

/**
 * Browser engine source. Experimental (issue #5 / #20).
 * Emits parsed `PipelineEvent`s. Recorded NDJSON remains the default until
 * the reviewer starts this source.
 */
export function createBrowserEngineSource(
  options: BrowserEngineSourceOptions = {},
): AnalysisEventSource {
  const engine = options.engine ?? null;
  return {
    id: options.id ?? "browser-engine",
    label: options.label ?? "Browser engine (experimental)",
    start(handlers: AnalysisSourceHandlers): AnalysisSourceHandle {
      if (engine == null) {
        const err = new Error(
          "Load a local model bundle before starting the browser engine. " +
            "Recorded analysis stays on the board until you do.",
        );
        queueMicrotask(() => handlers.onError?.(err));
        return { stop() {} };
      }

      let stopped = false;
      void (async () => {
        try {
          const stream = engine.analyzeSgf(options.sgf ?? "");
          if (Symbol.asyncIterator in stream) {
            for await (const line of stream as AsyncIterable<string>) {
              if (stopped) return;
              const event = parsePipelineEventLine(line);
              if (event) handlers.onEvent(event);
            }
          } else {
            const reader = stream.getReader();
            try {
              for (;;) {
                const next = await reader.read();
                if (stopped || next.done) break;
                const event = parsePipelineEventLine(next.value);
                if (event) handlers.onEvent(event);
              }
            } finally {
              reader.releaseLock();
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
          engine.stop?.();
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
