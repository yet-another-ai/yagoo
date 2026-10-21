import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "../../analysis/__fixtures__/ledger-position.json";
import { reducePipelineEvent } from "../../analysis/reduce";
import { createInitialAnalysisState, type PositionSnapshot } from "../../analysis/types";
import type { CommentaryRequest } from "../../commentary/session";
import CommentaryPanel from "../CommentaryPanel.vue";

// Real recorded Go facts; HTTP replies here are explicitly controlled mocks.
const snapshot = recorded as PositionSnapshot;
const input = reducePipelineEvent(createInitialAnalysisState(), {
  type: "positionCompleted", v: 1, phase: "deep", snapshot,
}).plies[snapshot.ply]!;
const endpoint = "http://localhost:11434/api/chat";
const mountPanel = () => mount(CommentaryPanel, { props: { input, contextKey: "game-a" } });
type Panel = ReturnType<typeof mountPanel>;

async function configure(wrapper: Panel) {
  await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
  await wrapper.get('[data-testid="commentary-protocol"]').setValue("ollama-chat");
  await wrapper.get('[data-testid="commentary-endpoint"]').setValue(endpoint);
  await wrapper.get('[data-testid="commentary-model"]').setValue("local-model");
  await wrapper.get('[data-testid="commentary-token"]').setValue("test-only-token");
  await wrapper.get("form").trigger("submit");
}

function reply(options: RequestInit) {
  const body = JSON.parse(String(options.body));
  const request = JSON.parse(body.messages[1].content) as CommentaryRequest;
  return Response.json({ done: true, message: {
    role: "assistant", content: JSON.stringify(request.responseExample),
  } });
}

afterEach(() => vi.unstubAllGlobals());

