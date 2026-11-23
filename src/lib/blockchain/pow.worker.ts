/// <reference lib="webworker" />
// Block mining off the main thread: the nonce search for one block is tens
// of thousands of hashes, which made the page stall whenever mining ran.
import { searchNonce, type PowJob } from "./powSearch";

self.onmessage = async (event: MessageEvent<{ id: number; job: PowJob }>) => {
  const { id, job } = event.data;
  try {
    const result = await searchNonce(self.crypto.subtle, job);
    self.postMessage({ id, ...result });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
