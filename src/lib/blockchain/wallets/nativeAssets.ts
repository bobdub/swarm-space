import { positiveBalanceAssets, type OwnedAsset } from "./ownedAssets";
import type { ProfileTokenHolding } from "../profileTokenBalance";
import type { CustomToken } from "../deposits/customTokens";

export interface NativeAsset extends OwnedAsset {
  symbol: string;
  kind: "swarm" | "credits" | "custom" | "creator" | "external";
  available: number;
  contract?: string;
}

export interface NativeAssetSnapshot {
  swarm: number;
  credits: number;
  mintme: number;
  eth: number;
  btc: number;
  custom: { token: CustomToken; amount: number; available: number }[];
  holdings: ProfileTokenHolding[];
}

/**
 * Everything the native wallet knows about, unfiltered. The wallet list
 * never hides assets automatically — zero balances stay visible until the
 * owner hides them manually (SWARM can never be hidden).
 */
export function nativeWalletInventory(snapshot: NativeAssetSnapshot): NativeAsset[] {
  return buildAssets(snapshot);
}

/** Native ownership is shared by Assets and Market, independent of MetaMask connection. */
export function nativeWalletAssets(snapshot: NativeAssetSnapshot): NativeAsset[] {
  return positiveBalanceAssets<NativeAsset>(buildAssets(snapshot));
}

function buildAssets(snapshot: NativeAssetSnapshot): NativeAsset[] {
  return [
    { id: "SWARM", label: "SWARM", symbol: "SWARM", kind: "swarm", amount: snapshot.swarm, available: snapshot.swarm },
    { id: "CREDIT", label: "Credits", symbol: "Credits", kind: "credits", amount: snapshot.credits, available: snapshot.credits },
    { id: "MINTME", label: "MintMe", symbol: "MINTME", kind: "external", amount: snapshot.mintme, available: snapshot.mintme },
    { id: "ETH", label: "ETH", symbol: "ETH", kind: "external", amount: snapshot.eth, available: snapshot.eth },
    { id: "BTC", label: "BTC", symbol: "BTC", kind: "external", amount: snapshot.btc, available: snapshot.btc },
    ...snapshot.custom.map(({ token, amount, available }): NativeAsset => ({
      id: `custom:${token.address}`, label: `${token.symbol} · MintMe`, symbol: token.symbol,
      kind: "custom", contract: token.address, amount, available,
    })),
    ...snapshot.holdings.map((holding): NativeAsset => ({
      id: `creator:${holding.tokenId}`, label: `${holding.ticker} · Creator`, symbol: holding.ticker,
      kind: "creator", amount: holding.amount, available: holding.amount,
    })),
  ]);
}

export function nativeMarketPayments(assets: NativeAsset[]): NativeAsset[] {
  return positiveBalanceAssets(assets).filter((asset) => asset.kind !== "swarm");
}