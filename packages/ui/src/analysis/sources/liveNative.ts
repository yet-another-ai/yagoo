import { coded } from "../../i18n/coded";
import { parsePipelineEventLine } from "../reduce";
import type {
  AnalysisEventSource,
  AnalysisSourceHandle,
  AnalysisSourceHandlers,
} from "./types";

export interface LiveNativeSourceOptions {
  /** Local `yagoo analyze --serve` SSE endpoint. */
  url?: string;
  /** Send the currently loaded SGF. Omit to use the CLI's startup SGF. */
  sgf?: string;
  /** Root-only interactive analysis, separate from batch review state. */
  position?: { ply: number; moves?: string[]; visits?: number };
  id?: string;
  label?: string;
  /** Injectable HTTP transport for model-free tests. */
  fetch?: typeof globalThis.fetch;
}

/** Fetch SSE once. Explicit stop/disconnect never reconnects or restarts work. */
export function createLiveNativeSource(
  options: LiveNativeSourceOptions = {},
): AnalysisEventSource {
  return {
    id: options.id ?? "live-native",
    label: options.label ?? "Local native engine",
    start(handlers: AnalysisSourceHandlers): AnalysisSourceHandle {
      const abort = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let stopped = false;
      const stop = () => {
        stopped = true;
        abort.abort();
        void reader?.cancel().catch(() => {});
      };
      void (async () => {
        try {
          const url = new URL(options.url ?? "http://127.0.0.1:8710/analyze");
          if (
            !["http:", "https:"].includes(url.protocol) ||
            !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
            url.username || url.password
          ) throw coded("engine.nativeLocalhost", "Native engine URL must use HTTP(S) on localhost.");
          if (options.position) {
            url.pathname = "/analyze-position";
            url.search = "";
            if (options.sgf == null) throw coded("engine.nativeSgf", "Position analysis requires an SGF.");
          }
          const transport = options.fetch ?? globalThis.fetch;
          const response = await transport(url.href, {
            method: options.sgf == null ? "GET" : "POST",
            headers: options.sgf == null ? undefined : { "Content-Type": "application/json" },
            body: options.sgf == null ? undefined : JSON.stringify({
              sgf: options.sgf, ...options.position,
            }),
            signal: abort.signal,
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
          });
          if (stopped) { await response.body?.cancel(); return; }
          if (!response.ok) {
            const body = await response.text();
            throw coded("engine.nativeHttp", `Native engine HTTP ${response.status}: ${body}`, {
              status: response.status,
              body,
            });
          }
          if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
            throw coded("engine.nativeSse", "Native engine did not return an SSE event stream.");
          }
          if (!response.body) throw coded("engine.nativeNoBody", "Native engine response has no body.");
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let data: string[] = [];
          let eventLength = 0;
          let terminal = false;
          const line = (value: string) => {
            if (value === "") {
              if (data.length === 0) return;
              const event = parsePipelineEventLine(data.join("\n"));
              data = [];
              eventLength = 0;
              if (event && !stopped) {
                handlers.onEvent(event);
                if (event.type === "error") throw new Error(event.message);
                if (event.type === "gameCompleted" ||
                    (options.position && event.type === "positionCompleted")) terminal = true;
              }
            } else if (value.startsWith("data:")) {
              eventLength += value.length;
              if (eventLength > 16 * 1024 * 1024) {
                throw coded("engine.nativeTooLarge", "Native engine event exceeds 16 MiB.");
              }
              data.push(value.slice(5).replace(/^ /, ""));
            }
          };
          while (!stopped && !terminal) {
            const chunk = await reader.read();
            if (stopped) return;
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            if (buffer.length > 16 * 1024 * 1024) {
              throw coded("engine.nativeTooLarge", "Native engine event exceeds 16 MiB.");
            }
            let newline: number;
            while ((newline = buffer.indexOf("\n")) >= 0) {
              line(buffer.slice(0, newline).replace(/\r$/, ""));
              buffer = buffer.slice(newline + 1);
              if (stopped || terminal) break;
            }
            if (chunk.done) {
              if (!terminal) {
                throw coded(
                  "engine.nativeDisconnected",
                  "Native engine disconnected before analysis completed.",
                );
              }
              break;
            }
          }
          if (!stopped) handlers.onDone?.();
        } catch (error) {
          if (!stopped) handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
        } finally {
          await reader?.cancel().catch(() => {});
          reader?.releaseLock();
        }
      })();
      return { stop };
    },
  };
}

/** Browser support; reachability is established by an explicit connect. */
export function isLiveNativeAvailable(): boolean {
  return typeof globalThis.fetch === "function" && typeof AbortController !== "undefined";
}
