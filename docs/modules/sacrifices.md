# Sacrifice candidates

**Implemented in additive snapshot schema v1; positive calibration remains
unverified.** The module identifies a narrowly supported group tradeoff in the
engine's preferred line. It does not infer a player's intention.

The input is `snapshot.comparison` for played move *p*, rooted at *p − 1*.
Ordinary snapshot-*p* candidates describe the next mover and must not be used.
The detector consumes the comparison root, retained candidate ownership/PVs and
its preferred-PV endpoint query. The pipeline may add bounded saving-move probes
through the same engine when the preferred PV captures an eligible group.

## Counterfactual criterion

Root ownership already predicts the preferred future. Consequently, subtracting
root ownership from PV-end ownership can describe a reading revision rather than
a sacrifice. Conversely, a well-foreseen sacrifice may already be
opponent-favored at the root. The detector requires an explicit saving
alternative from the **same root**.

All of these conditions must hold for an annotation:

1. The teaching group contains at least **2 original mover stones** and no
   opponent stones. Mixed groups, partial group captures, single stones and
   newly played throw-ins are outside this initial detector.
2. The preferred candidate, saving candidate and preferred-PV endpoint each
   have at least **16 visits**, finite values and valid ownership maps.
3. Saving-candidate mean ownership on those original stones is at least
   **+0.6** in their own color; preferred-candidate mean is at most **−0.4**;
   their difference is at least **1.0**. Preferred-PV endpoint mean is at most
   **−0.6**.
4. Legal replay of the preferred PV physically captures **every original group
   stone**. A later replacement at the same coordinate does not revive the
   original stone. The saving PV retains the originals throughout its replay
   and extends at least to the preferred line's last group-capture offset.
   Both replays start from the complete historical root, including ko.
5. Relative to the saving alternative, preferred mover score falls by no more
   than **1 point**, and mover winrate by no more than **0.02**. At the preferred
   PV endpoint, mover score falls by no more than **3 points**, and mover winrate
   by no more than **0.03**, relative to the preferred root candidate.
6. A [same-root ledger](gain-loss-ledger.md), saving alternative versus
   preferred, assigns a positive ownership-book cost to the group. The **net**
   preferred benefit elsewhere must cover that entire cost and be at least
   **0.5 book units**. Other losses elsewhere reduce this net benefit.

These are explicit **initial, uncalibrated tolerances**, not fitted confidence
intervals or severity thresholds. `compute_sacrifices_with_params` exposes them
for controlled experiments. The shipped pipeline uses the published defaults.
The selected saving alternative is the first fully qualifying retained candidate
in engine-rank order, followed by explicit saving probes in deterministic order.
Root ownership is diagnostic only: an already
opponent-favored root can qualify when an alternative demonstrates avoidability.

The value check at the later PV endpoint only checks viability. All exchange
attribution uses two `movesOwnership` maps from the identical root. No
later-root map is subtracted to price compensation.

## Evidence and wire contract

`comparison.context.rootCandidates` holds the retained top-K root candidates
plus the actual candidate, replacing its low-visit copy if a forced query
supplied better evidence. `pvLineages` records each legal replay, endpoint board,
and original-stone capture coordinates with one-based PV move offsets.
Illegal PVs produce no lineage and cannot support an annotation.

`savingProbes` is separate from `rootCandidates`: each entry has its forced
`candidate`, exact `queryId` and matching `rootHash`. The pipeline derives these
probes from eligible root groups whose original stones are all captured in the
preferred legal PV. It considers their empty adjacent root intersections in
board-index order (A19 first), rejects illegal moves under the full history and
skips the preferred move or alternatives with sufficient retained evidence.
It forces each selected move at depth one using the original root history.
The public `PipelineConfig.comparison_saving_probes` (`comparisonSavingProbes`
in JSON) defaults to **2** additional queries, accepts **0** to disable and has
a hard maximum of **8**. Probe and preferred candidates require at least the
greater of 16 visits and `comparison_min_visits`; the endpoint requires 16.
The unrestricted root and probe must provide the same nonempty position hash.
Failures, missing hashes and insufficient or illegal probe evidence remain
limitations, never fabricated alternatives. No additional engine is started.

These direct liberty extensions are a limited source of saving alternatives;
they do not cover distant tactical defenses. Query selection is independent of
probe outcomes and does not select a special move for a particular fixture.

`comparison.sacrificeAssessment` contains:

| Field | Meaning |
| --- | --- |
| `rootPly`, `mover`, `preferredMove` | Exact comparison root and preferred branch |
| `status` | `assessed` or `unassessed` |
| `annotations` | Supported candidates only |
| `checks` | Per-group outcome/rejection reason |
| `parameters` | Actual thresholds used |
| `limitations` | Coverage and calibration limits |

