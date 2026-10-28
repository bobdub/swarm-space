#!/usr/bin/env bash
set -euo pipefail
ROOT="$(dirname "$(dirname "$(realpath "$0")")")"
ENGINE="$ROOT/src/lib/blockchain/mintmeMiner/engine"
emcc "$ENGINE/Lyra2.c" "$ENGINE/Sponge.c" "$ENGINE/bridge.c" -O3 \
  --no-entry -s STANDALONE_WASM=1 -s INITIAL_MEMORY=16777216 \
  -s ALLOW_MEMORY_GROWTH=0 -s STACK_SIZE=1048576 \
  -s EXPORTED_FUNCTIONS='["_engine_init","_engine_input","_engine_output","_engine_hash"]' \
  -o "$ENGINE/lyra2v2.wasm"