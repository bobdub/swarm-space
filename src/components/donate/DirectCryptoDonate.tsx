import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check, Wallet, Bitcoin, Send } from "lucide-react";
import { toast } from "sonner";
import { useMetaMask, shortAddr, chainLabel } from "@/hooks/useMetaMask";
import { requestMetaMask } from "@/lib/blockchain/wallets/metaMaskBridge";
import { MINTME_CHAIN_ID_HEX, switchToMintMeNetwork } from "@/lib/blockchain/wallets/mintmeNetwork";

export const ETH_DONATION_ADDRESS = "0xcb7C28ae87f9d9A46271e1E62256a5dc8B58fCC8";
export const BTC_DONATION_ADDRESS = "bc1qak00ul9qty707v6kjgud9qc622nw8fpz2jcsr7";

const ETH_CHAIN_ID_HEX = "0x1";

type NetworkId = "eth" | "btc" | "mintme";

interface NetworkDef {
  id: NetworkId;
  label: string;
  symbol: string;
  presets: string[];
  evm: boolean;
  chainId?: string;
  addressLabel: string;
}

const NETWORKS: NetworkDef[] = [
  {
    id: "eth",
    label: "ETH / USDC",
    symbol: "ETH",
    presets: ["0.005", "0.01", "0.05"],
    evm: true,
    chainId: ETH_CHAIN_ID_HEX,
    addressLabel: "ETH / USDC / ERC-20 (Ethereum)",
  },
  {
    id: "btc",
    label: "BTC",
    symbol: "BTC",
    presets: [],
    evm: false,
    addressLabel: "BTC (Bitcoin)",
  },
  {
    id: "mintme",
    label: "MintMe",
    symbol: "MINTME",
    presets: ["50", "250", "1000"],
    evm: true,
    chainId: MINTME_CHAIN_ID_HEX,
    addressLabel: "MINTME (MintMe.com Coin)",
  },
];

interface Recipient {
  id: string;
  name: string;
  addresses: Partial<Record<NetworkId, string>>;
  comingSoon?: boolean;
}

const RECIPIENTS: Recipient[] = [
  {
    id: "quantum",
    name: "Quantum",
    addresses: {
      eth: ETH_DONATION_ADDRESS,
      btc: BTC_DONATION_ADDRESS,
      mintme: ETH_DONATION_ADDRESS,
    },
  },
  {
    id: "bobdub",
    name: "Bobdub",
    addresses: {
      eth: "0xde21D925ee48fFAeD8939AE8B75dD6E82310f8Ea",
      btc: "bc1qswpxr8sckxz40u3qnpadl0rd2ftuhckr35rx9k",
      mintme: "0xfce71e9182f4165e3de13544c39ad1507bcc6915",
    },
  },
];

function toWeiHex(amount: string): string {
  const [whole, frac = ""] = amount.trim().split(".");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  const wei = BigInt(whole || "0") * 10n ** 18n + BigInt(padded || "0");
  if (wei <= 0n) throw new Error("Enter an amount greater than zero");
  return "0x" + wei.toString(16);
}

function AddressRow({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success(`${label} address copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the address manually");
    }
  };
  return (
    <div className="rounded-2xl border border-border/50 bg-background/40 p-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all text-xs text-foreground">{address}</code>
        <Button type="button" size="icon" variant="ghost" onClick={copy} aria-label={`Copy ${label} address`}>
          {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function DirectCryptoDonate() {
  const { available, address, chainId, busy, connect } = useMetaMask();
  const [recipientId, setRecipientId] = useState("quantum");
  const [networkId, setNetworkId] = useState<NetworkId>("eth");
  const [amount, setAmount] = useState("0.01");
  const [sending, setSending] = useState(false);

  const recipient = RECIPIENTS.find((r) => r.id === recipientId) ?? RECIPIENTS[0];
  const network = useMemo(
    () => NETWORKS.find((n) => n.id === networkId) ?? NETWORKS[0],
    [networkId],
  );
  const target = recipient.addresses[networkId];

  const selectNetwork = (id: NetworkId) => {
    setNetworkId(id);
    const next = NETWORKS.find((n) => n.id === id);
    if (next?.presets.length) setAmount(next.presets[1] ?? next.presets[0]);
  };

  const ensureNetwork = async () => {
    if (!network.evm || !network.chainId) return;
    if (chainId?.toLowerCase() === network.chainId.toLowerCase()) return;
    if (network.id === "mintme") {
      await switchToMintMeNetwork();
      return;
    }
    await requestMetaMask("wallet_switchEthereumChain", [{ chainId: network.chainId }]);
  };

  const send = async () => {
    setSending(true);
    try {
      if (!address) {
        await connect();
        await ensureNetwork();
        return;
      }
      if (!target) throw new Error("No address for this network yet");
      await ensureNetwork();
      const value = toWeiHex(amount);
      const hash = await requestMetaMask<string>("eth_sendTransaction", [
        { from: address, to: target, value },
      ]);
      toast.success("Thank you! Donation sent", { description: shortAddr(String(hash)) });
    } catch (e) {
      toast.error("Donation not sent", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="rounded-3xl border border-primary/20 bg-primary/5 p-6 md:p-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wallet className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold text-foreground">Donate Crypto Directly</h2>
        </div>
        {address ? (
          <Badge>{shortAddr(address)} · {chainLabel(chainId)}</Badge>
        ) : (
          <Badge variant="secondary">{available ? "Wallet not connected" : "MetaMask not detected"}</Badge>
        )}
      </div>

      <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
        Choose who you're supporting and which coin you'd like to send. Nothing is held by the app —
        funds go straight from your wallet to theirs.
      </p>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Send to</div>
        <Select value={recipientId} onValueChange={setRecipientId}>
          <SelectTrigger className="rounded-2xl" aria-label="Choose who to support">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECIPIENTS.map((r) => (
              <SelectItem key={r.id} value={r.id} disabled={r.comingSoon}>
                {r.name}{r.comingSoon ? " — Coming Soon" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={networkId} onValueChange={(v) => selectNetwork(v as NetworkId)}>
        <TabsList className="w-full rounded-2xl">
          {NETWORKS.map((n) => (
            <TabsTrigger key={n.id} value={n.id} className="flex-1 rounded-xl text-xs sm:text-sm">
              {n.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {network.evm ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {network.presets.map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={amount === p ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setAmount(p)}
              >
                {p} {network.symbol}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder={`Amount in ${network.symbol}`}
              aria-label={`Amount in ${network.symbol}`}
            />
            <Button
              type="button"
              onClick={send}
              disabled={sending || busy || !available || (!!address && !target)}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {address ? "Send" : "Connect"}
            </Button>
          </div>
          {!target && (
            <p className="text-xs text-muted-foreground">
              {recipient.name} hasn't shared a {network.symbol} address yet.
            </p>
          )}
          {!available && (
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Install MetaMask to donate in one click →
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Bitcoin can't be sent from MetaMask — copy the address below into your Bitcoin wallet or
          exchange.
        </p>
      )}

      {target ? (
        <AddressRow label={network.addressLabel} address={target} />
      ) : (
        <div className="rounded-2xl border border-border/50 bg-background/40 p-3 text-xs text-muted-foreground">
          Coming soon.
        </div>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bitcoin className="h-3.5 w-3.5" />
        Only send Bitcoin to the BTC address, and only the matching network's assets to each EVM address.
      </p>
    </Card>
  );
}
