#!/usr/bin/env bash
# Regenerate recorded KataGo fixtures + sample NDJSON using a local CPU KataGo.
# NEVER run in CI — downloads / requires models.
#
# Prerequisites:
#   mise run katago:fetch-dev   # installs Eigen binary + b18 net into .yagoo-data/
#   or set YAGOO_KATAGO / YAGOO_MODEL / YAGOO_ANALYSIS_CONFIG yourself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATA_DIR="${YAGOO_DATA_DIR:-$ROOT/.yagoo-data}"
export YAGOO_KATAGO="${YAGOO_KATAGO:-$DATA_DIR/bin/katago}"
export YAGOO_MODEL="${YAGOO_MODEL:-$DATA_DIR/models/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz}"
export YAGOO_ANALYSIS_CONFIG="${YAGOO_ANALYSIS_CONFIG:-$DATA_DIR/config/analysis.cfg}"

SCAN_VISITS="${YAGOO_FIXTURE_SCAN_VISITS:-200}"
DEEP_VISITS="${YAGOO_FIXTURE_DEEP_VISITS:-500}"
MAX_DEEP="${YAGOO_FIXTURE_MAX_DEEP_PLIES:-8}"
TOP_K="${YAGOO_FIXTURE_TOP_K:-5}"

FIXTURE_DIR="$ROOT/crates/yagoo-pipeline/tests/fixtures/sample-19x19"
mkdir -p "$FIXTURE_DIR"

if [[ ! -x "$YAGOO_KATAGO" ]]; then
  echo "error: KataGo binary not found at $YAGOO_KATAGO" >&2
  echo "run: mise run katago:fetch-dev" >&2
  exit 1
fi
if [[ ! -f "$YAGOO_MODEL" ]]; then
  echo "error: model not found at $YAGOO_MODEL" >&2
  exit 1
fi
if [[ ! -f "$YAGOO_ANALYSIS_CONFIG" ]]; then
  echo "error: analysis config not found at $YAGOO_ANALYSIS_CONFIG" >&2
  exit 1
fi

KATAGO_VER="$("$YAGOO_KATAGO" version 2>&1 | head -1 || true)"
MODEL_NAME="$(basename "$YAGOO_MODEL")"
STAMP="$(date -u +%Y-%m-%dT%H:%MZ)"

echo "Regenerating fixtures with:"
echo "  kataGo:  $YAGOO_KATAGO ($KATAGO_VER)"
echo "  model:   $YAGOO_MODEL"
echo "  config:  $YAGOO_ANALYSIS_CONFIG"
echo "  scan:    $SCAN_VISITS visits"
echo "  deep:    $DEEP_VISITS visits (maxDeepPlies=$MAX_DEEP, topK=$TOP_K)"
echo

cargo build -p yagoo-cli --release

RESPONSES="$FIXTURE_DIR/responses.json.gz"
NDJSON_DOCS="$ROOT/docs/public/app/sample-scan-deep.ndjson"
NDJSON_UI="$ROOT/packages/ui/src/analysis/__fixtures__/sample-scan-deep.ndjson"
SGF="$ROOT/docs/public/app/sample.sgf"

./target/release/yagoo analyze "$SGF" \
  --katago "$YAGOO_KATAGO" \
  --model "$YAGOO_MODEL" \
  --config "$YAGOO_ANALYSIS_CONFIG" \
  --strategy scan-then-deep \
  --scan-visits "$SCAN_VISITS" \
  --visits "$DEEP_VISITS" \
  --max-deep-plies "$MAX_DEEP" \
  --top-k "$TOP_K" \
  --no-comparison \
  --record-fixture "$RESPONSES" \
  -o "$NDJSON_DOCS"

cp "$NDJSON_DOCS" "$NDJSON_UI"

cat > "$FIXTURE_DIR/README.md" <<EOF
# Sample 19×19 KataGo fixture

Recorded locally for deterministic CI replay. **Do not** regenerate in CI.

| Field | Value |
| --- | --- |
| Recorded | $STAMP |
| KataGo | $KATAGO_VER |
| Binary | Eigen AVX2 Linux (see \`mise run katago:fetch-dev\`) |
| Network | \`$MODEL_NAME\` |
| SGF | \`docs/public/app/sample.sgf\` (Shusaku vs Gennan Inseki 1846, first 100 moves) |
| Strategy | \`scan_then_deep\` |
| Scan visits | $SCAN_VISITS |
| Deep visits | $DEEP_VISITS |
| maxDeepPlies | $MAX_DEEP |
| topK | $TOP_K |
| Partials | off (final responses only) |

## Game credit

Public-domain historical game: Yasuda Shusaku (B, 4d) vs Inoue Gennan Inseki (W, 8d), 1846
(the "ear-reddening" game). Source: Andries Brouwer Shusaku archive
(https://homepages.cwi.nl/~aeb/go/games/), game 126. Truncated to 100 moves for the sample.

## Files

- \`responses.json.gz\` — JSON array of trimmed KataGo stdout lines (query order).
- \`groups-snapshot.json\` — compact deep-ply group summaries for the replay test.
- Replay via \`yagoo analyze --scripted-fixture …\` or \`cargo test -p yagoo-pipeline --test fixture_replay\`.

## Regenerate

\`\`\`sh
mise run katago:fetch-dev
mise run fixtures:regen
\`\`\`
EOF

# Compact groups snapshot for regression tests (must match fixture_replay.rs summarize_groups).
python3 - <<'PY'
import json
from pathlib import Path

def round3(x):
    if x is None:
        return None
    return round(float(x) * 1000.0) / 1000.0

def summarize(g):
    m = g.get("members") or {}
    return {
        "groupId": g["groupId"],
        "kind": g["kind"],
        "status": g.get("status"),
        "blackStones": m.get("blackStones") or [],
        "whiteStones": m.get("whiteStones") or [],
        "gPlus": round3(g.get("gPlus")),
        "gMinus": round3(g.get("gMinus")),
        "certainty": round3(g.get("certainty")),
    }

# bash embeds this as stdin — resolve via CWD (regen-fixtures.sh cds to ROOT).
root = Path.cwd()
nd = (root / "docs/public/app/sample-scan-deep.ndjson").read_text().splitlines()
groups_by_ply = {}
deep_plies = []
for line in nd:
    ev = json.loads(line)
    if ev.get("type") == "deepPliesSelected":
        deep_plies = ev.get("plies") or []
    if ev.get("type") == "positionCompleted" and ev.get("phase") == "deep":
        snap = ev["snapshot"]
        groups_by_ply[snap["ply"]] = [summarize(g) for g in (snap.get("groups") or [])]
out = {
    "deepPlies": deep_plies,
    "groupsByPly": {str(k): v for k, v in sorted(groups_by_ply.items())},
}
path = root / "crates/yagoo-pipeline/tests/fixtures/sample-19x19/groups-snapshot.json"
path.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
print(f"wrote {path} ({sum(len(v) for v in groups_by_ply.values())} groups across {len(groups_by_ply)} deep plies)")
for ply, gs in sorted(groups_by_ply.items()):
    print(f"  ply {ply}: {len(gs)} groups")
    for g in gs[:12]:
        st = len(g["blackStones"]) + len(g["whiteStones"])
        print(f"    {g['groupId']} {g['kind']} {g.get('status')} stones={st} g+/g-={g.get('gPlus')}/{g.get('gMinus')}")
PY

echo
echo "Done."
echo "  responses: $RESPONSES"
echo "  ndjson:    $NDJSON_DOCS"
ls -lh "$RESPONSES" "$NDJSON_DOCS"
