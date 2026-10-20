# Automatic game review

The **Review** action runs the available chosen engine and opens a report that updates as completed evidence arrives. Recorded NDJSON can be reviewed without an engine or model. If no engine is configured and no recording is loaded, Review opens source configuration. Stopping analysis preserves a clearly partial report.

## Evidence and alignment

A played move `p` is compared at the board **before it was played**, root `p - 1`. Only the authoritative `PositionSnapshot.comparison` for `p` may establish its score or winrate loss. The comparison's context carries both candidate lines, the root groups, query IDs, visits, and available history hashes. The ordinary snapshot at `p` describes the *next* player; its ledger and groups are not explanations of move `p`.

Ranking is deterministic: descending signed `scoreLoss`, then signed `winrateLoss`, then ascending actual move number. Loss is preferred minus actual, from the mover's perspective. Equality and negative finite-visit estimates remain in the report. Neither a negative estimate nor agreement with the preferred candidate proves optimal play.

`deepPliesSelected.reasons` contains unsigned scan priorities. These are shown separately as **unassessed scan leads** when a played-move comparison is absent. They never establish mistakes, point losses, captures, or sacrifices.

## Pipeline metadata

After the last completed analysis phase, the pipeline emits:

```json
{
  "type": "reportCompleted",
  "v": 1,
  "report": {
    "schemaVersion": 1,
    "moveCount": 1,
    "completedPositionPlies": [0, 1],
    "comparedMovePlies": [],
    "missingPositionPlies": [],
    "missingComparisonPlies": [1],
    "rankedMoves": [],
    "limitations": []
  }
}
```

This example has completed position analysis but no played-move comparison. `rankedMoves` entries, when available, contain `ply`, `rootPly`, `mover`, `actualMove`, `aiMove`, `scoreLoss`, and `winrateLoss`. The event precedes `gameCompleted`, including when aggregate game output is disabled. It contains structured metadata and references, not generated prose.

Coverage is measured against the whole SGF: positions `0..moveCount` and played moves `1..moveCount`. A range-limited or selectively deepened run remains partial even when the engine finishes successfully. Position coverage and comparison coverage are separate. The UI can reconstruct the same metadata from completed position events in older or interrupted streams.

## Explanations and review recommendations

The UI enriches metadata with the approved [commentary fact registry](./explanation-generation.md). Comparison score/winrate differences, actual-versus-preferred group and territory attribution, explicit branch tempo comparisons, and supported sacrifice evidence form the report's categories. Unsupported categories stay absent. Ownership attribution that fails the ledger consistency guard stays unpriced; it is never converted to point values.

Each review recommendation points to fact IDs already in that move's report. It asks the learner to replay or inspect those facts; it does not add tactical judgments. Root-aligned trade-offs use `comparison.ledgerDiff`, never the next-mover ledger.

Optional stored commentary is accepted only after `resolveCommentary` matches the selected approved clauses and their exact evidence against the current registry. A forged `verified` flag or stale text is insufficient. Rejected notes fall back to deterministic templates. Reports do not invoke an LLM, download anything, or send data to a service.

## Export and cancellation

Markdown and self-contained HTML exports include coverage, overview, ranked comparisons, their source facts, supported categories, recommendations, opening catalogue attribution when present, and provenance limits. SGF metadata, source names, and all free text are escaped as plain text. HTML has no scripts, external assets, or external links; navigation links point only to numeric move anchors. Markdown escapes punctuation so imported text cannot introduce links or raw HTML.

Export uses fixed filenames (`yagoo-review.md` / `yagoo-review.html`) and revokes each object URL after download. A new export supersedes a pending export. Cancellation, report replacement, and unmount invalidate pending output. Game/source changes reset evidence; generation guards discard late transport or file-read results.

Library consumers can use `reviewPipelineEvents(events, { sgf, source, provenance })`, `buildReviewReport(state, options)`, `exportReviewMarkdown(report)`, or `exportReviewHtml(report)` without a browser engine.

## Validation and limits

Model-free tests replay genuine full-history native comparisons:

- Move **60**, White **S3** versus **H3** at root **59**, has a recorded score loss of **6.681626325** points.
- Move **43**, Black **R2** at root **42**, equals the preferred **R2** and has exactly zero loss.

The older bundled scan/deep corpus includes queries that omitted pre-root history and admitted a ko-illegal candidate. Its unsigned swings remain demonstration priorities, not validated played-move losses. In particular, it does not support the earlier apparent large loss around move 50.

The report is a summary of available engine evidence, not an independent assessment of playing strength. Selective coverage cannot justify a full-game accuracy rating. No actual LLM calls, model downloads, timing gates, or performance benchmarks are used by report tests.
