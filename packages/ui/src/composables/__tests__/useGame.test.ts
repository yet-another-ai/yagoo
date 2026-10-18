import { describe, expect, it } from "vitest";
import { useGame } from "../useGame";

const SAMPLE = `(;FF[4]GM[1]SZ[9]PB[Alice]PW[Bob]BR[1d]WR[2d]C[Root comment]
;B[dd]C[Black opens]
;W[ff]
;B[df]
(;W[fd]C[Main line])
(;W[cf]C[Variation]))`;

describe("useGame", () => {
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
});
