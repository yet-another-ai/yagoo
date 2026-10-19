"""Generate small functional V7 fixtures from upstream KataGo, without a model.

The Python oracle does not implement superko or Japanese encore; these fixtures
do not certify those edge cases. The browser adapter rejects encore.
"""
import argparse
import json
import random
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--katago-source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.katago_source.resolve() / "python"))
    import numpy as np
    from katago.game.board import Board
    from katago.game.features import Features
    encoder = Features({"version": 15}, 19)
    rng = random.Random(5018)
    fixtures = []
    for size in [9, 13, 19]:
        for profile in ["chinese", "chinese-ogs", "japanese"]:
            board = Board(size)
            boards = [board.copy()]
            moves = []
            serial = []
            pla = Board.BLACK
            for turn in range(61):
                if turn in [0, 1, 2, 5, 10, 20, 40, 60]:
                    rules = dict(koRule="KO_POSITIONAL" if profile == "chinese-ogs" else "KO_SIMPLE",
                                 scoringRule="SCORING_TERRITORY" if profile == "japanese" else "SCORING_AREA",
                                 taxRule="TAX_SEKI" if profile == "japanese" else "TAX_NONE",
                                 multiStoneSuicideLegal=False, whiteKomi=7.5, encorePhase=0,
                                 passWouldEndPhase=bool(moves and moves[-1][1] == Board.PASS_LOC),
                                 asymPowersOfTwo=0, hasButton=False)
                    spatial = np.zeros((1, 361, 22), dtype=np.float32)
                    global_input = np.zeros((1, 19), dtype=np.float32)
                    encoder.fill_row_features(board, pla, Board.get_opp(pla), boards, moves, len(moves), rules,
                                              spatial, global_input, 0)
                    flat = spatial.transpose(0, 2, 1).reshape(-1)
                    fixtures.append(dict(name=f"{profile}-{size}-{turn}", size=size, rules=profile,
                                         komi=7.5, moves=serial.copy(), spatial=np.flatnonzero(flat).tolist(),
                                         globalInput=global_input[0].tolist()))
                legal = [board.loc(x, y) for y in range(size) for x in range(size) if board.would_be_legal(pla, board.loc(x, y))]
                loc = Board.PASS_LOC if turn == 3 or not legal else rng.choice(legal)
                board.play(pla, loc)
                moves.append((pla, loc))
                serial.append(None if loc == Board.PASS_LOC else [board.loc_x(loc), board.loc_y(loc)])
                boards.append(board.copy())
                pla = Board.get_opp(pla)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(fixtures, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(fixtures)} V7 feature fixtures to {args.out}")


if __name__ == "__main__":
    main()
