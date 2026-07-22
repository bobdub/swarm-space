import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link2, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { chainLabel, shortAddr, useMetaMask } from "@/hooks/useMetaMask";

interface Props {
  compact?: boolean;
  className?: string;
}

export function MetaMaskConnectButton({ compact = false, className }: Props) {
  const { available, address, chainId, busy, connect, disconnect } = useMetaMask();

  if (!available) {
    return (
      <Button
        variant="outline"
        size={compact ? "sm" : "default"}
        className={className}
        onClick={() => window.open("https://metamask.io/download/", "_blank", "noreferrer")}
      >
        <Link2 className="mr-2 h-4 w-4" />
        {compact ? "Install MetaMask" : "Install MetaMask"}
      </Button>
    );
  }

  if (!address) {
    return (
      <Button
        size={compact ? "sm" : "default"}
        className={className}
        onClick={async () => {
          await connect();
        }}
        disabled={busy}
      >
        <Link2 className="mr-2 h-4 w-4" />
        {busy ? "Connecting…" : "Connect MetaMask"}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={compact ? "sm" : "default"} className={className}>
          <Link2 className="mr-2 h-4 w-4" />
          <span className="tabular-nums">{shortAddr(address)}</span>
          <Badge variant="secondary" className="ml-2 text-[9px]">
            {chainLabel(chainId)}
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">
          <div className="font-medium">Connected wallet</div>
          <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{address}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">{chainLabel(chainId)}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await connect();
            toast.success("MetaMask reconnected");
          }}
        >
          <Link2 className="mr-2 h-4 w-4" /> Reconnect
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            disconnect();
            toast.message("MetaMask forgotten locally", {
              description: "The extension still remembers this site — use MetaMask to fully revoke.",
            });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Forget locally
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}