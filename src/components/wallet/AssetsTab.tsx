import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDownToLine, ArrowUpFromLine, Copy, Coins, EyeOff, Eye } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import { getAppWalletBalances, onAppWalletUpdate } from "@/lib/blockchain/wallets/appWallet";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { getChainMintmeBalance } from "@/lib/blockchain/deposits/mintmeDeposit";
import { getChainEthBalance } from "@/lib/blockchain/deposits/ethDeposit";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import { useNativeWalletAddress } from "@/hooks/useNativeWalletAddress";
import { useMetaMask } from "@/hooks/useMetaMask";
import { MetaMaskConnectButton } from "./MetaMaskConnectButton";
import { SwarmBridgeDialog } from "./SwarmBridgeDialog";
import { SwarmMetaMaskDialog } from "./SwarmMetaMaskDialog";
import { MintMeDepositDialog } from "./MintMeDepositDialog";
import { OnlineTransferDialog } from "./OnlineTransferDialog";
import { QRCodeSVG } from "qrcode.react";
import { useP2PContext } from "@/contexts/P2PContext";
import { CustomTokenWizard, CustomTokenRow, useCustomTokens } from "./CustomTokenWizard";
import { getRecordedTokenBalance } from "@/lib/blockchain/deposits/customTokens";
import { getUserProfileTokenHoldings, type ProfileTokenHolding } from "@/lib/blockchain/profileTokenBalance";
import { nativeWalletInventory } from "@/lib/blockchain/wallets/nativeAssets";
import { canHideAsset, hydrateHiddenAssets, listHiddenAssets, setAssetHidden, HIDDEN_ASSETS_EVENT } from "@/lib/blockchain/wallets/hiddenAssets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Layer = "native" | "metamask";

/** Tip-asset id used to preselect the Send & Tip modal for a wallet row. */
const TRANSFER_ASSET_ID: Record<string, string> = {
  SWARM: "chain:SWARM",
  CREDIT: "credits",
  MINTME: "external:MINTME",
  ETH: "external:ETH",
  BTC: "external:BTC",
};

