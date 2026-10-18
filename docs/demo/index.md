# Frontend demo

Interactive reviewer chrome for Yagoo — Vue goban (Shudan-compatible), Sabaki-inspired layout, and an SVG overlay skeleton.

Use ← → in the bottom bar to step through the sample SGF. The blue outline on the board is the **group-outline** overlay demo (coordinates via `BoardGeometry`).

<ClientOnly>
  <ReviewerDemo />
</ClientOnly>

## Package

Source lives in [`packages/ui`](https://github.com/yet-another-ai/yagoo/tree/main/packages/ui) (`@yagoo/ui`).

| Piece | Status |
| --- | --- |
| `Goban` | Shudan map props + fuzzy placement / collision |
| `useGame` | SGF load + forward / back / variations |
| `ReviewerLayout` | Board + sidebar + bottom bar |
| `WinrateGraph` | Static sample data |
| Game tree panel | Placeholder |
| `OverlayLayer` | SVG group-outline demo; WebGPU later |
