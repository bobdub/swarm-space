import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNativeWalletAddress } from "@/hooks/useNativeWalletAddress";
import { toast } from "sonner";

const short = (value: string) => (value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value);

export function NativeWalletAddress({ userId }: { userId: string }) {
  const nativeAddress = useNativeWalletAddress(userId);
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(() => toast.success("Wallet address copied"))
      .catch(() => toast.error("Could not copy wallet address"));
  };
  if (!userId) return null;
  return (
    <section aria-label="Wallet addresses" className="mb-6 min-w-0 space-y-3 border-b border-border pb-4">
      <div>
        <h2 className="text-sm font-semibold">Native SWARM wallet address</h2>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary" data-testid="native-wallet-address" title={nativeAddress || undefined}>{nativeAddress ? (<><span className="sm:hidden">{short(nativeAddress)}</span><span className="hidden sm:inline">{nativeAddress}</span></>) : "Loading address…"}</span>
          <Button type="button" size="icon" variant="ghost" className="shrink-0" disabled={!nativeAddress} aria-label="Copy native SWARM wallet address" title="Copy native SWARM wallet address" onClick={() => copy(nativeAddress)}><Copy className="h-4 w-4" /></Button>
        </div>
      </div>
    </section>
  );
}
