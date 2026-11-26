/**
 * remixBrain — start a new project from an existing Brain.
 *
 * A remix creates a fresh project owned by the remixer and carries the
 * source Brain's assets into it:
 *   • every Lab asset minted into the source (for the Main Brain, the
 *     shared catalog: mints with no project tag) is re-minted under the
 *     new project, so it shows on the new Brain's Lab tab;
 *   • the source project's material pool (smelted coin payloads) is
 *     copied into the new project's pool.
 *
 * Everyone can remix the Main Brain. Nothing in the source is changed.
 */
import { createProject } from '@/lib/projects';
import type { Project } from '@/types';
import {
  hydrateMintedPrefabs,
  listMintedPrefabs,
  mintPrefab,
  type MintedRecord,
} from './mintedPrefabsStore';
import {
  listHarvestedForProject,
  recordHarvestForProject,
  subscribeHarvestedForProject,
} from './harvestedInventory';

/** Remix source: a project, or `null` for the shared Main Brain. */
export interface RemixSource {
  projectId: string | null;
  name: string;
  description?: string;
}

export interface RemixResult {
  project: Project;
  assetsCopied: number;
}

export const MAIN_BRAIN_REMIX: RemixSource = {
  projectId: null,
  name: 'Main Brain',
  description: 'The shared world everyone starts in.',
};

/** Lab assets that belong to a Brain. The Main Brain's are the untagged ones. */
export function assetsForBrain(records: MintedRecord[], projectId: string | null): MintedRecord[] {
  return records.filter((r) => (projectId ? r.projectId === projectId : !r.projectId));
}

/** Read a project's material pool once it has loaded from storage. */
function loadProjectPool(projectId: string): Promise<{ symbol: string; count: number }[]> {
  return new Promise((resolve) => {
    let settled = false;
    let unsub: (() => void) | null = null;
    const done = (snap: { symbol: string; count: number }[]) => {
      if (settled) return;
      settled = true;
      resolve(snap);
      queueMicrotask(() => unsub?.());
    };
    // The first call fires on load; fall back to whatever is cached.
    unsub = subscribeHarvestedForProject(projectId, done);
    setTimeout(() => done(listHarvestedForProject(projectId)), 1500);
  });
}

export async function remixBrain(source: RemixSource, actorId: string): Promise<RemixResult> {
  const project = await createProject(
    `${source.name} (Remix)`,
    source.description?.trim() || `Remix of ${source.name}`,
  );

  await hydrateMintedPrefabs();
  const assets = assetsForBrain(listMintedPrefabs(), source.projectId);
  let assetsCopied = 0;
  for (const rec of assets) {
    // A fresh id, so the source Brain keeps its own copy.
    const id = `${rec.prefab.id}~${project.id.slice(0, 8)}`;
    try {
      await mintPrefab({ prefab: { ...rec.prefab, id }, actorId, projectId: project.id });
      assetsCopied += 1;
    } catch (err) {
      console.warn('[remixBrain] asset copy failed', rec.id, err);
    }
  }

  if (source.projectId) {
    const pool = await loadProjectPool(source.projectId);
    if (pool.length) await recordHarvestForProject(project.id, pool);
  }

  return { project, assetsCopied };
}
