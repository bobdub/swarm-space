# Bundled MintMe hashing primitive

Source: https://github.com/mintme-com/miner/tree/e78bc220b97515a9c5c01628dbf1d362e6d7488a/src/crypto

Lyra2.c, Lyra2.h, Sponge.c and Sponge.h are unchanged upstream public-domain
primitives; their notices are retained. No GPL miner application code is included.
bridge.c is our bounded adapter. Build with Emscripten 4.0.12:

```sh
nix shell nixpkgs#emscripten -c bash scripts/build-mintme-engine.sh
```

The checked-in `public/wasm/lyra2v2.wasm` is fetched by URL only inside the
client worker after the hydrated mining service starts it; never import WASM
from source, because this stack also bundles source for server deployment.
The 17 KiB WASM uses fixed 16 MiB linear memory. Its hashing matrix is
6 MiB: 16,384 rows × 4 columns × 12 uint64s. V2 time cost is 1; v1 is 4.
This is NOT the generic Lyra2REv2 multi-hash pipeline.

Every worker checks the upstream published v1 digest and the v2 digest generated
independently with GCC against the same pinned primitive. The v2 fixture is a
native cross-compilation reference, not an upstream-published v2 golden vector.
Pool input is the full RLP-header blob; nonce is the last 8 bytes (big-endian
numeric value / raw submitted hex). Digest comparison uses its first 8 bytes as
big endian against the pool's little-endian 8-byte target (or compact target).

Live accepted-share and payout verification still require a deployed WSS bridge
and configured community receiving address. Local hashing is not proof of payout.