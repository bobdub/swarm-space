/// <reference lib="webworker" />
/**
 * MintMe upgraded from CryptoNight to Lyra2v2-Webchain. A verified bundled
 * implementation is required before enabling hashing. Do not dynamically
 * execute a user-supplied script or submit CryptoNote nonce/hash guesses.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = (e: MessageEvent<{ type: string }>) => {
  if (e.data.type === "init") ctx.postMessage({ type: "unavailable" });
};
export {};
