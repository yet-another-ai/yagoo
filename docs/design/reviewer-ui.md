# Reviewer UI

The `/app/` page is the game-review workspace from [issue #30](https://github.com/yet-another-ai/yagoo/issues/30). It stays a client-only VitePress page (`layout: page`, no sidebar) and renders `@yagoo/ui`. The experimental browser engine keeps its own page; its model controls sit in an island the reviewer can host later.

The event-stream reducer (`AnalysisState`) is the only source of analysis. Panels read it. They do not estimate winrate, groups, ledgers, or commentary on the client.

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
| Try branch | `reviewer/tryBranch.ts` | Local stones only, via `@sabaki/go-board` |

`useAnalysisStream` still reduces NDJSON into `AnalysisState`. Per-ply `ledger`, `comparison`, `sacrifices`, and `commentary`, plus `opening` and `report` on the state, stay `null` until a future event fills them.

## What works today

- Open SGF (picker and drag-and-drop). Board size comes from `SZ` (default 19). The board fills its pane.
- Import NDJSON (picker, drag-and-drop, bundled ear-reddening sample) and stream scan then deepen.
- Winrate and score graph. Deepened plies are marked. Clicking the graph seeks.
- Candidate ghosts, visit filtering, and Sabaki-style numbered PV preview on hover or click. A winrate is shown only when that candidate's visits are at least 5% of the top move (the top move itself always qualifies). Thinner lines are left off the list and the analysis comment, and their winrate is not printed on the board.
- Ownership paint and group (块) outlines / list. Chains (串) are not drawn as groups.
- Bottom bar: players, captures, previous / next move.
- Key-move previous / next, from `deepPliesSelected` only.
- Try mode: click an empty point to grow a local branch and walk it in the tree. The bottom bar's side to move and capture counts follow that branch. Analysis overlays hide off the main line. No engine call.
- Report view: lists those same key moves and the deltas already on `deepReasons`, across the full width of the page.
- Engine menu: NDJSON is usable. Live native and the browser engine stay disabled until their adapters connect.

## Stubs and the issue that fills them

| Surface | Empty when | Issue |
| --- | --- | --- |
| Header opening / joseki | `AnalysisState.opening == null` | [#27](https://github.com/yet-another-ai/yagoo/issues/27) |
| Why not | `PlyAnalysis.comparison == null` | [#24](https://github.com/yet-another-ai/yagoo/issues/24) |
| Ledger | `PlyAnalysis.ledger == null` | [#23](https://github.com/yet-another-ai/yagoo/issues/23) |
| Sacrifice (弃子) | `PlyAnalysis.sacrifices == null` | [#25](https://github.com/yet-another-ai/yagoo/issues/25) |
| Notes | `PlyAnalysis.commentary == null` | [#28](https://github.com/yet-another-ai/yagoo/issues/28) |
| Try-mode AI suggestions | Always, for now. Local moves still work. | [#26](https://github.com/yet-another-ai/yagoo/issues/26) |
| Report prose and export | `AnalysisState.report == null` | [#29](https://github.com/yet-another-ai/yagoo/issues/29) |
| Live native connect | `isLiveNativeAvailable()` is false | [#19](https://github.com/yet-another-ai/yagoo/issues/19) |
| Browser engine connect | No `BrowserEngineAdapter` | [#20](https://github.com/yet-another-ai/yagoo/issues/20) |
| Model island (catalog, cancel, OPFS clear, local files) | Default slot content | [#22](https://github.com/yet-another-ai/yagoo/pull/22) |

An empty array is different from `null` where the type allows it. `sacrifices: []` means the pipeline looked and found none. `null` means it has not spoken.

When a contract object is present, the pane renders its fields (ledger rows highlight a group id, comparison shows winrate and score, commentary shows the text and fact ids). The app does not construct those objects.

## Data contracts

Defined in `packages/ui/src/analysis/modules.ts` and stored on `PlyAnalysis` / `AnalysisState`.

- **Ledger (#23).** `GainLossLedger`: `move`, `vs` (`pass` or `best`), `value`, `ledger[]` (`kind`, optional `id`, `change`, `points`, optional `tempo`), `consistent`. Matches the fact JSON in `docs/modules/gain-loss-ledger.md`, plus tempo from the group status change.
- **Why not (#24).** `MoveComparison`: actual and AI move, winrates (fraction for the side to play), score leads (Black’s perspective), optional `ownershipDelta[]` (black-positive, row-major from A19), `ledgerDiff`.
- **Sacrifice (#25).** `SacrificeAnnotation`: `groupId`, `ownershipFlip` (positive means the mover gives the group away), `compensationPoints`, `exchangedWith`, `pv`.
- **Opening (#27).** `OpeningMatch`: `name`, `joseki`, `deviationPly`, `source`. The matcher owns licensing; the badge only displays `source`.
- **Notes (#28).** `LlmCommentary`: `text`, `citedFactIds`, `provider`, `verified`. The checkbox stays disabled. Nothing is sent to a model.
- **Report (#29).** `ReviewReportDocument`: `markdown`, `moves[]` of the structured pieces above. The view already lists key moves from `deepPlies` so the shell is usable before the document exists. Export stays disabled.
- **Try (#26).** No analysis type yet. `tryBranch.ts` only replays stones. A future source can attach the same `PlyAnalysis` fields to a variation id.

## Engine and model island

`EngineSourcePanel` is the one selector:

1. **NDJSON** — SGF and event file, same as drop on the board.
2. **Live native** — button disabled, points at `yagoo analyze --serve` (#19).
3. **Browser engine** — button disabled (#20). Inside it, `[data-slot="model-island"]` is where the experimental page’s model island mounts.

The experimental page (`packages/browser-engine/index.html`) is the #22 model island: catalog, size, **Load model**, cancel, OPFS clear, and local files, in `#model-island` (`data-slot="model-island"`). Load is explicit. The page does not fetch weights on startup. The reviewer keeps the same slot for #20 and does not download weights itself. The element ids the engine demo binds (`#load`, `#manifest`, `#model-select`, `#cancel-download`, `#scan`, `#status`, …) stay put.

## Tests

Vitest (happy-dom) covers the reducer leaving module slots null on the recorded fixture, the inspector and report rendering real fields or the labelled empty state, try-move legality, and the `/app/` shell (stream, PV preview, groups, key move, report, engine menu, try mode). CI does not download or run a model.
