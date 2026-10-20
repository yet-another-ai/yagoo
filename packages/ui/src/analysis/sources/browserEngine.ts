import { parsePipelineEventLine } from "../reduce";
import type {
  AnalysisEventSource,
  AnalysisSourceHandle,
  AnalysisSourceHandlers,
  PositionAnalysisRequest,
} from "./types";

export interface BrowserEngineSourceOptions {
  /** In-browser KataGo engine. Null until the reviewer has a local model staged. */
  engine?: BrowserEngineAdapter | null;
  /** SGF the engine should analyze. Recorded fixtures stay in place until this runs. */
  sgf?: string;
  id?: string;
  label?: string;
  position?: Omit<PositionAnalysisRequest, "sgf">;
}

/** In-browser engine that yields the same NDJSON lines as `yagoo analyze`. */
export interface BrowserEngineAdapter {
  analyzeSgf(sgf: string): AsyncIterable<string> | ReadableStream<string>;
  analyzePosition?: (request: PositionAnalysisRequest) => AsyncIterable<string> | ReadableStream<string>;
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
      let reader: ReadableStreamDefaultReader<string> | undefined;
      void (async () => {
        try {
          if (options.position && !engine.analyzePosition) {
            throw new Error("This browser engine does not support single-position analysis.");
          }
          const stream = options.position
            ? engine.analyzePosition!({ sgf: options.sgf ?? "", ...options.position })
            : engine.analyzeSgf(options.sgf ?? "");
          if (!("getReader" in stream)) {
            for await (const line of stream as AsyncIterable<string>) {
              if (stopped) return;
              const event = parsePipelineEventLine(line);
              if (event) handlers.onEvent(event);
            }
          } else {
            reader = stream.getReader();
            try {
              for (;;) {
                const next = await reader.read();
                if (stopped || next.done) break;
                const event = parsePipelineEventLine(next.value);
                if (event) handlers.onEvent(event);
              }
            } finally {
              reader.releaseLock();
              reader = undefined;
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
          void reader?.cancel().catch(() => {});
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
