/**
 * The wallet's view of cell chains: which ones a member sees under
 * Wallet > Chain, what each holds for them, and the actions they can take
 * there (send the cell coin, invite, remove, leave).
 *
 * A cell's chain shows for its creator from the moment the cell exists, and
 * for everyone else once they're on its roster with at least one other
 * member: that is, once the cell is live between two or more members.
 */
import { CELL_ROSTER_TX, signCellTransfer, type CellChain } from "./cellChain";
import { getCellChains, getLocalRosterSigner, type CellChains } from "./cellChains";
import type { CellSession } from "./cellSync";
import { rosterRecordHash, type SignedRosterRecord, type TextSigner } from "./roster";

export interface WalletCellChain {
  cellId: string;
  chainId: string;
  name: string;
  ticker: string;
  isOwner: boolean;
}

export interface CellWalletView extends WalletCellChain {
  owner: string;
  height: number;
  balance: number;
  maturing: number;
  supply: number;
  members: string[];
  /** Accounts holding an invite that's waiting for them to accept (on the chain or still pending). */
  invited: string[];
  pending: number;
  /** Proven accounts connected in this cell right now; empty unless it's the active cell. */
  connected: string[];
  /** True when this cell is the one the device is in. */
  active: boolean;
}

/** True when the cell's chain belongs in this account's wallet. */
export function showsInWallet(chain: CellChain, userId: string): boolean {
  const roster = chain.getRoster();
  if (roster.owner === userId) return true;
  return roster.isMember(userId) && roster.members.size >= 2;
}

/** The cell chains this account sees under Wallet > Chain. */
export async function listWalletCellChains(
  userId: string,
  cellIds: string[],
  chains: CellChains = getCellChains(),
): Promise<WalletCellChain[]> {
  const out: WalletCellChain[] = [];
  for (const cellId of cellIds) {
    const chain = await chains.chain(cellId).catch(() => null);
    if (!chain || !showsInWallet(chain, userId)) continue;
    const roster = chain.getRoster();
    out.push({ cellId, chainId: chain.chainId, name: roster.name, ticker: roster.ticker, isOwner: roster.owner === userId });
  }
  return out;
}

function pendingInvitees(chain: CellChain): string[] {
  const out = new Set<string>();
  for (const tx of chain.getPendingTransactions()) {
    const s = tx.type === CELL_ROSTER_TX ? tx.meta?.roster as SignedRosterRecord | undefined : undefined;
    if (s?.record.kind === "invite") out.add(s.record.invitee);
  }
  return [...out];
}

/** Everything the wallet shows for one cell chain. Null when this account doesn't see it. */
export async function cellWalletView(
  cellId: string,
  userId: string,
  session: CellSession | null,
  chains: CellChains = getCellChains(),
): Promise<CellWalletView | null> {
  const chain = await chains.chain(cellId).catch(() => null);
  if (!chain || !showsInWallet(chain, userId)) return null;
  const roster = chain.getRoster();
  const active = session?.cellId === cellId;
  const connected = active ? [...new Set(session!.connectedAccounts().values())] : [];
  const invited = new Set(pendingInvitees(chain));
  for (const account of connected) if (roster.hasOpenInvite(account)) invited.add(account);
  for (const m of roster.members) invited.delete(m);
  return {
    cellId,
    chainId: chain.chainId,
    name: roster.name,
    ticker: roster.ticker,
    isOwner: roster.owner === userId,
    owner: roster.owner,
    height: chain.getLatestBlock().index,
    balance: chain.getBalance(userId),
    maturing: chain.getImmatureRewards(userId),
    supply: chain.getTotalSupply(),
    members: roster.sortedMembers(),
    invited: [...invited].sort(),
    pending: chain.getPendingTransactions().length,
    connected,
    active,
  };
}

// ── Actions ──

export interface CellActionResult { ok: boolean; reason?: string }

interface ActionDeps {
  chains?: CellChains;
  signer?: TextSigner | null;
  session?: CellSession | null;
  now?: number;
}

