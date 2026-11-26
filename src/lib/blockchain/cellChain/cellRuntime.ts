/**
 * Runs the active cell's chain session over the cell engine's connections:
 * starts when a cell is entered, stops when it's left.
 */
import { signerFromKeys } from "../blockHeader";
import { endorsementSignerFromKeys } from "../endorsements";
import { getCellChains } from "./cellChains";
import { CELL_CHAIN_CHANNEL, CellSession, type CellSigners, type CellTransport } from "./cellSync";
import { rosterSignerFromKeys } from "./roster";

let session: CellSession | null = null;
let attached = false;

/** The signed-in user's signers, with the key unlocked from their vault. Null when locked or signed out. */
export async function getLocalCellSigners(): Promise<CellSigners | null> {
  try {
    const { getCurrentUser, getCachedPrivateKey } = await import("@/lib/auth");
    const user = getCurrentUser();
    if (!user?.id || !user.publicKey) return null;
    const privateKey = await getCachedPrivateKey();
    if (!privateKey) return null;
    return {
      text: rosterSignerFromKeys(user.id, user.publicKey, privateKey),
      block: signerFromKeys(user.id, user.publicKey, privateKey),
      endorse: endorsementSignerFromKeys(user.id, user.publicKey, privateKey),
    };
  } catch {
    return null;
  }
}

/** The builder-mode connections a cell or coin chain session runs over, and its mining switch. */
export async function builderTransport(): Promise<{ transport: CellTransport; miningEnabled: () => boolean }> {
  const { getStandaloneBuilderMode } = await import("@/lib/p2p/builderMode.standalone-archived");
  const bm = getStandaloneBuilderMode();
  return {
    transport: {
      selfPeerId: () => bm.getPeerId(),
      peers: () => bm.getConnectedPeerIds(),
      send: (peerId, payload) => { void bm.send(CELL_CHAIN_CHANNEL, peerId, payload); },
      onMessage: (handler) => bm.onMessage(CELL_CHAIN_CHANNEL, handler),
      onPeersChange: (handler) => bm.onPeersChange((peers) => handler(peers.map((p) => p.peerId))),
    },
    miningEnabled: () => {
      const t = bm.getToggles();
      return t.blockchainSync && t.mining;
    },
  };
}

/** Start (or switch to) the session for `cell`; null stops it. */
export async function runCellSession(cell: { cellId: string; ownerUserId?: string } | null): Promise<CellSession | null> {
  if (session && session.cellId === cell?.cellId) return session;
  session?.stop();
  session = null;
  if (!cell) return null;
  const { transport, miningEnabled } = await builderTransport();
  const next = new CellSession(cell.cellId, getCellChains(), transport, {
    expectedOwner: cell.ownerUserId || undefined,
    signers: getLocalCellSigners,
    miningEnabled,
  });
  session = next;
  next.start();
  return next;
}

export function getCellSession(): CellSession | null {
  return session;
}

/** Follow the active cell for the life of the app. */
export async function attachCellRuntime(): Promise<void> {
  if (attached) return;
  attached = true;
  const { onActiveCellChange } = await import("@/lib/p2p/userCell");
  onActiveCellChange((cell) => {
    void runCellSession(cell).catch((err) => console.warn("[CellRuntime] session failed", err));
  });
}
