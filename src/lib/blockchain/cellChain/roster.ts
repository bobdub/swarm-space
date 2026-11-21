/**
 * Cell rosters: the signed member list of a private cell.
 *
 * A cell's members are its voters, so the list has to be the same on every
 * member's device. It is never read from local settings or from who happens
 * to be connected: it is folded from signed records, in order.
 *
 * - `genesis`: signed by the owner. Names the cell and the owner, who is the
 *   first member. Its hash is the cell chain's id, so two cells that share a
 *   cell id string (or a forged genesis for someone else's cell) never mix.
 * - `invite`: signed by the owner, naming one account and an expiry.
 * - `accept`: signed by the invited account, naming the invite's hash. An
 *   invite plus its acceptance adds the member. Nobody joins by being invited
 *   alone, and nobody joins without the owner's invite.
 * - `leave`: signed by a member about itself. The owner can't leave.
 * - `remove`: signed by the owner about another member.
 *
 * A record that doesn't verify, or doesn't fit the roster at that point, is
 * rejected and the fold stops there: Phase 1 puts these records in cell chain
 * blocks, and a block with a bad record is invalid as a whole.
 *
 * Each cell is its own chain with its own coin (ticker from the cell name),
 * mined by its members. Mining a cell never creates SWARM: the shared chain's
 * block rewards remain the only way SWARM is made.
 */
import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import { sha256Async } from "../crypto";

/** Default lifetime of an invite. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A cell can't grow past this many members (keeps each block's witness list bounded). */
export const MAX_CELL_MEMBERS = 32;
export const MAX_CELL_NAME_LENGTH = 80;
export const MAX_TICKER_LENGTH = 6;
/** Ticker for a cell whose name has no letters or digits. */
export const FALLBACK_CELL_TICKER = "CELL";

/**
 * A cell coin's ticker: the cell name's letters and digits, uppercased, up to
 * six characters ("Garden Club" → GARDEN). Fixed in the genesis, so renaming
 * the cell never changes it. Tickers may repeat across cells; a coin is told
 * apart by its chain id.
 */
export function tickerFromName(name: string): string {
  const letters = name.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return letters.slice(0, MAX_TICKER_LENGTH) || FALLBACK_CELL_TICKER;
}

const isTicker = (x: unknown): x is string => typeof x === "string" && /^[A-Z0-9]{1,6}$/.test(x);

export type RosterRecord =
  | { kind: "genesis"; cellId: string; name: string; ticker: string; owner: string; at: number }
  | { kind: "invite"; chain: string; invitee: string; at: number; expiresAt: number }
  | { kind: "accept"; chain: string; invite: string; at: number }
  | { kind: "leave"; chain: string; at: number }
  | { kind: "remove"; chain: string; member: string; at: number };

export interface SignedRosterRecord {
  record: RosterRecord;
  /** The account that signed: must be the key's user id. */
  signer: string;
  publicKey: string;
  signature: string;
}

export interface TextSigner {
  userId: string;
  publicKey: string;
  signText(text: string): Promise<string>;
}

/** Deterministic JSON: object keys sorted, so every device signs and hashes the same bytes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signedText(record: RosterRecord, signer: string, publicKey: string): string {
  return canonical({ v: 1, type: "cell-roster", record, signer, publicKey });
}

export async function signRosterRecord(record: RosterRecord, signer: TextSigner): Promise<SignedRosterRecord> {
  const signature = await signer.signText(signedText(record, signer.userId, signer.publicKey));
  return { record, signer: signer.userId, publicKey: signer.publicKey, signature };
}

/** The record's id: invites are accepted by this hash, and a genesis's hash is the cell chain's id. */
export function rosterRecordHash(s: SignedRosterRecord): Promise<string> {
  return sha256Async(canonical(s));
}

const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 128;
const isTime = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

function wellFormed(r: RosterRecord | null | undefined): boolean {
  if (!r || typeof r !== "object" || !isTime(r.at)) return false;
  switch (r.kind) {
    case "genesis":
      return isId(r.cellId) && typeof r.name === "string" && r.name.length <= MAX_CELL_NAME_LENGTH
        && isTicker(r.ticker) && isId(r.owner);
    case "invite":
      return isId(r.chain) && isId(r.invitee) && isTime(r.expiresAt) && r.expiresAt > r.at;
    case "accept":
      return isId(r.chain) && isId(r.invite);
    case "leave":
      return isId(r.chain);
    case "remove":
      return isId(r.chain) && isId(r.member);
    default:
      return false;
  }
}

/** Check the signature, that the key names the signer, and that the record is well formed. */
export async function verifyRosterRecord(s: unknown): Promise<boolean> {
  const x = s as SignedRosterRecord | null;
  if (!x || !wellFormed(x.record) || !isId(x.signer) || typeof x.publicKey !== "string" || typeof x.signature !== "string") return false;
  try {
    if (await computeUserId(x.publicKey) !== x.signer) return false;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(x.publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(x.signature), new TextEncoder().encode(signedText(x.record, x.signer, x.publicKey)));
  } catch {
    return false;
  }
}

