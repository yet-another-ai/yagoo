// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "../../analysis/__fixtures__/ledger-position.json";
import { reducePipelineEvent } from "../../analysis/reduce";
import { createInitialAnalysisState, type PositionSnapshot } from "../../analysis/types";
import { buildCommentaryFacts, renderCommentary } from "../facts";
import {
  createHttpCommentaryProvider, type HttpCommentaryConfig, type HttpCommentaryProtocol,
} from "../httpProvider";
import { CommentarySession, type CommentaryRequest, type CommentarySessionState } from "../session";

// Protocol responses below are explicit mocks, not outputs from a real model.
// Fact evidence comes from the repository's recorded engine fixture.
const snapshot = recorded as PositionSnapshot;
const state = reducePipelineEvent(createInitialAnalysisState(), {
  type: "positionCompleted", v: 1, phase: "deep", snapshot,
});
const facts = buildCommentaryFacts(state.plies[snapshot.ply]!);
const config: HttpCommentaryConfig = {
  endpoint: "https://provider.example/v1/chat/completions", model: "user-chosen-model",
  protocol: "openai-chat",
};
const signal = () => new AbortController().signal;

function setup() {
  let latest!: CommentarySessionState;
  let serial = 0;
  const session = new CommentarySession((next) => { latest = next; }, () => `mock-http-${++serial}`);
  session.setContext(facts, "game-a");
  return { session, latest: () => latest };
}

function request() {
  const { session } = setup();
  session.setEnabled(true);
  return JSON.parse(session.exportRequest()!) as CommentaryRequest;
}

function envelope(protocol: HttpCommentaryProtocol, selection: unknown = request().responseExample) {
  const message = { role: "assistant", content: JSON.stringify(selection) };
  return protocol === "openai-chat"
    ? { choices: [{ finish_reason: "stop", message }] }
    : { done: true, done_reason: "stop", message };
}

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  headers: { "Content-Type": "application/json" },
});
const mockedFetch = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);

afterEach(() => vi.unstubAllGlobals());

