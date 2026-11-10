#!/usr/bin/env bash
set -euo pipefail

MODEL_DIR="${1:-/opt/vesna/models/joe}"
REVISION="cf910fb59f1d79ab3b625a63993a108751c6c25d"
EXPECTED_SHA="abf4b998e34045cbd00eaf050de2de620f81ded6eb8b85a24b022a1c2b3f08d2"
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/${REVISION}/en/en_US/joe/medium"

mkdir -p "$MODEL_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for suffix in .onnx .onnx.json; do
  file="en_US-joe-medium${suffix}"
  curl --fail --location --proto '=https' --proto-redir '=https' \
    "$BASE_URL/$file" --output "$TMP_DIR/$file"
done
curl --fail --location --proto '=https' --proto-redir '=https' \
  "$BASE_URL/MODEL_CARD" --output "$TMP_DIR/MODEL_CARD"

printf '%s  %s\n' "$EXPECTED_SHA" "$TMP_DIR/en_US-joe-medium.onnx" | sha256sum --check -
chmod 0644 "$TMP_DIR/en_US-joe-medium.onnx" "$TMP_DIR/en_US-joe-medium.onnx.json" "$TMP_DIR/MODEL_CARD"
mv "$TMP_DIR/en_US-joe-medium.onnx" "$TMP_DIR/en_US-joe-medium.onnx.json" "$TMP_DIR/MODEL_CARD" "$MODEL_DIR/"
