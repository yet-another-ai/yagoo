import { describe, expect, it, vi } from "vitest";
import recorded from "../../analysis/__fixtures__/ledger-position.json";
import { reducePipelineEvent } from "../../analysis/reduce";
import { createInitialAnalysisState, type PositionSnapshot } from "../../analysis/types";
import { buildCommentaryFacts, renderCommentary } from "../facts";
import {
  CommentarySession, verifyCommentarySelection,
  type CommentaryProvider, type CommentaryRequest, type CommentarySessionState,
} from "../session";

// All providers below are labelled in-process mocks. No network/model is used.
const snapshot = recorded as PositionSnapshot;
const state = reducePipelineEvent(createInitialAnalysisState(), {
  type: "positionCompleted", v: 1, phase: "deep", snapshot,
});
const facts = buildCommentaryFacts(state.plies[snapshot.ply]!);
const accepted = (requestId: string) => ({
  version: 1, requestId, selections: [
    { factId: facts[0]!.id, variant: 1 },
    { factId: facts[1]!.id, variant: 0 },
  ],
});

function setup() {
  let latest!: CommentarySessionState;
  let serial = 0;
  const session = new CommentarySession((next) => { latest = next; }, () => `mock-${++serial}`);
  session.setContext(facts, "game-a");
  return { session, latest: () => latest };
}

function deferredProvider() {
  const pending: Array<{
    request: CommentaryRequest; signal: AbortSignal;
    resolve: (response: unknown) => void;
  }> = [];
  const provider: CommentaryProvider = {
    id: "mock deferred",
    select: vi.fn((request, signal) => new Promise((resolve) => {
      pending.push({ request, signal, resolve });
    })),
  };
  return { provider, pending };
}

describe("bounded provider response verification", () => {
  it("renders only original clauses in selected order, including approved variants", () => {
    const response = accepted("request");
    response.selections.reverse();
    const result = verifyCommentarySelection(facts, "request", JSON.stringify(response), "mock selector");
    expect(result.verified).toBe(true);
    expect(result.provider).toBe("mock selector");
    expect(result.sentences.map((s) => s.text)).toEqual([
      facts[1]!.variants[0], facts[0]!.variants[1],
    ]);
    expect(result.citedFactIds).toEqual(response.selections.map((s) => s.factId));
  });

  it.each([
    ["free prose with plausible values", "D4 is a severe mistake worth 24.2 points."],
    ["extra prose field", { ...accepted("request"), text: "Black is dead." }],
    ["unknown fact", { version: 1, requestId: "request", selections: [{ factId: "invented", variant: 0 }] }],
    ["unknown variant", { version: 1, requestId: "request", selections: [{ factId: facts[0]!.id, variant: 99 }] }],
    ["negative variant", { version: 1, requestId: "request", selections: [{ factId: facts[0]!.id, variant: -1 }] }],
    ["fractional variant", { version: 1, requestId: "request", selections: [{ factId: facts[0]!.id, variant: 0.5 }] }],
    ["text in choice", { version: 1, requestId: "request", selections: [{ factId: facts[0]!.id, variant: 0, text: "invented" }] }],
    ["duplicated fact", { version: 1, requestId: "request", selections: [accepted("request").selections[0], accepted("request").selections[0]] }],
    ["stale ID", accepted("old-request")],
    ["empty choice", { version: 1, requestId: "request", selections: [] }],
    ["too many choices", { version: 1, requestId: "request", selections: facts.slice(0, 4).map((f) => ({ factId: f.id, variant: 0 })) }],
    ["malformed JSON", "{bad"],
    ["oversized JSON", " ".repeat(65_537)],
  ])("falls back on %s", (_, response) => {
    const result = verifyCommentarySelection(facts, "request", response, "mock untrusted");
    expect(result.verified).toBe(false);
    expect(result.provider).toBe("templates");
    expect(result.text).toBe(renderCommentary(facts).text);
    expect(result.fallbackReason).toBeTruthy();
  });
});

