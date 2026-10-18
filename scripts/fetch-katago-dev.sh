#!/usr/bin/env bash
# Download b18c384nbt weights for local development (+ link KataGo binary).
# Not used in CI. Override dirs with YAGOO_DATA_DIR.
set -euo pipefail

DATA_DIR="${YAGOO_DATA_DIR:-$PWD/.yagoo-data}"
mkdir -p "$DATA_DIR/bin" "$DATA_DIR/models" "$DATA_DIR/config"

MODEL_NAME="kata1-b18c384nbt-s9996604416-d4316597426"
CKPT_ZIP_URL="https://media.katagotraining.org/uploaded/networks/zips/kata1/${MODEL_NAME}.zip"
BIN_URL="https://media.katagotraining.org/uploaded/networks/${MODEL_NAME}.bin.gz"
MODEL_DIR="$DATA_DIR/models/${MODEL_NAME}"
BIN_PATH="$DATA_DIR/models/${MODEL_NAME}.bin.gz"
CFG_PATH="$DATA_DIR/config/analysis.cfg"

if [[ ! -f "$MODEL_DIR/model.ckpt" ]]; then
  echo "Downloading ${MODEL_NAME} PyTorch checkpoint zip…"
  tmp="$(mktemp -d)"
  curl -fL "$CKPT_ZIP_URL" -o "$tmp/model.zip"
  mkdir -p "$MODEL_DIR"
  unzip -o "$tmp/model.zip" -d "$MODEL_DIR"
  rm -rf "$tmp"
  echo "Checkpoint ready at $MODEL_DIR"
else
  echo "Checkpoint already present at $MODEL_DIR"
fi

if [[ ! -f "$BIN_PATH" ]]; then
  echo "Downloading ${MODEL_NAME}.bin.gz for Analysis Engine…"
  curl -fL "$BIN_URL" -o "$BIN_PATH"
else
  echo "Engine weights already present at $BIN_PATH"
fi

if [[ ! -f "$CFG_PATH" ]]; then
  cat >"$CFG_PATH" <<'EOF'
# Minimal KataGo analysis config for local Yagoo dev.
# Adjust nnMaxBatchSize / numSearchThreads for your machine.
logFile = 
logAllGotoRequests = false
logAllGTPOutput = false
numSearchThreads = 4
nnMaxBatchSize = 64
EOF
  echo "Wrote sample analysis config at $CFG_PATH"
fi

if command -v katago >/dev/null 2>&1; then
  ln -sfn "$(command -v katago)" "$DATA_DIR/bin/katago"
  echo "Linked existing katago -> $DATA_DIR/bin/katago"
else
  cat <<EOF
No \`katago\` binary found on PATH.
Install a release from https://github.com/lightvector/KataGo/releases
(Linux: Eigen or OpenCL build), put \`katago\` on PATH, then re-run this script.

Then analyze an SGF:

  export YAGOO_KATAGO=$DATA_DIR/bin/katago
  export YAGOO_MODEL=$BIN_PATH
  export YAGOO_ANALYSIS_CONFIG=$CFG_PATH
  cargo run -p yagoo-cli -- analyze path/to/game.sgf -o events.ndjson --final-json game.json
EOF
fi

echo "Data directory: $DATA_DIR"
echo "Engine model:   $BIN_PATH"
echo "Analysis cfg:   $CFG_PATH"
