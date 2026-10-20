# Sacrifice candidates

**Implemented in additive snapshot schema v1; positive calibration remains
unverified.** The module identifies a narrowly supported group tradeoff in the
engine's preferred line. It does not infer a player's intention.

The input is `snapshot.comparison` for played move *p*, rooted at *p − 1*.
Ordinary snapshot-*p* candidates describe the next mover and must not be used.
The detector adds no engine process or query: it consumes the comparison root,
retained candidate ownership/PVs and its preferred-PV endpoint query.

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
in engine-rank order. Root ownership is diagnostic only: an already
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
They validate the producer's payload; they do not run a second detector.

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
