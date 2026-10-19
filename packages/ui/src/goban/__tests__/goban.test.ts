import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { BoardMap, HeatVertex, Marker, Sign } from "../../types";
import Goban from "../Goban.vue";
import { createShiftMap, createRng } from "../shifts";

function emptyBoard(n: number): BoardMap<Sign> {
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0 as Sign),
  );
}

function withStone(
  map: BoardMap<Sign>,
  x: number,
  y: number,
  sign: Sign,
): BoardMap<Sign> {
  return map.map((row, yy) =>
    row.map((v, xx) => (xx === x && yy === y ? sign : v)),
  );
}

describe("Goban", () => {
  it("renders a vertex per intersection", () => {
    const signMap = emptyBoard(3);
    const wrapper = mount(Goban, {
      props: { signMap, vertexSize: 20 },
    });
    expect(wrapper.findAll(".shudan-vertex")).toHaveLength(9);
    expect(wrapper.find(".shudan-goban").classes()).toContain(
      "shudan-board-3x3",
    );
  });

  it("shows coordinates when requested", () => {
    const wrapper = mount(Goban, {
      props: {
        signMap: emptyBoard(3),
        showCoordinates: true,
      },
    });
    expect(wrapper.find(".shudan-goban").classes()).toContain(
      "shudan-coordinates",
    );
    expect(wrapper.findAll(".shudan-coordx").length).toBeGreaterThan(0);
    expect(wrapper.findAll(".shudan-coordy").length).toBeGreaterThan(0);
  });

  it("applies fuzzy shift classes when enabled", () => {
    const signMap = withStone(emptyBoard(3), 1, 1, 1);
    const wrapper = mount(Goban, {
      props: {
        signMap,
        fuzzyStonePlacement: true,
        fuzzySeed: 99,
      },
    });
    const expected = createShiftMap(3, 3, createRng(99));
    const shift = expected[1]![1]!;
    const cell = wrapper.find('[data-x="1"][data-y="1"]');
    if (shift) {
      expect(cell.classes()).toContain(`shudan-shift_${shift}`);
    } else {
      expect(cell.classes().some((c) => c.startsWith("shudan-shift_"))).toBe(
        false,
      );
    }
  });

  it("keeps the same shift map across remounts with the same seed", () => {
    const signMap = withStone(emptyBoard(5), 2, 2, 1);
    const a = mount(Goban, {
      props: { signMap, fuzzyStonePlacement: true, fuzzySeed: 123 },
    });
    const b = mount(Goban, {
      props: { signMap, fuzzyStonePlacement: true, fuzzySeed: 123 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((a.vm as any).shiftMap).toEqual((b.vm as any).shiftMap);
  });

  it("emits vertex-click with board coordinates", async () => {
    const wrapper = mount(Goban, {
      props: { signMap: emptyBoard(3) },
    });
    await wrapper.find('[data-x="2"][data-y="1"]').trigger("click");
    const events = wrapper.emitted("vertex-click");
    expect(events).toBeTruthy();
    expect(events![0]![1]).toEqual([2, 1]);
  });

  it("renders heat labels and marker types", () => {
    const signMap = emptyBoard(3);
    const heatMap: BoardMap<HeatVertex | null> = emptyBoard(3).map((row) =>
      row.map(() => null),
    );
    heatMap[0]![0] = { strength: 9, text: "80%" };
    const markerMap: BoardMap<Marker | null> = emptyBoard(3).map((row) =>
      row.map(() => null),
    );
    markerMap[1]![1] = { type: "circle" };

    const wrapper = mount(Goban, {
      props: {
        signMap: withStone(signMap, 1, 1, -1),
        heatMap,
        markerMap,
      },
    });
    expect(wrapper.find(".shudan-heatlabel").text()).toBe("80%");
    expect(wrapper.find(".shudan-marker_circle").exists()).toBe(true);
  });

  it("uses absolute opacity for signed ownership paint (black and white)", () => {
    const signMap = emptyBoard(3);
    const paintMap: BoardMap<number> = emptyBoard(3).map((row) =>
      row.map(() => 0),
    );
    paintMap[0]![0] = 0.55;
    paintMap[0]![1] = -0.4;

    const wrapper = mount(Goban, {
      props: { signMap, paintMap, vertexSize: 20 },
    });

    const black = wrapper.find(".shudan-paint_1 .shudan-paint");
    const white = wrapper.find(".shudan-paint_-1 .shudan-paint");
    expect(black.exists()).toBe(true);
    expect(white.exists()).toBe(true);
    expect(black.attributes("style")).toMatch(/--shudan-paint-opacity:\s*0\.55/);
    // Negative paint must not produce negative CSS opacity (invisible white).
    expect(white.attributes("style")).toMatch(/--shudan-paint-opacity:\s*0\.4/);
    expect(white.attributes("style")).not.toMatch(
      /--shudan-paint-opacity:\s*-/,
    );
  });

  it("animates placement by assigning a non-zero shift", async () => {
    const before = emptyBoard(3);
    const wrapper = mount(Goban, {
      props: {
        signMap: before,
        fuzzyStonePlacement: true,
        animateStonePlacement: true,
        fuzzySeed: 1,
        animationDuration: 50,
      },
    });

    const after = withStone(before, 1, 1, 1);
    await wrapper.setProps({ signMap: after });
    await wrapper.vm.$nextTick();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shift = (wrapper.vm as any).shiftMap[1][1];
    expect(shift).toBeGreaterThanOrEqual(1);
    expect(shift).toBeLessThanOrEqual(8);
    expect(
      wrapper.find('[data-x="1"][data-y="1"]').classes(),
    ).toContain("shudan-animate");
  });
});
