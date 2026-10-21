# Reviewer UI

The `/app/` page is the game-review workspace from [issue #30](https://github.com/yet-another-ai/yagoo/issues/30). It stays a client-only VitePress page (`layout: page`, no sidebar) and renders `@yagoo/ui`. `/demo/` embeds the same reviewer. The experimental browser engine loads from the **Engine** panel on both pages. There is no separate engine UI; `/engine/` redirects to `/demo/`.

The event-stream reducer (`AnalysisState`) is the source of analysis. Panels do not estimate winrate, groups, or ledgers. Opt-in commentary renders approved sentences from those structured values, with exact source citations.

## Layout

Wide screens (and any width the browser has not measured yet):

```
┌ Header: brand · opening (#27) · rules / stream · Open SGF · Engine ┐
├──────────────────────────────┬──┬──────────────────────────────────┤
│                              │  │ Winrate + score graph             │
│         Board                │  │ Move inspector (tabs)             │
│         (auto-sized)         │  │   AI · Why not · Ledger ·         │
│                              │  │   Sacrifice · Notes               │
│                              │  │ Groups | Tree                     │
│                              │  │ Comment                           │
├──────────────────────────────┴──┴──────────────────────────────────┤
│ Players · move · ← → · Try · Report                                │
└────────────────────────────────────────────────────────────────────┘
```

The splitter between the board and the sidebar is keyboard-focusable (Left / Right). Those keys resize the sidebar and do not step the move. Dragging it changes the sidebar width (340–560px). On a wide page the sidebar starts near 36% of the reviewer, so the move inspector, groups, and comment are not clipped into a narrow column.

Under 960px the splitter hides. The board stacks above one sidebar section at a time: Graph, Move, Groups, Tree, Notes. The same breakpoint is the CSS fallback when `ResizeObserver` reports a narrow box.

Light and dark follow VitePress (`html.dark`). `theme="dark"` or `theme="light"` on `AnalysisReviewer` forces that palette even when the docs page is the other theme, using concrete colours rather than the page's `--vp-c-*` values. Dark mode uses a deep tatami so the wood board, stones, and translucent ownership wash stay readable. Stones keep Shudan fuzzy placement.

Keyboard: Left / Right move through the game, or through the try branch when one is open. At the try anchor, Previous leaves try mode and steps to the previous game move. Next is enabled only when the try cursor has a child. `[` and `]` jump key moves. Candidate rows are a listbox (Up / Down, Enter to pin the PV). Inspector tabs are a tablist (Left / Right). Focus rings use the accent colour. Arrow keys aimed at the splitter, a tab, or a text field do not move the game.

## Component map

| Piece | Module | Role |
| --- | --- | --- |
| `AnalysisReviewer` | `layout/AnalysisReviewer.vue` | File drop, NDJSON source, overlay state, theme |
| `ReviewerLayout` | `layout/ReviewerLayout.vue` | Board, splitter, panels, try branch, report view |
| `OpeningBadge` | `reviewer/OpeningBadge.vue` | Header opening / joseki |
| `EngineSourcePanel` | `reviewer/EngineSourcePanel.vue` | NDJSON, live native, browser engine |
| `MoveInspector` | `reviewer/MoveInspector.vue` | Perspectives for the current move |
| `CandidatesPanel` | `layout/CandidatesPanel.vue` | AI candidates (functional) |
| `GroupsPanel` | `layout/GroupsPanel.vue` | Teaching groups / 块 (functional) |
| `VariationTree` | `reviewer/VariationTree.vue` | SGF variations and the try branch |
| `ReviewReport` | `reviewer/ReviewReport.vue` | Automatic review |
| `WinrateGraph` | `layout/WinrateGraph.vue` | Winrate, score lead, key-move markers |
| `CommentBox` / `BottomBar` | `layout/` | Sabaki comment and navigation |
| `StubPane` | `reviewer/StubPane.vue` | Empty state labelled with an issue |
| Contracts | `analysis/modules.ts` | Types the pipeline will emit |
| Key moves | `reviewer/keyMoves.ts` | Reads `deepPlies` / `deepReasons` / candidate `order` |
| Try branch | `reviewer/tryBranch.ts` | Replayed anchor history, legal moves, and node ancestry |

`useAnalysisStream` reduces NDJSON into `AnalysisState`. Per-ply module fields remain `null` until their producer fills them. Opt-in Notes saves locally rendered, grounded sentences in `PlyAnalysis.commentary`; new analysis invalidates them.
`openingMatched` fills `opening`; loaded SGFs are also recognized locally without an engine using the same [starter opening catalogue](../modules/openings.md).

## What works today

- Open SGF (picker and drag-and-drop). Board size comes from `SZ` (default 19). The board fills its pane.
- Opening/joseki-start header and stored-line deviation marker, from a small original Apache-2.0 catalogue; ambiguous or unsupported games show an explicit unmatched state.
- Import NDJSON (picker, drag-and-drop, bundled ear-reddening sample) and stream scan then deepen.
- Winrate and score graph. Deepened plies are marked. Clicking the graph seeks.
- Candidate ghosts, visit filtering, and Sabaki-style numbered PV preview on hover or click. A winrate is shown only when that candidate's visits are at least 5% of the top move (the top move itself always qualifies). Thinner lines are left off the list and the analysis comment, and their winrate is not printed on the board.
- Ownership paint and group (块) outlines / list. Chains (串) are not drawn as groups.
- Bottom bar: players, captures, previous / next move.
- Key-move previous / next, from `deepPliesSelected` only.
- Try mode: click an empty point or Pass to grow a branch and walk its tree. Side to move and captures follow the selected node. A staged browser model or connected native source analyzes just that position; candidates, PV and ownership come from its snapshot. Stop, retry, navigation and new SGFs cancel stale requests.
- Report view: lists those same key moves and the deltas already on `deepReasons`, across the full width of the page.
- Engine menu: NDJSON is the default. The browser engine stays disabled until a local bundle (or a configured manifest URL) is staged, then **Use browser engine** runs it. Live native connects to the local `yagoo analyze --serve` endpoint.
- Notes: local templates after explicit opt-in, inspectable manual prompt/selection JSON, and an optional injected provider selector. Provider responses can only select and order approved clauses. Group/zone citations highlight their source coordinates.

## Stubs and the issue that fills them

| Surface | Empty when | Issue |
| --- | --- | --- |
| Why not | `PlyAnalysis.comparison == null` | [#24](https://github.com/yet-another-ai/yagoo/issues/24) |
| Ledger | `PlyAnalysis.ledger == null` | [#23](https://github.com/yet-another-ai/yagoo/issues/23) |
| Sacrifice (弃子) | `PlyAnalysis.sacrifices == null` | [#25](https://github.com/yet-another-ai/yagoo/issues/25) |
| Report prose and export | `AnalysisState.report == null` | [#29](https://github.com/yet-another-ai/yagoo/issues/29) |
| Live catalog download, cancel, OPFS clear | Package harness only (`packages/browser-engine`). The published panel loads local files and does not host weights. | [#22](https://github.com/yet-another-ai/yagoo/pull/22) |

An empty array is different from `null` where the type allows it. `sacrifices: []` means the pipeline looked and found none. `null` means it has not spoken.

When a module contract object is present, its pane renders the fields. Notes builds a bounded fact registry from supported values, constructs approved text locally, and shows exact source paths and values for every sentence.

## Data contracts

Defined in `packages/ui/src/analysis/modules.ts` and stored on `PlyAnalysis` / `AnalysisState`.

- **Ledger (#23).** `GainLossLedger`: `move`, `vs` (`pass` or `best`), `value`, `ledger[]` (`kind`, optional `id`, `change`, `points`, optional `tempo`), `consistent`. Matches the fact JSON in `docs/modules/gain-loss-ledger.md`, plus tempo from the group status change.
- **Why not (#24).** `MoveComparison`: actual and AI move, winrates (fraction for the side to play), score leads (Black’s perspective), optional `ownershipDelta[]` (black-positive, row-major from A19), `ledgerDiff`.
- **Sacrifice (#25).** `SacrificeAnnotation`: `groupId`, `ownershipFlip` (positive means the mover gives the group away), `compensationPoints`, `exchangedWith`, `pv`.
- **Opening (#27).** `OpeningMatch`: `name`, `joseki`, `deviationPly`, `source`. The matcher owns licensing; the badge only displays `source`. The loaded SGF's local match takes precedence over NDJSON, so another game's analysis cannot supply its opening. See [matching and limits](../modules/openings.md).
- **Notes (#28).** `GroundedCommentary` extends `LlmCommentary` with selected sentences and exact evidence values. Notes is off by default; enabling it runs local templates. Sending structured facts through a host-injected provider requires a separate explicit action. No provider or credentials are bundled. See [Explanation generation](../modules/explanation-generation).
- **Report (#29).** `ReviewReportDocument`: `markdown`, `moves[]` of the structured pieces above. The view already lists key moves from `deepPlies` so the shell is usable before the document exists. Export stays disabled.
- **Try (#26).** `PositionAnalysisRequest` contains the SGF ancestry, anchor `ply`, GTP `moves` including pass, and an optional visit budget. `useVariationAnalysis` keeps `AnalysisState` per variation node, separate from the main-line graph. The shared root-only pipeline emits one `positionCompleted` snapshot. See [live variations](../pipeline/live-variations).

## Engine and model island

`EngineSourcePanel` is the one selector:

1. **NDJSON** — SGF and event file, same as drop on the board.
2. **Live native** connects to the configured local `yagoo analyze --serve` endpoint.
3. **Browser engine** — experimental. `[data-slot="model-island"]` is the empty state: this site does not host weights, **Load local model**, and the single-thread hint beside **Enable threads**. **Use browser engine** stays disabled until a bundle is verified. Recorded analysis stays on the board until that button runs `BrowserEngineAdapter`.

The package page (`packages/browser-engine/index.html`) remains the local harness: catalog, size, **Load model**, cancel, OPFS clear, and local files, in `#model-island`. It does not fetch a manifest on startup. The published site does not copy that page. Its element ids (`#load`, `#manifest`, `#model-select`, `#cancel-download`, `#scan`, `#status`, …) stay on the harness.

## Tests

Vitest (happy-dom) covers the reducer leaving module slots null on the recorded fixture, the inspector and report rendering real fields or the labelled empty state, try-move legality, and the `/app/` shell (stream, PV preview, groups, key move, report, engine menu, try mode). CI does not download or run a model.