An annotation includes group/root stone membership, captured originals,
`referenceMove` (saving), `preferredMove`, both own-color ownership means,
root/end diagnostic means, `ownershipFlip` (**saving minus preferred**),
`costBook`, net `compensationBook`, detailed signed `exchanges`, PVs and query/
visit/value provenance. `compensationPoints` is null unless the same-root ledger
is consistent within its 3-point tolerance and scaling preserves the signs.
The UI labels raw book units explicitly; it never calls them points.
Evidence also distinguishes `referenceSource` (`root_candidate`, `actual_forced`
or `saving_forced`) and carries `referenceRootHash`; forced saving probes are
never described as unrestricted engine choices.

Missing/malformed primary evidence or insufficient preferred/endpoint visits
gives `unassessed`. An assessed empty array means **no supported candidate among
the retained evidence**, not a proof that the position has no sacrifice.
Missing/undersampled saving alternatives are reported as unavailable for that
group. No unsupported sente/gote claim is made.

The TypeScript reducer fills its legacy `sacrifices` slot only from an aligned,
assessed comparison. It uses `null` for absent/unassessed evidence, `[]` for a
scoped negative, and clears old results on replacement/restart. The exported
`alignedSacrificeAssessment` and `sacrificesFromComparison` helpers enforce the
same root/mover and annotation provenance contract for commentary and reports.
They validate candidate, PV, endpoint, lineage and query linkage, achieved
visits, reported ownership means and numerical criteria in the producer's
payload; they do not run a second Go replay engine.

## Reviewer behavior

The **Sacrifice** tab shows the board before the selected move, just as the
comparison tab does. Hovering or focusing a group highlights its original
stones; exchange rows highlight their exact root intersections. These clear on
blur/leave, a different tab, source replacement, ply change or a local try
variation. Next-mover overlays and actual-versus-preferred difference shading
are suppressed in this perspective.

The panel identifies the saving move, preferred capture horizon, ownership
flip, net exchange, visit counts and query provenance. It says **supported
sacrifice candidate**, preserving the distinction between engine evidence and
human intent.

## Calibration record and known limits

The unchanged genuine full-history `comparison-19x19` corpus contains five
positions at 64 requested visits. CI replays responses; it never loads a model.
None of its groups meets the saving-probe selection criteria, so no additional
queries are requested during replay. This does not validate the new collection
path; separate bounded probe tests and historical screening records do.

| Played move | Result with defaults | Relevant boundary |
| --- | --- | --- |
| 43 | Assessed, no supported candidate | Retained group contains both colors |
| 44 | Assessed, no supported candidate | Mixed groups; Q4 already opponent-favored at root, actual branch only 2 visits |
| 50 | Unassessed | Preferred candidate has 15 visits |
| 60 | Assessed, no supported candidate | Own group not captured in preferred PV; other group mixed |
| 96 | Assessed, no supported candidate | One-stone group and mixed group |

These are regression cases, **not an expert-labelled accuracy dataset**.
Observed supported annotations: **0**. Expert-reviewed true positives,
false-positive rate and recall are **unverified**. No success-rate claim can be
made from this sample. Additional historical candidate games must be recorded,
legally replayed and reviewed without weakening the criterion to force a hit.

The constructed 5×5 Rust/UI tests verify arithmetic, legal capture lineage,
color signs, missing evidence and interaction. Their values are explicitly
hand-authored and are never included in the demo as engine output or counted
as real positive calibration.

The principal expected false negatives are mixed teaching groups, short or
unstable PVs, omitted saving candidates, undersampled branches, partial group
sacrifices, throw-ins and one-stone sacrifices. Finite-visit engine errors can
still produce false positives despite the guards. Threshold iteration requires
new recorded evidence and documented review outcomes. This calibration
acceptance item remains open.

An additional committed `sacrifice-historical` corpus records six historical
screens at 64 visits, one preregistered 256-visit sensitivity screen, and two
forced actual-move queries: **23 genuine responses, zero supported positives**.
It verifies original C17 capture followed by same-color replacement, mixed-group
rejection, undersampled preferred branches and unstable endpoint values. The
three-stone F8/G8/G7 capture at Chitetsu–Dosaku move 131 belongs to a mixed
teaching group; it must not be narrowed silently to manufacture a positive.
The deeper screen also exceeds both global stability limits. Source licensing,
full-history queries, model/engine hashes, plans and all raw transcripts are
preserved alongside model-free CI replay tests.

## Replaying additional historical screens

The offline example checks completed recording requests against queries made by
the production comparison pipeline, using the default sacrifice thresholds and
candidate-visit requirement. Branch pass/status probes are disabled because
they are unrelated to sacrifice detection. Missing core responses make the
comparison unavailable; missing optional saving responses remain limitations.
No missing values are invented.

```sh
cargo run -p yagoo-pipeline --example sacrifice_screen -- RECORDING output.json SUPPLEMENT
```

`SUPPLEMENT` is optional and may repeat for additional recorded folders. Each
folder contains `analysis.cfg`, `queries.ndjson` and `responses.ndjson`; the
primary folder also has a completed `manifest.json` and references source SGFs
under `sources/` or its parent. The output includes the raw-to-pipeline query-ID
mapping and exact `missingQueries` for a coordinated future recording. The
example is offline and never runs a model. Validate file hashes and recording
provenance separately before treating a screen as empirical evidence.
