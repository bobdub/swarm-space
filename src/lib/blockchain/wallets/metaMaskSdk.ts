/**
 * MetaMask SDK wrapper — enables mobile deep-link / QR pairing.
 *
 * On desktop with the extension, `window.ethereum` is already injected and
 * we return it as-is (no SDK overhead). On mobile browsers or when no
 * extension is present, we lazily boot the SDK which opens the MetaMask
 * mobile app via a deep link (or shows a QR code the user can scan).
 *
 * The provider returned here has the same EIP-1193 shape as
 * `window.ethereum`, so the rest of the app doesn't care where it came from.
 */

type Eip1193Provider = {
  isMetaMask?: boolean;
  request?: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

let sdkPromise: Promise<Eip1193Provider | null> | null = null;
let cachedProvider: Eip1193Provider | null = null;

function getInjected(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return eth ?? null;
}

export function hasInjectedMetaMask(): boolean {
  const eth = getInjected();
  return !!eth?.isMetaMask;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

async function bootSdk(): Promise<Eip1193Provider | null> {
  if (typeof window === "undefined") return null;
  try {
    const mod = await import("@metamask/sdk");
    const MMSDK = new mod.MetaMaskSDK({
      dappMetadata: {
        name: "Swarm-Space",
        url: window.location.origin,
      },
      checkInstallationImmediately: false,
      logging: { developerMode: false },
    });
    // The SDK auto-initializes; getProvider() returns an EIP-1193 provider.
    const provider = MMSDK.getProvider();
    return (provider as unknown as Eip1193Provider) ?? null;
  } catch (err) {
    console.warn("[MetaMask-SDK] failed to boot", err);
    return null;
  }
}

/**
 * Returns the best available EIP-1193 provider:
 *   1. Cached SDK provider from a prior call.
 *   2. Injected window.ethereum (desktop extension).
 *   3. Lazily-booted MetaMask SDK provider (mobile / no extension).
 */
export async function getMetaMaskProvider(): Promise<Eip1193Provider | null> {
  if (cachedProvider) return cachedProvider;
  const injected = getInjected();
  if (injected?.isMetaMask) {
    cachedProvider = injected;
    return injected;
  }
  if (!sdkPromise) sdkPromise = bootSdk();
  const sdkProvider = await sdkPromise;
  if (sdkProvider) cachedProvider = sdkProvider;
  return sdkProvider;
}

/** Synchronous best-effort read for feature detection. */
export function getMetaMaskProviderSync(): Eip1193Provider | null {
  return cachedProvider ?? getInjected();
}

export type { Eip1193Provider };