export function AssetsTab() {
  const userId = getCurrentUser()?.id ?? "";
  const { balance: credits } = useCreditBalance(userId || null);
  const [swarm, setSwarm] = useState(0);
  const [mintme, setMintme] = useState(0);
  const [bridge, setBridge] = useState({ ETH: 0, BTC: 0, MINTME: 0 });
  const [layer, setLayer] = useState<Layer>("native");
  const [selection, setSelection] = useState("all");
  const [holdings, setHoldings] = useState<ProfileTokenHolding[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => listHiddenAssets(userId));
  const { address } = useMetaMask();
  const { stats, getActivePeerConnections } = useP2PContext();
  const customTokens = useCustomTokens(userId);
  const offline = Math.max(stats.connectedPeers, getActivePeerConnections().length) === 0;

  useEffect(() => {
    if (!userId) return;
    const refresh = async () => {
      setBridge(getAppWalletBalances(userId));
      setMintme(getChainMintmeBalance(userId));
      try { setHoldings(await getUserProfileTokenHoldings(userId)); } catch { /* retain last known holdings */ }
      try { setSwarm(await getSwarmBalance(userId)); } catch { /* ignore */ }
      try { setHiddenIds(await hydrateHiddenAssets(userId)); } catch { /* retain last known */ }
    };
    void refresh();
    const onHidden = () => setHiddenIds(listHiddenAssets(userId));
    const off = onAppWalletUpdate(refresh);
    window.addEventListener("blockchain-transaction", refresh);
    window.addEventListener("credit-transaction", refresh);
    window.addEventListener(HIDDEN_ASSETS_EVENT, onHidden);
    return () => {
      off();
      window.removeEventListener("blockchain-transaction", refresh);
      window.removeEventListener("credit-transaction", refresh);
      window.removeEventListener(HIDDEN_ASSETS_EVENT, onHidden);
    };
  }, [userId]);

  const rows = [
    { code: "SWARM", label: "SWARM", amount: swarm, digits: 2 },
    { code: "CREDIT", label: "Credits", amount: credits, digits: 2 },
    { code: "MINTME", label: "MintMe", amount: mintme, digits: 4 },
    { code: "ETH", label: "ETH", amount: bridge.ETH + getChainEthBalance(userId), digits: 6 },
    { code: "BTC", label: "BTC", amount: bridge.BTC, digits: 6 },
  ];
  // The wallet lists every known asset — nothing is hidden automatically.
  const inventory = nativeWalletInventory({
    swarm, credits, mintme, eth: bridge.ETH + getChainEthBalance(userId), btc: bridge.BTC, holdings,
    custom: customTokens.map((token) => ({ token, amount: getRecordedTokenBalance(userId, token.address), available: getRecordedTokenBalance(userId, token.address) })),
  });
  const hidden = new Set(hiddenIds);
  const selected = inventory.some((a) => a.id === selection) ? selection : "all";
  const matchesFilter = (id: string) => selected === "all" || selected === id;
  const visible = (id: string) => !hidden.has(id) && matchesFilter(id);
  const hide = (id: string) => setAssetHidden(userId, id, true);
  const unhide = (id: string) => setAssetHidden(userId, id, false);
  const hiddenAssets = inventory.filter((a) => hidden.has(a.id));

  return (
    <section aria-label="Assets" className="space-y-3">
      <div role="tablist" aria-label="Asset network" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
        {(["native", "metamask"] as const).map((l) => (
          <Button key={l} type="button" role="tab" aria-selected={layer === l} size="sm"
            variant={layer === l ? "default" : "ghost"} onClick={() => setLayer(l)}>
            {l === "native" ? "Native" : "MetaMask"}
          </Button>
        ))}
      </div>

      {layer === "native" && offline && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
          Waiting for peers — native transfers travel through the mesh, so a peer must be online. Like mining, they unlock once you connect.
        </div>
      )}

      {layer === "metamask" && !address && (
        <div className="rounded-md border p-3 text-sm space-y-2">
          <p className="text-muted-foreground">Connect MetaMask to manage assets on your MetaMask wallet.</p>
          <MetaMaskConnectButton compact />
        </div>
      )}

      {layer === "metamask" && address && (
        <div className="flex justify-end"><CustomTokenWizard userId={userId} /></div>
      )}

      {layer === "native" && <div className="space-y-1">
        <Label htmlFor="owned-wallet-asset">Wallet assets</Label>
        <Select value={selected} onValueChange={setSelection}>
          <SelectTrigger id="owned-wallet-asset"><SelectValue placeholder="Select an asset" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assets</SelectItem>
            {inventory.map((a) => <SelectItem key={a.id} value={a.id}>{a.label} · {a.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>}

      <div className="grid gap-2">
        {rows.filter((r) => layer === "native" ? visible(r.code) : r.code !== "CREDIT").map((r) => (
          <div key={r.code} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Coins className="h-4 w-4 text-primary" /> {r.label}
              </div>
              <div className="text-xl font-semibold tabular-nums">
                {r.amount.toLocaleString(undefined, { maximumFractionDigits: r.digits })}{" "}
                <span className="text-xs font-normal text-muted-foreground">{r.code}</span>
              </div>
            </div>
            <AssetActions code={r.code} label={r.label} amount={r.amount} userId={userId}
              layer={layer} metaMaskAddress={address} offline={offline}
              onHide={layer === "native" && canHideAsset(r.code, r.amount) ? () => hide(r.code) : undefined} />
          </div>
        ))}
        {customTokens.filter((t) => layer === "metamask" ? !t.hidden : visible(`custom:${t.address}`)).map((t) => (
          <CustomTokenRow key={t.address} userId={userId} token={t} layer={layer}
            onHide={layer === "native" && canHideAsset(`custom:${t.address}`, getRecordedTokenBalance(userId, t.address)) ? () => hide(`custom:${t.address}`) : undefined} />
        ))}
        {layer === "native" && holdings.filter((h) => visible(`creator:${h.tokenId}`)).map((h) => (
          <div key={h.tokenId} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium"><Coins className="h-4 w-4 text-primary" />{h.ticker}<span className="text-xs text-muted-foreground">Creator token</span></div>
              <div className="text-xl font-semibold tabular-nums">{h.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-shrink-0">
              <OnlineTransferDialog userId={userId} assetId={`creator:${h.tokenId}`} assetLabel={h.ticker} amount={h.amount} />
              {canHideAsset(`creator:${h.tokenId}`, h.amount) && (
                <Button type="button" size="sm" variant="ghost" onClick={() => hide(`creator:${h.tokenId}`)}>
                  <EyeOff className="mr-1 h-3 w-3" />Hide
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {layer === "native" && hiddenAssets.length > 0 && (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <p className="text-xs font-medium text-muted-foreground">Hidden assets</p>
          <ul className="space-y-1">
            {hiddenAssets.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-muted-foreground">{a.label}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => unhide(a.id)}>
                  <Eye className="mr-1 h-3 w-3" />Show
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function AssetActions({ code, label, amount, userId, layer, metaMaskAddress, offline, onHide }: {
  code: string; label: string; amount: number; userId: string; layer: Layer; metaMaskAddress: string | null; offline: boolean;
  onHide?: () => void;
}) {
  const cls = "grid grid-cols-2 gap-2 sm:flex sm:flex-shrink-0";
  const hideButton = onHide && (
    <Button type="button" size="sm" variant="ghost" onClick={onHide} title="Hide this asset while its balance is zero.">
      <EyeOff className="mr-1 h-3 w-3" />Hide
    </Button>
  );
  if (offline && layer === "native" && (code === "SWARM" || code === "CREDIT")) {
    return (
      <div className={cls}>
        <ReceiveDialog label={label} userId={userId} note="Transfers to you settle once a mesh peer is online." />
        <Button type="button" variant="outline" size="sm" disabled title="A mesh peer must be online to transfer.">
          <ArrowUpFromLine className="mr-1 h-3 w-3" />Waiting for peers
        </Button>
        {hideButton}
      </div>
    );
  }
  if (layer === "native" && code === "SWARM") {
    return (
      <div className={cls}>
        <SwarmBridgeDialog mode="deposit" balance={amount} userId={userId} className="w-full sm:w-auto" />
        <SwarmBridgeDialog mode="withdraw" balance={amount} userId={userId} className="w-full sm:w-auto" />
      </div>
    );
  }
  if (layer === "native" && code === "CREDIT") {
    return (
      <div className={cls}>
        <ReceiveDialog label={label} userId={userId} />
        <OnlineTransferDialog userId={userId} assetId={TRANSFER_ASSET_ID.CREDIT} assetLabel="Credits" amount={amount} />
        {hideButton}
      </div>
    );
  }
  if (layer === "native" && (code === "MINTME" || code === "ETH" || code === "BTC")) {
    return (
      <div className={cls}>
        <ReceiveDialog label={label} userId={userId} note="Native SWARM transfers only for now." />
        <OnlineTransferDialog userId={userId} assetId={TRANSFER_ASSET_ID[code]} assetLabel={label} amount={amount} />
        {hideButton}
      </div>
    );
  }
  if ((code === "MINTME" || code === "ETH") && layer === "metamask") {
    return (
      <div className={cls}>
        <MintMeDepositDialog userId={userId} label="Deposit to Native" asset={code as "MINTME" | "ETH"} />
        <Button type="button" variant="outline" size="sm" disabled title="Withdrawals come next.">
          <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer / Withdraw
        </Button>
      </div>
    );
  }
  if (layer === "metamask" && code === "SWARM") {
    return (
      <div className={cls}>
        <SwarmMetaMaskDialog mode="deposit" userId={userId} nativeBalance={amount} />
        <SwarmMetaMaskDialog mode="withdraw" userId={userId} nativeBalance={amount} />
      </div>
    );
  }
  const reason = "External deposits for this asset are not available yet.";
  return (
    <div className={cls}>
      <Button type="button" variant="outline" size="sm" disabled title={reason}><ArrowDownToLine className="mr-1 h-3 w-3" />Receive</Button>
      <Button type="button" variant="outline" size="sm" disabled title={reason}>
        <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer / Withdraw
      </Button>
    </div>
  );
}

function ReceiveDialog({ label, userId, note }: { label: string; userId: string; note?: string }) {
  const [open, setOpen] = useState(false);
  const addr = useNativeWalletAddress(userId);
  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={!userId} onClick={() => setOpen(true)}>
        <ArrowDownToLine className="mr-1 h-3 w-3" />Receive
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Receive {label}</DialogTitle></DialogHeader>
          {addr && <div className="mx-auto rounded-md border p-3"><QRCodeSVG value={addr} size={176} bgColor="#ffffff" fgColor="#000000" aria-label="Native wallet address QR code" /></div>}
          <Label>Your native SWARM wallet address</Label>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 break-all font-mono text-xs">{addr || "Loading address…"}</span>
            <Button type="button" size="icon" variant="ghost" disabled={!addr} aria-label="Copy address"
              onClick={() => void navigator.clipboard.writeText(addr).then(() => toast.success("Wallet address copied"))}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
