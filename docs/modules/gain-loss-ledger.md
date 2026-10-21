# Gain / loss ledger

**Role.** Decompose why a move is valuable or a mistake: own territory, reducing the opponent, or changing a group’s life status — not a single opaque point count.

Whether this module is in the **2-week MVP** is still an [open question](../open-questions.md) (high teaching value vs time to validate groups).

## Inputs

- Move \(m\) by side \(P\)
- Reference: **pass probe** when explaining “value of playing”; **best move** \(b\) when explaining “mistake”
- Matching ownership maps and `scoreLead`

## Fetching data

- Prefer \(o^{(m)}\) from the **same** query via `includeMovesOwnership`
- If \(m\) is missing from `moveInfos`, issue a separate query with `allowMoves=[m]` — do **not** compare against a later root analysis (different search trees)
- Reference \(o^{\mathrm{ref}}\): pass-probe root ownership, or \(b\)’s `movesOwnership`

## Assignment

Let \(\delta_i=\sigma_P\,(o_i^{(m)}-o_i^{\mathrm{ref}})\). Assign points by priority:

1. **Group term:** \(i\in C\) and \(C\)’s status changes between \(m\) and ref (or \(|\Delta g_C|\ge 0.3\)). All members of \(C\) go under “save / kill / strengthen / weaken \(C\)”.
2. **Own territory:** empty and \(\sigma_P o_i^{\mathrm{ref}}\ge 0\) under the reference.
3. **Reduce opponent:** empty and \(\sigma_P o_i^{\mathrm{ref}}<0\) under the reference.
4. **Other:** remaining stone points (scattered dead stones, etc.).

Book value \(E_k=\sum_{i\in k}\delta_i\). Scale to `scoreLead` difference:

\[
\hat E_k=E_k\cdot\frac{\sigma_P\,[\mathrm{scoreLead}(m)-\mathrm{scoreLead}(\mathrm{ref})]}{\sum_k E_k}
\]

If \(\big|\sum_k E_k-\sigma_P\Delta\mathrm{scoreLead}\big|\) exceeds **initial** 3 points, or \(\sum_k E_k\approx 0\), **do not** scale — report proportions only and flag “book vs search inconsistent”. Negative line items are allowed (e.g. “+6 territory, but C3 settled→weak −9”).

## Fact JSON fragment

```json
{
  "move": "R14",
  "vs": "pass",
  "value": 11.2,
  "ledger": [
    {
      "kind": "group",
      "id": "C5",
      "change": "weak->settled",
      "points": 7.9
    },
    { "kind": "own_territory", "points": 4.1 },
    { "kind": "reduce_opponent", "points": -0.8 }
  ],
  "consistent": true
}
```

## Teaching uses

- “~11 points: ~8 from settling C5.”
- “−7 vs best: mostly failing to save C3 (−9); the territory grab (+2) does not compensate.”
- Link to pivotal groups in the score module when a mistake creates a “game hangs on this” region.

## Known limits

