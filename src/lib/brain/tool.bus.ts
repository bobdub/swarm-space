/**
 * tool.bus — high-level "forge" entry point for the Sculpting → Tools
 * bridge (Phase 4). Single call:
 *   1. derives a Tool from a Molecule (via `toolForge.deriveForgedTool`),
 *   2. registers it into the toolCatalog (live for `sculpting.applyImpact`),
 *   3. persists it to IndexedDB,
 *   4. gossips via BroadcastChannel (+ optional Gun bridge),
 *   5. fires a `lab.recipe` event on the scaffold bus so the field
 *      "feels" the new tool as a forge-flavoured recipe.
 */
import { emitScaffold } from '@/lib/uqrc/scaffoldBus';
import type { Molecule } from '@/lib/remix/moleculeCatalog';
import { deriveForgedTool } from './toolForge';
import {
  forgeTool,
  hydrateForgedTools,
  type ForgedToolRecord,
} from './toolMintStore';

export interface ForgeMoleculeInput {
  molecule: Molecule;
  actorId: string;
}

export async function forgeMoleculeAsTool(
  input: ForgeMoleculeInput,
): Promise<ForgedToolRecord> {
  const tool = deriveForgedTool(input.molecule);
  const rec = await forgeTool({ tool, actorId: input.actorId });
  emitScaffold({
    domain: 'lab',
    type: 'recipe',
    recipeId: tool.id,
    formula: `forge:${input.molecule.formula}`,
    ok: true,
  });
  return rec;
}

let booted = false;
export function bootToolBusBridges(): void {
  if (booted) return;
  booted = true;
  void hydrateForgedTools();
}