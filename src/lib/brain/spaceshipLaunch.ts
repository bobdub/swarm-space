import { getCurrentUser } from '@/lib/auth';
import { getCreditBalance, deductCredits } from '@/lib/credits';
import { getSwarmBalance, burnSwarm } from '@/lib/blockchain/token';
import { createLaunchCharger } from './spaceshipPayment';
// Game admission follows the existing land-plot fee path, not vault settlement.
export const chargeShipLaunch = createLaunchCharger({ currentUserId: () => getCurrentUser()?.id, swarmBalance: getSwarmBalance, creditBalance: getCreditBalance, burn: burnSwarm, deduct: deductCredits });