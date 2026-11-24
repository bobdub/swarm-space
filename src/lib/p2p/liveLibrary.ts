/** Read the authoritative in-memory directory while a debounced disk save is pending. */
type Contact = { peerId: string; nodeId: string; alias: string; addedAt: number; lastSeenAt: number; autoConnect: boolean; source: string };
let owner: string | undefined;
let read: (() => Contact[]) | undefined;

export function setLiveLibrary(nodeId: string, reader: () => Contact[]): void {
  owner = nodeId;
  read = reader;
}

export function readLiveLibrary(): Contact[] | undefined {
  try {
    if (owner !== localStorage.getItem('swarm-mesh-node-id')) return undefined;
    return read?.();
  } catch { return undefined; }
}