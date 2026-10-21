# Recorded same-root comparison and sacrifice evidence

Recorded locally 2026-10-20T17:16:29.180Z. **CI must only replay these files. Do not download a model or launch KataGo in CI.**

- Engine: KataGo v1.16.4; Eigen AVX2 CPU, Windows.
- Model: `kata1-b18c384nbt-s9996604416-d4316597426`, existing local SWA export, SHA-256 `46a623a366ef6ef423fa2055f1b094fd8f64c518c065e7d254a9e0829c192c5c`.
- Engine binary SHA-256: `bad55cf31ec42f58dec821a2e428c8d45d9e4697f9e2741b8aa644d03a37acfc`.
- Source: bundled 100-move Shusaku–Gennan historical game, copied byte-for-byte into `source.sgf`; SHA-256 `6b0310aec23fd026120aed5bb29ec4a68350494c47403fad1dde09757308b269`.
- Source archive credited by the bundled SGF: https://homepages.cwi.nl/~aeb/go/games/, game 126. No new source download occurred.
- Rules: Chinese; komi 0; 19×19. These are the repository sample's explicit settings, not a reconstruction of historical rules.
- Search: 64 maximum visits per query, eight root symmetries, one analysis/search thread, four Eigen threads, full pre-root history retained.
- Frame: all raw scores, winrates and ownership are Black-positive; ownership is row-major A19 through T1.

Actual move p is compared with the preferred `order=0` move at the position after p−1 moves. A missing actual candidate is queried with `allowMoves` at the identical root and verified by its engine position hash. Actual and AI branch root/pass queries are separate evidence for branch groups and tempo. The PV endpoint replays the exact preferred PV from the same root.

| Actual ply | Root ply | Actual | AI | Actual forced | Actual/AI candidate visits | Recorded loss for mover |
| --- | --- | --- | --- | --- | --- | --- |
| 43 | 42 | B R2 | R2 | false | 61/61 | 0.000000 |
| 44 | 43 | W S7 | P9 | false | 2/58 | 2.457585 |
| 50 | 49 | W R7 | R7 | false | 15/15 | 0.000000 |
| 60 | 59 | W S3 | H3 | true | 63/56 | 6.681626 |
| 96 | 95 | W R14 | R14 | false | 47/47 | 0.000000 |

Candidate visits can be much lower than the query's maximum visits. These finite-visit differences are recorded estimates, not calibrated mistake severity or proof that the engine found the strongest move.

## Sacrifice diagnostics

Means use only the root group's mover-colored stone coordinates, even after capture. A positive root-to-end difference alone does not establish a new sacrifice: already opponent-favored stones, contested groups, transient search disagreement, missing compensation, and capture lineage need separate checks. This corpus has no expert-labelled positive sacrifice. Positive calibration remains incomplete.

| Actual ply | Root group | Fixed own stones | Root own mean | Preferred own mean | PV-end own mean | Root-to-end deterioration |
| --- | --- | --- | --- | --- | --- | --- |
| 43 | N3 | M2 M4 N3 O2 O3 P3 P4 Q1 Q3 S1 | 0.720681 | 0.721314 | 0.761300 | -0.040619 |
| 44 | P5 | P5 P6 P7 P8 | 0.899653 | 0.901910 | 0.889115 | 0.010537 |
| 44 | Q4 | Q4 R3 R4 R5 S2 | -0.475213 | -0.486134 | -0.900839 | 0.425625 |
| 50 | M4 | N2 | -0.105105 | -0.096789 | -0.126821 | 0.021716 |
| 50 | Q5 | Q4 R3 R4 R5 S2 S7 | 0.676174 | 0.701317 | 0.704065 | -0.027891 |
| 60 | L2 | L2 L3 M3 | 0.808196 | 0.808588 | 0.805717 | 0.002479 |
| 96 | J17 | J17 | 0.046892 | 0.056313 | 0.089550 | -0.042658 |
| 96 | M17 | M17 N17 N18 P17 Q18 | 0.572962 | 0.575287 | 0.865186 | -0.292224 |

## Files

The implemented conservative detector replays this unchanged corpus with no
supported sacrifice annotations. Moves 43/44 contain mixed groups, move 60's
own group is not captured in the preferred PV, and move 96 has only a single
own stone or mixed group. Move 50 is unassessed at the default 16-visit guard
because the preferred candidate has 15 visits. These are scoped regression
outcomes, not expert-labelled accuracy measurements. Positive calibration,
false-positive rate and recall remain unverified. See
`docs/modules/sacrifices.md` for thresholds and exclusions.

- `queries.ndjson`: exact ordered KataGo requests, including visit limits, full histories and restrictions.
- `responses.ndjson`: unmodified final KataGo stdout response lines.
- `responses.json.gz`: compressed JSON array of those same raw response strings for scripted replay.
- `manifest.json`: query-role mapping, same-root scores, PV lineage, source/engine/model provenance and file hashes.
- `analysis.cfg`, `engine-version.txt`, `stderr.log`: exact engine configuration, version/build information and diagnostics.
- `derived-summary.json` was produced during recording and is not vendored here. Current derivative snapshots are regenerated through the checked-in pipeline example below, separate from the raw engine recording.
- `validation.json`: offline assertions and measured comparison summary.
- `record-fixtures.mjs`, `validate-recording.mjs`: dependency-free Node recording and validation scripts.

The pre-existing model export command and checkpoint metadata are recorded alongside the initial corpus. No binary, DLL, checkpoint, model weights or network service is included or required for replay.

## Reproduce locally

Provide existing local assets matching the recorded hashes. Run from this fixture directory, and use a new output directory:

```powershell
node record-fixtures.mjs --engine "$env:YAGOO_KATAGO" --model "$env:YAGOO_MODEL" --sgf source.sgf --out ..\regenerated-64 --plies 43,44,50,60,96 --visits 64
node validate-recording.mjs ..\regenerated-64
```

The recorder refuses CI execution and existing output transcripts. It accepts this simple empty-board, alternating-move SGF mainline. It does not download assets.

Current derivative snapshots can be regenerated from the repository root without
an engine or model:

```sh
cargo run -p yagoo-pipeline --example comparison_fixture -- packages/ui/src/analysis/__fixtures__/comparison-positions.json
node scripts/merge-comparison-sample.mjs
```

The first command checks the generated queries against the recorded complete
histories and visits. The second combines those five full-history deep snapshots
with the legacy demonstration stream for the docs app. The old UI regression
stream remains unchanged. A warning in the combined stream identifies both
provenances. The older setup-only corpus omitted ko history and must not be used
to validate move comparisons; illegal R1 recaptures at true roots 43/49 are not
explained by different search visits.

KataGo v1.16.4 reports the configured `searchRandSeed` key as unused; the original warning is retained. Offline replay is deterministic. Regeneration can change preferred moves, groups, PV lengths and scores across runs, visit budgets, engine versions and hardware. Preserve new observations as a separate recording rather than rewriting results to match old expectations.
