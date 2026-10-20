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