/** Signer over text with the vault's identity key (PKCS#8, base64). */
export function rosterSignerFromKeys(userId: string, publicKey: string, privateKey: string): TextSigner {
  return {
    userId,
    publicKey,
    async signText(text: string) {
      const key = await crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(privateKey),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      return arrayBufferToBase64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(text)));
    },
  };
}

// ── The roster: folded from records, in order ───────────────────────

interface OpenInvite { invitee: string; expiresAt: number }

export class CellRoster {
  readonly members = new Set<string>();
  private invites = new Map<string, OpenInvite>();
  private lastAt = 0;

  private constructor(
    /** Hash of the genesis record: the cell chain's id. */
    readonly chainId: string,
    readonly cellId: string,
    readonly name: string,
    /** The cell coin's ticker, fixed at genesis. */
    readonly ticker: string,
    readonly owner: string,
    at: number,
  ) {
    this.members.add(owner);
    this.lastAt = at;
  }

  /** Start a roster from a genesis record. Null when it isn't a valid, signed genesis. */
  static async fromGenesis(s: SignedRosterRecord): Promise<CellRoster | null> {
    const r = s?.record;
    if (r?.kind !== "genesis" || !await verifyRosterRecord(s) || s.signer !== r.owner) return null;
    return new CellRoster(await rosterRecordHash(s), r.cellId, r.name, r.ticker, r.owner, r.at);
  }

  /** Fold a whole record list, genesis first. Null when any record is rejected. */
  static async fold(records: SignedRosterRecord[]): Promise<CellRoster | null> {
    if (records.length === 0) return null;
    const roster = await CellRoster.fromGenesis(records[0]);
    if (!roster) return null;
    for (const s of records.slice(1)) if (!await roster.apply(s)) return null;
    return roster;
  }

  isMember(userId: string): boolean {
    return this.members.has(userId);
  }

  /** Members in a fixed order, the same on every device. */
  sortedMembers(): string[] {
    return [...this.members].sort();
  }

  /** The record would apply at this point, without applying it. */
  async check(s: SignedRosterRecord): Promise<boolean> {
    return (await this.plan(s)) !== null;
  }

  /** Apply one record. Returns false, leaving the roster unchanged, when it doesn't fit. */
  async apply(s: SignedRosterRecord): Promise<boolean> {
    const step = await this.plan(s);
    if (!step) return false;
    step();
    return true;
  }

  private async plan(s: SignedRosterRecord): Promise<(() => void) | null> {
    const r = s?.record;
    if (!r || r.kind === "genesis" || r.chain !== this.chainId) return null;
    // Records only move forward in time, so an old invite can't be replayed later in the list.
    if (r.at < this.lastAt) return null;
    if (!await verifyRosterRecord(s)) return null;
    const at = r.at;
    switch (r.kind) {
      case "invite": {
        if (s.signer !== this.owner || this.members.has(r.invitee)) return null;
        const id = await rosterRecordHash(s);
        if (this.invites.has(id)) return null;
        return () => { this.invites.set(id, { invitee: r.invitee, expiresAt: r.expiresAt }); this.lastAt = at; };
      }
      case "accept": {
        const invite = this.invites.get(r.invite);
        if (!invite || invite.invitee !== s.signer || r.at > invite.expiresAt) return null;
        if (this.members.has(s.signer) || this.members.size >= MAX_CELL_MEMBERS) return null;
        return () => {
          this.invites.delete(r.invite);
          this.members.add(s.signer);
          this.lastAt = at;
        };
      }
      case "leave": {
        if (!this.members.has(s.signer) || s.signer === this.owner) return null;
        return () => { this.members.delete(s.signer); this.lastAt = at; };
      }
      case "remove": {
        if (s.signer !== this.owner || r.member === this.owner || !this.members.has(r.member)) return null;
        return () => {
          this.members.delete(r.member);
          for (const [id, inv] of this.invites) if (inv.invitee === r.member) this.invites.delete(id);
          this.lastAt = at;
        };
      }
      default:
        return null;
    }
  }
}

// ── Building records ────────────────────────────────────────────────

export function genesisRecord(cellId: string, name: string, owner: string, at: number): RosterRecord {
  return { kind: "genesis", cellId, name: name.slice(0, MAX_CELL_NAME_LENGTH), ticker: tickerFromName(name), owner, at };
}

export function inviteRecord(chain: string, invitee: string, at: number, ttlMs = INVITE_TTL_MS): RosterRecord {
  return { kind: "invite", chain, invitee, at, expiresAt: at + ttlMs };
}

export async function acceptRecord(invite: SignedRosterRecord, at: number): Promise<RosterRecord> {
  if (invite.record.kind !== "invite") throw new Error("Not an invite");
  return { kind: "accept", chain: invite.record.chain, invite: await rosterRecordHash(invite), at };
}

export function leaveRecord(chain: string, at: number): RosterRecord {
  return { kind: "leave", chain, at };
}

export function removeRecord(chain: string, member: string, at: number): RosterRecord {
  return { kind: "remove", chain, member, at };
}
