# Docs reviewer app

VitePress page at `/app/` hosts the real `@yagoo/ui` reviewer (Sabaki chrome + Shudan goban) driven by the same NDJSON event stream that `yagoo analyze` emits.

## Data sources

| Source | Status |
| --- | --- |
| **(a) NDJSON import** | Supported — file picker, drag-and-drop, and bundled `public/app/sample-scan-deep.ndjson` |
| **(b) Live native engine** | Adapter seam only — follow-up: `yagoo analyze --serve` |
| **(c) Browser engine** | Adapter seam only — after browser KataGo lands |

Missing SGF `RU` is treated as **Chinese** (same as `yagoo-sgf` / the pipeline).

The bundled sample is an original **19×19** teaching game (~70 legality-checked moves). Analysis covers the main line via `scan_then_deep`; one ownership-swing ply is deepened. The board auto-sizes to the container (`ResizeObserver`). Other board sizes still work when you open an SGF with a different `SZ`.

### Groups / 块 in the sample

Deep `positionCompleted` events carry `groups[]` from `yagoo_snapshot::compute_groups` (`source: "pipeline"`). Scan plies omit groups. The bundled NDJSON was regenerated with the groups module after enriching deep-ply scenario ownership (scripted fixtures alone often copy root ownership onto candidates, which yields no fate signal). Prefer regenerating from a real KataGo deep run when a local `b18c384nbt` setup is available:

```sh
mise run katago:fetch-dev   # local only — never in CI
cargo run -p yagoo-cli -- analyze docs/public/app/sample.sgf \
  -o docs/public/app/sample-scan-deep.ndjson \
  --strategy scan-then-deep --partials --from 0 --to 70
cp docs/public/app/sample-scan-deep.ndjson \
  packages/ui/src/analysis/__fixtures__/sample-scan-deep.ndjson
```

Without KataGo, re-apply groups to an existing sample via:

```sh
cargo run -p yagoo-snapshot --example regen_sample_groups -- \
  docs/public/app/sample-scan-deep.ndjson \
  packages/ui/src/analysis/__fixtures__/sample-scan-deep.ndjson
```

CI never downloads or runs KataGo models.

## Local regenerate fixture (scripted engine)

```sh
# Scripted engine responses → real PipelineEvent NDJSON (no KataGo binary / model).
# Ownership arrays must be size² long (361 for 19×19). Candidate ownership should
# differ from root or clustering will find no active points.
cargo run -p yagoo-cli -- analyze docs/public/app/sample.sgf \
  --scripted-fixture path/to/scripted.json \
  -o docs/public/app/sample-scan-deep.ndjson \
  --strategy scan-then-deep --partials --from 0 --to 70
```
