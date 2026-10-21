import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowDownToLine, ArrowUpFromLine, Copy, Coins } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import { getAppWalletBalances, onAppWalletUpdate } from "@/lib/blockchain/wallets/appWallet";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { getChainMintmeBalance } from "@/lib/blockchain/deposits/mintmeDeposit";
import { getChainEthBalance } from "@/lib/blockchain/deposits/ethDeposit";
import { resolveNativeWalletRecipient } from "@/lib/blockchain/wallets/nativeAddress";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import { useNativeWalletAddress } from "@/hooks/useNativeWalletAddress";
import { useMetaMask } from "@/hooks/useMetaMask";
import { MetaMaskConnectButton } from "./MetaMaskConnectButton";
import { SwarmBridgeDialog } from "./SwarmBridgeDialog";
import { SwarmMetaMaskDialog } from "./SwarmMetaMaskDialog";
import { MintMeDepositDialog } from "./MintMeDepositDialog";
import { QRCodeSVG } from "qrcode.react";
import { useP2PContext } from "@/contexts/P2PContext";
import { SendCreditsModal } from "@/components/SendCreditsModal";
import { CustomTokenWizard, CustomTokenRow, useCustomTokens } from "./CustomTokenWizard";
import { getRecordedTokenBalance } from "@/lib/blockchain/deposits/customTokens";
import { getUserProfileTokenHoldings, type ProfileTokenHolding } from "@/lib/blockchain/profileTokenBalance";
import { nativeWalletAssets } from "@/lib/blockchain/wallets/nativeAssets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Layer = "native" | "metamask";

export function AssetsTab() {
  const userId = getCurrentUser()?.id ?? "";
  const { balance: credits } = useCreditBalance(userId || null);
  const [swarm, setSwarm] = useState(0);
  const [mintme, setMintme] = useState(0);
  const [bridge, setBridge] = useState({ ETH: 0, BTC: 0, MINTME: 0 });
  const [layer, setLayer] = useState<Layer>("native");
  const [selection, setSelection] = useState("all");
  const [holdings, setHoldings] = useState<ProfileTokenHolding[]>([]);
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
    };
    void refresh();
    const off = onAppWalletUpdate(refresh);
    window.addEventListener("blockchain-transaction", refresh);
    window.addEventListener("credit-transaction", refresh);
    return () => {
      off();
      window.removeEventListener("blockchain-transaction", refresh);
      window.removeEventListener("credit-transaction", refresh);
    };
  }, [userId]);

  const rows = [
    { code: "SWARM", label: "SWARM", amount: swarm, digits: 2 },
    { code: "CREDIT", label: "Credits", amount: credits, digits: 2 },
    { code: "MINTME", label: "MintMe", amount: mintme, digits: 4 },
    { code: "ETH", label: "ETH", amount: bridge.ETH + getChainEthBalance(userId), digits: 6 },
    { code: "BTC", label: "BTC", amount: bridge.BTC, digits: 6 },
  ];
  const owned = nativeWalletAssets({
    swarm, credits, mintme, eth: bridge.ETH + getChainEthBalance(userId), btc: bridge.BTC, holdings,
    custom: customTokens.map((token) => ({ token, amount: getRecordedTokenBalance(userId, token.address), available: getRecordedTokenBalance(userId, token.address) })),
  });
  const selected = owned.some((a) => a.id === selection) ? selection : "all";
  const showNative = (id: string) => owned.some((a) => a.id === id) && (selected === "all" || selected === id);

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
        <Label htmlFor="owned-wallet-asset">Owned assets</Label>
        <Select value={selected} onValueChange={setSelection}>
          <SelectTrigger id="owned-wallet-asset"><SelectValue placeholder="Select an owned asset" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owned assets</SelectItem>
            {owned.map((a) => <SelectItem key={a.id} value={a.id}>{a.label} · {a.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</SelectItem>)}
          </SelectContent>
        </Select>
        {owned.length === 0 && <p className="text-sm text-muted-foreground">No positive asset balances yet.</p>}
      </div>}

      <div className="grid gap-2">
        {rows.filter((r) => layer === "native" ? showNative(r.code) : r.code !== "CREDIT").map((r) => (
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
              layer={layer} metaMaskAddress={address} offline={offline} />
          </div>
        ))}
        {customTokens.filter((t) => layer === "metamask" || showNative(`custom:${t.address}`)).map((t) => <CustomTokenRow key={t.address} userId={userId} token={t} layer={layer} />)}
        {layer === "native" && holdings.filter((h) => showNative(`creator:${h.tokenId}`)).map((h) => (
          <div key={h.tokenId} className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Coins className="h-4 w-4 text-primary" />{h.ticker}<span className="text-xs text-muted-foreground">Creator token</span></div>
            <div className="text-xl font-semibold tabular-nums">{h.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssetActions({ code, label, amount, userId, layer, metaMaskAddress, offline }: {
  code: string; label: string; amount: number; userId: string; layer: Layer; metaMaskAddress: string | null; offline: boolean;
}) {
  const cls = "grid grid-cols-2 gap-2 sm:flex sm:flex-shrink-0";
  if (offline && layer === "native" && (code === "SWARM" || code === "CREDIT")) {
    return (
      <div className={cls}>
        <ReceiveDialog label={label} userId={userId} note="Transfers to you settle once a mesh peer is online." />
        <Button type="button" variant="outline" size="sm" disabled title="A mesh peer must be online to transfer.">
          <ArrowUpFromLine className="mr-1 h-3 w-3" />Waiting for peers
        </Button>
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
        <CreditTransferDialog amount={amount} userId={userId} />
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
  if (layer === "metamask" && code === "BTC") {
    return (
      <div className={cls}>
        <Button type="button" variant="outline" size="sm" disabled title="Bitcoin is not reachable through MetaMask's web connection.">
          <ArrowDownToLine className="mr-1 h-3 w-3" />Deposit to Native
        </Button>
        <p className="col-span-2 text-xs text-muted-foreground sm:max-w-48">MetaMask doesn't let websites move Bitcoin yet.</p>
      </div>
    );
  }
  const reason = layer === "metamask"
    ? metaMaskAddress ? "Only MintMe deposits are available so far." : "Connect MetaMask first."
    : "External deposits for this asset are not available yet.";
  return (
    <div className={cls}>
      {layer === "native"
        ? <ReceiveDialog label={label} userId={userId} note="Native SWARM transfers only for now." />
        : <Button type="button" variant="outline" size="sm" disabled title={reason}><ArrowDownToLine className="mr-1 h-3 w-3" />Receive</Button>}
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

function CreditTransferDialog({ amount, userId }: { amount: number; userId: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const next = async () => {
    setBusy(true);
    try {
      const user = await resolveNativeWalletRecipient(input);
      if (user.id === userId) throw new Error("That is your own wallet.");
      setTarget({ id: user.id, name: user.displayName || user.username || "user" });
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recipient not found");
    } finally { setBusy(false); }
  };
  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={!userId || amount <= 0} onClick={() => setOpen(true)}>
        <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer / Withdraw
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer Credits</DialogTitle></DialogHeader>
          <Label htmlFor="credit-recipient">Recipient wallet address</Label>
          <Input id="credit-recipient" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x…" />
          <DialogFooter>
            <Button type="button" disabled={busy || input.trim().length < 6} onClick={() => void next()}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {target && <SendCreditsModal toUserId={target.id} toUsername={target.name} isOpen onClose={() => setTarget(null)} />}
    </>
  );
}
