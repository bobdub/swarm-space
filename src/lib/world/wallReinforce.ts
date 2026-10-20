import { getCurrentUser } from '@/lib/auth';
import { getWalletTipAssets, sendWalletTip } from '@/lib/blockchain/wallets/walletTips';
import { pickReinforcePayment } from './wallInteractionRules';
import { recordWallInteraction } from './wallInteractionsStore';

/** Tip the wall's maker a fixed amount (1 SWARM, else 10 credits) and record the reinforcement. */
export async function reinforceWall(wall: { placementId: string; actorId: string }): Promise<string> {
  const user = getCurrentUser();
  if (!user) throw new Error('Sign in first');
  if (user.id === wall.actorId) throw new Error('You cannot reinforce your own wall');
  const assets = await getWalletTipAssets(user.id);
  const swarm = assets.find((a) => a.kind === 'chain' && !a.unavailable);
  const credits = assets.find((a) => a.kind === 'credits');
  const pick = pickReinforcePayment(swarm?.balance ?? 0, credits?.balance ?? 0);
  if (!pick) throw new Error('Need 1 SWARM or 10 credits to reinforce');
  const assetId = pick.asset === 'swarm' ? swarm!.id : 'credits';
  await sendWalletTip({ recipient: wall.actorId, assetId, amount: pick.amount, message: 'Wall reinforced' });
  recordWallInteraction({ placementId: wall.placementId, kind: 'reinforce', actorId: user.id });
  return pick.asset === 'swarm' ? `${pick.amount} ${swarm!.ticker}` : `${pick.amount} credits`;
}
