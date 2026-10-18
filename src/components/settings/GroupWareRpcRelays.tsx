import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Server } from "lucide-react";
import { toast } from "sonner";
import { getGroupWareNode, type GroupWareSnapshot } from "@/lib/groupware/groupwareNode";
import { addSwarmNetworkToMetaMask, verifySwarmPublicRpc } from "@/lib/blockchain/wallets/swarmEvmNetwork";

type Check = "idle" | "checking" | "ok" | "fail";

/** Lists GroupWare Personal Servers advertising a public SWARM RPC; each is preflighted before MetaMask is asked. */
export function GroupWareRpcRelays({ metaMaskConnected }: { metaMaskConnected: boolean }) {
  const [snap, setSnap] = useState<GroupWareSnapshot | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  useEffect(() => {
    const node = getGroupWareNode();
    node.start();
    return node.subscribe(setSnap);
  }, []);

  const relays = useMemo(() => {
    const list = (snap?.nodes ?? []).filter((n) => n.rpcUrl).map((n) => ({ id: n.nodeId, name: n.name, url: n.rpcUrl!, own: false }));
    const h = snap?.host;
    if (h?.enabled && h.rpcUrl) list.unshift({ id: h.nodeId, name: `${h.name} (yours)`, url: h.rpcUrl, own: true });
    return list;
  }, [snap]);

  const setCheck = (url: string, c: Check) => setChecks((p) => ({ ...p, [url]: c }));

  const check = async (url: string) => {
    setCheck(url, "checking");
    try { await verifySwarmPublicRpc(url); setCheck(url, "ok"); return true; }
    catch (e) { setCheck(url, "fail"); toast.error(e instanceof Error ? e.message : "Relay did not answer"); return false; }
  };

  const add = async (url: string) => {
    try { await addSwarmNetworkToMetaMask(url); setCheck(url, "ok"); toast.success("SWARM network sent to MetaMask"); }
    catch (e) { setCheck(url, "fail"); toast.error(e instanceof Error ? e.message : "Could not add network"); }
  };

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Server className="h-4 w-4" /> Personal Server relays
      </div>
      <p className="text-[11px] text-muted-foreground">
        Always-on Personal Servers shared through GroupWare can host the SWARM network for MetaMask. Nothing to download.
      </p>
      {relays.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground">
          No relays on the mesh yet. Hosts can add one in Settings → Storage → GroupWare.
        </p>
      ) : (
        <ul className="space-y-1">
          {relays.map((r) => {
            const c = checks[r.url] ?? "idle";
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{r.name}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{r.url}</div>
                </div>
                <Badge variant={c === "ok" ? "default" : c === "fail" ? "destructive" : "secondary"} className="text-[10px]">
                  {c === "ok" ? "Reachable" : c === "fail" ? "Unreachable" : c === "checking" ? "Checking…" : "Unchecked"}
                </Badge>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" disabled={c === "checking"} onClick={() => void check(r.url)}>
                    Check
                  </Button>
                  <Button type="button" size="sm" className="h-7 text-[11px]" disabled={!metaMaskConnected || c === "checking"} onClick={() => void add(r.url)}>
                    Add to MetaMask
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
