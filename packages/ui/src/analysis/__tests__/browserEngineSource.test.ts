import { describe, expect, it, vi } from "vitest";
import { createBrowserEngineSource } from "../sources/browserEngine";
import type { BrowserEngineAdapter } from "../sources/browserEngine";

function adapter(lines: string[], seen: { sgf?: string; stopped?: boolean }): BrowserEngineAdapter {
  return {
    analyzeSgf(sgf: string) {
      seen.sgf = sgf;
      return (async function* () {
        for (const line of lines) yield line;
      })();
    },
    stop() {
      seen.stopped = true;
    },
  };
}

describe("createBrowserEngineSource", () => {
  it("sends a full position request without falling back to a game scan", async () => {
    const analyzeSgf = vi.fn();
    const analyzePosition = vi.fn(async function* () {
      yield '{"type":"positionCompleted","v":1,"phase":"deep","snapshot":{"ply":3}}';
    });
    const onDone = vi.fn();
    createBrowserEngineSource({
      engine: { analyzeSgf, analyzePosition },
      sgf: "(;SZ[9];B[cc])",
      position: { ply: 1, moves: ["D4", "pass"], visits: 100 },
    }).start({ onEvent: () => {}, onDone });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(analyzeSgf).not.toHaveBeenCalled();
    expect(analyzePosition).toHaveBeenCalledWith({
      sgf: "(;SZ[9];B[cc])", ply: 1, moves: ["D4", "pass"], visits: 100,
    });
  });

  it("cancels a pending readable stream without reporting completion", async () => {
    const cancel = vi.fn();
    const stop = vi.fn();
    const stream = new ReadableStream<string>({ cancel });
    const onDone = vi.fn();
    const handle = createBrowserEngineSource({
      engine: { analyzeSgf: () => stream, stop },
      sgf: "(;SZ[9])",
    }).start({ onEvent: () => {}, onDone });
    handle.stop();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(stop).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("parses NDJSON from the adapter and forwards the SGF", async () => {
    const seen: { sgf?: string; stopped?: boolean } = {};
    const events: string[] = [];
    let done = false;
    const source = createBrowserEngineSource({
      engine: adapter(
        ['{"type":"gameStarted"}', "", '{"type":"positionCompleted","ply":0}'],
        seen,
      ),
      sgf: "(;SZ[9])",
    });
    source.start({
      onEvent: (event) => events.push(event.type),
      onDone: () => {
        done = true;
      },
    });
    await vi.waitFor(() => expect(done).toBe(true));
    expect(seen.sgf).toBe("(;SZ[9])");
    expect(events).toEqual(["gameStarted", "positionCompleted"]);
  });

  it("reports a missing engine without throwing", async () => {
    let message = "";
    createBrowserEngineSource().start({
      onEvent: () => {},
      onError: (error) => {
        message = error.message;
      },
    });
    await vi.waitFor(() => expect(message).toMatch(/local model/i));
  });
});
