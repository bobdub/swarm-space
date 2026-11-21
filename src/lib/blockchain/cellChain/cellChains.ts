/**
 * This device's cell chains: which genesis each cell has, opening its chain,
 * and the member actions (invite, accept, leave, remove) that go into it.
 *
 * Each cell is known by its signed genesis record, kept here per cell id.
 * The chain itself (blocks, pending records) is kept by CellChain's storage.
 */
import { CellChain, type CellChainOptions } from "./cellChain";
import {
  acceptRecord,
  genesisRecord,
  inviteRecord,
  leaveRecord,
  removeRecord,
  rosterSignerFromKeys,
  signRosterRecord,
  verifyRosterRecord,
  type SignedRosterRecord,
  type TextSigner,
} from "./roster";

const GENESIS_PREFIX = "cell-chain-genesis-v1:";
/** Where the first version of signed rosters kept records, before they moved into blocks. */
const LEGACY_ROSTER_PREFIX = "cell-roster-v1:";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function defaultStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export class CellChains {
  private open = new Map<string, Promise<CellChain | null>>();

  constructor(private store: Store | null = defaultStore(), private chainOptions: CellChainOptions = {}) {}

  /** The cell's signed genesis record, if this device has one. */
  genesis(cellId: string): SignedRosterRecord | null {
    try {
      const raw = this.store?.getItem(GENESIS_PREFIX + cellId);
      if (raw) return JSON.parse(raw) as SignedRosterRecord;
      const legacy = JSON.parse(this.store?.getItem(LEGACY_ROSTER_PREFIX + cellId) ?? "[]");
      return Array.isArray(legacy) && legacy[0]?.record?.kind === "genesis" ? legacy[0] : null;
    } catch {
      return null;
    }
  }

  /** Remember a cell's genesis (the owner's, or one a member received). False when it isn't a valid genesis for this cell. */
  async setGenesis(cellId: string, genesis: SignedRosterRecord): Promise<boolean> {
    if (genesis?.record?.kind !== "genesis" || genesis.record.cellId !== cellId) return false;
    if (!await verifyRosterRecord(genesis) || genesis.signer !== genesis.record.owner) return false;
    const existing = this.genesis(cellId);
    if (existing && existing.signature !== genesis.signature) return false;
    try { this.store?.setItem(GENESIS_PREFIX + cellId, JSON.stringify(genesis)); } catch { return false; }
    return !!this.store;
  }

  /** Open the cell's chain (cached). Null when this device has no valid genesis for it. */
  chain(cellId: string): Promise<CellChain | null> {
    let opening = this.open.get(cellId);
    if (!opening) {
      opening = this.openNow(cellId);
      this.open.set(cellId, opening);
      void opening.then((c) => { if (!c) this.open.delete(cellId); });
    }
    return opening;
  }

  private async openNow(cellId: string): Promise<CellChain | null> {
    const genesis = this.genesis(cellId);
    if (!genesis) return null;
    const chain = await CellChain.open(genesis, this.chainOptions);
    if (!chain || chain.cellId !== cellId) return null;
    await this.migrateLegacyRecords(cellId, chain);
    return chain;
  }

  /** Records saved by the first version of signed rosters go into the chain's pending list. */
  private async migrateLegacyRecords(cellId: string, chain: CellChain): Promise<void> {
    let legacy: SignedRosterRecord[] = [];
    try { legacy = JSON.parse(this.store?.getItem(LEGACY_ROSTER_PREFIX + cellId) ?? "[]"); } catch { legacy = []; }
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    if (!this.store?.getItem(GENESIS_PREFIX + cellId) && legacy[0]?.record?.kind === "genesis") {
      try { this.store?.setItem(GENESIS_PREFIX + cellId, JSON.stringify(legacy[0])); } catch { return; }
    }
    for (const s of legacy.slice(1)) await chain.queueRosterRecord(s);
    try { this.store?.removeItem(LEGACY_ROSTER_PREFIX + cellId); } catch { /* best effort */ }
  }

  /** Owner: make sure the cell has a signed genesis and an open chain. */
  async ensureOwned(cellId: string, name: string, signer: TextSigner, at: number = Date.now()): Promise<CellChain | null> {
    const existing = this.genesis(cellId);
    if (existing) return existing.signer === signer.userId ? this.chain(cellId) : null;
    const genesis = await signRosterRecord(genesisRecord(cellId, name, signer.userId, at), signer);
    if (!await this.setGenesis(cellId, genesis)) return null;
    return this.chain(cellId);
  }

  /** Owner: sign an invite and queue it for the next block. Returns the invite to hand to the invitee. */
  async invite(cellId: string, invitee: string, signer: TextSigner, at: number = Date.now()): Promise<SignedRosterRecord | null> {
    const chain = await this.chain(cellId);
    if (!chain || chain.getRoster().owner !== signer.userId) return null;
    const s = await signRosterRecord(inviteRecord(chain.chainId, invitee, at), signer);
    return await chain.queueRosterRecord(s) ? s : null;
  }

  /** Invitee: accept an invite. The invite must already be on (or queued for) this device's copy of the chain. */
  async accept(cellId: string, invite: SignedRosterRecord, signer: TextSigner, at: number = Date.now()): Promise<SignedRosterRecord | null> {
    const chain = await this.chain(cellId);
    if (!chain) return null;
    await chain.queueRosterRecord(invite);
    const s = await signRosterRecord(await acceptRecord(invite, at), signer);
    return await chain.queueRosterRecord(s) ? s : null;
  }

  async leave(cellId: string, signer: TextSigner, at: number = Date.now()): Promise<SignedRosterRecord | null> {
    const chain = await this.chain(cellId);
    if (!chain) return null;
    const s = await signRosterRecord(leaveRecord(chain.chainId, at), signer);
    return await chain.queueRosterRecord(s) ? s : null;
  }

  async remove(cellId: string, member: string, signer: TextSigner, at: number = Date.now()): Promise<SignedRosterRecord | null> {
    const chain = await this.chain(cellId);
    if (!chain) return null;
    const s = await signRosterRecord(removeRecord(chain.chainId, member, at), signer);
    return await chain.queueRosterRecord(s) ? s : null;
  }

  /** Forget a cell on this device (its saved blocks stay in IndexedDB under its chain id). */
  forget(cellId: string): void {
    this.open.delete(cellId);
    try {
      this.store?.removeItem(GENESIS_PREFIX + cellId);
      this.store?.removeItem(LEGACY_ROSTER_PREFIX + cellId);
    } catch { /* best effort */ }
  }
}

let shared: CellChains | null = null;
export function getCellChains(): CellChains {
  if (!shared) shared = new CellChains();
  return shared;
}

/** The signed-in user's roster signer, with the key unlocked from their vault. Null when locked or signed out. */
export async function getLocalRosterSigner(): Promise<TextSigner | null> {
  try {
    const { getCurrentUser, getCachedPrivateKey } = await import("@/lib/auth");
    const user = getCurrentUser();
    if (!user?.id || !user.publicKey) return null;
    const privateKey = await getCachedPrivateKey();
    return privateKey ? rosterSignerFromKeys(user.id, user.publicKey, privateKey) : null;
  } catch {
    return null;
  }
}

/** Owner's device: make sure an owned cell has its signed genesis and chain. Silent when the vault is locked. */
export async function ensureOwnedCellChain(cell: { cellId: string; name: string; ownerUserId: string }): Promise<boolean> {
  const signer = await getLocalRosterSigner();
  if (!signer || signer.userId !== cell.ownerUserId) return false;
  return !!await getCellChains().ensureOwned(cell.cellId, cell.name, signer);
}
