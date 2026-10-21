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
| `groups` | Teaching **groups** (块) — fate-correlated units. Filled on **deep** `positionCompleted` by `yagoo_snapshot::compute_groups`. Scan snapshots omit / empty. |

## Documents

- **`PositionSnapshot`** — one ply: board, chains, optional `groups`, root analysis, optional pass probe, top-K candidates (`movesOwnership` when present), optional PV ends.
- **`GameSnapshot`** — `{ size, komi, rules, positions[] }` aggregate written by the CLI `--final-json` flag after the stream completes.
- **`deepPliesSelected`** (stream event) — after scan, lists which plies will deepen (`mode`: `swing` | `all` | `range`) plus swing `reasons` for the UI.

## Groups (块) on `PositionSnapshot`

Additive wire field (camelCase). Emitted after the deep phase has root + scenario ownership (pass probe, candidate `movesOwnership`, optional PV ends):

```json
{
  "groups": [
    {
      "groupId": "D4",
      "members": {
        "blackStones": ["D4", "D5", "E5"],
        "whiteStones": [],
        "empty": ["C3", "C4", "D3"]
      },
      "chains": ["B:D4-D5-E5"],
      "parts": [{ "points": ["D4", "D5", "E5", "C3", "C4", "D3"], "chains": ["B:D4-D5-E5"] }],
      "kind": "simple",
      "strength": { "black": 0.42 },
      "certainty": 0.61,
      "cohesion": 0.83,
      "boundConfidence": null,
      "status": "weak",
      "gPlus": 0.55,
      "gMinus": 0.12,
      "delta": 0.43,
      "source": "pipeline"
    }
  ]
}
```

| Field | Source | Notes |
| --- | --- | --- |
| `groupId`, `members`, `chains`, `parts`, `kind`, `strength`, `certainty`, `cohesion`, `boundConfidence` | [Groups](../modules/groups.md) | `kind`: `simple` \| `contested` \| `bound` |
| `status`, `gPlus`, `gMinus`, `delta` | [Tempo sensitivity](../modules/tempo-sensitivity.md) | `status`: `settled` \| `weak` \| `tempo_critical` \| `dead` \| `likely_seki` |
| `source` | Pipeline | `"pipeline"` when real; omit when empty |

Serde: `default`, `skip_serializing_if = "Vec::is_empty"`. Do **not** invent groups from `chains` alone in the UI.

Algorithm summary: equal-weight fate vectors from deep scenarios → drop stable points → average-linkage correlation clustering (cut \(r^\ast=0.7\)) → 4-connectivity / kind → tempo status from root vs pass probe. Details and thresholds: [groups module](../modules/groups.md), [parameters](../appendix/parameters.md).

## Pass probe

Stored under `passProbe` (engine analysis after appending `"pass"` for the side to move). If skipped:

| `passProbeSkipped` | Meaning |
| --- | --- |
| `previous_was_pass` | Prior action was already a pass (see [conventions](../appendix/conventions.md)) |
| `disabled_in_phase` | Scan phase does not run the probe |

## Crate

Rust types live in `yagoo-snapshot`. Conversion from Analysis Engine responses and `GameState` is in the same crate (`engine_from_response`, `board_from_game`, …). Group computation: `compute_groups`.

## Optional gain/loss ledger

`PositionSnapshot.ledger` is an additive **schema-v1** field; old documents still
deserialize, and omitted/null values mean unavailable. Deep completion emits the
best retained candidate versus the explicit pass probe, rooted at this snapshot's
position. Candidate and reference ownership must use the same root position;
the pass probe is the explicitly documented counterfactual.

| Field | Meaning |
| --- | --- |
| `rootPly`, `mover` | Root position after this many moves; side whose favor signs represent (`B` / `W`) |
| `move`, `vs`, `referenceMove` | Candidate GTP move; `pass` or `best`; exact reference move |
| `value`, `bookTotal` | Mover-perspective search difference and raw ownership sum |
| `consistent`, `scaling`, `inconsistency` | Whether scaled points are safe; `score` or `proportions`; optional `zero_book` / `book_search_mismatch` |
| `ledger[].kind`, `id` | `group`, `own_territory`, `reduce_opponent`, `other`; group id when applicable |
| `ledger[].points` | Signed points when consistent, otherwise JSON `null` |
| `ledger[].bookValue`, `proportion` | Raw signed ownership and share of total absolute contribution |
| `ledger[].intersections` | Disjoint GTP coordinates assigned to the row, covering the board |
| `ledger[].strengthChanges` | Optional per-color `{color, reference, candidate, delta}` on fixed root stone membership |
| `ledger[].tempo` | `unassessed` for candidate-only rows; comparison rows may use `branch_pass_probes` |
| `ledger[].tempoChanges` | Per-color status evidence on fixed root stone membership when explicit branch/pass pairs exist |

The reducer copies this server fact and clears stale values when an authoritative
snapshot omits it. It does not calculate attribution in TypeScript. Evidence
paths for later explanation modules can refer to `ledger.value`,
`ledger.bookTotal`, `ledger.consistent`, and `ledger.ledger[i]` fields. See
[Gain/loss ledger](../modules/gain-loss-ledger.md) for formulas and limitations.

## Optional played-move comparison

`PositionSnapshot.comparison` is an additive optional schema-v1 field.
`comparison.ply` is this snapshot's *p*, while `comparison.rootPly` and
`comparison.context.rootPly` are **p − 1**. `comparison.mover` is the player
who made move *p*, usually the opposite of the snapshot's next `toPlay`.
All report/commentary consumers must use comparison context for claims about
the played move, rather than borrowing `snapshot.root`, `groups` or `ledger`.

The [comparison module](../modules/move-comparison.md) defines signs, root
identity, candidate visits, optional branch/pass and preferred-PV evidence.
Paths such as `comparison.scoreLoss`, `comparison.ledgerDiff.ledger[i]`,
`comparison.groupTempo[i]`, `comparison.context.preferred.pv` and
`comparison.evidence` provide grounded facts for later explanation modules.
Omitted/null is unavailable, not zero loss.

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
