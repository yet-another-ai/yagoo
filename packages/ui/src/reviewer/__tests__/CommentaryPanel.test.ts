import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import recorded from "../../analysis/__fixtures__/ledger-position.json";
import { reducePipelineEvent } from "../../analysis/reduce";
import { createInitialAnalysisState, type PositionSnapshot } from "../../analysis/types";
import { buildCommentaryFacts, renderCommentary, type CommentaryInput } from "../../commentary/facts";
import type { CommentaryRequest } from "../../commentary/session";
import CommentaryPanel from "../CommentaryPanel.vue";

const snapshot = recorded as PositionSnapshot;
const state = reducePipelineEvent(createInitialAnalysisState(), {
  type: "positionCompleted", v: 1, phase: "deep", snapshot,
});
const input: CommentaryInput = state.plies[snapshot.ply]!;

describe("grounded Notes panel", () => {
  it("requires opt-in, then shows real source facts and inspectable manual selection", async () => {
    const wrapper = mount(CommentaryPanel, { props: { input, contextKey: "sgf-a" } });
    expect(wrapper.find('[data-testid="commentary-body"]').exists()).toBe(false);
    await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    expect(wrapper.get('[data-testid="commentary-body"]').text()).toContain("+24.2 points");
    expect(wrapper.get('[data-testid="commentary-body"]').text()).toContain("unpriced");
    expect(wrapper.get('[data-testid="commentary-body"]').text()).toContain("/plies/50/ledger/value");
    await wrapper.findAll("button").find((b) => b.text() === "Prepare prompt JSON")!.trigger("click");
    const request = JSON.parse(wrapper.get<HTMLTextAreaElement>('[data-testid="commentary-prompt"]').element.value) as CommentaryRequest;
    const line = buildCommentaryFacts(input).find((f) => f.target)!;
    await wrapper.get('[data-testid="commentary-response"]').setValue(JSON.stringify({
      version: 1, requestId: request.requestId, selections: [{ factId: line.id, variant: 0 }],
    }));
    await wrapper.get('[data-testid="commentary-import"]').trigger("click");
    expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("Approved clause selection");
    await wrapper.get(`[data-fact-id="${line.id}"]`).trigger("click");
    expect(wrapper.emitted("cite")?.at(-1)).toEqual([line.target]);
    await wrapper.get(`[data-fact-id="${line.id}"]`).trigger("blur");
    expect(wrapper.emitted("clear-citation")?.length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it("makes an injected mock call only on explicit action and ignores completion after SGF changes", async () => {
    let resolve!: (value: unknown) => void;
    let request!: CommentaryRequest;
    let signal!: AbortSignal;
    const select = vi.fn((packet: CommentaryRequest, abort: AbortSignal) => {
      request = packet;
      signal = abort;
      return new Promise((done) => { resolve = done; });
    });
    const wrapper = mount(CommentaryPanel, {
      props: { input, contextKey: "sgf-a", provider: { id: "mock deferred", select } },
    });
    expect(select).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    expect(select).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    expect(select).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="commentary-cancel"]').exists()).toBe(true);
    const writes = wrapper.emitted("result")?.length;
    await wrapper.setProps({ contextKey: "sgf-b" });
    expect(signal.aborted).toBe(true);
    resolve(request.responseExample);
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked).toBe(false);
    expect(wrapper.find('[data-testid="commentary-body"]').exists()).toBe(false);
    expect(wrapper.emitted("result")?.length).toBe(writes);
    wrapper.unmount();
  });

  it("clears consent and aborts work on unmount", async () => {
    let signal!: AbortSignal;
    const onResult = vi.fn();
    const wrapper = mount(CommentaryPanel, {
      props: {
        input, contextKey: "sgf-a", onResult,
        provider: {
          id: "mock never resolves",
          select: (_: CommentaryRequest, abort: AbortSignal) => {
            signal = abort;
            return new Promise<unknown>(() => {});
          },
        },
      },
    });
    await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    const writes = onResult.mock.calls.length;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    expect(onResult).toHaveBeenCalledTimes(writes);
  });

  it("hides and cancels a pending request without replacing a restored selection", async () => {
    const facts = buildCommentaryFacts(input);
    const stored = renderCommentary(facts, [{ factId: facts[1]!.id, variant: 0 }], "mock saved provider", true);
    let finish!: (value: unknown) => void;
    let signal!: AbortSignal;
    const onResult = vi.fn();
    const wrapper = mount(CommentaryPanel, { props: {
      input, stored, contextKey: "game-a", onResult, provider: {
        id: "mock deferred",
        select: (_request: CommentaryRequest, abort: AbortSignal) => {
          signal = abort;
          return new Promise((resolve) => { finish = resolve; });
        },
      },
    } });
    expect(wrapper.emitted("result")).toBeUndefined();
    expect(wrapper.find('[data-testid="commentary-body"]').exists()).toBe(false);
    await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    expect(wrapper.emitted("result")?.at(-1)?.[0]).toEqual(stored);
    const writes = wrapper.emitted("result")!.length;
    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("mock saved provider");
    await wrapper.setProps({ active: false });
    expect(signal.aborted).toBe(true);
    expect(wrapper.get<HTMLElement>('[data-testid="commentary-panel"]').element.style.display).toBe("none");
    finish("late rejected response");
    await flushPromises();
    await wrapper.setProps({ active: true });
    expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("mock saved provider");
    expect(wrapper.emitted("result")).toHaveLength(writes);
    wrapper.unmount();
    expect(onResult).toHaveBeenCalledTimes(writes);
  });

  it("ignores a queued manual import after branch entry cancels the prompt", async () => {
    const wrapper = mount(CommentaryPanel, { props: { input, contextKey: "game-a" } });
    try {
      await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
      await wrapper.findAll("button").find((button) => button.text() === "Prepare prompt JSON")!.trigger("click");
      const request = JSON.parse(wrapper.get<HTMLTextAreaElement>('[data-testid="commentary-prompt"]').element.value) as CommentaryRequest;
      await wrapper.get('[data-testid="commentary-response"]').setValue(JSON.stringify(request.responseExample));
      const apply = wrapper.get('[data-testid="commentary-import"]');
      const writes = wrapper.emitted("result")!.length;
      await wrapper.setProps({ active: false });
      await apply.trigger("click");
      await wrapper.setProps({ active: true });
      expect(wrapper.find('[data-testid="commentary-prompt"]').exists()).toBe(false);
      expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("Deterministic templates");
      expect(wrapper.emitted("result")).toHaveLength(writes);
    } finally {
      wrapper.unmount();
    }
  });
});
