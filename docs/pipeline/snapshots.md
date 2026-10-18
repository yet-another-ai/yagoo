# Snapshot schema

Versioned, typed JSON consumed by teaching modules (groups, tempo, zoning, ledger). Modules must **not** call KataGo directly — they read snapshots only.

## Conventions

| Field | Convention |
| --- | --- |
| `schemaVersion` | Currently **1** (`yagoo_snapshot::SCHEMA_VERSION`) |
| Ownership / winrate / scoreLead | **Black-positive** (`ownershipConvention: "black_positive"`). Queries set `reportAnalysisWinratesAs = BLACK`. |
| Ownership arrays | Row-major from **A19**, length `size²` |
| Coordinates in board/chains/moves | GTP strings (`D4`, `pass`) |
| `chains` | Rules **chains** (串), not teaching **groups** (块) |

## Documents

- **`PositionSnapshot`** — one ply: board, chains, root analysis, optional pass probe, top-K candidates (`movesOwnership` when present), optional PV ends.
- **`GameSnapshot`** — `{ size, komi, rules, positions[] }` aggregate written by the CLI `--final-json` flag after the stream completes.
- **`deepPliesSelected`** (stream event) — after scan, lists which plies will deepen (`mode`: `swing` | `all` | `range`) plus swing `reasons` for the UI.

## Pass probe

Stored under `passProbe` (engine analysis after appending `"pass"` for the side to move). If skipped:

| `passProbeSkipped` | Meaning |
| --- | --- |
| `previous_was_pass` | Prior action was already a pass (see [conventions](../appendix/conventions.md)) |
| `disabled_in_phase` | Scan phase does not run the probe |

## Crate

Rust types live in `yagoo-snapshot`. Conversion from Analysis Engine responses and `GameState` is in the same crate (`engine_from_response`, `board_from_game`, …).

## Optional browser neural sample

`EngineAnalysis.neural` is an additive optional schema-v1 field, available on
completed nonterminal browser queries. Native responses, terminal positions and
during-search partials omit it. This applies independently to `root`, `passProbe`
and PV-end analysis. It contains one **identity-symmetry root NN sample**, not a
tree mean or an eight-symmetry average. The existing reviewer ignores these new
fields; teaching modules may consume them directly from saved NDJSON.

`sampleToPlay` identifies the actual `B` or `W` neural-input perspective. Do not
borrow the surrounding position's player for a pass probe. `sampleSymmetry` is
`identity`, `aggregation` is `none`, and `tensorLayout` is `CHW`. `boardSize` is the
played board; `modelBoardSize` is always 19. Spatial outputs retain padding:
read point `(x,y)` in channel `c` at `c*361 + y*19 + x`, masking points outside
`boardSize`. Taking the first `boardSize²` values is incorrect on small boards.

| Field | Shape | Meaning / activation |
| --- | --- | --- |
| `scoreBeliefLogProbs` | 842 | Normalized natural log probabilities. Bin `i` represents `scoreBinFirstCenter + i` points, from −420.5 to +420.5. Includes komi; do not rescale or add komi again. |
| `sekiLogits` | 4×19×19 | Softmax channels 0–2 together: no signed naive-area/ownership discrepancy, discrepancy for the player to move, discrepancy for the opponent. Apply sigmoid to channel 3 independently for final unowned probability, which includes dame and is not a pure seki probability. |
| `futurePositionPreTanh` | 2×19×19 | Apply tanh. Expected signed stone occupancy at +8 and +32 half-moves, using the final board if the game ends earlier. Own stone +1, opponent −1, empty 0; not territory or next-move probability. |

Score belief has no no-result bin; upstream does not train it on no-result games.
For black-perspective consumers when `sampleToPlay=W`, reverse score bins, negate
future-position values and swap seki channels 1/2; channel 3 stays unchanged.
The browser checks shapes, finite values and score-probability normalization.
These raw heads are separate from the black-positive searched scalars above.

Trunk activations never enter snapshots or NDJSON. The optional live GPU lease
and its lifetime are described in [Browser engine](../browser-engine#root-activations).
