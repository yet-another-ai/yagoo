# Real-game sacrifice candidate research

This folder contains research records and reproducible candidate selection. It does not currently establish a positive sacrifice label.

The original SGFs are exact downloads from the [CWI historical Go archive](https://homepages.cwi.nl/~aeb/go/games/), whose collector states that the games are public domain and claims no rights over the collection. `source-provenance.json` records URLs, byte hashes, dates, metadata, and analysis normalization. The corresponding `.chinese.sgf` records preserve every mainline move and use explicit 19x19, Chinese rules and zero komi, matching the existing fixture corpus. These analysis settings are not a reconstruction of historical rules. The Chitetsu–Dosaku record itself warns that other sources reverse the player names and differ on the result.

`replay-captures.mjs` verifies all mainlines with legal move replay and creates `capture-map.json`, tracking the birth and capture of individual stones. `prepare-sources.mjs` produces normalized records and provenance. Neither script starts an engine.

The [INAF announcement of a Nihon Kiin lecture by Michael Redmond](https://www.inaf-go.org/2021/09/new-lectures-by-michael-redmond-9p-and-tsuruyama-atsushi-8p-sponsored-by-inaf/) identifies sacrifice in a Dosaku–Yasui Santetsu game as its subject. This is a primary expert lead for selecting a game, not confirmation of particular move numbers or of KataGo's preferred continuation. The date linkage is a secondary lead recorded separately in provenance.

## Selected screens

`screen-plan.json` fixes six candidate roots before engine screening:

| Actual move | Historical continuation | Purpose and limitation |
| --- | --- | --- |
| Akaboshi–Jowa 1835, Black 59 J8 | White 60 G4 captures E4/F4 | Two-stone sacrifice candidate; Black's actual decision is not presumed correct |
| Chitetsu–Dosaku 1668, Black 131 J6 | White 132 F7 captures F8/G8/G7 | Connected three-stone candidate; archive player/result attribution is uncertain |
| Dosaku–Santetsu 1669, Black 113 G8 | Existing K7/J6/K6/L6 group has only J5/L5 liberties | Threatened four-stone candidate from offline scanning; not captured in the historical mainline |
| Dosaku–Santetsu 1669, Black 35 D18 | White 36 D17 captures C17 | Single-stone shape boundary case |
| Dosaku–Santetsu 1669, Black 71 E13 | White 72 E16 captures F16 | Single-stone, ko-associated boundary case |
| Dosaku–Santetsu 1669, Black 137 M7 | White 138 N7 captures the new M7 stone | Newly played throw-in; not an original root stone |

Historical capture alone is not evidence that a sacrifice is correct, preferred, avoidable, or compensated.

## Recording

`screen-positions.mjs --plan-only` validates prefixes and prints the plan without spawning KataGo. A live run requires explicit engine, model, and a new output subdirectory of this research folder. It refuses CI. Only the coordinated owner of the single model process may run it.

Each candidate gets a full-history root query, a query at the unrestricted preferred PV endpoint, and a query after passing at the original root. Raw requests and all response/warning envelopes are preserved. The copied configuration reports values from BLACK's perspective. The manifest includes engine/model hashes, version, config, source references, actual and preferred moves, PV visit counts, and exact original/new-stone capture lineage. It records failure or cancellation; an unconfirmed child shutdown does not release exclusive engine ownership.

The root response retains ownership maps for all returned candidates, permitting a later same-root saving-alternative comparison. A root-to-end ownership change or preferred-versus-pass score difference is only a diagnostic, never a sacrifice label.

## Existing negative evidence

The prior authentic corpus at `../recorded-comparison-sacrifice` contains actual plies 43, 44, 50, 60 and 96 at 64 visits; `../recorded-p50-deeper` contains ply 50 at 256 visits. Independent full-history replay found no previously healthy mover-owned root stones captured in any of those selected preferred PVs.

The p44 White Q4 group is a required negative: its mover ownership mean is already -0.475213 at the root and -0.4861 for the preferred candidate before the endpoint falls to -0.900839. No original stone in that group is physically captured in the recorded preferred PV. An endpoint flip detector would incorrectly treat a reading update about an already opponent-favored group as a new sacrifice.

Other physically captured original mover stones in those records were already opponent-favored: White Q2 at p44 (-0.922260), p50/64 (-0.937226), and p50/256 (-0.954694). Captures in auxiliary actual-branch PVs include Black S8 near p50 (-0.768989 at 64 visits, -0.760832 at 256) and Black M18 near p96 (-0.640873). These figures are diagnostic observations, not expert sacrifice labels.

## Interpretation boundary

[KataGo's analysis protocol](https://raw.githubusercontent.com/lightvector/KataGo/master/docs/Analysis_Engine.md) defines root and candidate ownership as predictions of eventual ownership. As a methodological inference, an already-foreseen sound sacrifice can be opponent-favored at the root. Conversely, a root-to-end reversal can reflect changed search knowledge. Root prediction alone therefore does not establish whether a loss was avoidable.

The coordinated conservative detector proposal instead requires a same-root saving/actual candidate that retains the original group, a preferred candidate/PV that loses it, physical capture lineage, adequate evidence, competitive global value, and gains elsewhere under the same-root comparison. Candidate screens must be assessed against the fixed criteria; neither thresholds nor source labels should be changed to manufacture a positive. Small groups, newly played stones, ko exchanges, short/decreasing-visit PVs, and unknown saving alternatives remain explicit coverage limits.

## Native screens recorded 2026-10-20

`screen-64-20261020` records all six roots, their preferred-PV endpoints, and pass controls: 18 complete native queries. `screen-256-20261020` records one preregistered sensitivity run of Chitetsu/Dosaku ply 131: three complete native queries. The single-case selection and unchanged 15-move PV length were fixed in `sensitivity-plan.json` before the deeper run. Both runs used the same existing KataGo v1.16.4 Eigen AVX2 binary, SWA-exported model, Chinese rules, zero komi, full move history, BLACK reporting perspective, and configuration. No model was downloaded or uploaded.

| Screen | Preferred move / candidate visits | Observed original-stone lineage and limitation |
| --- | --- | --- |
| Jowa 1835 ply 59, 64 requested visits | O3 / 15 | No original mover stone captured in preferred PV; preferred evidence below the fixed 16-visit minimum |
| Chitetsu/Dosaku 1668 ply 131, 64 requested visits | J6 / 63 | F8/G8/G7 captured by F7 at PV offset 2; all original identities tracked; production teaching groups include both colors and endpoint winrate is unstable |
| Dosaku 1669 ply 113, 64 requested visits | G8 / 36 | No original mover stone captured in preferred PV |
| Dosaku 1669 ply 35, 64 requested visits | D18 / 49 | Original C17 captured at offset 2, then Black occupies C17 again at offset 5; the replacement does not undo original capture; one-stone boundary |
| Dosaku 1669 ply 71, 64 requested visits | G6 / 13 | No original mover stone captured in preferred PV; preferred evidence below the fixed 16-visit minimum |
| Dosaku 1669 ply 137, 64 requested visits | M7 / 61 | The newly played M7 is captured at offset 2; no original root stone is captured |
| Chitetsu/Dosaku 1668 ply 131, 256 requested visits | J6 / 254 | Original F8/G8/G7 captured at offset 2; newly played G7 at offset 3 captured separately at offset 4; endpoint remains unstable |

For ply 131 at 64 visits, preferred Black winrate is 0.351719263 and the endpoint is 0.0878926586, a decline of 0.2638266044. At 256 visits, preferred Black score/winrate are -2.59639044 / 0.29674898, while the endpoint is -7.58216519 / 0.13700212: declines of 4.98577475 points and 0.15974686. These fail the unchanged endpoint stability tolerances. Physical capture alone is not a supported sacrifice annotation.

The exact production replay requested two supplemental forced historical moves, Jowa J8 and Dosaku E13, at 64 visits. `screen-64-production-supplement-plan.json` is a byte-identical copy of that generated request plan. `record-supplement.mjs` verifies matching full histories, unchanged engine/model hashes, and identical native root hashes before accepting each result. No handpicked F7 saving query is added: the fixed production eligibility rules did not generate one for the mixed teaching group.

`validate-screens.mjs` verifies source prefixes, maps, file hashes and original/new stone identities. `finalize-calibration.mjs` additionally checks all retained candidate PVs by legal replay, exact supplemental queries, source-file hashes and zero-process shutdown receipts, then writes `calibration-summary.json` and `artifact-hashes.json`. The recorded script snapshots retain the original scratch-workspace dependency layout; packaged reproduction should provide the same `@sabaki/go-board` dependency without silently rewriting recorded evidence.

This bounded recording adds real capture, replacement and throw-in regression evidence. A genuine supported positive and expert-labelled sacrifice accuracy remain unverified. Neither budget nor threshold was repeatedly adjusted to obtain a positive.
