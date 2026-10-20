# Sample 19×19 KataGo fixture

Recorded locally for deterministic CI replay. **Do not** regenerate in CI.

| Field | Value |
| --- | --- |
| Recorded | 2026-10-19T12:17Z |
| KataGo | KataGo v1.18.1 |
| Binary | Eigen AVX2 Linux (see `mise run katago:fetch-dev`) |
| Network | `kata1-b18c384nbt-s9996604416-d4316597426.bin.gz` |
| SGF | `docs/public/app/sample.sgf` (Shusaku vs Gennan Inseki 1846, first 100 moves) |
| Strategy | `scan_then_deep` |
| Scan visits | 200 |
| Deep visits | 500 |
| maxDeepPlies | 8 |
| topK | 5 |
| Partials | off (final responses only) |

## Game credit

Public-domain historical game: Yasuda Shusaku (B, 4d) vs Inoue Gennan Inseki (W, 8d), 1846
(the "ear-reddening" game). Source: Andries Brouwer Shusaku archive
(https://homepages.cwi.nl/~aeb/go/games/), game 126. Truncated to 100 moves for the sample.

## Files

- `responses.json.gz` — JSON array of trimmed KataGo stdout lines (query order).
- `groups-snapshot.json` — compact deep-ply group summaries for the replay test.
- Replay via `yagoo analyze --scripted-fixture …` or `cargo test -p yagoo-pipeline --test fixture_replay`.

## Regenerate

```sh
mise run katago:fetch-dev
mise run fixtures:regen
```

## Ledger derivative (2026-10-21)

The raw `responses.json.gz` recording above is unchanged. Both bundled
`sample-scan-deep.ndjson` files were replayed through the ledger-enabled pipeline:

```sh
cargo run -p yagoo-cli -- analyze docs/public/app/sample.sgf --scripted-fixture crates/yagoo-pipeline/tests/fixtures/sample-19x19/responses.json.gz --strategy scan-then-deep --scan-visits 200 --visits 500 --max-deep-plies 8 --top-k 5 -o docs/public/app/sample-scan-deep.ndjson
```

Copy that output to `packages/ui/src/analysis/__fixtures__/sample-scan-deep.ndjson`.
The UI's compact `ledger-position.json` is the real ply-50 snapshot with computed
ledger fields, extracted with:

```sh
cargo run -p yagoo-snapshot --example ledger_fixture -- packages/ui/src/analysis/__fixtures__/sample-scan-deep.ndjson 50 packages/ui/src/analysis/__fixtures__/ledger-position.json
```

No engine/model is needed for either command. The recorded P2-versus-pass book at
ply 50 is inconsistent with search (ownership book 31.762810, search 24.237321),
so the derivative deliberately contains null line points and signed proportions.
This is evidence for exercising the consistency guard, not a calibrated claim
about this historical move's teaching interpretation.