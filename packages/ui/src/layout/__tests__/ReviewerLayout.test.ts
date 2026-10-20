import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisSourceHandlers, PositionAnalysisRequest, PositionSourceFactory } from "../../analysis/sources/types";
import ReviewerLayout from "../ReviewerLayout.vue";

const SGF = "(;FF[4]GM[1]SZ[9];B[dd];W[ff])";

describe("ReviewerLayout", () => {
  it("analyzes the selected SGF sibling's ancestry and lets it stop or restart", async () => {
    const runs: Array<{ request: PositionAnalysisRequest; stop: ReturnType<typeof vi.fn> }> = [];
    const source: PositionSourceFactory = (request) => ({
      id: "controlled", label: "Controlled adapter, no model",
      start() {
        const stop = vi.fn();
        runs.push({ request, stop });
        return { stop };
      },
    });
    const wrapper = mount(ReviewerLayout, {
      props: { sgf: "(;SZ[9];B[dd](;W[ff])(;W[cc];B[ee]))", vertexSize: 16, positionSource: source },
    });
    await flushPromises();
    wrapper.vm.goToPly(1);
    wrapper.vm.goForward(1);
    await flushPromises();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.request).toMatchObject({ ply: 2, moves: [] });
    expect(runs[0]!.request.sgf).toContain("B[dd];W[cc]");
    expect(runs[0]!.request.sgf).not.toMatch(/W\[ff\]|B\[ee\]/);
    await wrapper.get('[data-testid="stop-variation"]').trigger("click");
    expect(runs[0]!.stop).toHaveBeenCalledOnce();
    await wrapper.get('[data-testid="analyze-variation"]').trigger("click");
    expect(runs).toHaveLength(2);
    wrapper.unmount();
    expect(runs[1]!.stop).toHaveBeenCalledOnce();
  });

  it("shows only the selected tried position's candidates, PV and ownership", async () => {
    const runs: Array<{ request: PositionAnalysisRequest; handlers: AnalysisSourceHandlers; stop: ReturnType<typeof vi.fn> }> = [];
    const source: PositionSourceFactory = (request) => ({
      id: "controlled", label: "Controlled adapter, no model",
      start(handlers) {
        const stop = vi.fn();
        runs.push({ request, handlers, stop });
        return { stop };
      },
    });
    const wrapper = mount(ReviewerLayout, {
      props: { sgf: SGF, vertexSize: 16, positionSource: source, candidates: [{ move: "H8", visits: 200 }] },
      attachTo: document.body,
    });
    await flushPromises();
    wrapper.vm.goToPly(1);
    await flushPromises();
    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').trigger("click");
    const run = runs.at(-1)!;
    expect(run.request).toMatchObject({ ply: 1, moves: ["A9"] });
    expect(run.request.sgf).toContain("B[dd]");
    expect(run.request.sgf).not.toContain("W[ff]");
    expect(runs[0]!.stop).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("H8");
    run.handlers.onEvent({
      type: "positionCompleted", v: 1, phase: "deep",
      snapshot: {
        schemaVersion: 1, ply: 2, toPlay: "B", ownershipConvention: "black_positive",
        board: { size: 9, black: ["D6"], white: ["A9"] }, chains: [],
        root: { visits: 200, ownership: Array(81).fill(0.6) },
        candidates: [{ move: "C3", visits: 160, order: 0, winrate: 0.6, pv: ["C3", "pass", "B8"] }],
      },
    });
    run.handlers.onDone?.();
    await flushPromises();
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).toContain("C3");
    expect(wrapper.findAll(".shudan-paint").length).toBeGreaterThan(0);
    await wrapper.get('[data-candidate-index="0"]').trigger("mouseenter");
    expect(wrapper.findAll(".shudan-marker").map((marker) => marker.text())).toContain("1");
    await wrapper.get('[data-testid="try-pass"]').trigger("click");
    expect(runs.at(-1)!.request.moves).toEqual(["A9", "pass"]);
    expect(wrapper.get('[data-testid="candidates-panel"]').text()).not.toContain("C3");
    const last = runs.at(-1)!;
    await wrapper.setProps({ sgf: "(;SZ[9];B[ee])" });
    expect(last.stop).toHaveBeenCalledOnce();
    expect(wrapper.vm.tryMode).toBe(false);
    wrapper.unmount();
  });

  it("moves with the arrow keys and opens try mode", async () => {
    const wrapper = mount(ReviewerLayout, {
      props: { sgf: SGF, vertexSize: 16 },
      attachTo: document.body,
    });
    await flushPromises();

    await wrapper.get(".yagoo-reviewer").trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.vm.moveNumber).toBe(1);

    await wrapper.get(".yagoo-reviewer").trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.vm.moveNumber).toBe(0);

    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    expect(wrapper.get('[data-testid="variation-tree"]').text()).toMatch(
      /Load a browser model or connect a native engine/,
    );
    expect(wrapper.vm.tryMode).toBe(true);

    wrapper.unmount();
  });

  it("does not step the move when the splitter handles arrow keys", async () => {
    const wrapper = mount(ReviewerLayout, {
      props: { sgf: SGF, vertexSize: 16 },
      attachTo: document.body,
    });
    await flushPromises();

    await wrapper.get(".yagoo-reviewer").trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.vm.moveNumber).toBe(1);

    const splitter = wrapper.get(".yagoo-splitter");
    const before = Number(splitter.attributes("aria-valuenow"));
    await splitter.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.vm.moveNumber).toBe(1);
    expect(Number(splitter.attributes("aria-valuenow"))).toBe(before + 16);

    await splitter.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.vm.moveNumber).toBe(1);
    expect(Number(splitter.attributes("aria-valuenow"))).toBe(before);

    wrapper.unmount();
  });

  it("walks try mode from the local position and steps out at the anchor", async () => {
    const wrapper = mount(ReviewerLayout, {
      props: { sgf: SGF, vertexSize: 16 },
      attachTo: document.body,
    });
    await flushPromises();

    const next = () => wrapper.get('[aria-label="Next move"]');
    const prev = () => wrapper.get('[aria-label="Previous move"]');
    const toPlay = () =>
      wrapper.get(".yagoo-bottom-bar__turn").attributes("data-to-play");

    await wrapper.get(".yagoo-reviewer").trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.vm.moveNumber).toBe(1);
    expect(toPlay()).toBe("-1");

    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    expect(next().attributes("disabled")).toBeDefined();

    await wrapper.get(".yagoo-reviewer").trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.vm.moveNumber).toBe(1);

    await wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').trigger("click");
    expect(toPlay()).toBe("1");
    expect(
      wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').classes(),
    ).toContain("shudan-sign_-1");
    expect(next().attributes("disabled")).toBeDefined();

    await prev().trigger("click");
    expect(wrapper.vm.tryMode).toBe(true);
    expect(wrapper.vm.moveNumber).toBe(1);
    expect(toPlay()).toBe("-1");
    expect(
      wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').classes(),
    ).toContain("shudan-sign_0");
    expect(next().attributes("disabled")).toBeUndefined();

    await next().trigger("click");
    expect(toPlay()).toBe("1");

    await prev().trigger("click");
    await prev().trigger("click");
    expect(wrapper.vm.tryMode).toBe(false);
    expect(wrapper.vm.moveNumber).toBe(0);
    expect(toPlay()).toBe("1");

    wrapper.unmount();
  });

  it("updates side to move and captures from the try position", async () => {
    const wrapper = mount(ReviewerLayout, {
      props: { sgf: SGF, vertexSize: 16 },
      attachTo: document.body,
    });
    await flushPromises();

    await wrapper.get('[data-testid="try-move-toggle"]').trigger("click");
    await wrapper.get('.shudan-vertex[data-x="0"][data-y="1"]').trigger("click");
    await wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').trigger("click");
    await wrapper.get('.shudan-vertex[data-x="1"][data-y="0"]').trigger("click");

    expect(wrapper.get('[data-testid="captures-black"]').text()).toBe("1");
    expect(wrapper.get('[data-testid="captures-white"]').text()).toBe("0");
    expect(
      wrapper.get(".yagoo-bottom-bar__turn").attributes("data-to-play"),
    ).toBe("-1");
    expect(
      wrapper.get('.shudan-vertex[data-x="0"][data-y="0"]').classes(),
    ).toContain("shudan-sign_0");

    wrapper.unmount();
  });
});
