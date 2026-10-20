# Docs reviewer app

VitePress page at `/app/` hosts the real `@yagoo/ui` reviewer (Sabaki chrome + Shudan goban) driven by the same NDJSON event stream that `yagoo analyze` emits.

## Data sources

| Source | Status |
| --- | --- |
| **(a) NDJSON import** | Supported — file picker, drag-and-drop, and bundled `public/app/sample-scan-deep.ndjson` |
| **(b) Live native engine** | Adapter seam only — follow-up: `yagoo analyze --serve` |
| **(c) Browser engine** | Adapter seam only — after browser KataGo lands |

Missing SGF `RU` is treated as **Chinese** (same as `yagoo-sgf` / the pipeline).

The bundled sample is the public-domain **ear-reddening game** (Yasuda Shusaku vs Inoue Gennan Inseki, 1846), truncated to the first 100 moves — see the SGF `C[]` credit (Andries Brouwer archive, game 126). Analysis covers the main line via `scan_then_deep` with scan visits ≈200; swing plies are deepened. The board auto-sizes to the container (`ResizeObserver`). Other board sizes still work when you open an SGF with a different `SZ`.

### Groups / 块 in the sample

Deep `positionCompleted` events carry `groups[]` from `yagoo_snapshot::compute_groups` (`source: "pipeline"`). Scan plies omit groups. The bundled NDJSON and the recorded KataGo responses under `crates/yagoo-pipeline/tests/fixtures/sample-19x19/` come from a real local CPU run (`mise run fixtures:regen`). CI only **replays** those committed responses — it never downloads models or runs KataGo.

```sh
mise run katago:fetch-dev   # local only — Eigen AVX2 + b18c384nbt into .yagoo-data/
mise run fixtures:regen     # local only — NOT part of `mise run ci`
```

That writes:

- `crates/yagoo-pipeline/tests/fixtures/sample-19x19/responses.json.gz` (+ README / groups snapshot)
- `docs/public/app/sample-scan-deep.ndjson` (copied to `packages/ui/.../__fixtures__/`)

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
