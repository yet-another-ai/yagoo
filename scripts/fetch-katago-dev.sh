#!/usr/bin/env bash
# Download CPU KataGo (Eigen AVX2) + b18c384nbt weights for local development.
# Not used in CI. Override dirs with YAGOO_DATA_DIR.
set -euo pipefail

DATA_DIR="${YAGOO_DATA_DIR:-$PWD/.yagoo-data}"
mkdir -p "$DATA_DIR/bin" "$DATA_DIR/models" "$DATA_DIR/config" "$DATA_DIR/logs"

# Pinned teaching net (see docs/open-questions.md / README).
MODEL_NAME="kata1-b18c384nbt-s9996604416-d4316597426"
# Engine weights live under /models/kata1/ on the media host (bare /networks/ URL 403s).
BIN_URL="https://media.katagotraining.org/uploaded/networks/models/kata1/${MODEL_NAME}.bin.gz"
BIN_PATH="$DATA_DIR/models/${MODEL_NAME}.bin.gz"
CFG_PATH="$DATA_DIR/config/analysis.cfg"

# CPU build: Eigen AVX2 from the latest release that still ships Eigen (v1.18.1;
# v1.18.2 is CUDA-only). Override with YAGOO_KATAGO_RELEASE_URL if needed.
KATAGO_ZIP_URL="${YAGOO_KATAGO_RELEASE_URL:-https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-linux-x64.zip}"
KATAGO_BIN="$DATA_DIR/bin/katago"

if [[ ! -f "$BIN_PATH" ]]; then
  echo "Downloading ${MODEL_NAME}.bin.gz for Analysis Engine…"
  curl -fL --retry 5 --retry-delay 2 -o "$BIN_PATH" "$BIN_URL"
else
  echo "Engine weights already present at $BIN_PATH"
fi

if [[ ! -x "$KATAGO_BIN" ]]; then
  echo "Downloading KataGo Eigen AVX2 Linux binary…"
  tmp="$(mktemp -d)"
  curl -fL --retry 5 --retry-delay 2 -o "$tmp/katago.zip" "$KATAGO_ZIP_URL"
  unzip -o "$tmp/katago.zip" -d "$tmp/extract"
  src="$(find "$tmp/extract" -type f -name katago | head -1)"
  if [[ -z "$src" ]]; then
    echo "error: katago binary not found in release zip" >&2
    exit 1
  fi
  install -m 755 "$src" "$KATAGO_BIN"
  # Keep a reference analysis_example.cfg if missing.
  if [[ ! -f "$CFG_PATH" ]]; then
    ex="$(find "$tmp/extract" -type f -name analysis_example.cfg | head -1 || true)"
    if [[ -n "$ex" ]]; then
      cp "$ex" "$CFG_PATH"
      # Soften for CPU Eigen.
      if ! grep -q '^warnUnusedFields' "$CFG_PATH"; then
        sed -i '1iwarnUnusedFields = false' "$CFG_PATH"
      fi
      sed -i -E \
        -e 's/^numSearchThreadsPerAnalysisThread[[:space:]]*=.*/numSearchThreadsPerAnalysisThread = 2/' \
        -e 's/^numAnalysisThreads[[:space:]]*=.*/numAnalysisThreads = 1/' \
        -e 's/^nnMaxBatchSize[[:space:]]*=.*/nnMaxBatchSize = 8/' \
        "$CFG_PATH" || true
    fi
  fi
  rm -rf "$tmp"
  echo "Installed $KATAGO_BIN"
else
  echo "KataGo binary already present at $KATAGO_BIN"
fi

if [[ ! -f "$CFG_PATH" ]]; then
  cat >"$CFG_PATH" <<'EOF'
warnUnusedFields = false
logDir = .yagoo-data/logs
numAnalysisThreads = 1
numSearchThreadsPerAnalysisThread = 2
nnMaxBatchSize = 8
reportAnalysisWinratesAs = BLACK
EOF
  echo "Wrote minimal analysis config at $CFG_PATH"
fi

"$KATAGO_BIN" version || true

cat <<EOF

Data directory: $DATA_DIR
Engine model:   $BIN_PATH
Analysis cfg:   $CFG_PATH
KataGo binary:  $KATAGO_BIN

Example:

  export YAGOO_KATAGO=$KATAGO_BIN
  export YAGOO_MODEL=$BIN_PATH
  export YAGOO_ANALYSIS_CONFIG=$CFG_PATH
  mise run fixtures:regen
EOF
