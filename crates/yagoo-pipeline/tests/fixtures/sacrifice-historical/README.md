# Genuine historical sacrifice screens

These are **negative and boundary regression recordings**, not expert-labelled
positive sacrifice examples. The production detector, with unchanged default
thresholds, supports **zero** annotations in this corpus.

## Sources and provenance

`source-provenance.json` records exact download URLs, source and normalized SGF
SHA-256 hashes, and the CWI historical archive's statement that the games are in
the public domain and its collector claims no rights over the collection. The
small source SGFs are redistributed on that stated basis. Original files and
explicit Chinese-rules/zero-komi analysis copies are both preserved. These
analysis rules are not a reconstruction of historical rules. The Chitetsu–Dosaku
source itself warns that other records reverse the players and differ on result.
`RESEARCH.md` retains candidate-selection context and its expert/source limits.

All native requests preserve full move history. Recordings use the existing
KataGo **v1.16.4 Eigen AVX2** executable and official SWA b18 model; manifests
record their hashes, configuration, BLACK reporting perspective and visit budget.
No executable, model weights or network service is included. This native version
differs from the browser reference version; results must not be attributed only
to visit count or treated as browser parity evidence.

Each dated directory preserves original query/response NDJSON, manifest, engine
configuration, stderr, recording-script snapshot, validation and process-shutdown
evidence. Local path/PID fields are historical provenance, not execution targets.
The nested `.gitattributes` disables line-ending normalization to preserve hashes.
Top-level recorder/validator copies only adapt dependency/config paths to this
repository layout; dated script snapshots remain byte-for-byte originals.

## Recorded outcomes

| Screen | Budget | Production outcome / boundary |
| --- | --- | --- |
| Akaboshi–Jowa 1835, played 59 | 64 | Unassessed: preferred O3 has 15 visits. Actual J8 has a separate 64-visit forced same-root query. |
| Chitetsu–Dosaku 1668, played 131 | 64 | No supported candidate: captured F8/G8/G7 belong to a mixed teaching group. Preferred-to-endpoint winrate also falls about 0.264. |
| Dosaku–Santetsu 1669, played 113 | 64 | No supported original-group capture. |
| Dosaku–Santetsu 1669, played 35 | 64 | Original C17 is captured at PV offset 2 and replaced by Black at offset 5. The replacement must not revive the original stone. Single/mixed-group coverage boundary. |
| Dosaku–Santetsu 1669, played 71 | 64 | Unassessed: preferred G6 has 13 visits. Actual E13 has a separate 64-visit forced same-root query. |
| Dosaku–Santetsu 1669, played 137 | 64 | Newly played throw-in boundary; no eligible original root group is sacrificed. |
| Chitetsu–Dosaku 1668, played 131 | 256 | Independent preregistered sensitivity screen; still no positive. Endpoint score falls about 4.986 and winrate about 0.160, exceeding unchanged stability limits. |

There are **23 genuine final responses**: 18 for six initial screens, three for
the single deeper screen, and two forced historical actual moves. No saving probe
was selected by the production generator, so no handpicked F7 saving move was
recorded or injected into its candidates. `sensitivity-plan.json` preserves the
deeper experiment's predeclared scope. Thresholds and PV length were unchanged.

Capture lineage, legality and source identity are verified facts. Positive
accuracy, recall, false-positive rate and expert agreement remain **unverified**.
Constructed unit tests elsewhere are never counted as native positive evidence.

## Offline replay and checks

From the repository root, without an engine or model:

```sh
cargo test -p yagoo-pipeline --test historical_sacrifice_replay
cargo run -p yagoo-pipeline --example sacrifice_screen -- crates/yagoo-pipeline/tests/fixtures/sacrifice-historical/screen-64-20261020 output-64.json crates/yagoo-pipeline/tests/fixtures/sacrifice-historical/supplement-64-20261020
cargo run -p yagoo-pipeline --example sacrifice_screen -- crates/yagoo-pipeline/tests/fixtures/sacrifice-historical/screen-256-20261020 output-256.json
```

CI verifies exact query histories, budgets, rules and candidate restrictions,
then runs the real comparison/detector. It never loads a model and has no timing
threshold. The example also reports logical-to-recorded query IDs and any missing
requests, rather than filling missing evidence.

With installed workspace JavaScript dependencies, run from this fixture folder:

```sh
node validate-screens.mjs screen-64-20261020
node validate-screens.mjs screen-256-20261020
node finalize-calibration.mjs
```

The validators replay every retained candidate PV and check source/recording
hashes. They refresh derived validation/index files, not native transcripts.
`artifact-hashes.json` indexes this packaged corpus; the dated manifests remain
the authority for the original native files.

## Optional native reproduction

Never run these commands in CI. Coordinate exclusive use of one KataGo process,
provide existing assets, and select fresh output directories. The recorder
refuses to overwrite transcripts and does not download assets.

```powershell
node screen-positions.mjs --engine "$env:YAGOO_KATAGO" --model "$env:YAGOO_MODEL" --out .\regenerated-64 --visits 64
node screen-positions.mjs --engine "$env:YAGOO_KATAGO" --model "$env:YAGOO_MODEL" --out .\regenerated-256 --visits 256 --ids chitetsu1668-p131
node record-supplement.mjs --source .\regenerated-64 --queries .\screen-64-production-supplement-plan.json --out .\regenerated-actuals
```

These reproduce the query plan, not deterministic search values. New engine,
model, hardware or search outcomes need separate provenance and interpretation;
do not replace these recordings to force agreement.
