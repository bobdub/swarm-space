/** Wallet/mobile round trips may need several minutes; never infer absence from silence. */
export const METAMASK_RESPONSE_TIMEOUT_MS = 300_000;

export function waitForMetaMask<T>(promise: Promise<T>, message: string, ms = METAMASK_RESPONSE_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { cleanup(); reject(new Error("Wallet request cancelled")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(message)); }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}