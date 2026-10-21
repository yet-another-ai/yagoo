import { describe, expect, it } from "vitest";
import { useGame } from "../useGame";

const SAMPLE = `(;FF[4]GM[1]SZ[9]PB[Alice]PW[Bob]BR[1d]WR[2d]C[Root comment]
;B[dd]C[Black opens]
;W[ff]
;B[df]
(;W[fd]C[Main line])
(;W[cf]C[Variation]))`;

describe("useGame", () => {
  it("keeps the valid position when a recorded move is illegal and allows another variation", () => {
    const g = useGame();
    g.loadSgf("(;SZ[9];B[dd](;W[dd])(;W[ff]))");
    g.goForward();
    const position = g.position.value;
    const ancestry = g.positionSgf.value;
    expect(g.goForward()).toBe(false);
    expect(g.error.value).toBe("Illegal SGF move 2");
    expect(g.position.value).toBe(position);
    expect(g.positionSgf.value).toBe(ancestry);
    expect(g.moveNumber.value).toBe(1);
    expect(g.goToPly(2)).toBe(false);
    expect(g.position.value).toBe(position);
    expect(g.goToVariation(1)).toBe(true);
    expect(g.error.value).toBeNull();
    expect(g.signMap.value[5]![5]).toBe(-1);
    expect(g.goBack()).toBe(true);
  });

  it("rejects an invalid replacement root without losing the loaded game", () => {
    const g = useGame();
    g.loadSgf(SAMPLE);
    g.goToPly(2);
    const tree = g.tree.value;
    const position = g.position.value;
    expect(g.loadSgf("(;SZ[5]AB[aa]B[aa])")).toBe(false);
    expect(g.error.value).toBe("Illegal SGF move 1");
    expect(g.tree.value).toBe(tree);
    expect(g.position.value).toBe(position);
    expect(g.boardSize.value).toBe(9);
    expect(g.moveNumber.value).toBe(2);
    expect(g.players.value[0].name).toBe("Alice");
    expect(g.goForward()).toBe(true);
    expect(g.error.value).toBeNull();
    expect(g.loadSgf("(;SZ[5])")).toBe(true);
    expect(g.boardSize.value).toBe(5);
  });

  it("reports illegal recorded Chinese superko without weakening the default rules", () => {
    const g = useGame();
    g.loadSgf("(;SZ[5]AB[ab][cb][ba]AW[bb][ac][cc][bd];B[bc];W[];B[];W[bb])");
    expect(g.goToPly(3)).toBe(true);
    const position = g.position.value;
    expect(position?.positionalSuperko).toBe(true);
    expect(g.goForward()).toBe(false);
    expect(g.error.value).toBe("Illegal SGF move 4");
    expect(g.position.value).toBe(position);
    expect(g.goBack()).toBe(true);
    expect(g.error.value).toBeNull();
  });

  it("loads SGF metadata and root position", () => {
    const g = useGame();
    g.loadSgf(SAMPLE);
    expect(g.boardSize.value).toBe(9);
    expect(g.players.value[0].name).toBe("Alice");
    expect(g.players.value[1].name).toBe("Bob");
    expect(g.comment.value).toBe("Root comment");
    expect(g.moveNumber.value).toBe(0);
    expect(g.signMap.value[3]![3]).toBe(0);
  });

  it("navigates forward and back along the main line", () => {
    const g = useGame();
    g.loadSgf(SAMPLE);
    expect(g.goForward()).toBe(true);
    expect(g.moveNumber.value).toBe(1);
    expect(g.signMap.value[3]![3]).toBe(1); // B[dd]
    expect(g.comment.value).toBe("Black opens");
    expect(g.currentPlayer.value).toBe(-1);

    expect(g.goForward()).toBe(true);
    expect(g.signMap.value[5]![5]).toBe(-1); // W[ff]

    expect(g.goBack()).toBe(true);
    expect(g.moveNumber.value).toBe(1);
    expect(g.signMap.value[5]![5]).toBe(0);
  });

  it("jumps to a main-line ply", () => {
    const g = useGame();
    g.loadSgf(SAMPLE);
    expect(g.goToPly(2)).toBe(true);
    expect(g.moveNumber.value).toBe(2);
    expect(g.signMap.value[5]![5]).toBe(-1); // W[ff]
    expect(g.goToPly(0)).toBe(true);
    expect(g.moveNumber.value).toBe(0);
  });

  it("switches between variations", () => {
    const g = useGame();
    g.loadSgf(SAMPLE);
    g.goForward(); // B
    g.goForward(); // W
    g.goForward(); // B[df]
    expect(g.variationCount.value).toBe(2);

    expect(g.goToVariation(1)).toBe(true);
    expect(g.comment.value).toBe("Variation");
    // W[cf] → c=2, f=5
    expect(g.signMap.value[5]![2]).toBe(-1);

    g.goBack();
    expect(g.goToVariation(0)).toBe(true);
    expect(g.comment.value).toBe("Main line");
    expect(g.signMap.value[3]![5]).toBe(-1); // W[fd]
  });

  it("labels child variations in GTP and knows the main line", () => {
    const g = useGame();
    g.loadSgf(SAMPLE);
    expect(g.onMainLine.value).toBe(true);
    expect(g.children.value[0]?.label).toBe("B D6");
    g.goForward();
    g.goForward();
    g.goForward();
    expect(g.children.value.map((child) => child.label)).toEqual([
      "W F6",
      "W C4",
    ]);
    g.goToVariation(1);
    expect(g.onMainLine.value).toBe(false);
  });
});