async function resolve(deps: ActionDeps): Promise<{ chains: CellChains; signer: TextSigner | null; session: CellSession | null; now: number }> {
  let session = deps.session;
  if (session === undefined) {
    const { getCellSession } = await import("./cellRuntime");
    session = getCellSession();
  }
  return {
    chains: deps.chains ?? getCellChains(),
    signer: deps.signer === undefined ? await getLocalRosterSigner() : deps.signer,
    session,
    now: deps.now ?? Date.now(),
  };
}

async function announceRecord(cellId: string, chains: CellChains, session: CellSession | null, s: SignedRosterRecord): Promise<void> {
  if (session?.cellId !== cellId) return;
  const chain = await chains.chain(cellId);
  const id = await rosterRecordHash(s);
  const tx = chain?.getPendingTransactions().find((p) => p.id === id);
  if (tx) await session.announce(tx);
}

const LOCKED = "Unlock your wallet to sign for the cell.";

/** Send some of the cell's coin to another member. */
export async function sendCellCoin(cellId: string, to: string, amount: number, deps: ActionDeps = {}): Promise<CellActionResult> {
  const { chains, signer, session, now } = await resolve(deps);
  if (!signer) return { ok: false, reason: LOCKED };
  const chain = await chains.chain(cellId);
  if (!chain) return { ok: false, reason: "This device doesn't have the cell's chain." };
  const roster = chain.getRoster();
  if (!roster.isMember(signer.userId)) return { ok: false, reason: "Only members can send the cell's coin." };
  if (!roster.isMember(to) || to === signer.userId) return { ok: false, reason: "Pick another member of the cell." };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "Enter an amount above zero." };
  if (amount > chain.getBalance(signer.userId)) return { ok: false, reason: `You don't have that much ${roster.ticker} yet.` };
  const at = Math.round(now);
  const tx = await signCellTransfer({ chain: chain.chainId, to, amount, nonce: at, at }, signer);
  if (!await chain.queue(tx)) return { ok: false, reason: "The chain didn't take that transfer." };
  if (session?.cellId === cellId) await session.announce(tx);
  return { ok: true };
}

/** Owner: invite an account into the cell. */
export async function inviteToCell(cellId: string, invitee: string, deps: ActionDeps = {}): Promise<CellActionResult> {
  const { chains, signer, session, now } = await resolve(deps);
  if (!signer) return { ok: false, reason: LOCKED };
  const id = invitee.trim();
  if (!id) return { ok: false, reason: "Enter the account to invite." };
  const chain = await chains.chain(cellId);
  if (!chain) return { ok: false, reason: "This device doesn't have the cell's chain." };
  if (chain.getRoster().owner !== signer.userId) return { ok: false, reason: "Only the cell's creator can invite." };
  if (chain.getRoster().isMember(id)) return { ok: false, reason: "That account is already a member." };
  const s = await chains.invite(cellId, id, signer, Math.round(now));
  if (!s) return { ok: false, reason: "The cell couldn't take that invite (it may be full)." };
  await announceRecord(cellId, chains, session, s);
  return { ok: true };
}

/** Owner: remove a member. */
export async function removeFromCell(cellId: string, member: string, deps: ActionDeps = {}): Promise<CellActionResult> {
  const { chains, signer, session, now } = await resolve(deps);
  if (!signer) return { ok: false, reason: LOCKED };
  const s = await chains.remove(cellId, member, signer, Math.round(now));
  if (!s) return { ok: false, reason: "Only the creator can remove a member, and not themselves." };
  await announceRecord(cellId, chains, session, s);
  return { ok: true };
}

/** Member: leave the cell. The creator can't leave their own cell. */
export async function leaveCell(cellId: string, deps: ActionDeps = {}): Promise<CellActionResult> {
  const { chains, signer, session, now } = await resolve(deps);
  if (!signer) return { ok: false, reason: LOCKED };
  const s = await chains.leave(cellId, signer, Math.round(now));
  if (!s) return { ok: false, reason: "The creator can't leave their own cell." };
  await announceRecord(cellId, chains, session, s);
  return { ok: true };
}
