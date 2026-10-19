import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReviewerLayout from "../ReviewerLayout.vue";

const SGF = "(;FF[4]GM[1]SZ[9];B[dd];W[ff])";

describe("ReviewerLayout", () => {
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
      /Coming in #26/,
    );
    expect(wrapper.vm.tryMode).toBe(true);

    wrapper.unmount();
  });
});
