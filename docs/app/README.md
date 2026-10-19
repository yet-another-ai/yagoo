# Docs reviewer app

VitePress page at `/app/` hosts the real `@yagoo/ui` reviewer (Sabaki chrome + Shudan goban) driven by the same NDJSON event stream that `yagoo analyze` emits.

## Data sources

| Source | Status |
| --- | --- |
| **(a) NDJSON import** | Supported — file picker, drag-and-drop, and bundled `public/app/sample-scan-deep.ndjson` |
| **(b) Live native engine** | Adapter seam only — [#19](https://github.com/yet-another-ai/yagoo/issues/19) (`yagoo analyze --serve`) |
| **(c) Browser engine** | Adapter seam only — [#20](https://github.com/yet-another-ai/yagoo/issues/20) (after PR #7 merges) |

Missing SGF `RU` is treated as **Chinese** (same as `yagoo-sgf` / the pipeline).

The bundled sample is a **19×19** game (~52 moves). Analysis covers the full main line via `scan_then_deep`; one swing ply is deepened. Other board sizes still work when you open an SGF with a different `SZ`.

## Local regenerate fixture

```sh
# Scripted engine responses → real PipelineEvent NDJSON (no KataGo binary / model).
# Ownership arrays must be size² long (361 for 19×19).
cargo run -p yagoo-cli -- analyze docs/public/app/sample.sgf \
  --scripted-fixture path/to/scripted.json \
  -o docs/public/app/sample-scan-deep.ndjson \
  --strategy scan-then-deep --partials --from 0 --to 52
```

CI never downloads or runs KataGo models.
