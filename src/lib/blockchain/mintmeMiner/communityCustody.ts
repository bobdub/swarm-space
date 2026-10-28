/** Public receiving metadata only. Never derive a community key from a user. */
export function getMintMeCommunityVaultAddress(): string | null {
  const address = import.meta.env.VITE_MINTME_COMMUNITY_VAULT_ADDRESS?.trim();
  return address && /^0x[0-9a-f]{40}$/i.test(address) && !/^0x0{40}$/i.test(address)
    ? address : null;
}