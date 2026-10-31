import { INFINITY_VAULTS, infinityVaultEvmAddress } from "../infinity/vaults";

/** Public receiving address of the community MintMe pool: Infinity's MintMe vault,
 * unless a deployment overrides it. Never derive a community key from a user. */
export function getMintMeCommunityVaultAddress(): string | null {
  const address = import.meta.env.VITE_MINTME_COMMUNITY_VAULT_ADDRESS?.trim();
  if (address && /^0x[0-9a-f]{40}$/i.test(address) && !/^0x0{40}$/i.test(address)) return address;
  return infinityVaultEvmAddress(INFINITY_VAULTS.mintme);
}
