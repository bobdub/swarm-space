import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Wallet, Bitcoin, Send } from "lucide-react";
import { toast } from "sonner";
import { useMetaMask, shortAddr, chainLabel } from "@/hooks/useMetaMask";
import { requestMetaMask } from "@/lib/blockchain/wallets/metaMaskBridge";

export const ETH_DONATION_ADDRESS = "0xcb7C28ae87f9d9A46271e1E62256a5dc8B58fCC8";
export const BTC_DONATION_ADDRESS = "bc1qak00ul9qty707v6kjgud9qc622nw8fpz2jcsr7";

const PRESETS = ["0.005", "0.01", "0.05"];

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
  const [amount, setAmount] = useState("0.01");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!address) {
      await connect();
      return;
    }
    setSending(true);
    try {
      const value = toWeiHex(amount);
      const hash = await requestMetaMask<string>("eth_sendTransaction", [
        { from: address, to: ETH_DONATION_ADDRESS, value },
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
        Prefer to give straight from your own wallet? Send ETH (or any ERC-20 such as USDC) to the
        address below, or send Bitcoin to the BTC address. Nothing is held by the app — funds go
        directly to the community wallet.
      </p>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={amount === p ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setAmount(p)}
            >
              {p} ETH
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Amount in ETH"
            aria-label="Amount in ETH"
          />
          <Button type="button" onClick={send} disabled={sending || busy || !available} className="gap-2">
            <Send className="h-4 w-4" />
            {address ? "Send" : "Connect"}
          </Button>
        </div>
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

      <div className="grid gap-3 sm:grid-cols-2">
        <AddressRow label="ETH / USDC / ERC-20 (Ethereum)" address={ETH_DONATION_ADDRESS} />
        <AddressRow label="BTC (Bitcoin)" address={BTC_DONATION_ADDRESS} />
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bitcoin className="h-3.5 w-3.5" />
        Only send Bitcoin to the BTC address, and only Ethereum-network assets to the ETH address.
      </p>
    </Card>
  );
}
