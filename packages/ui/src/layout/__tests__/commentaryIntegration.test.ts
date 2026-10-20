import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import snapshot from "../../analysis/__fixtures__/ledger-position.json";
import sampleSgf from "../../analysis/__fixtures__/sample.sgf?raw";
import type { CommentaryRequest } from "../../commentary/session";
import AnalysisReviewer from "../AnalysisReviewer.vue";

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    await flushPromises();
  }
}

describe("commentary reviewer integration", () => {
  it("saves grounded notes, highlights citations, and clears consent on a new SGF", async () => {
    let finish!: (value: unknown) => void;
    let signal!: AbortSignal;
    let request!: CommentaryRequest;
    const select = vi.fn((packet: CommentaryRequest, abort: AbortSignal) => {
      request = packet;
      signal = abort;
      return new Promise((resolve) => { finish = resolve; });
    });
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: sampleSgf,
        initialNdjson: JSON.stringify({ type: "positionCompleted", v: 1, phase: "deep", snapshot }),
        vertexSize: 16,
        initialPerspective: "notes",
        commentaryProvider: { id: "mock deferred", select },
      },
    });
    await settle();
    const layout = wrapper.findComponent({ name: "ReviewerLayout" });
    layout.vm.goToPly(50);
    await settle();
    expect(select).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    await flushPromises();
    expect(layout.props("commentary")?.text).toContain("+24.2 points");
    expect(wrapper.find('[data-testid="commentary-body"]').exists()).toBe(true);

    const panel = wrapper.get('[data-testid="commentary-panel"]');
    await panel.findAll("button").find((button) => button.text() === "Prepare prompt JSON")!.trigger("click");
    const packet = JSON.parse(wrapper.get<HTMLTextAreaElement>('[data-testid="commentary-prompt"]').element.value) as CommentaryRequest;
    const line = packet.facts.find((fact) => fact.id.endsWith("/ledger-line-0"))!;
    await wrapper.get('[data-testid="commentary-response"]').setValue(JSON.stringify({
      version: 1, requestId: packet.requestId, selections: [{ factId: line.id, variant: 0 }],
    }));
    await wrapper.get('[data-testid="commentary-import"]').trigger("click");
    await wrapper.get(`[data-fact-id="${line.id}"]`).trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".shudan-dimmed").length).toBeGreaterThan(0);
    expect(layout.props("commentary")?.verified).toBe(true);

    await wrapper.get('[data-testid="commentary-provider"]').trigger("click");
    expect(select).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ initialSgf: "(;FF[4]GM[1]SZ[19];B[dd])" });
    await settle();
    expect(signal.aborted).toBe(true);
    finish(request.responseExample);
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked).toBe(false);
    expect(wrapper.find('[data-testid="commentary-body"]').exists()).toBe(false);
    expect(layout.props("commentary")).toBeNull();
    expect(wrapper.findAll(".shudan-dimmed").length).toBe(0);
    wrapper.unmount();
  });
});
