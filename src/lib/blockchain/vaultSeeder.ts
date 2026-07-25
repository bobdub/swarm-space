/**
 * vaultSeeder — read-only advertisement of vault-held pieces.
 * Does NOT register new gossip topics; cross-peer seeding hook lands later.
 */
import { findVaultEntry, listVaults } from "./syncVault";

export async function vaultHas(contentHash: string): Promise<boolean> {
  return !!(await findVaultEntry(contentHash));
}

export async function vaultInventory(): Promise<string[]> {
  const vaults = await listVaults();
  const out = new Set<string>();
  for (const v of vaults) for (const h of Object.keys(v.index)) out.add(h);
  return Array.from(out);
}