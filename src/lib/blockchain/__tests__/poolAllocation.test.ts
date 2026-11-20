import { describe, expect, it } from 'vitest';
import type { SwarmTransaction } from '../types';
import {
  ALLOCATION_FROM, ALLOCATION_TO, allocationDay, buildAllocationTx, planAllocation, validAllocationLedger, verifyAllocationTx, type AllocationVote,
} from '../infinity/poolAllocation';
import { NATIVE_MINTME_CUSTODY, mintMeAmount, nativeMintMeBalanceUnits } from '../wallets/nativeMintmeLedger';
import { InfinityPoolAllocation } from '../infinity/poolAllocationService';

const E18 = 10n ** 18n;
const deposit = (to: string, units: bigint): SwarmTransaction => ({
  id: `dep-${to}-${units}`, type: 'external_deposit', from: 'mintme', to, amount: mintMeAmount(units),
  timestamp: new Date(0).toISOString(), signature: '', publicKey: '', nonce: 0, fee: 0, chainId: 'SWARM',
  meta: { currency: 'MINTME', custody: NATIVE_MINTME_CUSTODY, amountUnits: units.toString() },
} as SwarmTransaction);

const DAY = 20_000;
const NOW = DAY * 86_400_000 + 1000;
const vote = (plan: NonNullable<ReturnType<typeof planAllocation>>, voterId: string, agree = true): AllocationVote =>
  ({ proposalId: plan.proposalId, round: plan.round, day: plan.day, units: plan.units.toString(), voterId, agree });

describe('Infinity vault allocation', () => {
  const ledger = [deposit(ALLOCATION_FROM, 100n * E18)];

  it('proposes 5% of the donations vault per round', () => {
    const plan = planAllocation(ledger, DAY)!;
    expect(plan.units).toBe(5n * E18);
    expect(plan.round).toBe(0);
  });

  it('needs 3 yes answers and a strict majority', () => {
    const plan = planAllocation(ledger, DAY)!;
    expect(buildAllocationTx([vote(plan, 'a'), vote(plan, 'b')], ledger)).toBeNull();
    expect(buildAllocationTx([vote(plan, 'a'), vote(plan, 'b'), vote(plan, 'c'), vote(plan, 'd', false), vote(plan, 'e', false), vote(plan, 'f', false)], ledger)).toBeNull();
    const tx = buildAllocationTx([vote(plan, 'a'), vote(plan, 'b'), vote(plan, 'c'), vote(plan, 'd', false)], ledger)!;
    expect(tx.from).toBe(ALLOCATION_FROM);
    expect(tx.to).toBe(ALLOCATION_TO);
    expect(verifyAllocationTx(tx, ledger, NOW)).toBe(true);
  });

  it('moves units between Infinity vaults only and caps each day at 10%', () => {
    let txs = [...ledger];
    for (let i = 0; i < 4; i++) {
      const plan = planAllocation(txs, DAY);
      if (!plan) break;
      const tx = buildAllocationTx(['a', 'b', 'c'].map((v) => vote(plan, v)), txs)!;
      expect(verifyAllocationTx(tx, txs, NOW)).toBe(true);
      txs = [...txs, tx];
    }
    const moved = nativeMintMeBalanceUnits(txs, ALLOCATION_TO);
    expect(moved).toBe(10n * E18); // 5% + 5% then the day cap stops it
    expect(nativeMintMeBalanceUnits(txs, ALLOCATION_FROM)).toBe(90n * E18);
    expect(planAllocation(txs, DAY)).toBeNull();
    expect(planAllocation(txs, DAY + 1)!.units).toBe(4_500_000_000_000_000_000n);
  });

  it('rejects edited amounts, replayed rounds and future days', () => {
    const plan = planAllocation(ledger, DAY)!;
    const tx = buildAllocationTx(['a', 'b', 'c'].map((v) => vote(plan, v)), ledger)!;
    expect(verifyAllocationTx({ ...tx, meta: { ...tx.meta, units: (50n * E18).toString() } }, ledger, NOW)).toBe(false);
    expect(verifyAllocationTx({ ...tx, to: 'attacker' }, ledger, NOW)).toBe(false);
    expect(verifyAllocationTx(tx, [...ledger, tx], NOW)).toBe(false);
    expect(verifyAllocationTx(tx, ledger, (DAY - 5) * 86_400_000)).toBe(false);
  });

  it('settles over the mesh only when members connected 2 h+ agree', async () => {
    let txs = [...ledger];
    const handlers: Array<(peer: string, m: unknown) => void> = [];
    const nodes = ['a', 'b', 'c'].map((id) => new InfinityPoolAllocation({
      transport: {
        broadcast: (_c, m) => { for (const h of handlers) queueMicrotask(() => h(id, m)); },
        onMessage: (_c, h) => { handlers.push(h); return () => {}; },
      },
      ledger: { transactions: () => txs, accept: async (tx) => { if (!verifyAllocationTx(tx, txs, NOW)) return false; txs = [...txs, tx]; return true; } },
      memberId: () => id,
      deepTier: () => true,
      now: () => NOW,
    }));
    nodes.forEach((n) => n.start());
    await nodes[0].tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(txs.some((t) => t.id === 'infinity-allocation-0')).toBe(true);
    expect(allocationDay(NOW)).toBe(DAY);
  });
});

describe('Infinity vault allocation ledger checks', () => {
  const ledger = [deposit(ALLOCATION_FROM, 100n * E18)];
  const settle = (txs: SwarmTransaction[], day: number) => {
    const plan = planAllocation(txs, day)!;
    return buildAllocationTx(['a', 'b', 'c'].map((v) => vote(plan, v)), txs)!;
  };

  it('refuses a record dated tomorrow', () => {
    const tx = settle(ledger, DAY + 1);
    expect(verifyAllocationTx(tx, ledger, NOW)).toBe(false);
    expect(verifyAllocationTx(tx, ledger, NOW + 86_400_000)).toBe(true);
  });

  it('rejects a forged or uncapped record arriving through block sync', () => {
    const good = settle(ledger, DAY);
    expect(validAllocationLedger([...ledger, good], NOW)).toBe(true);
    const forged = { ...good, id: 'infinity-allocation-1', amount: 50, meta: { round: 1, day: DAY, units: (50n * E18).toString(), votes: [] } } as SwarmTransaction;
    expect(validAllocationLedger([...ledger, good, forged], NOW)).toBe(false);
  });
});
