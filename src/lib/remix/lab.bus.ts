/**
 * Lab port — high-level "mint" entry point for the Lab → World bridge.
 *
 * Wraps `emitScaffold('lab','recipe')` and the minted-prefabs store so a
 * single call:
 *   1. derives the Prefab from a Molecule (UQRC mass/basin/H₂O/fire),
 *   2. registers it in the Builder Bar catalog,
 *   3. persists it to IndexedDB,
 *   4. gossips via BroadcastChannel (+ optional Gun bridge),
 *   5. fires a `recipe` event on the scaffold bus so the field "feels" it.
 */
import { emitScaffold, subscribeScaffold } from '@/lib/uqrc/scaffoldBus';
import type { LabRecipeEvent, ScaffoldHandler } from '@/lib/uqrc/scaffoldPorts';
import type { Molecule } from './moleculeCatalog';
import { deriveMintedPrefab, type LabMintOptions } from './labMint';
import {
  mintPrefab,
  hydrateMintedPrefabs,
  type MintedRecord,
} from './mintedPrefabsStore';

export function emitLabRecipe(evt: Omit<LabRecipeEvent, 'domain' | 'type'>): void {
  emitScaffold({ domain: 'lab', type: 'recipe', ...evt });
}

export function onLabRecipe(fn: ScaffoldHandler<LabRecipeEvent>): () => void {
  return subscribeScaffold<LabRecipeEvent>('lab', fn);
}

export interface MintMoleculeInput extends LabMintOptions {
  molecule: Molecule;
  actorId: string;
}

export async function mintMolecule(input: MintMoleculeInput): Promise<MintedRecord> {
  const { molecule, actorId, ...opts } = input;
  const prefab = deriveMintedPrefab(molecule, opts);
  const rec = await mintPrefab({ prefab, actorId });
  emitLabRecipe({ recipeId: prefab.id, formula: molecule.formula, ok: true });
  return rec;
}

let booted = false;
export function bootLabBusBridges(): void {
  if (booted) return;
  booted = true;
  // Hydrate prior mints so they re-appear in the Builder Bar after reload.
  void hydrateMintedPrefabs();
}