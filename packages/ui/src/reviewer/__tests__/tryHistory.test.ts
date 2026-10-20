import { describe, expect, it } from "vitest";
import { useGame } from "../../composables/useGame";
import { applyTryMoves, orderedTryNodes, tryPath, type TryNode } from "../tryBranch";

const ko = "(;SZ[5]AB[ab][cb][ba]AW[bb][ac][cc][bd];B[bc])";

describe("try history", () => {
  it("retains an anchor ko and Chinese positional history, including legal passes", () => {
    const game = useGame();
    game.loadSgf(ko);
    game.goToPly(1);
    const run = (moves: [number, number][]) => applyTryMoves(5, game.signMap.value, game.currentPlayer.value, moves, game.position.value);
    expect(run([[1, 1]])).toBeNull();
    expect(run([[-1, -1]])?.toPlay).toBe(1);
    expect(run([[-1, -1], [-1, -1], [1, 1]])).toBeNull();
    expect(game.position.value!.history).toHaveLength(2);
  });

  it("clears simple ko on passes for Japanese rules without losing captures", () => {
    const game = useGame();
    game.loadSgf(ko.replace("SZ[5]", "SZ[5]RU[Japanese]"));
    game.goToPly(1);
    const result = applyTryMoves(5, game.signMap.value, -1, [[-1, -1], [-1, -1], [1, 1]], game.position.value);
    expect(result?.captures.white).toBe(1);
    expect(result?.signMap[1]![1]).toBe(-1);
    expect(game.signMap.value[1]![1]).toBe(0);
    expect(game.players.value[0].captures).toBe(1);
  });

  it("retains legacy SGF tt passes and expands compressed setup for engines", () => {
    const game = useGame();
    game.loadSgf("(;SZ[9]AB[aa:ab]PL[W];W[tt])");
    game.goToPly(1);
    expect(game.currentPlayer.value).toBe(1);
    expect(game.moveNumber.value).toBe(1);
    expect(game.positionSgf.value).toContain("AB[aa][ab]");
    expect(game.positionSgf.value).toContain("W[tt]");
    expect(game.signMap.value[0]![0]).toBe(1);
    expect(game.signMap.value[1]![0]).toBe(1);
  });

  it("uses the actual SGF ancestry, root move, handicap and explicit player", () => {
    const game = useGame();
    game.loadSgf("(;SZ[9]HA[2]AB[aa][bb]PL[B]B[cc];C[note];W[](;B[dd])(;B[ee]))");
    expect(game.moveNumber.value).toBe(1);
    expect(game.currentPlayer.value).toBe(-1);
    game.goToPly(2);
    expect(game.moveNumber.value).toBe(2);
    expect(game.currentPlayer.value).toBe(1);
    game.goToVariation(1);
    expect(game.positionSgf.value).toContain("B[ee]");
    expect(game.positionSgf.value).not.toContain("B[dd]");
    expect(game.positionSgf.value).toContain("W[]");
    expect(game.position.value!.history).toHaveLength(3);
  });

  it("orders siblings under their own ancestor and rejects off-board moves", () => {
    const nodes: TryNode[] = [
      { id: "a", parentId: null, vertex: [0, 0], sign: 1, label: "A9" },
      { id: "b", parentId: "a", vertex: [1, 0], sign: -1, label: "B9" },
      { id: "c", parentId: null, vertex: [2, 0], sign: 1, label: "C9" },
      { id: "d", parentId: "b", vertex: [3, 0], sign: 1, label: "D9" },
    ];
    expect(orderedTryNodes(nodes).map((node) => node.id)).toEqual(["a", "b", "d", "c"]);
    expect(tryPath(nodes, "d").map((node) => node.id)).toEqual(["a", "b", "d"]);
    const game = useGame();
    game.loadSgf("(;SZ[9])");
    expect(applyTryMoves(9, game.signMap.value, 1, [[9, 1]], game.position.value)).toBeNull();
  });
});
