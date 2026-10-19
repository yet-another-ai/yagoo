import { parseNdjson } from "../reduce";
import type { PipelineEvent } from "../types";
import type {
  AnalysisEventSource,
  AnalysisSourceHandle,
  AnalysisSourceHandlers,
} from "./types";

export interface NdjsonFileSourceOptions {
  /** Yield events progressively via rAF / microtask batches (default true). */
  progressive?: boolean;
  /** Events per animation frame when progressive (default 4). */
  batchSize?: number;
  id?: string;
  label?: string;
}

/**
 * (a) Import an NDJSON file produced by `yagoo analyze`.
 * Parses the full text, then optionally streams events to the reducer
 * so the UI can show scan → deepen progressively.
 */
export function createNdjsonTextSource(
  text: string,
  options: NdjsonFileSourceOptions = {},
): AnalysisEventSource {
  const events = parseNdjson(text);
  return createNdjsonEventsSource(events, options);
}

export function createNdjsonEventsSource(
  events: readonly PipelineEvent[],
  options: NdjsonFileSourceOptions = {},
): AnalysisEventSource {
  const progressive = options.progressive !== false;
  const batchSize = options.batchSize ?? 4;

  return {
    id: options.id ?? "ndjson-file",
    label: options.label ?? "NDJSON file",
    start(handlers: AnalysisSourceHandlers): AnalysisSourceHandle {
      let stopped = false;
      let raf = 0;
      let index = 0;

      const pump = () => {
        if (stopped) return;
        if (!progressive) {
          for (const ev of events) {
            if (stopped) return;
            handlers.onEvent(ev);
          }
          if (!stopped) handlers.onDone?.();
          return;
        }
        const end = Math.min(index + batchSize, events.length);
        while (index < end) {
          handlers.onEvent(events[index]!);
          index += 1;
        }
        if (index >= events.length) {
          handlers.onDone?.();
          return;
        }
        raf = requestAnimationFrame(pump);
      };

      try {
        if (progressive && typeof requestAnimationFrame === "function") {
          raf = requestAnimationFrame(pump);
        } else {
          queueMicrotask(pump);
        }
      } catch (err) {
        handlers.onError?.(
          err instanceof Error ? err : new Error(String(err)),
        );
      }

      return {
        stop() {
          stopped = true;
          if (raf) cancelAnimationFrame(raf);
        },
      };
    },
  };
}

export async function createNdjsonFileSource(
  file: File,
  options: NdjsonFileSourceOptions = {},
): Promise<AnalysisEventSource> {
  const text = await file.text();
  return createNdjsonTextSource(text, {
    ...options,
    id: options.id ?? `ndjson:${file.name}`,
    label: options.label ?? file.name,
  });
}
