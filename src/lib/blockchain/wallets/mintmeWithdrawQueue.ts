/**
 * MINTME withdrawals to MintMe. Every withdrawal needs a connected peer to
 * cross-check the ledger; without one it waits instead of being lost.
 * Amounts already at the user's MintMe receiving address go out directly from
 * the cold key; mined rewards go out through the Reward Contract once it is
 * deployed — until then they stay queued ("On-chain release coming soon").
 * Nothing is simulated: Sent always carries a real MintMe transaction hash.
 */
export type WithdrawStatus = "queued" | "waiting-peer" | "sent" | "reversed";

export interface WithdrawEntry {
  id: string;
  to: string;
  amount: number;
  status: WithdrawStatus;
  txHash?: string;
  note?: string;
  createdAt: number;
}

export interface WithdrawDeps {
  peers(): number;
  contract(): string | null;
  /** True when the user's MintMe receiving address already holds this amount plus fee. */
  directBacked(amount: number): Promise<boolean>;
  sendDirect(to: string, amount: number): Promise<string>;
  sendContract(to: string, amount: number): Promise<string>;
}

export const COMING_SOON = "On-chain release coming soon";

export async function processWithdraw(e: WithdrawEntry, d: WithdrawDeps): Promise<WithdrawEntry> {
  if (e.status === "sent" || e.status === "reversed") return e;
  if (d.peers() < 1) return { ...e, status: "waiting-peer", note: "Waiting for a connected peer to check the ledger" };
  let route: "direct" | "contract" | null = null;
  try { route = await d.directBacked(e.amount) ? "direct" : d.contract() ? "contract" : null; }
  catch { return { ...e, status: "queued", note: "MintMe is unreachable; will retry" }; }
  if (!route) return { ...e, status: "queued", note: COMING_SOON };
  try {
    const txHash = route === "direct" ? await d.sendDirect(e.to, e.amount) : await d.sendContract(e.to, e.amount);
    return { ...e, status: "sent", txHash, note: undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Release failed";
    if (msg.startsWith(COMING_SOON)) return { ...e, status: "queued", note: COMING_SOON };
    if (/locked/i.test(msg)) return { ...e, status: "queued", note: "Wallet locked; will send after unlock" };
    return { ...e, status: "reversed", note: `${msg} Your balance was not debited.` };
  }
}

const key = (uid: string) => `swarm:mintme-withdrawals:${uid}`;
export function readWithdrawals(uid: string): WithdrawEntry[] {
  try { const v = JSON.parse(localStorage.getItem(key(uid)) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveWithdrawals(uid: string, list: WithdrawEntry[]) {
  localStorage.setItem(key(uid), JSON.stringify(list.slice(-50)));
  window.dispatchEvent(new Event("mintme-withdrawals"));
}

/** Live deps: mesh peers, cold-key direct path, Reward Contract path. */
export async function liveWithdrawDeps(userId: string): Promise<WithdrawDeps> {
  const [{ getSwarmMeshStandalone }, { getMintMeRewardContract, buildWithdrawCalldata }, direct, { deriveColdKey, getColdKeyReceivingAddress }, custody, ledger, { getSwarmChain }] = await Promise.all([
    import("@/lib/p2p/swarmMesh.standalone"), import("../mintmeMiner/rewardContract"), import("./nativeMintmeDirect"),
    import("./coldKey"), import("./nativeMintmeCustody"), import("./nativeMintmeLedger"), import("../chain"),
  ]);
  return {
    peers: () => getSwarmMeshStandalone().getConnectedPeers().length,
    contract: getMintMeRewardContract,
    async directBacked(amount) {
      const p = custody.mintMeReadProvider();
      try {
        const [held, fee] = await Promise.all([p.getBalance(await getColdKeyReceivingAddress(userId)), p.getFeeData()]);
        return held >= ledger.mintMeUnits(amount) + 21000n * (fee.gasPrice ?? 0n);
      } finally { p.destroy(); }
    },
    sendDirect: (to, amount) => direct.withdrawNativeMintMe({ userId, to, amount }),
    async sendContract(to, amount) {
      const contract = getMintMeRewardContract();
      // The matching ledger debit record ships with the deployed contract; until then nothing is released.
      if (!contract || !import.meta.env?.VITE_MINTME_REWARD_RELEASE_LIVE) throw new Error(`${COMING_SOON}.`);
      const units = ledger.mintMeUnits(amount);
      if (getSwarmChain().getNativeMintMeBalanceUnits(userId) < units) throw new Error("Not enough native MINTME.");
      const { wallet } = await deriveColdKey(userId);
      const p = custody.mintMeReadProvider();
      try { return (await wallet.connect(p).sendTransaction({ to: contract, data: buildWithdrawCalldata(to, units) })).hash; }
      finally { p.destroy(); }
    },
  };
}
