import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import fixtureText from "../../analysis/__fixtures__/sample-scan-deep.ndjson?raw";
import AnalysisReviewer from "../AnalysisReviewer.vue";

const SAMPLE_SGF = `(;FF[4]GM[1]SZ[9]KM[7.5]
PB[Alpha]PW[Beta]
C[Sample]
;B[cc]
;W[gg]
)`;

describe("AnalysisReviewer", () => {
  it("loads SGF and streams fixture NDJSON into the reviewer chrome", async () => {
    const wrapper = mount(AnalysisReviewer, {
      props: {
        initialSgf: SAMPLE_SGF,
        initialNdjson: fixtureText,
        vertexSize: 20,
      },
      attachTo: document.body,
    });

    // Progressive rAF batches — advance frames until stream completes.
    for (let i = 0; i < 40; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      await flushPromises();
    }

    expect(wrapper.find(".yagoo-reviewer").exists()).toBe(true);
    expect(wrapper.find(".yagoo-winrate").exists()).toBe(true);
    expect(wrapper.find(".yagoo-bottom-bar").exists()).toBe(true);
    expect(wrapper.text()).toMatch(/chinese/i);
    expect(wrapper.text()).toMatch(/complete|streaming|deep/i);

    wrapper.unmount();
  });
});