describe("configured HTTP commentary in the reviewer (mock endpoint)", () => {
  it("sends only after opt-in, configuration and a separate explicit action", async () => {
    const fetch = vi.fn(async (_: string, options: RequestInit) => reply(options));
    vi.stubGlobal("fetch", fetch);
    const wrapper = mountPanel();
    expect(wrapper.find('[data-testid="commentary-provider-settings"]').exists()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await configure(wrapper);
    expect(fetch).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="commentary-destination"]').text()).toContain(endpoint);
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(endpoint);
    const options = fetch.mock.calls[0]![1];
    expect(options).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer test-only-token");
    const body = JSON.parse(String(options.body));
    expect(body).toMatchObject({ model: "local-model", stream: false, format: "json" });
    expect(String(options.body)).not.toContain("test-only-token");
    expect(String(options.body)).not.toContain("(;FF[");
    expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("Approved clause selection");
    expect(wrapper.get('[data-testid="commentary-body"]').text()).toContain("/plies/50/");
    wrapper.unmount();
  });

  it("aborts repeated requests and config changes, ignores late replies, and forgets credentials on a new game", async () => {
    const pending: Array<{ options: RequestInit; resolve: (value: Response) => void }> = [];
    const fetch = vi.fn((_: string, options: RequestInit) => new Promise<Response>((resolve) => {
      pending.push({ options, resolve });
    }));
    vi.stubGlobal("fetch", fetch);
    const wrapper = mountPanel();
    await configure(wrapper);
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    expect(pending).toHaveLength(2);
    expect(pending[0]!.options.signal!.aborted).toBe(true);
    await wrapper.get('[data-testid="commentary-endpoint"]').setValue("http://localhost:11435/api/chat");
    expect(pending[1]!.options.signal!.aborted).toBe(true);
    expect(wrapper.find('[data-testid="commentary-provider"]').exists()).toBe(false);
    pending.forEach((request) => request.resolve(reply(request.options)));
    await flushPromises();
    expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("Deterministic templates");
    await wrapper.get("form").trigger("submit");
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    await wrapper.setProps({ contextKey: "game-b" });
    expect(pending[2]!.options.signal!.aborted).toBe(true);
    pending[2]!.resolve(reply(pending[2]!.options));
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked).toBe(false);
    await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-endpoint"]').element.value).toBe("");
    expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-token"]').element.value).toBe("");
    expect(wrapper.find('[data-testid="commentary-provider"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("retains page-memory configuration while hidden, but blocks actions and ignores aborted replies", async () => {
    const pending: Array<{ options: RequestInit; resolve: (value: Response) => void }> = [];
    const fetch = vi.fn((_: string, options: RequestInit) => new Promise<Response>((resolve) => {
      pending.push({ options, resolve });
    }));
    vi.stubGlobal("fetch", fetch);
    const wrapper = mountPanel();
    try {
      await configure(wrapper);
      const settings = wrapper.get('[data-testid="commentary-provider-settings"]').element;
      const writes = wrapper.emitted("result")!.length;
      await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
      await wrapper.setProps({ active: false });
      expect(pending[0]!.options.signal!.aborted).toBe(true);
      expect(wrapper.find('[data-testid="commentary-provider-settings"]').exists()).toBe(true);
      expect(wrapper.get<HTMLElement>('[data-testid="commentary-panel"]').element.style.display).toBe("none");

      // Hidden DOM handlers can still receive queued/programmatic events.
      await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
      await wrapper.findAll("button").find((button) => button.text() === "Prepare prompt JSON")!.trigger("click");
      await wrapper.get('[data-testid="commentary-enable"]').setValue(false);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-testid="commentary-prompt"]').exists()).toBe(false);
      pending[0]!.resolve(reply(pending[0]!.options));
      await flushPromises();
      expect(wrapper.emitted("result")).toHaveLength(writes);

      await wrapper.setProps({ active: true });
      expect(wrapper.get<HTMLElement>('[data-testid="commentary-panel"]').element.style.display).toBe("");
      expect(wrapper.get('[data-testid="commentary-provider-settings"]').element).toBe(settings);
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked).toBe(true);
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-endpoint"]').element.value).toBe(endpoint);
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-model"]').element.value).toBe("local-model");
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-token"]').element.value).toBe("test-only-token");
      expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("Deterministic templates");
      expect(fetch).toHaveBeenCalledTimes(1);
      await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
      expect(fetch).toHaveBeenCalledTimes(2);
      pending[1]!.resolve(reply(pending[1]!.options));
      await flushPromises();
      expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("Approved clause selection");

      // A real game/source change still revokes consent and clears credentials,
      // including when that change happens while the panel is hidden.
      await wrapper.setProps({ active: false });
      await wrapper.setProps({ contextKey: "game-b" });
      await wrapper.setProps({ active: true });
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked).toBe(false);
      await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-endpoint"]').element.value).toBe("");
      expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-token"]').element.value).toBe("");
      expect(wrapper.find('[data-testid="commentary-provider"]').exists()).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
  });

  it("cancels, disables, and forgets without sending a request or persisting settings", async () => {
    let signal!: AbortSignal;
    const fetch = vi.fn((_: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetch);
    const wrapper = mountPanel();
    await configure(wrapper);
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    await wrapper.get('[data-testid="commentary-cancel"]').trigger("click");
    expect(signal.aborted).toBe(true);
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    await wrapper.get('[data-testid="commentary-enable"]').setValue(false);
    expect(signal.aborted).toBe(true);
    await configure(wrapper);
    await wrapper.get('[data-testid="commentary-forget"]').trigger("click");
    expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-token"]').element.value).toBe("");
    expect(wrapper.find('[data-testid="commentary-provider"]').exists()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    await configure(wrapper);
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    const fresh = mountPanel();
    await fresh.get('[data-testid="commentary-enable"]').setValue(true);
    expect(fresh.get<HTMLInputElement>('[data-testid="commentary-token"]').element.value).toBe("");
    expect(fresh.get<HTMLInputElement>('[data-testid="commentary-endpoint"]').element.value).toBe("");
    fresh.unmount();
  });

  it("rejects invalid settings and falls back on failed HTTP without showing response details", async () => {
    const fetch = vi.fn(async () => new Response("private error content", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const wrapper = mountPanel();
    await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    await configure(wrapper);
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("Deterministic templates");
    expect(wrapper.text()).toContain("Provider request failed");
    expect(wrapper.text()).not.toContain("private error content");
    wrapper.unmount();
  });
});
