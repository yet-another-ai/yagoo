import type { CommentaryProvider, CommentaryRequest } from "./session";

export type HttpCommentaryProtocol = "openai-chat" | "ollama-chat";

export interface HttpCommentaryConfig {
  /** Complete chat endpoint, including /v1/chat/completions or /api/chat. */
  endpoint: string;
  model: string;
  protocol: HttpCommentaryProtocol;
  /** Optional user-supplied bearer token; retained only in this provider closure. */
  apiKey?: string;
}

const MAX_RESPONSE_BYTES = 128 * 1024;
const failure = () => new Error("Commentary provider request failed.");
const cancelled = () => new DOMException("Commentary request cancelled.", "AbortError");
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function configuration(config: HttpCommentaryConfig) {
  try {
    const endpoint = new URL(config.endpoint);
    const loopback = endpoint.hostname === "localhost" || endpoint.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(endpoint.hostname);
    if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) ||
        endpoint.username || endpoint.password || /[?#\s]/.test(config.endpoint) ||
        /^https?:\/\/[^/]*@/i.test(config.endpoint) ||
        typeof config.model !== "string" || !config.model.trim() ||
        !["openai-chat", "ollama-chat"].includes(config.protocol) ||
        (config.apiKey !== undefined &&
          (typeof config.apiKey !== "string" || /[\u0000-\u001f\u007f]/.test(config.apiKey)))) {
      throw new Error();
    }
    return {
      endpoint: endpoint.href, model: config.model.trim(), protocol: config.protocol,
      apiKey: config.apiKey?.trim(),
    };
  } catch {
    throw new Error("Invalid commentary provider configuration.");
  }
}

/** Do not wait for a noncooperative transport to settle after cancellation. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(cancelled());
    };
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

function discard(response: Response) {
  void response.body?.cancel().catch(() => {});
}

async function readEnvelope(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || response.redirected || !response.body) {
    discard(response);
    throw failure();
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw failure();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (signal.aborted) throw cancelled();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw failure();
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function content(envelope: unknown, protocol: HttpCommentaryProtocol): string {
  if (!record(envelope) || envelope.error != null) throw failure();
  let message: unknown;
  if (protocol === "openai-chat") {
    if (!Array.isArray(envelope.choices) || envelope.choices.length !== 1 ||
        !record(envelope.choices[0]) || envelope.choices[0].finish_reason !== "stop") throw failure();
    message = envelope.choices[0].message;
  } else {
    if (envelope.done !== true ||
        (envelope.done_reason !== undefined && envelope.done_reason !== "stop")) throw failure();
    message = envelope.message;
  }
  if (!record(message) || message.role !== "assistant" ||
      message.tool_calls != null || message.function_call != null || message.refusal != null ||
      typeof message.content !== "string" || !message.content.trim()) throw failure();
  return message.content;
}

/**
 * Calls the configured endpoint only on select(). The session remains the sole
 * authority for validating selections and rendering approved fact clauses.
 * Neither endpoint details nor credentials enter persisted provider IDs/errors.
 */
export function createHttpCommentaryProvider(
  config: HttpCommentaryConfig, fetcher: typeof fetch = (input, init) => fetch(input, init),
): CommentaryProvider {
  const { endpoint, model, protocol, apiKey } = configuration(config);
  return {
    id: protocol === "openai-chat" ? "OpenAI-compatible HTTP" : "Ollama HTTP",
    async select(request: CommentaryRequest, signal: AbortSignal): Promise<unknown> {
      if (signal.aborted) throw cancelled();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        // Project the allowed packet explicitly, excluding UI targets, origin,
        // SGF/player metadata, and any incidental fields added by callers.
        const packet = {
          version: request.version, requestId: request.requestId,
          facts: request.facts.map(({ id, evidence, variants, priority }) => ({
            id, evidence: evidence.map(({ path, value }) => ({ path, value })), variants, priority,
          })),
          responseExample: {
            version: request.responseExample.version, requestId: request.responseExample.requestId,
            selections: request.responseExample.selections.map(({ factId, variant }) => ({ factId, variant })),
          },
        };
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const response = await abortable(fetcher(endpoint, {
          method: "POST", headers,
          body: JSON.stringify({
            model, messages: [
              { role: "system", content: request.instruction },
              { role: "user", content: JSON.stringify(packet) },
            ],
            stream: false,
            ...(protocol === "openai-chat" ? { response_format: { type: "json_object" } } : { format: "json" }),
          }),
          signal: controller.signal, credentials: "omit", redirect: "error",
          cache: "no-store", referrerPolicy: "no-referrer",
        }).then((result) => {
          if (controller.signal.aborted) {
            discard(result);
            throw cancelled();
          }
          return result;
        }), controller.signal);
        const envelope = await readEnvelope(response, controller.signal);
        if (signal.aborted) throw cancelled();
        return content(envelope, protocol);
      } catch {
        controller.abort();
        // Transport errors and server bodies may contain credentials or prompts.
        throw signal.aborted ? cancelled() : failure();
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
