import { describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import sample from "../__fixtures__/sample-scan-deep.ndjson?raw";
import { parseNdjson } from "../reduce";
import { createLiveNativeSource } from "../sources/liveNative";
import type { AnalysisSourceHandlers } from "../sources/types";
import type { PipelineEvent } from "../types";
import { useAnalysisStream } from "../useAnalysisStream";

const started: PipelineEvent = {
  type: "gameStarted", v: 1, size: 9, komi: 7.5,
  moveCount: 0, positionCount: 1, strategy: "scan_then_deep",
};
const done: PipelineEvent = { type: "gameCompleted", v: 1 };
const sse = (...events: PipelineEvent[]) => events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join("");
function response(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 137) {
        controller.enqueue(bytes.slice(offset, offset + 137));
      }
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}
function consume(fetch: typeof globalThis.fetch, position?: { ply: number }) {
  const events: PipelineEvent[] = [];
  return new Promise<PipelineEvent[]>((resolve, reject) => {
    createLiveNativeSource({ sgf: "(;SZ[9])", fetch, position }).start({
      onEvent: e => events.push(e),
      onDone: () => resolve(events),
      onError: reject,
    });
  });
}

describe("live native SSE", () => {
  it("renders recorded NDJSON unchanged across arbitrary chunks and SSE comments", async () => {
    const expected = parseNdjson(sample);
    // Preserve the recorded wire numbers, including Rust's serialized -0.0.
    // JSON.stringify(parsed) would change negative zero before testing SSE.
    const recordedSse = sample.trim().split(/\r?\n/).map(line => `data: ${line}\r\n\r\n`).join("");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(`: heartbeat\n\n${recordedSse}`),
    );
    expect(await consume(fetch)).toEqual(expected);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:8710/analyze");
    expect(JSON.parse(options!.body as string)).toEqual({ sgf: "(;SZ[9])" });
    expect(options?.redirect).toBe("error");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the distinct root-only endpoint for an interactive request", async () => {
    const snapshotEvent = parseNdjson(sample).find(e => e.type === "positionCompleted")!;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(sse(snapshotEvent)));
    expect(await consume(fetch, { ply: 0 })).toEqual([snapshotEvent]);
    expect(fetch.mock.calls[0]![0]).toBe("http://127.0.0.1:8710/analyze-position");
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).ply).toBe(0);
  });

  it("aborts a delayed connection and suppresses late events and completion", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const handlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    const handle = createLiveNativeSource({ fetch }).start(handlers);
    handle.stop();
    expect(fetch.mock.calls[0]![1]!.signal?.aborted).toBe(true);
    finish(response(sse(started, done)));
    await Promise.resolve();
    await Promise.resolve();
    expect(handlers.onEvent).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("cancels the reader while waiting for the next event", async () => {
    const cancel = vi.fn();
    let emitted!: () => void;
    const firstEvent = new Promise<void>(resolve => { emitted = resolve; });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(sse(started))); },
        cancel,
      }), { headers: { "content-type": "text/event-stream" } },
    ));
    const onDone = vi.fn();
    const handle = createLiveNativeSource({ fetch }).start({ onEvent: emitted, onDone });
    await firstEvent;
    handle.stop();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each([
    ["data: {bad}\n\n", /JSON|Unexpected|property/i],
    [sse(started), /disconnected before analysis completed/],
    [sse({ type: "error", v: 1, message: "engine exited" }), /engine exited/],
  ])("reports malformed, incomplete, or failed streams without retry", async (text, error) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(text));
    await expect(consume(fetch)).rejects.toThrow(error);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reports HTTP and content-type failures", async () => {
    await expect(consume(vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("origin denied", { status: 403 }),
    ))).rejects.toThrow("403: origin denied");
    await expect(consume(vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("not SSE"),
    ))).rejects.toThrow("SSE event stream");
  });

  it("rejects remote endpoints before transmitting the SGF", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await new Promise<void>(resolve => {
      createLiveNativeSource({ url: "https://example.com/analyze", fetch }).start({
        onEvent: vi.fn(),
        onError: error => { expect(error.message).toContain("localhost"); resolve(); },
      });
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("analysis source lifetime", () => {
  it("ignores stale callbacks after replacement, reset, and scope disposal", () => {
    const scope = effectScope();
    const analysis = scope.run(() => useAnalysisStream())!;
    const stops = [vi.fn(), vi.fn()];
    const handlers: AnalysisSourceHandlers[] = [];
    const source = (id: number) => ({
      id: String(id), label: String(id),
      start(callbacks: AnalysisSourceHandlers) {
        handlers[id] = callbacks;
        return { stop: stops[id]! };
      },
    });
    analysis.attachSource(source(0));
    analysis.attachSource(source(1));
    handlers[0]!.onEvent(started);
    handlers[0]!.onError?.(new Error("stale"));
    handlers[0]!.onDone?.();
    expect(analysis.state.value.eventCount).toBe(0);
    expect(analysis.isStreaming.value).toBe(true);
    handlers[1]!.onEvent(started);
    expect(analysis.state.value.size).toBe(9);
    analysis.reset();
    handlers[1]!.onEvent(done);
    expect(analysis.state.value.eventCount).toBe(0);
    analysis.attachSource(source(1));
    scope.stop();
    handlers[1]!.onError?.(new Error("after unmount"));
    expect(analysis.state.value.lastError).toBeNull();
    expect(analysis.isStreaming.value).toBe(false);
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(stops[1]).toHaveBeenCalledTimes(2);
  });
});
