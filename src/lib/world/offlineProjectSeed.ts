/**
 * offlineProjectSeed — the one way offline gathers reach online play.
 *
 * Goods gathered in offline play stay in the offline bag and never sync
 * (`harvestedInventory`, `playMode`). The exception: a project's creator
 * may start their project with them, while the project has no members
 * besides the creator, by paying `PROJECT_SEED_FEE_SWARM`.
 *
 * Seeding moves the whole offline bag into that project's seed pool. The
 * pool is usable for local play inside that project's Brain only (builds,
 * Lab work); it is never sold at a Trading Stand, crafted into a coin or
 * moved back to the player's bag, so seeded goods never become tradable.
 *
 * The fee goes into the Market Vault like a Market tool purchase: a SWARM
 * transfer to the community pool marked as a pool inflow
 * (`marketVault: true`, `direction: 'vault-sell'`), with
 * `meta.projectSeed = <projectId>`. It is taken before anything moves, so a
 * short balance moves nothing.
 */
import type { Project } from '@/types';
import { listOfflineHarvested, moveOfflineToProjectSeed } from '@/lib/remix/harvestedInventory';

/** SWARM a creator pays to seed their empty project with offline gathers. */
export const PROJECT_SEED_FEE_SWARM = 10;

/** Members of a project other than its owner. */
export function otherMembers(project: Pick<Project, 'owner' | 'members'>): string[] {
  return (project.members ?? []).filter((m) => m && m !== project.owner);
}

/**
 * Why `userId` cannot seed `project` with offline gathers right now, or
 * null when they can. Pure, so the settings card and the action agree.
 */
export function seedRefusal(
  project: Pick<Project, 'owner' | 'members'> | null | undefined,
  userId: string | null | undefined,
  offlineEntries: number,
): string | null {
  if (!userId) return 'Sign in to seed a project.';
  if (!project) return 'That project was not found.';
  if (project.owner !== userId) return 'Only the project\'s creator can seed it with offline gathers.';
  if (otherMembers(project).length > 0) {
    return 'Offline gathers can only start a project that has no members yet.';
  }
  if (offlineEntries <= 0) return 'You have no offline gathers to bring in.';
  return null;
}

export interface SeedResult {
  projectId: string;
  fee: number;
  moved: { symbol: string; count: number }[];
}

/**
 * Pay the fee and move the offline bag into `projectId`'s seed pool.
 * Throws (charging nothing, moving nothing) when `seedRefusal` refuses or
 * the SWARM balance is short.
 */
export async function seedProjectWithOfflineGathers(projectId: string, userId: string): Promise<SeedResult> {
  const { getCurrentUser } = await import('@/lib/auth');
  if (!userId || getCurrentUser()?.id !== userId) throw new Error('Sign in to seed a project.');
  const { getProject } = await import('@/lib/projects');
  // Read the project fresh, so a member who just joined blocks the seed.
  const project = await getProject(projectId);
  const refusal = seedRefusal(project, userId, listOfflineHarvested().length);
  if (refusal) throw new Error(refusal);

  const { COMMUNITY_POOL } = await import('@/lib/blockchain/poolLedger');
  const { transferSwarm } = await import('@/lib/blockchain/token');
  await transferSwarm({
    from: userId,
    to: COMMUNITY_POOL,
    amount: PROJECT_SEED_FEE_SWARM,
    meta: { projectSeed: projectId, marketVault: true, direction: 'vault-sell' },
  });

  const moved = moveOfflineToProjectSeed(projectId);
  return { projectId, fee: PROJECT_SEED_FEE_SWARM, moved };
}