describe("commentary session consent and lifetime", () => {
  it("rehydrates only matching exact evidence without persisting lifecycle changes", () => {
    const saved = renderCommentary(facts, [{ factId: facts[0]!.id, variant: 1 }], "mock saved provider", true);
    let latest!: CommentarySessionState;
    const writes: unknown[] = [];
    const session = new CommentarySession((next, persist) => {
      latest = next;
      if (persist) writes.push(next.result);
    });
    session.setContext(facts, "game-a", saved);
    expect(latest.enabled).toBe(false);
    expect(latest.result).toBeNull();
    expect(writes).toHaveLength(0);
    session.setEnabled(true);
    expect(latest.result).toEqual(saved);
    expect(writes).toHaveLength(1);
    session.setContext([], "game-a", null);
    session.setContext(facts, "game-a", saved);
    expect(latest.result).toEqual(saved);
    expect(writes).toHaveLength(1);

    const changed = structuredClone(facts);
    changed[0]!.evidence[0]!.value = 999; // Same displayed clauses, different exact source identity.
    session.setContext(changed, "game-a", saved);
    expect(latest.result?.verified).toBe(false);
    expect(latest.result?.fallbackReason).toContain("current approved facts");
    expect(writes).toHaveLength(1);
    session.setContext(facts, "game-b", saved);
    expect(latest.enabled).toBe(false);
    expect(latest.result).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it("preserves saved choices during preparation, cancellation and opt-out", async () => {
    const saved = renderCommentary(facts, [{ factId: facts[0]!.id, variant: 1 }], "mock saved provider", true);
    let latest!: CommentarySessionState;
    const writes: unknown[] = [];
    const session = new CommentarySession((next, persist) => {
      latest = next;
      if (persist) writes.push(next.result);
    });
    session.setContext(facts, "game-a", saved);
    session.setEnabled(true);
    const { provider, pending } = deferredProvider();
    const work = session.request(provider);
    expect(latest.result).toEqual(saved);
    session.cancel();
    expect(pending[0]!.signal.aborted).toBe(true);
    pending[0]!.resolve(accepted(pending[0]!.request.requestId));
    await work;
    expect(latest.result).toEqual(saved);
    expect(writes).toHaveLength(1);
    session.setEnabled(false);
    expect(latest.result).toBeNull();
    expect(writes).toHaveLength(1);
    session.setEnabled(true);
    expect(latest.result).toEqual(saved);
    session.setContext(facts, "game-a", null);
    expect(latest.result?.provider).toBe("templates");
    expect(writes).toHaveLength(2);
  });

  it("keeps a failure explanation when the parent echoes its persisted result", async () => {
    const { session, latest } = setup();
    session.setEnabled(true);
    await session.request({ id: "mock failure", async select() { throw new Error("failed"); } });
    const failed = latest().result;
    expect(failed?.fallbackReason).toContain("failed");
    expect(session.setContext(facts, "game-a", failed)).toBe(false);
    expect(latest().result).toEqual(failed);
  });

  it("makes no call until enabled and explicitly requested", async () => {
    const { session, latest } = setup();
    const select = vi.fn(async (request: CommentaryRequest) => accepted(request.requestId));
    const provider = { id: "mock immediate", select };
    await session.request(provider);
    expect(select).not.toHaveBeenCalled();
    expect(session.exportRequest()).toBeNull();
    session.setEnabled(true);
    expect(select).not.toHaveBeenCalled();
    expect(latest().result?.provider).toBe("templates");
    await session.request(provider);
    expect(select).toHaveBeenCalledTimes(1);
    expect(latest().result?.verified).toBe(true);
  });

  it("ignores noncooperative late completions when repeated", async () => {
    const { session, latest } = setup();
    const { provider, pending } = deferredProvider();
    session.setEnabled(true);
    const first = session.request(provider);
    const second = session.request(provider);
    expect(pending[0]!.signal.aborted).toBe(true);
    pending[1]!.resolve(accepted(pending[1]!.request.requestId));
    await second;
    const current = latest().result;
    pending[0]!.resolve("a late invalid response");
    await first;
    expect(latest().result).toBe(current);
    expect(latest().busy).toBe(false);
  });

  it.each(["cancel", "opt-out", "new-game", "facts-changed"] as const)(
    "invalidates pending work on %s",
    async (action) => {
      const { session, latest } = setup();
      const { provider, pending } = deferredProvider();
      session.setEnabled(true);
      const work = session.request(provider);
      if (action === "cancel") session.cancel();
      if (action === "opt-out") session.setEnabled(false);
      if (action === "new-game") session.setContext(facts, "game-b");
      if (action === "facts-changed") session.setContext(facts.slice(1), "game-a");
      expect(pending[0]!.signal.aborted).toBe(true);
      const expected = latest().result;
      pending[0]!.resolve(accepted(pending[0]!.request.requestId));
      await work;
      expect(latest().result).toBe(expected);
      expect(latest().busy).toBe(false);
      if (action === "new-game" || action === "opt-out") {
        expect(latest().enabled).toBe(false);
        expect(latest().result).toBeNull();
      }
    },
  );

  it("exports inspectable structured values and consumes manual responses once", () => {
    const { session, latest } = setup();
    session.setEnabled(true);
    const request = JSON.parse(session.exportRequest()!) as CommentaryRequest;
    expect(request.facts[0]!.evidence).toEqual(facts[0]!.evidence);
    expect(Object.keys(request)).toEqual(["version", "requestId", "instruction", "facts", "responseExample"]);
    const packet = JSON.stringify(request);
    expect(packet).not.toContain('"ownership":');
    expect(packet).not.toContain('"board":');
    expect(packet).not.toMatch(/SGF|playerName|blackStones|whiteStones/);
    expect(session.importResponse(accepted(request.requestId))).toBe(true);
    expect(latest().requestText).toBe("");
    expect(session.importResponse(accepted(request.requestId))).toBe(false);
    expect(latest().result?.provider).toBe("manual selection");
  });

  it("rejects manual responses from older requests and after a game switch", () => {
    const { session, latest } = setup();
    session.setEnabled(true);
    const old = JSON.parse(session.exportRequest()!) as CommentaryRequest;
    session.exportRequest();
    expect(session.importResponse(accepted(old.requestId))).toBe(false);
    expect(latest().result?.verified).toBe(false);
    session.exportRequest();
    session.setContext(facts, "game-b");
    expect(session.importResponse(accepted(old.requestId))).toBe(false);
    expect(latest().result).toBeNull();
  });

  it("keeps canonical facts independent of provider mutations and errors", async () => {
    const { session, latest } = setup();
    session.setEnabled(true);
    await session.request({
      id: "mock mutation",
      async select(request) {
        request.facts[0]!.variants[1] = "This group is dead.";
        request.facts[0]!.evidence[0]!.value = 999;
        return accepted(request.requestId);
      },
    });
    expect(latest().result?.sentences[0]!.text).toBe(facts[0]!.variants[1]);
    await session.request({ id: "mock failure", async select() { throw new Error("secret transport detail"); } });
    expect(latest().result?.provider).toBe("templates");
    expect(latest().result?.fallbackReason).toContain("failed");
    expect(JSON.stringify(latest())).not.toContain("secret transport detail");
  });
});
