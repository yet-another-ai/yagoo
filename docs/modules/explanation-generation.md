# Explanation generation

**Role.** Turn structured module outputs into short, traceable teaching text. Module facts are the source of truth; commentary presents them.

## Implemented scope (#28)

The reviewer **Notes** tab is off by default. Enabling **Show grounded notes** renders up to three deterministic sentences locally. It does not call a provider. A host may supply a `CommentaryProvider` to `AnalysisReviewer`; **Send selected facts to …** is a separate explicit action. No provider, transport, credentials, endpoint, model download, or paid service is built in.

An optional provider selects and orders approved complete clauses. It cannot supply displayed prose. This is deliberately narrower than unrestricted LLM rewriting: checking that numbers and coordinates occur in the input does **not** prove that arbitrary prose says the same thing. The implementation validates a bounded response grammar instead.

## Fact registry and priorities

`packages/ui/src/commentary/facts.ts` exports `buildCommentaryFacts(input)`. Each fact has:

- A stable position-scoped `id`, such as `ply-50/ledger-search`.
- Exact JSON-pointer `evidence` paths into `AnalysisState`, with copied source values.
- One or more complete, approved sentence `variants`.
- A deterministic teaching `priority` and optional group/zone highlight target.

The renderer selects one to three facts. Historical actual-versus-preferred score and winrate differences come first, followed by an explicit unpriced-attribution notice, branch tempo status, root search comparison, and current group status. Available ledger lines, sacrifice-module observations, engine score, candidate visits, and opening labels follow. A provider can choose a different subset or ordering within the same registry.

Supported claims have explicit boundaries:

- A played-move comparison at ply `p` must identify `rootPly = p - 1` and its `mover`. Comparison winrates use that mover's perspective; source score leads remain Black-positive. Loss fields must agree with the actual and preferred source values before becoming a difference sentence. When both choices name the same move, their score and winrate must be identical and both loss fields must be zero; contradictory comparisons produce no approved clauses. Selection weights and unsigned `deepReasons` never become mistake judgments.
- A current-position ledger must match its root ply and mover. A comparison ledger must also match the played/preferred moves at the historical root. `value` is a mover-relative **search score difference**.
- A ledger line is priced only when `consistent` is true, `scaling` is `"score"`, and its `points` is finite. Otherwise, a signed `proportion` is described as a share of the total absolute ownership-book contribution, explicitly unpriced. `bookValue` is never relabelled as points.
- Current group status and comparison branch status are quoted as module classifications. Strength changes alone do not imply life, death, saving a group, sente, or gote.
- Sacrifice observations cite the module's group and ownership-flip field. This implementation does not invent compensation when the underlying ledger cannot price it.
- Opening names are catalogue labels, not claims of exhaustive recognition. No player names, SGF comments, or user prose become commentary instructions.

Missing or invalid facts, including malformed optional collections, are omitted. Empty input produces a clear empty state. This module does not run Go analysis or decide tactical judgments.

## Provider-independent selection

`CommentarySession` supports an injected adapter and manual prompt export/response import:

```ts
interface CommentaryProvider {
  id: string;
  select(request: CommentaryRequest, signal: AbortSignal): Promise<unknown>;
}
```

The exported prompt is inspectable JSON containing a request ID, approved facts, exact selected source values, clause variants, and a response example. It omits the SGF, names, comments, board arrays, and full ownership maps. Group or zone coordinates that support a selected fact can be included. Preparing the prompt does not send it anywhere; the user can copy it to a provider of their choosing. A host-supplied adapter owns any transport and must honor its `AbortSignal`.

The only accepted response shape is:

```json
{
  "version": 1,
  "requestId": "the-current-request-id",
  "selections": [
    { "factId": "ply-50/ledger-search", "variant": 0 }
  ]
}
```

One to three unique known fact IDs and in-range integer variant indices are required. Wrong request IDs, unknown fields, new text, duplicate facts, unsupported variants, oversized JSON strings, malformed JSON, or provider errors return deterministic templates. The application always constructs displayed text from its own registry. It does not display a provider's rejected answer or error details.

The ability to choose among approved clauses does not ensure the most useful teaching emphasis. That remains a separate quality question; `verified` means only that a clause selection passed this bounded check.

## Lifetime, citations, and persistence

Consent is local to the loaded game and is not saved in browser storage. Each request receives a fresh ID and generation. Repeating, cancelling, disabling notes, changing facts/position, switching SGF or stream game, switching providers, and unmounting invalidate pending work. Cancellation also aborts the adapter signal. A late result is ignored even if an adapter ignores cancellation. New-game changes turn consent off.

Each sentence exposes its fact ID and exact source paths/values. **Highlight cited group or zone** focuses the supported coordinates; branch facts retain historical root coordinates. Notes are hidden from unanalysed try branches.

The reviewer saves local results in the existing `PlyAnalysis.commentary` field. `GroundedCommentary` adds `sentences` and `factEvidence` to the base `text`, `citedFactIds`, `provider`, and `verified` fields. New authoritative position/stage evidence clears stored notes. A UI origin check prevents late events from saving into another position or game.

`resolveCommentary(facts, stored)` revalidates stored sentences, IDs, and exact evidence before a report reuses them. It reconstructs text from current approved variants. Changed source values are rejected even if their one-decimal display rounding would look unchanged. A stored `verified: true` flag alone is never sufficient.

## Validation and limitations

Tests use the recorded `analysis/__fixtures__/ledger-position.json` and labelled in-process mock providers. The recorded root-ply-50 example has a search difference of about **24.2 points** and an ownership book total of about **31.8**, so its line shares stay unpriced. Tests verify exact source pointers, historical-root perspective, inconsistent-loss rejection, bounded-format rejection, provider mutation isolation, manual imports, repeated requests, cancellation, game changes, UI consent, citation actions, and stored-evidence revalidation. No model or provider request runs in CI.

The separate genuine `comparison-positions.json` corpus checks White's played S3 versus H3 at move 60: its **6.681626325-point** difference belongs to root ply 59, while the snapshot's root-ply-60 ledger belongs to Black's next move. Move 43's actual and preferred R2 are equal, so its comparison remains zero even though the next-mover ledger is nonzero. Every comparison clause's JSON pointer is checked against these recorded snapshots.

The initial sentence set is intentionally small and can sound repetitive. It supports the recorded module values rather than full natural-language teaching. It cannot establish whether the engine's own assessment is correct, and it does not attempt semantic verification of unrestricted prose.
