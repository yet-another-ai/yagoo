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
