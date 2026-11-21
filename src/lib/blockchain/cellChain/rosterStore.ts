/**
 * Where a cell's signed roster records are kept on this device until the
 * cell chain (Phase 1) holds them in blocks.
 *
 * Every write re-folds the whole list, so a record that doesn't fit is never
 * saved, and every read re-checks the signatures, so an edited store can't
 * add a member.
 */
import {
  acceptRecord,
  CellRoster,
  genesisRecord,
  inviteRecord,
  leaveRecord,
  removeRecord,
  rosterSignerFromKeys,
  signRosterRecord,
  type SignedRosterRecord,
  type TextSigner,
} from "./roster";

const KEY_PREFIX = "cell-roster-v1:";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function defaultStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export class CellRosterStore {
  constructor(private store: Store | null = defaultStore()) {}

  records(cellId: string): SignedRosterRecord[] {
    try {
      const raw = JSON.parse(this.store?.getItem(KEY_PREFIX + cellId) ?? "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  /** The cell's roster, or null when it has no valid genesis yet. */
  async roster(cellId: string): Promise<CellRoster | null> {
    const roster = await CellRoster.fold(this.records(cellId));
    return roster && roster.cellId === cellId ? roster : null;
  }

  /** Append a record if it fits the roster as it stands. */
  async append(cellId: string, record: SignedRosterRecord): Promise<boolean> {
    const list = this.records(cellId);
    const roster = await CellRoster.fold(list);
    if (!roster || roster.cellId !== cellId || !await roster.apply(record)) return false;
    return this.write(cellId, [...list, record]);
  }

  /**
   * Replace this device's records with a longer list from another member, when
   * it extends ours and is valid end to end. Returns true when adopted.
   */
  async adopt(cellId: string, incoming: SignedRosterRecord[]): Promise<boolean> {
    const ours = this.records(cellId);
    if (incoming.length <= ours.length) return false;
    const mine = await CellRoster.fold(ours);
    const theirs = await CellRoster.fold(incoming);
    if (!theirs || theirs.cellId !== cellId) return false;
    if (mine) {
      if (mine.chainId !== theirs.chainId) return false;
      const sameStart = ours.every((r, i) => r.signature === incoming[i]?.signature);
      if (!sameStart) return false;
    }
    return this.write(cellId, incoming);
  }

  /** Owner only: write the cell's genesis if it has none. Returns the roster. */
  async ensureGenesis(cellId: string, name: string, signer: TextSigner, at = Date.now()): Promise<CellRoster | null> {
    const existing = await this.roster(cellId);
    if (existing) return existing.owner === signer.userId ? existing : null;
    if (this.records(cellId).length > 0) return null; // something invalid is stored: don't paper over it
    const genesis = await signRosterRecord(genesisRecord(cellId, name, signer.userId, at), signer);
    if (!this.write(cellId, [genesis])) return null;
    return this.roster(cellId);
  }

  /** Owner: sign an invite for `invitee`. Returns the signed invite to hand over. */
  async invite(cellId: string, invitee: string, signer: TextSigner, at = Date.now()): Promise<SignedRosterRecord | null> {
    const roster = await this.roster(cellId);
    if (!roster || roster.owner !== signer.userId) return null;
    const signed = await signRosterRecord(inviteRecord(roster.chainId, invitee, at), signer);
    return await this.append(cellId, signed) ? signed : null;
  }

  /** Invitee: sign an acceptance of an invite already in this device's records. */
  async accept(cellId: string, invite: SignedRosterRecord, signer: TextSigner, at = Date.now()): Promise<SignedRosterRecord | null> {
    const signed = await signRosterRecord(await acceptRecord(invite, at), signer);
    return await this.append(cellId, signed) ? signed : null;
  }

  async leave(cellId: string, signer: TextSigner, at = Date.now()): Promise<SignedRosterRecord | null> {
    const roster = await this.roster(cellId);
    if (!roster) return null;
    const signed = await signRosterRecord(leaveRecord(roster.chainId, at), signer);
    return await this.append(cellId, signed) ? signed : null;
  }

  async remove(cellId: string, member: string, signer: TextSigner, at = Date.now()): Promise<SignedRosterRecord | null> {
    const roster = await this.roster(cellId);
    if (!roster) return null;
    const signed = await signRosterRecord(removeRecord(roster.chainId, member, at), signer);
    return await this.append(cellId, signed) ? signed : null;
  }

  forget(cellId: string): void {
    try { this.store?.removeItem(KEY_PREFIX + cellId); } catch { /* best effort */ }
  }

  private write(cellId: string, list: SignedRosterRecord[]): boolean {
    try {
      this.store?.setItem(KEY_PREFIX + cellId, JSON.stringify(list));
      return !!this.store;
    } catch {
      return false;
    }
  }
}

let shared: CellRosterStore | null = null;
export function getCellRosterStore(): CellRosterStore {
  if (!shared) shared = new CellRosterStore();
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

/** Owner's device: make sure an owned cell has its signed genesis. Silent when the vault is locked. */
export async function ensureOwnedCellGenesis(cell: { cellId: string; name: string; ownerUserId: string }): Promise<boolean> {
  const signer = await getLocalRosterSigner();
  if (!signer || signer.userId !== cell.ownerUserId) return false;
  return !!await getCellRosterStore().ensureGenesis(cell.cellId, cell.name, signer);
}
