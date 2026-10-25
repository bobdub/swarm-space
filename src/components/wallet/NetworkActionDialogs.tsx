/**
 * NetworkActionDialogs — network-aware Receive / Transfer actions for
 * MintMe-family assets (native MINTME and imported MintMe tokens).
 *
 * Each action button carries a network dropdown:
 * - SWARM: native mesh receiving address and online-peer transfers.
 * - MintMe: deposit to the cold-key receiving address / cold-key withdrawal.
 * - Custom Chain: shown only when the user has deployed a sub-chain on
 *   SWARM; MintMe assets cannot move onto a SWARM sub-chain, so the panel
 *   explains that instead of offering a transfer.
 */
import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAllLiveChains, type LiveChainInfo } from "@/lib/blockchain/multiChainManager";
import { NativeTokenDepositDialog } from "./NativeTokenDepositDialog";
import { NativeTransferDialog } from "./NativeTransferDialog";

export type AssetNetwork = "swarm" | "mintme" | `chain:${string}`;

/** Sub-chains this user has deployed on SWARM. */
export function useUserSubChains(userId: string): LiveChainInfo[] {
  const [chains, setChains] = useState<LiveChainInfo[]>([]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const load = () =>
      void getAllLiveChains()
        .then((all) => {
          if (active) setChains(all.filter((c) => !c.isMainChain && c.deployer === userId));
        })
        .catch(() => { if (active) setChains([]); });
    load();
    window.addEventListener("coin-deployed", load);
    return () => { active = false; window.removeEventListener("coin-deployed", load); };
  }, [userId]);
  return chains;
}

export function NetworkPicker({ value, onChange, subChains, id }: {
  value: AssetNetwork;
  onChange: (network: AssetNetwork) => void;
  subChains: LiveChainInfo[];
  id: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AssetNetwork)}>
      <SelectTrigger id={id} className="h-8 w-full min-w-[120px] text-xs sm:w-auto" aria-label="Network">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="swarm">SWARM</SelectItem>
        <SelectItem value="mintme">MintMe</SelectItem>
        {subChains.map((c) => (
          <SelectItem key={c.chainId} value={`chain:${c.chainId}`}>
            {c.ticker} · {c.chainName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SubChainNotice({ label, chain }: { label: string; chain: LiveChainInfo | undefined }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <p>
        {label} lives on the MintMe blockchain and cannot move onto {chain ? `${chain.chainName} (${chain.ticker})` : "a SWARM sub-chain"}.
        Sub-chains settle their own native coins — switch the network to SWARM or MintMe to move this asset.
      </p>
    </div>
  );
}

/** Receive + Transfer for the native MINTME row, with a network dropdown. */
export function MintMeNativeActions({ userId, amount }: { userId: string; amount: number }) {
  const subChains = useUserSubChains(userId);
  const [receiveNet, setReceiveNet] = useState<AssetNetwork>("swarm");
  const [sendNet, setSendNet] = useState<AssetNetwork>("swarm");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const receiveChain = receiveNet.startsWith("chain:") ? subChains.find((c) => `chain:${c.chainId}` === receiveNet) : undefined;
  const sendChain = sendNet.startsWith("chain:") ? subChains.find((c) => `chain:${c.chainId}` === sendNet) : undefined;

  return (
    <>
      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
        <NetworkPicker id="mintme-receive-network" value={receiveNet} onChange={setReceiveNet} subChains={subChains} />
        {receiveNet === "swarm" && (
          <Button type="button" variant="outline" size="sm" disabled={!userId} onClick={() => setReceiveOpen(true)}>
            <ArrowDownToLine className="mr-1 h-3 w-3" />Receive
          </Button>
        )}
        {receiveNet === "mintme" && <NativeTokenDepositDialog userId={userId} symbol="MINTME" />}
        {receiveNet.startsWith("chain:") && <SubChainNotice label="MINTME" chain={receiveChain} />}
      </div>
      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
        <NetworkPicker id="mintme-send-network" value={sendNet} onChange={setSendNet} subChains={subChains} />
        {sendNet === "swarm" && (
          <NativeTransferDialog userId={userId} assetId="external:MINTME" assetLabel="MINTME" amount={amount} />
        )}
        {sendNet === "mintme" && (
          <Button type="button" variant="outline" size="sm" disabled
            title="Withdrawing MINTME itself to MintMe needs a gasless cold-key path that is not built yet.">
            <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer / Withdraw
          </Button>
        )}
        {sendNet.startsWith("chain:") && <SubChainNotice label="MINTME" chain={sendChain} />}
      </div>
      {receiveOpen && <NativeSwarmReceiveDialog userId={userId} label="MINTME" open={receiveOpen} onOpenChange={setReceiveOpen} />}
    </>
  );
}

/** Receive + Transfer/Withdraw for an imported MintMe token row, with network dropdowns. */
export function CustomTokenNetworkActions({ userId, symbol, address, recorded, withdrawForm }: {
  userId: string;
  symbol: string;
  address: string;
  recorded: number;
  /** Rendered when the MintMe send network is selected (cold-key withdrawal form). */
  withdrawForm: React.ReactNode;
}) {
  const subChains = useUserSubChains(userId);
  const [receiveNet, setReceiveNet] = useState<AssetNetwork>("swarm");
  const [sendNet, setSendNet] = useState<AssetNetwork>("swarm");
  const [sendOpen, setSendOpen] = useState(false);
  const receiveChain = receiveNet.startsWith("chain:") ? subChains.find((c) => `chain:${c.chainId}` === receiveNet) : undefined;
  const sendChain = sendNet.startsWith("chain:") ? subChains.find((c) => `chain:${c.chainId}` === sendNet) : undefined;

  return (
    <>
      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
        <NetworkPicker id={`receive-net-${address}`} value={receiveNet} onChange={setReceiveNet} subChains={subChains} />
        <NativeTokenDepositDialog userId={userId} symbol={symbol} />
        {receiveNet.startsWith("chain:") && <SubChainNotice label={symbol} chain={receiveChain} />}
      </div>
      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
        <NetworkPicker id={`send-net-${address}`} value={sendNet} onChange={setSendNet} subChains={subChains} />
        {sendNet === "swarm" && (
          <NativeTransferDialog userId={userId} assetId={`custom:${address}`} assetLabel={symbol} amount={recorded} />
        )}
        {sendNet === "mintme" && (
          <Button type="button" variant="outline" size="sm" disabled={!userId || recorded <= 0}
            title={recorded <= 0 ? `You hold no ${symbol} to withdraw.` : `Send ${symbol} to a MintMe wallet`}
            onClick={() => setSendOpen(true)}>
            <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer / Withdraw
          </Button>
        )}
        {sendNet.startsWith("chain:") && <SubChainNotice label={symbol} chain={sendChain} />}
        {sendOpen && sendNet === "mintme" && withdrawForm}
      </div>
    </>
  );
}

/** Minimal native-address receive dialog (QR + copy) reused for the MINTME row. */
import { QRCodeSVG } from "qrcode.react";
import { Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useNativeWalletAddress } from "@/hooks/useNativeWalletAddress";

function NativeSwarmReceiveDialog({ userId, label, open, onOpenChange }: {
  userId: string; label: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const addr = useNativeWalletAddress(userId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
        <p className="text-xs text-muted-foreground">Native SWARM transfers only for now.</p>
      </DialogContent>
    </Dialog>
  );
}
