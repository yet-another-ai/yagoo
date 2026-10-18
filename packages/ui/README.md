# `@yagoo/ui`

Vue 3 board and reviewer UI for Yagoo.

- **Goban** — Vue reimplementation of [Shudan](https://github.com/SabakiHQ/Shudan) (MIT): same DOM structure, `shudan-*` classes, `--shudan-*` variables, map props, fuzzy stone placement with neighbor collision (`readjustShifts`), placement animation.
- **Reviewer chrome** — Sabaki-inspired dark layout (winrate graph, comment box, bottom bar).
- **Overlays** — `OverlayRenderer` + `BoardGeometry`; SVG group-outline demo today, WebGPU later.
- **`<yagoo-board>`** — framework-agnostic custom element.

```ts
import { Goban, ReviewerLayout, useGame, registerYagooBoard } from "@yagoo/ui";
import "@yagoo/ui/styles.css";
```

See `THIRD_PARTY_NOTICES.md` for Shudan / Sabaki library attribution.
