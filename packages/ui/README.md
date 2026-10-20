# `@yagoo/ui`

Vue 3 board and reviewer UI for Yagoo.

- **Goban** — Vue reimplementation of [Shudan](https://github.com/SabakiHQ/Shudan) (MIT): same DOM structure, `shudan-*` classes, `--shudan-*` variables, map props, fuzzy stone placement with neighbor collision (`readjustShifts`), placement animation.
- **Reviewer chrome** — Sabaki-inspired layout (board, graph, move inspector, groups, tree, comment, bottom bar) in the VitePress light and dark themes. See `docs/design/reviewer-ui.md`.
- **Analysis stream** — reducer/store for `yagoo analyze` NDJSON (`scan` → `deepPliesSelected` → `deep`), with NDJSON file / live-native / browser-engine source adapters.
- **Live native SSE** — `createLiveNativeSource({ url, sgf })` posts the loaded SGF to `yagoo analyze --serve`; stopping aborts the request and suppresses stale callbacks. Add `position: { ply, moves, visits }` for the separate root-only interactive endpoint. `isLiveNativeAvailable()` checks browser transport support; connection reachability is determined when the user connects.
- **`AnalysisReviewer`** — full reviewer wired to real analysis (ownership heat, candidates/PV, winrate + score lead). Hosted on the VitePress `/app/` page (client-only).
- **Groups / 块** — deep-phase pipeline groups (fate clustering) with Sabaki-style outlines and a Groups panel; distinct from rules chains (串).
- **Overlays** — `OverlayRenderer` + `BoardGeometry`; SVG group outlines today, WebGPU later.
- **`<yagoo-board>`** — framework-agnostic custom element.

```ts
import {
  AnalysisReviewer,
  Goban,
  ReviewerLayout,
  useAnalysisStream,
  useGame,
  registerYagooBoard,
} from "@yagoo/ui";
import "@yagoo/ui/styles.css";
```

See `THIRD_PARTY_NOTICES.md` for Shudan / Sabaki library attribution.