- Ownership book ≠ points (issue #538) — scaling + consistency checks required
- Choice of reference changes the story — UI must label the baseline
- Sente / gote / double-sente classification is not produced directly; \(\Delta\) from tempo can approximate; full treatment is post-MVP

## Implementation status (schema v1, 2026-10-21)

`yagoo_snapshot::compute_ledger` attributes a root candidate against its explicit
pass probe or the best candidate's `movesOwnership`. `compute_ledger_against`
accepts two candidate branches from the same root, including a forced
`allowMoves` query of that identical position. The caller must preserve this
provenance. Neither API reads a later root or subtracts consecutive positions.

The deep pipeline emits `PositionSnapshot.ledger` for the best retained root
candidate versus pass. A snapshot at ply *p* explains a move **available after p**;
it does not explain the already played move *p*. Actual-move comparison needs
the preceding root and its played branch. Scan positions, old recordings, skipped
pass probes, absent candidate maps/scores, and malformed evidence leave the
field absent. Missing attribution is not zero value.

Group membership remains fixed at the root. A group receives priority when any
color's mean own-color stone strength changes by at least **0.3**. All its stones
and empties then belong to that line. Remaining empties are split by the mover's
reference ownership sign, and remaining stones go to `other`. Exact disjoint
coordinates in `intersections` drive both mouse and keyboard board highlights.
Malformed overlapping eligible groups are rejected.

`value` is the mover-perspective search score difference; `bookTotal` is the
ownership sum. With difference at most **3 points** and `abs(bookTotal) >= 1e-6`,
`scaling: "score"` supplies signed line `points`. Otherwise
`scaling: "proportions"` supplies `points: null`, raw `bookValue`, and
`proportion = bookValue / sum(abs(bookValue))`. The all-zero case uses zero shares.
Signed shares can cancel; they are not win probabilities or calibrated points.
`inconsistency` distinguishes `zero_book` from `book_search_mismatch`.

The ordinary best-versus-pass ledger keeps tempo transitions **unassessed**:
one ownership map per candidate does not establish post-move life status.
The [played-move comparison](move-comparison.md) now collects actual/preferred
branch root/pass pairs, retaining fixed root stone membership per color.
`compute_ledger_against_with_tempo` gives a group priority when these supported
statuses differ, even below the 0.3 strength threshold. Those rows carry
`tempo: "branch_pass_probes"` and detailed `tempoChanges`. Missing probes retain
`unassessed`. These ownership-based statuses establish neither sente/gote nor
geometric seki, and broad teaching calibration remains incomplete.

Validation uses constructed arithmetic tests separately from all eight deep
positions in the genuine 2026-10-19 KataGo recording (see the fixture README).
The bundled NDJSON is replayed through the new pipeline without changing the raw
responses. `ledger-position.json` is a derived ply-50 snapshot used by reducer and
UI hover/focus tests. This checks data flow and arithmetic, not human teaching
calibration; the initial thresholds remain unvalidated on a broad game corpus.

The older recording omitted move history; some candidates violate the true
game's ko restriction. It remains an arithmetic/data-flow regression fixture,
not historical comparison evidence. The newer full-history `comparison-19x19`
corpus is used for actual-versus-preferred tests and supported branch statuses.

## Value of the played move

For a deeply compared move *p*, `comparison.playedLedger` attributes the actual
candidate at root *p - 1* against that root's explicit pass probe. It uses the
existing `movesOwnership` and pass ownership, with the same signed mover
perspective, partition and 3-point consistency guard as other ledgers. This
answers "what did playing this move gain compared with passing?" It is separate
from `comparison.ledgerDiff`, which measures actual versus preferred, and does
not subtract the ownership estimates of consecutive positions.

`comparison.playedTempo` evaluates the original root group's stones before the
move and after the actual branch. Each position supplies its own root/pass pair;
side-to-play determines `gPlus`/`gMinus` independently. These are the existing
`GroupStatus` classifications from the group module, not sente/gote labels or
proof of life. Original stone coordinates remain fixed, including captured
locations; newly placed stones are not added to these groups. A supported
before/after status change gives the group ledger priority even when the
candidate/pass ownership-strength change is below 0.3. The row carries
`tempo: "root_branch_pass_probes"` and `playedTempoChanges`.

The **Why not** view shows this played/pass ledger separately on the board
before move *p*. Row hover/focus highlights that root's exact intersections.
Missing root pass evidence leaves played value unavailable. Missing actual-branch
pass evidence leaves before/after statuses unassessed without discarding the
supported played/pass value. Imported claims are checked against their maps,
scores, coordinates, query identifiers and status means before rendering.

No extra analysis queries are needed: existing deep-comparison evidence supplies
both features. Scan-only moves still lack the multi-scenario groups and pass
probes; this is selective coverage, not a ledger for every scanned move. Full
scan coverage would require additional evidence and is not claimed here.

The unchanged genuine five-position corpus gives Black move 43 R2 a value of
**25.72956312** points versus pass, while its actual-versus-AI loss is exactly
zero. White move 60 S3 has **8.89357024** points versus pass and a separate
**6.681626325**-point loss versus H3. These are finite-visit search estimates,
not calibrated teaching severity. Recorded root-to-actual status transitions
include N3 Black `tempo_critical` to `weak` at move 43 and Q4 White `weak` to
`settled` at move 44. Offline replay still requests exactly the same 30 recorded
queries; no new model run is needed to test this extension.
