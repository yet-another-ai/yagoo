#!/usr/bin/env bash
# Download KataGo binary + b18c384nbt SWA checkpoint for local development.
# Not used in CI. Override dirs with YAGOO_DATA_DIR.
set -euo pipefail

DATA_DIR="${YAGOO_DATA_DIR:-$PWD/.yagoo-data}"
mkdir -p "$DATA_DIR/bin" "$DATA_DIR/models"

MODEL_NAME="kata1-b18c384nbt-s9996604416-d4316597426"
MODEL_ZIP_URL="https://media.katagotraining.org/uploaded/networks/zips/kata1/${MODEL_NAME}.zip"
MODEL_DIR="$DATA_DIR/models/${MODEL_NAME}"

if [[ ! -f "$MODEL_DIR/model.ckpt" ]]; then
  echo "Downloading ${MODEL_NAME} checkpoint zip…"
  tmp="$(mktemp -d)"
  curl -fL "$MODEL_ZIP_URL" -o "$tmp/model.zip"
  mkdir -p "$MODEL_DIR"
  unzip -o "$tmp/model.zip" -d "$MODEL_DIR"
  rm -rf "$tmp"
  echo "Model ready at $MODEL_DIR"
else
  echo "Model already present at $MODEL_DIR"
fi

# Official Linux Eigen OpenCL/CPU builds vary by release. Prefer an existing
# `katago` on PATH; otherwise print instructions rather than guessing a URL.
if command -v katago >/dev/null 2>&1; then
  ln -sfn "$(command -v katago)" "$DATA_DIR/bin/katago"
  echo "Linked existing katago -> $DATA_DIR/bin/katago"
else
  cat <<EOF
No \`katago\` binary found on PATH.
Install a KataGo release from https://github.com/lightvector/KataGo/releases
and ensure \`katago\` is on PATH, then re-run this script to link it into:
  $DATA_DIR/bin/katago

Example analysis invocation (after you add a matching analysis CFG):
  katago analysis -model $MODEL_DIR/model.ckpt -config <analysis.cfg>
EOF
fi

echo "Data directory: $DATA_DIR"