describe("explicit HTTP commentary transports", () => {
  it.each(["openai-chat", "ollama-chat"] as const)("sends the %s protocol with only approved facts", async (protocol) => {
    const packet = request();
    Object.assign(packet, { sgf: "(;PB[Private Black]PW[Private White];B[dd])", playerName: "Private Player" });
    Object.assign(packet.facts[0]!, { target: { groupId: "D4" }, privateMetadata: "private" });
    Object.assign(packet.facts[0]!.evidence[0]!, { privateMetadata: "private" });
    const fetcher = mockedFetch(jsonResponse(envelope(protocol, packet.responseExample)));
    const endpoint = protocol === "openai-chat" ? config.endpoint : "http://127.0.0.1:11434/api/chat";
    const provider = createHttpCommentaryProvider({ ...config, protocol, endpoint, apiKey: "mock-secret" }, fetcher);
    expect(fetcher).not.toHaveBeenCalled();

    expect(await provider.select(packet, signal())).toBe(JSON.stringify(packet.responseExample));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [destination, init] = fetcher.mock.calls[0]!;
    expect(destination).toBe(endpoint);
    expect(init).toMatchObject({
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer mock-secret" },
      credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
    });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({
      model: config.model, stream: false,
      ...(protocol === "openai-chat" ? { response_format: { type: "json_object" } } : { format: "json" }),
      messages: [
        { role: "system", content: packet.instruction },
        { role: "user", content: JSON.stringify({
          version: packet.version, requestId: packet.requestId,
          facts: facts.map(({ id, evidence, variants, priority }) => ({ id, evidence, variants, priority })),
          responseExample: packet.responseExample,
        }) },
      ],
    });
    expect(init!.body).not.toMatch(/sgf|playerName|Private Player|Private Black|Private White|blackStones|whiteStones|privateMetadata|mock-secret|"target"/);
    expect(JSON.stringify(JSON.parse(body.messages[1].content))).not.toMatch(/"ownership":|"board":/);
    expect(provider.id).not.toMatch(/provider\.example|user-chosen-model|mock-secret/);
  });

  it("keeps configuration in memory, snapshots it, and omits an absent token", async () => {
    const editable = { ...config };
    const fetcher = mockedFetch(jsonResponse(envelope("openai-chat")));
    const provider = createHttpCommentaryProvider(editable, fetcher);
    editable.endpoint = "https://changed.example/";
    editable.model = "changed";
    editable.apiKey = "changed-secret";
    await provider.select(request(), signal());
    expect(fetcher.mock.calls[0]![0]).toBe(config.endpoint);
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).model).toBe(config.model);
  });

  it("uses browser fetch only when select is explicitly called", async () => {
    const fetcher = mockedFetch(jsonResponse(envelope("openai-chat")));
    vi.stubGlobal("fetch", fetcher);
    const provider = createHttpCommentaryProvider(config);
    expect(fetcher).not.toHaveBeenCalled();
    await provider.select(request(), signal());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://provider.example/chat", "http://localhost:11434/api/chat",
    "http://127.0.0.1:11434/api/chat", "http://127.20.3.4:11434/api/chat",
    "http://[::1]:11434/api/chat",
  ])("accepts an explicit secure or loopback endpoint: %s", (endpoint) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createHttpCommentaryProvider({ ...config, endpoint }, fetcher)).not.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["insecure remote", { endpoint: "http://provider.example/chat" }],
    ["insecure LAN", { endpoint: "http://192.168.1.2/chat" }],
    ["unspecified address", { endpoint: "http://0.0.0.0/chat" }],
    ["localhost lookalike", { endpoint: "http://localhost.example/chat" }],
    ["relative endpoint", { endpoint: "/api/chat" }],
    ["unsupported scheme", { endpoint: "file:///api/chat" }],
    ["URL user", { endpoint: "https://user:secret@provider.example/chat" }],
    ["empty URL user", { endpoint: "https://@provider.example/chat" }],
    ["query", { endpoint: "https://provider.example/chat?key=secret" }],
    ["empty query", { endpoint: "https://provider.example/chat?" }],
    ["fragment", { endpoint: "https://provider.example/chat#secret" }],
    ["empty fragment", { endpoint: "https://provider.example/chat#" }],
    ["URL controls", { endpoint: "https://provider.example/\nchat" }],
    ["empty model", { model: " \t" }],
    ["unknown protocol", { protocol: "unknown" as HttpCommentaryProtocol }],
    ["header injection", { apiKey: "secret\r\nOther: value" }],
  ])("rejects %s before any request", (_, invalid) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createHttpCommentaryProvider({ ...config, ...invalid }, fetcher))
      .toThrow("Invalid commentary provider configuration.");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("bounded and cancellable response reading", () => {
  it("makes no request for an already aborted signal and hides its reason", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort(new Error("private abort reason"));
    await expect(createHttpCommentaryProvider(config, fetcher).select(request(), controller.signal))
      .rejects.toMatchObject({ name: "AbortError", message: "Commentary request cancelled." });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aborts a pending read promptly and cancels the response stream", async () => {
    const cancel = vi.fn();
    const fetcher = mockedFetch(new Response(new ReadableStream({ cancel })));
    const controller = new AbortController();
    const pending = createHttpCommentaryProvider(config, fetcher).select(request(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetcher.mock.results[0]!.type).toBe("return"));
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("settles cancellation before an uncooperative fetch and discards its late body", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((done) => { resolve = done; }));
    const controller = new AbortController();
    const pending = createHttpCommentaryProvider(config, fetcher).select(request(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it.each(["advertised", "omitted", "lying"])("bounds response bytes with %s content length", async (length) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode("€".repeat(25_000)));
        stream.enqueue(new TextEncoder().encode("€".repeat(25_000)));
      },
      cancel,
    }), {
      headers: length === "omitted" ? {} : { "Content-Length": length === "advertised" ? "150000" : "1" },
    });
    const fetcher = mockedFetch(response);
    await expect(createHttpCommentaryProvider(config, fetcher).select(request(), signal()))
      .rejects.toThrow("Commentary provider request failed.");
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("decodes JSON split across chunks and multibyte characters", async () => {
    const selection = request().responseExample;
    const bytes = new TextEncoder().encode(JSON.stringify({ ...envelope("openai-chat", selection), ignored: "棋" }));
    const response = new Response(new ReadableStream({ start(stream) {
      for (let i = 0; i < bytes.length; i += 7) stream.enqueue(bytes.slice(i, i + 7));
      stream.close();
    } }));
    await expect(createHttpCommentaryProvider(config, mockedFetch(response)).select(request(), signal()))
      .resolves.toBe(JSON.stringify(selection));
    expect(response.body!.locked).toBe(false);
  });

  it.each([
    ["bad status", () => new Response("server secret", { status: 401 })],
    ["malformed JSON", () => new Response("server secret")],
    ["empty body", () => new Response(null)],
    ["invalid UTF-8", () => new Response(new Uint8Array([0xff]))],
    ["stream failure", () => new Response(new ReadableStream({ start(stream) { stream.error(new Error("stream secret")); } }))],
  ])("hides transport details and does not retry on %s", async (_, response) => {
    const fetcher = mockedFetch(response());
    await expect(createHttpCommentaryProvider({ ...config, apiKey: "token-secret" }, fetcher).select(request(), signal()))
      .rejects.toThrow(/^Commentary provider request failed\.$/);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not expose fetch errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("request token-secret and full prompt"));
    await expect(createHttpCommentaryProvider(config, fetcher).select(request(), signal()))
      .rejects.toThrow(/^Commentary provider request failed\.$/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("protocol envelope rejection", () => {
  const message = { role: "assistant", content: JSON.stringify(request().responseExample) };
  it.each([
    ["openai-chat", "null", null],
    ["openai-chat", "missing choice", { choices: [] }],
    ["openai-chat", "unfinished", { choices: [{ message, finish_reason: "length" }] }],
    ["openai-chat", "missing finish reason", { choices: [{ message }] }],
    ["openai-chat", "tool call", { choices: [{ message: { ...message, tool_calls: [{}] }, finish_reason: "stop" }] }],
    ["openai-chat", "legacy function call", { choices: [{ message: { ...message, function_call: {} }, finish_reason: "stop" }] }],
    ["openai-chat", "refusal", { choices: [{ message: { ...message, refusal: "refused" }, finish_reason: "stop" }] }],
    ["openai-chat", "empty content", { choices: [{ message: { ...message, content: " \n" }, finish_reason: "stop" }] }],
    ["openai-chat", "nontext content", { choices: [{ message: { ...message, content: [{ text: "text" }] }, finish_reason: "stop" }] }],
    ["ollama-chat", "unfinished", { message, done: false }],
    ["ollama-chat", "truncated", { message, done: true, done_reason: "length" }],
    ["ollama-chat", "missing done", { message }],
    ["ollama-chat", "tool call", { message: { ...message, tool_calls: [{}] }, done: true }],
    ["ollama-chat", "refusal", { message: { ...message, refusal: "refused" }, done: true }],
    ["ollama-chat", "empty content", { message: { ...message, content: "" }, done: true }],
    ["ollama-chat", "server error", { message, done: true, error: "secret" }],
  ] as const)("rejects %s %s", async (protocol, _, response) => {
    const fetcher = mockedFetch(jsonResponse(response));
    await expect(createHttpCommentaryProvider({ ...config, protocol }, fetcher).select(request(), signal()))
      .rejects.toThrow(/^Commentary provider request failed\.$/);
  });
});

describe("HTTP selection through the commentary session", () => {
  it.each(["openai-chat", "ollama-chat"] as const)("validates %s selections and renders only fixture-backed clauses", async (protocol) => {
    const { session, latest } = setup();
    const selection = {
      version: 1, requestId: "mock-http-1", selections: [{ factId: facts[0]!.id, variant: 1 }],
    };
    const fetcher = mockedFetch(jsonResponse(envelope(protocol, selection)));
    const provider = createHttpCommentaryProvider({ ...config, protocol }, fetcher);
    await session.request(provider);
    expect(fetcher).not.toHaveBeenCalled();
    session.setEnabled(true);
    expect(fetcher).not.toHaveBeenCalled();
    await session.request(provider);
    expect(latest().result?.verified).toBe(true);
    expect(latest().result?.text).toBe(facts[0]!.variants[1]);
    expect(latest().result?.factEvidence[facts[0]!.id]).toEqual(facts[0]!.evidence);
  });

  it.each([
    ["prose", "The group is dead and this is a severe mistake."],
    ["unknown fact", { version: 1, requestId: "mock-http-1", selections: [{ factId: "invented", variant: 0 }] }],
    ["stale selection", { version: 1, requestId: "old-request", selections: [{ factId: facts[0]!.id, variant: 0 }] }],
  ])("lets the session reject %s despite a successful HTTP envelope", async (_, selection) => {
    const { session, latest } = setup();
    session.setEnabled(true);
    await session.request(createHttpCommentaryProvider(config, mockedFetch(jsonResponse(envelope("openai-chat", selection)))));
    expect(latest().result?.verified).toBe(false);
    expect(latest().result?.text).toBe(renderCommentary(facts).text);
    expect(latest().result?.provider).toBe("templates");
  });

  it("discards a late HTTP completion after the game changes", async () => {
    const { session, latest } = setup();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((done) => { resolve = done; }));
    session.setEnabled(true);
    const pending = session.request(createHttpCommentaryProvider(config, fetcher));
    session.setContext(facts, "game-b");
    await pending;
    resolve(jsonResponse(envelope("openai-chat")));
    await Promise.resolve();
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(latest()).toMatchObject({ enabled: false, busy: false, result: null });
  });
});
