export type TipAssetKind = "credits" | "chain" | "creator" | "external";
export interface TipAsset {
  id: string;
  ticker: string;
  name: string;
  balance: number;
  kind: TipAssetKind;
  chainId?: string;
  tokenId?: string;
  creatorUserId?: string;
  unavailable?: string;
}

export function validateWalletTip(asset: TipAsset, amount: number): void {
  if (asset.unavailable) throw new Error(asset.unavailable);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount above zero");
  if (asset.kind === "credits" && !Number.isSafeInteger(amount)) throw new Error("Credit tips use whole credits");
  if (amount > asset.balance) throw new Error(`Insufficient ${asset.ticker} balance`);
}