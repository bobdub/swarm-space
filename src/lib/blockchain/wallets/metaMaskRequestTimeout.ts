/** Wallet/mobile round trips may need several minutes; never infer absence from silence. */
export const METAMASK_RESPONSE_TIMEOUT_MS = 300_000;

export function waitForMetaMask<T>(promise: Promise<T>, message: string, ms = METAMASK_RESPONSE_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}