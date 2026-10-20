export interface OwnedAsset {
  id: string;
  label: string;
  amount: number;
}

/** Ownership is a positive balance, not a speculative external price quote. */
export function positiveBalanceAssets<T extends OwnedAsset>(assets: T[]): T[] {
  return assets.filter((asset) => Number.isFinite(asset.amount) && asset.amount > 0);
}