import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNativeWalletAddress } from "@/hooks/useNativeWalletAddress";
import { getColdKeyReceivingAddress } from "@/lib/blockchain/wallets/coldKey";
import { toast } from "sonner";

const short = (value: string) => (value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value);

export function NativeWalletAddress({ userId, network = "swarm" }: { userId: string; network?: string }) {
  const nativeAddress = useNativeWalletAddress(userId);
  const isMintMe = network === "mintme";
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  useEffect(() => {
    if (!isMintMe || !userId) return;
    let active = true;
    void getColdKeyReceivingAddress(userId)
      .then((a) => { if (active) setEvmAddress(a); })
      .catch(() => { if (active) setEvmAddress(null); });
    return () => { active = false; };
  }, [isMintMe, userId]);

  const address = (isMintMe ? evmAddress : nativeAddress) || "";
  const heading = isMintMe ? "MintMe receiving address" : "Native SWARM wallet address";
  const hint = isMintMe
    ? "Only send from wallets that support the MintMe chain."
    : "Only transfer to online peers on SWARM.";
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(() => toast.success("Wallet address copied"))
      .catch(() => toast.error("Could not copy wallet address"));
  };
  if (!userId) return null;
  return (
    <section aria-label="Wallet addresses" className="mb-6 min-w-0 space-y-3 border-b border-border pb-4">
      <div>
        <h2 className="text-sm font-semibold" title={hint}>{heading}</h2>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary" data-testid="native-wallet-address" title={address || undefined}>{address ? (<><span className="sm:hidden">{short(address)}</span><span className="hidden sm:inline">{address}</span></>) : "Loading address…"}</span>
          <Button type="button" size="icon" variant="ghost" className="shrink-0" disabled={!address} aria-label={`Copy ${heading}`} title={`Copy ${heading}`} onClick={() => copy(address)}><Copy className="h-4 w-4" /></Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
    </section>
  );
}
