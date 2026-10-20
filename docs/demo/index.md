# Frontend demo

The demo is the Sabaki-style reviewer with the experimental browser engine in its **Engine** panel. Recorded sample analysis is the board you see first. This site does not host model weights, and the page does not fetch a manifest on load.

Open **Engine** for the empty state: how to export a b18 bundle, **Load local model**, and the single-thread hint beside **Enable threads**. After a bundle checks out, **Use browser engine** replaces the recorded stream with live scan and deepen. `/yagoo/engine/` redirects here.

<ClientOnly>
  <ReviewerDemo />
</ClientOnly>

## Package

Source lives in [`packages/ui`](https://github.com/yet-another-ai/yagoo/tree/main/packages/ui) (`@yagoo/ui`). The docs host is `docs/engine/EngineHost.vue`, shared with the [reviewer](/app/).

| Piece | Status |
| --- | --- |
| `AnalysisReviewer` | Board, analysis panels, engine selector |
| `Goban` | Shudan map props + fuzzy placement / collision |
| `useGame` | SGF load + forward / back / variations |
| Browser engine | Local bundle, then scan and deepen. Experimental |
| Recorded NDJSON | Default until a model is loaded and started |
