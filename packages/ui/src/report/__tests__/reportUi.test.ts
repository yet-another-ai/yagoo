import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import snapshotsJson from "../../analysis/__fixtures__/comparison-positions.json";
import sampleSgf from "../../analysis/__fixtures__/sample.sgf?raw";
import type { PositionSnapshot, PipelineEvent } from "../../analysis/types";
import AnalysisReviewer from "../../layout/AnalysisReviewer.vue";
import ReviewerLayout from "../../layout/ReviewerLayout.vue";
import ReviewReport from "../../reviewer/ReviewReport.vue";
import EngineSourcePanel from "../../reviewer/EngineSourcePanel.vue";
import { reviewPipelineEvents } from "../build";

const snapshot = (snapshotsJson as unknown as PositionSnapshot[]).find((s) => s.ply === 60)!;
const events: PipelineEvent[] = [
  { type: "gameStarted", v: 1, size: 19, komi: 0.5, moveCount: 100, positionCount: 101, strategy: "scan_then_deep" },
  { type: "positionCompleted", v: 1, phase: "deep", snapshot },
  { type: "gameCompleted", v: 1 },
];
const report = reviewPipelineEvents(events);

describe("report UI orchestration", () => {
  it("jumps to played move60 rather than comparison root59", async () => {
    const wrapper = mount(ReviewerLayout, { props: { sgf: sampleSgf, reportDocument: report, vertexSize: 12 } });
    wrapper.vm.openReport();
    await flushPromises();
    await wrapper.get('[data-report-ply="60"]').trigger("click");
    expect(wrapper.vm.moveNumber).toBe(60);
    expect(wrapper.emitted("select-ply")?.at(-1)).toEqual([60]);
    wrapper.unmount();
  });

  it("one Review action starts the available engine and opens a report that can be stopped", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const stop = vi.fn();
    const analyzeSgf = vi.fn(async function* () {
      yield JSON.stringify(events[0]);
      yield JSON.stringify(events[1]);
      await pending;
      yield JSON.stringify(events[2]);
    });
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: sampleSgf, browserEngine: { analyzeSgf, stop }, vertexSize: 12 },
    });
    await wrapper.get('[data-testid="review-game"]').trigger("click");
    await flushPromises();
    expect(analyzeSgf).toHaveBeenCalledWith(sampleSgf);
    expect(wrapper.get('[data-testid="review-report"]').text()).toMatch(/Move 60|in progress/);
    await wrapper.get('[data-testid="cancel-review"]').trigger("click");
    expect(stop).toHaveBeenCalled();
    release();
    await flushPromises();
    expect(wrapper.get('[data-testid="review-report"]').text()).toMatch(/partial/);
    expect(wrapper.find('[data-testid="cancel-review"]').exists()).toBe(false);
    await wrapper.setProps({ initialSgf: "(;SZ[9];B[aa])" });
    expect(wrapper.get('[data-testid="review-report"]').text()).not.toMatch(/Move 60/);
    wrapper.unmount();
  });

  it("opens configuration when Review has no engine and rejects late file reads after a source switch", async () => {
    const wrapper = mount(AnalysisReviewer, { props: { initialSgf: sampleSgf, vertexSize: 12 } });
    await wrapper.get('[data-testid="review-game"]').trigger("click");
    expect(wrapper.text()).toMatch(/Choose an available engine/);
    expect(wrapper.find('[data-testid="review-report"]').exists()).toBe(false);
    let resolve!: (value: string) => void;
    const stale = { name: "stale.sgf", text: () => new Promise<string>((r) => { resolve = r; }) } as File;
    wrapper.findComponent(EngineSourcePanel).vm.$emit("sgf-file", stale);
    await wrapper.setProps({ initialSgf: "(;SZ[9];B[bb])" });
    resolve(sampleSgf);
    await flushPromises();
    expect(wrapper.findAll(".shudan-vertex")).toHaveLength(81);
    wrapper.unmount();
  });

  it("restarts a stopped review and rejects both pending runs after an SGF switch", async () => {
    const releases: Array<() => void> = [];
    const analyzeSgf = vi.fn(async function* () {
      const pending = new Promise<void>((resolve) => { releases.push(resolve); });
      yield JSON.stringify(events[0]);
      yield JSON.stringify(events[1]);
      await pending;
      yield JSON.stringify(events[1]);
      yield JSON.stringify(events[2]);
    });
    const stop = vi.fn();
    const wrapper = mount(AnalysisReviewer, {
      props: { initialSgf: sampleSgf, browserEngine: { analyzeSgf, stop }, vertexSize: 12 },
    });
    await wrapper.get('[data-testid="review-game"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="cancel-review"]').trigger("click");
    await wrapper.get('[data-testid="review-game"]').trigger("click");
    await flushPromises();
    expect(analyzeSgf).toHaveBeenCalledTimes(2);
    // Opening an already running report must not start another engine request.
    await wrapper.get('[data-testid="review-game"]').trigger("click");
    expect(analyzeSgf).toHaveBeenCalledTimes(2);
    await wrapper.setProps({ initialSgf: "(;SZ[9];B[aa])" });
    releases.forEach((release) => release());
    await flushPromises();
    expect(stop).toHaveBeenCalled();
    expect(wrapper.get('[data-testid="review-report"]').text()).not.toContain("Move 60");
    expect(wrapper.find('[data-testid="cancel-review"]').exists()).toBe(false);
    await wrapper.findAll("button").find((button) => button.text() === "Back to board")!.trigger("click");
    expect(wrapper.findAll(".shudan-vertex")).toHaveLength(81);
    wrapper.unmount();
  });

  it("exports repeatedly without retaining object URLs", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const wrapper = mount(ReviewReport, { props: { report } });
    await wrapper.get('[data-testid="export-markdown"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="export-html"]').trigger("click");
    await flushPromises();
    expect(click).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    vi.restoreAllMocks();
  });
});
