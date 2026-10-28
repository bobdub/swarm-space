/**
 * MintMe miner master switch. The MintMe miner must never start unless this
 * returns true. Defaults ON; the user's choice persists on this device.
 */
const KEY = "swarm-mintme-miner-enabled";
type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

export function getMintMeMinerEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setMintMeMinerEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    /* storage unavailable: keep in-memory listeners informed */
  }
  listeners.forEach((l) => l(enabled));
}

export function onMintMeMinerEnabledChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
