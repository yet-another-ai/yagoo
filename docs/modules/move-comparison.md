# Actual versus preferred move

**Implemented in additive schema v1.** A comparison attached to snapshot *p*
explains the move that produced that position. Its evidence is rooted at *p − 1*,
with the player who made move *p* as `mover`. The ordinary snapshot root and
candidates still describe the next player after *p*. These are different contexts.

## Queries and evidence

`yagoo_pipeline::analyze_move_comparison` undoes one move on the complete replayed
game state. Setup stones, initial player, all preceding moves, passes and ko
history survive. All scan, ordinary deep and comparison queries use
`AnalysisQueryBuilder::from_game_state`; missing SGF `RU` defaults to Chinese.

The preferred candidate is the lowest engine `order`, not the candidate with most
visits. The actual candidate is found among **all** returned `moveInfos`, before
the group-analysis top-K limit. If absent, malformed, or below
`comparisonMinVisits` (default **16**), a second query restricts `allowMoves` to
the actual move at the identical historical root. Both use `movesOwnership`.
There is no substitution of ownership from the position after the actual move.
When supplied, root hashes must match; the query history is also retained by
the engine protocol. A missing hash is a documented limitation.

If actual and preferred are the same move, both columns use the exact same
candidate, giving zero score loss, zero winrate loss and a zero ownership
difference. A low-visit equality is labelled as such rather than re-searched
and turned into an artificial discrepancy.

`comparison.evidence` records root/actual query IDs, actual source
(`root_candidate` or `forced`), requested and achieved visits, root hashes and
limitations. The 16-visit threshold is an initial quality guard, not calibration.
The recorded 64-visit corpus uses a threshold of **1** to reproduce its genuine
two-visit actual candidate at move 44; production would request additional
evidence for that branch.

## Signs and board context

| Field | Convention |
| --- | --- |
| `actualWinrate`, `aiWinrate` | Fractions in the **mover's** perspective |
| `actualScoreLead`, `aiScoreLead` | Black-positive points |
| `scoreLoss`, `winrateLoss` | Preferred minus actual in the mover's favor; negative estimates are retained |
| `ownershipDelta` | Actual minus preferred, Black-positive, row-major on the root board |
| `ledgerDiff.value` | Actual minus preferred in mover perspective, the negative of `scoreLoss` |

`context` includes the root board/groups, root/pass analyses, actual/preferred
candidates, optional branch/pass pairs, and the preferred PV endpoint. Each
additional analysis has an explicit query ID. The ledger partitions the root
board using the [same-root attribution rules](gain-loss-ledger.md).

The **Why not** tab shows `context.board`, explicitly labelled as the board
before move *p*. A/AI markers, ownership shading, group outlines and row
highlights all belong to that board. The difference toggle maps −2…+2 to
−1…+1 for display opacity; dark means a difference toward Black, light toward
White. Other inspector perspectives return to the selected position *p*.
Wrong-ply payloads and local try boards do not display this comparison.
Replacing, cancelling or resetting a source rejects its late callbacks.

## Branch status changes

By default, actual and preferred branches each receive a root query and an
explicit pass probe. Equal moves share the branch pair. Root group stone
membership is held fixed across both branches, independently per color; no
matching of unrelated groups from newly clustered boards is attempted.
`groupTempo` records these coordinates, both branch statuses and their
own-color `gPlus`/`gMinus`. These are ownership-based pass-sensitivity estimates
on the original stones' locations, including locations where stones were
captured; they are not a proof of life or geometric seki.

A supported status difference gives the group ledger priority even when its
candidate ownership-strength change is below 0.3. The row contains
`tempo: "branch_pass_probes"` and `tempoChanges`; ordinary candidate-only
ledgers remain `unassessed`. The evidence supports neither sente/gote nor a
claim that a stone was sacrificed intentionally. Missing/invalid pass evidence
leaves transitions unassessed. A previous pass suppresses a second-pass probe.

## Configuration and limits

Comparisons run for deeply analyzed played moves; setup ply 0 and scan-only
positions have no comparison. `includeComparison` defaults to true;
`comparisonBranchProbes` and `comparisonPvEnd` also default to true.
CLI `--no-comparison` preserves old scripted replay, and
`--comparison-min-visits` controls the initial candidate-quality threshold.
These are optional additions to the v1 configuration and snapshot schema.

Core comparison query failures produce a warning and leave the field absent.
This preserves browser/WASM analysis when its experimental search cannot
handle a restricted move query. Optional branch/PV probe failures retain the
same-root comparison and disclose missing evidence. A completed snapshot with
no comparison clears older UI comparison data. No threshold or runtime is a CI
performance gate.

The genuine `comparison-19x19` fixture covers moves 43, 44, 50, 60 and 96:
Black/White signs, exact equality, a missing actual candidate forced at move 60,
and explicit branch/pass evidence. CI only replays committed responses.
It supplies regression evidence, not calibrated teaching accuracy or an
expert-labelled positive sacrifice.

The older `sample-19x19` recording used setup-only positions and omitted ko
history. Its R1 candidates at roots 43/49 are illegal in the actual historical
game. Those records must not validate actual-versus-preferred comparisons or
be described as mere visit-budget variance. The new comparison corpus retains
the complete history and correctly excludes those ko recaptures.
