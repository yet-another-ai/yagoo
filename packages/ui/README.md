# `@yagoo/ui`

Vue 3 board and reviewer UI for Yagoo.

- **Goban** — Vue reimplementation of [Shudan](https://github.com/SabakiHQ/Shudan) (MIT): same DOM structure, `shudan-*` classes, `--shudan-*` variables, map props, fuzzy stone placement with neighbor collision (`readjustShifts`), placement animation.
- **Reviewer chrome** — Sabaki-inspired dark layout (winrate graph, comment box, bottom bar).
- **Analysis stream** — reducer/store for `yagoo analyze` NDJSON (`scan` → `deepPliesSelected` → `deep`), with NDJSON file / live-native / browser-engine source adapters.
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
