import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import snapshot from "../../analysis/__fixtures__/ledger-position.json";
import sampleSgf from "../../analysis/__fixtures__/sample.sgf?raw";
import type { CommentaryRequest } from "../../commentary/session";
import type { GroundedCommentary } from "../../commentary/facts";
import AnalysisReviewer from "../AnalysisReviewer.vue";

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    await flushPromises();
  }
}

describe("commentary reviewer integration", () => {
  const unrelatedOpening = JSON.stringify({
    type: "openingMatched", v: 1,
    match: { name: "Unrelated game", joseki: null, deviationPly: 9, source: "synthetic test" },
  });

  it.each([
    { sgf: "(;SZ[19];B[pd];W[dd];B[pp];W[dp];B[pj])", expected: "Sanrensei" },
    { sgf: "(;SZ[19];B[jj])", expected: null },
    { sgf: "", expected: "Unrelated game" },
  ])("uses the same opening in Notes and the header for SGF '$sgf'", async ({ sgf, expected }) => {
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: sgf, initialNdjson: unrelatedOpening, vertexSize: 16, initialPerspective: "notes" },
    });
    try {
      await settle();
      await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
      const badge = wrapper.get('[data-testid="opening-badge"]');
      const notes = wrapper.get('[data-testid="commentary-panel"]');
      if (expected) {
        expect(badge.text()).toContain(expected);
        expect(wrapper.get('[data-testid="commentary-body"]').text()).toContain(expected);
        await notes.findAll("button").find((button) => button.text() === "Prepare prompt JSON")!.trigger("click");
        const packet = JSON.parse(wrapper.get<HTMLTextAreaElement>('[data-testid="commentary-prompt"]').element.value) as CommentaryRequest;
        expect(packet.facts.find((fact) => fact.id.endsWith("/opening"))?.evidence)
          .toContainEqual({ path: "/opening/name", value: expected });
      } else {
        expect(badge.text()).toContain("No unique match");
        expect(notes.text()).toContain("No supported structured facts");
      }
      if (sgf) expect(notes.text()).not.toContain("Unrelated game");
    } finally {
      wrapper.unmount();
    }
  });

  it("refreshes Notes opening context when the SGF switches or is cleared", async () => {
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: "(;SZ[19];B[pd];W[dd];B[pp];W[dp];B[pj])", vertexSize: 16, initialPerspective: "notes" },
    });
    try {
      await wrapper.get('[data-testid="engine-source-button"]').trigger("click");
      const input = wrapper.get('[data-testid="source-ndjson-input"]');
      for (const [sgf, expected] of [
        ["(;SZ[19];B[dd];W[cc];B[dc];W[ce])", "4-4 point"],
        ["(;SZ[19];B[jj])", null],
        ["", "Unrelated game"],
      ] as const) {
        await wrapper.setProps({ initialSgf: sgf });
        await settle();
        expect(wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked).toBe(false);
        expect(wrapper.find('[data-testid="commentary-body"]').exists()).toBe(false);
        Object.defineProperty(input.element, "files", {
          configurable: true,
          value: [new File([unrelatedOpening], "unrelated.ndjson", { type: "text/plain" })],
        });
        await input.trigger("change");
        await settle();
        await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
        const notes = wrapper.get('[data-testid="commentary-panel"]');
        expect(wrapper.get('[data-testid="opening-badge"]').text()).toContain(expected ?? "No unique match");
        expect(notes.text()).toContain(expected ?? "No supported structured facts");
        if (sgf) expect(notes.text()).not.toContain("Unrelated game");
      }
    } finally {
      wrapper.unmount();
    }
  });

  it.each(["navigation", "Try", "SGF sibling", "report"])(
    "preserves a non-default selection through %s", async (transition) => {
    // Labelled synthetic positions exercise UI persistence; no engine is used.
    const initialNdjson = [1, 2].map((ply) => JSON.stringify({
      type: "positionCompleted", v: 1, phase: "deep",
      snapshot: {
        schemaVersion: 1, ply, toPlay: ply === 1 ? "W" : "B", ownershipConvention: "black_positive",
        board: { size: 9, black: ["D6"], white: ply === 2 ? ["F4"] : [] }, chains: [],
        root: { scoreLead: ply, visits: 100 }, candidates: [{ move: "A9", visits: 80 }],
      },
    })).join("\n");
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: "(;SZ[9];B[dd](;W[ff];B[ee])(;W[cc];B[gg]))",
        initialNdjson, vertexSize: 16, initialPerspective: "notes",
      },
    });
    await settle();
    const layout = wrapper.findComponent({ name: "ReviewerLayout" });
    layout.vm.goToPly(2);
    await settle();
    await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    await wrapper.findAll("button").find((button) => button.text() === "Prepare prompt JSON")!.trigger("click");
    const packet = JSON.parse(wrapper.get<HTMLTextAreaElement>('[data-testid="commentary-prompt"]').element.value) as CommentaryRequest;
    const choice = packet.facts.find((fact) => fact.id.endsWith("/candidate-0"))!;
    await wrapper.get('[data-testid="commentary-response"]').setValue(JSON.stringify({
      version: 1, requestId: packet.requestId, selections: [{ factId: choice.id, variant: 0 }],
    }));
    await wrapper.get('[data-testid="commentary-import"]').trigger("click");
    await flushPromises();
    const saved = structuredClone(layout.props("commentary")) as GroundedCommentary;
    expect(saved).toMatchObject({ verified: true, provider: "manual selection" });
    expect(saved.sentences).toHaveLength(1);

    if (transition === "Try") {
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
      expect(layout.props("commentary")).toEqual(saved);
      expect(wrapper.find('[data-testid="commentary-body"]').exists()).toBe(false);
      await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    } else if (transition === "navigation") {
      layout.vm.goToPly(1);
      await settle();
      layout.vm.goToPly(2);
    } else if (transition === "SGF sibling") {
      layout.vm.goToPly(1);
      layout.vm.goForward(1);
      await settle();
      expect(layout.props("commentary")).toEqual(saved);
      expect(wrapper.find('[data-testid="commentary-body"]').exists()).toBe(false);
      layout.vm.leaveVariation();
    } else {
      layout.vm.view = "report";
      await flushPromises();
      expect(layout.props("commentary")).toEqual(saved);
      layout.vm.view = "board";
    }
    await settle();
    expect(layout.props("commentary")).toEqual(saved);
    if (!wrapper.get<HTMLInputElement>('[data-testid="commentary-enable"]').element.checked) {
      await wrapper.get('[data-testid="commentary-enable"]').setValue(true);
    }
    expect(wrapper.get('[data-testid="commentary-body"]').text()).toContain(saved.text);
    expect(wrapper.get('[data-testid="commentary-verification"]').text()).toContain("manual selection");
    expect(layout.props("commentary")).toEqual(saved);
    wrapper.unmount();
  });

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
