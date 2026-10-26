import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = {
  user: vi.fn(() => ({ id: 'pilot' })), swarm: vi.fn(async () => 5), credits: vi.fn(async () => 500),
  burn: vi.fn(async () => ({})), deduct: vi.fn(async () => undefined),
};
import { createLaunchCharger } from '../spaceshipPayment';
const chargeShipLaunch = createLaunchCharger({ currentUserId: () => mocks.user()?.id, swarmBalance: mocks.swarm, creditBalance: mocks.credits, burn: mocks.burn, deduct: mocks.deduct });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockReturnValue({ id: 'pilot' }); mocks.swarm.mockResolvedValue(5); mocks.credits.mockResolvedValue(500); mocks.burn.mockResolvedValue({}); });
describe('paid boarding', () => {
  it('deduplicates held-action completion and debits exactly five SWARM', async () => {
    const a = chargeShipLaunch('pilot', 'dedup'); const b = chargeShipLaunch('pilot', 'dedup');
    expect(a).toBe(b); await a; expect(mocks.burn).toHaveBeenCalledTimes(1);
    expect(mocks.burn).toHaveBeenCalledWith({ from: 'pilot', amount: 5, reason: 'Spaceship launch:dedup' });
    expect(mocks.deduct).not.toHaveBeenCalled();
  });
  it('charges game credits only when SWARM is insufficient', async () => {
    mocks.swarm.mockResolvedValue(0); await chargeShipLaunch('pilot', 'fallback');
    expect(mocks.deduct).toHaveBeenCalledWith('pilot', 500, 'Spaceship launch:fallback'); expect(mocks.burn).not.toHaveBeenCalled();
  });
  it('does not charge after a cancelled boarding', async () => {
    await expect(chargeShipLaunch('pilot', 'cancelled', () => false)).rejects.toThrow('cancelled');
    expect(mocks.burn).not.toHaveBeenCalled(); expect(mocks.deduct).not.toHaveBeenCalled();
  });
  it('never falls back after a SWARM payment error', async () => {
    mocks.burn.mockRejectedValueOnce(new Error('Ledger refused'));
    await expect(chargeShipLaunch('pilot', 'refused')).rejects.toThrow('Ledger refused'); expect(mocks.deduct).not.toHaveBeenCalled();
  });
});