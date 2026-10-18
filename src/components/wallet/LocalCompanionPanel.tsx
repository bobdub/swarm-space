import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, Plug, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useP2PContext } from "@/contexts/P2PContext";
import { useAuth } from "@/hooks/useAuth";
import { COMPANION_URL, detectCompanion, runCompanionRelay, verifyCompanionRpc, type CompanionHealth } from "@/lib/blockchain/gateway/localCompanion";
import { getExternalMetaMaskProvider } from "@/lib/blockchain/wallets/metaMaskSdk";
import { SWARM_EVM_NETWORK } from "@/lib/blockchain/wallets/swarmEvmNetwork";
import { toast } from "sonner";

export function LocalCompanionPanel({ gatewayRunning }: { gatewayRunning: boolean }) {
  const { user } = useAuth();
  const { stats } = useP2PContext();
  const [health, setHealth] = useState<CompanionHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [paired, setPaired] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [rpcVerified, setRpcVerified] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const readyRef = useRef(false);
  const [meshOnline, setMeshOnline] = useState(false);

  // Read actual engine connections; dashboard aggregate counters are not readiness proof.
  useEffect(() => {
    let cancelled = false;
    void import("@/lib/p2p/swarmMesh.standalone").then(({ getSwarmMeshStandalone }) => {
      if (cancelled) return;
      const mesh = getSwarmMeshStandalone();
      setMeshOnline(mesh.getPhase() === "online" && mesh.getConnectedPeers().length > 0);
    });
    return () => { cancelled = true; };
  }, [stats]);
  const ready = gatewayRunning && !!user && meshOnline;
  readyRef.current = ready;

  const check = async () => {
    setChecking(true);
    try { setHealth(await detectCompanion()); setMessage(""); }
    catch { setHealth(null); setMessage("Not detected. Start your companion, then check again. Your browser may ask for local-network access."); }
    finally { setChecking(false); }
  };
  useEffect(() => { void check(); }, []);
  useEffect(() => {
    if (!ready) { controller.current?.abort(); setPaired(false); setPairing(false); }
  }, [ready]);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    let cancelled = false;
    setRpcVerified(false);
    if (paired && ready) {
      void verifyCompanionRpc().then(() => {
        if (!cancelled) setRpcVerified(true);
      }).catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "SWARM could not be verified.");
      });
    }
    return () => { cancelled = true; };
  }, [paired, ready]);

  const pair = async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPairing(true); setMessage("");
    try {
      const gateway = await import("@/lib/blockchain/gateway/swarmGatewayCell");
      await runCompanionRelay(code.trim(), abort.signal, async (request) => {
        if (!readyRef.current) throw new Error("The local mesh is not ready.");
        return gateway.handleRpc(request);
      }, () => { setPaired(true); setPairing(false); setCode(""); });
    } catch (error) {
      if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Pairing failed.");
    } finally {
      if (controller.current === abort) { setPaired(false); setPairing(false); }
    }
  };
  const install = async () => {
    setInstalling(true);
    try {
      await verifyCompanionRpc();
      const wallet = await getExternalMetaMaskProvider();
      if (!wallet?.request) throw new Error("Connect the desktop MetaMask extension first.");
      await wallet.request({ method: "wallet_addEthereumChain", params: [{ ...SWARM_EVM_NETWORK, rpcUrls: [`${COMPANION_URL}/rpc`] }] });
      toast.success("SWARM network request sent to MetaMask");
    } catch (error) { setMessage(error instanceof Error ? error.message : "MetaMask did not add the network."); }
    finally { setInstalling(false); }
  };

  return <section className="space-y-3 border-t border-border pt-4" aria-label="Local companion">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Local companion</h3>
      <Badge variant={paired ? "default" : "secondary"}>{paired ? "Paired · read-only" : health ? "Detected · not paired" : "Not detected"}</Badge>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={checking} onClick={() => void check()}>
        <RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />{checking ? "Checking…" : "Check companion"}
      </Button>
      {paired ? <Button type="button" size="sm" variant="outline" onClick={() => { controller.current?.abort(); setPaired(false); }}><Unplug className="mr-2 h-4 w-4" />Unpair</Button> : null}
    </div>
    {health && !paired && <div className="space-y-2">
      <Label htmlFor="companion-pairing-code">Companion pairing code</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="companion-pairing-code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from the companion window" className="min-w-0 flex-1" />
        <Button type="button" size="sm" disabled={!ready || !code || pairing} onClick={() => void pair()}><Plug className="mr-2 h-4 w-4" />{pairing ? "Pairing…" : "Pair companion"}</Button>
      </div>
      {!ready && <p className="text-xs text-muted-foreground">Sign in, connect MetaMask and connect to a mesh peer before pairing.</p>}
    </div>}
    {paired && !rpcVerified && <p className="text-xs text-muted-foreground">Verifying the paired SWARM chain…</p>}
    {paired && rpcVerified && <Button type="button" size="sm" disabled={installing || !ready} onClick={() => void install()}>{installing ? "Verifying SWARM…" : "Add local SWARM network to MetaMask"}</Button>}
    {message && <p role="status" className="break-words text-xs text-muted-foreground">{message}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" asChild><a href="/downloads/swarm-companion-windows-x64.exe" download><Download className="mr-2 h-4 w-4" />Windows x64</a></Button>
      <Button type="button" size="sm" variant="outline" asChild><a href="/downloads/swarm-companion-linux-x64.zip" download><Download className="mr-2 h-4 w-4" />Linux x64</a></Button>
      <Button type="button" size="sm" variant="ghost" asChild><a href="/downloads/swarm-companion-source.zip" download><Download className="mr-2 h-4 w-4" />Source &amp; tests</a></Button>
    </div>
    <p className="text-xs text-muted-foreground">Windows: open the downloaded app. Linux: extract, then open the executable; your desktop may require permission to run it. These downloads are unsigned.</p>
    <p className="text-xs text-muted-foreground">Keep this Node page and the companion open. Network reads use your online mesh; sending from MetaMask is not supported yet. No wallet keys are shared.</p>
  </section>;
}