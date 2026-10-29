import { useEffect } from "react";
import { useAuthReady } from "@/hooks/useAuthReady";
import { isGuestUser } from "@/lib/preview/guestAccess";
import { getMintMeMinerEnabled, onMintMeMinerEnabledChange } from "@/lib/mining/mintmeMinerPreference";

/** One app-wide owner; page navigation never starts duplicate workers or stops a live miner. */
export function MintMeMiningService() {
  const { user, isReady } = useAuthReady();
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    if (!isReady || !user || isGuestUser(user)) return;
    void Promise.all([
      import("@/lib/p2p/swarmMesh.standalone"),
      import("@/lib/blockchain/mintmeMiner/miner"),
      import("@/lib/blockchain/mintmeMiner/miningCell"),
    ]).then(([meshModule, minerModule, cellModule]) => {
      if (cancelled) return;
      const mesh = meshModule.getSwarmMeshStandalone();
      const miner = minerModule.getMintMeMiner();
      const cell = cellModule.getMintMeMiningCell();
      let lastEndpoint: string | null = null;
      let attemptedContext = "";
      const reconcile = () => {
        if (!getMintMeMinerEnabled()) { attemptedContext = ""; cell.stop(); miner.stop("off"); return; }
        const peers = mesh.getConnectedPeers();
        if (mesh.getPhase() !== "online" || !peers.length) {
          attemptedContext = ""; cell.stop(); miner.stop("needs-mesh", "Waiting for a mesh connection."); return;
        }
        const peerId = mesh.getPeerId();
        if (!peerId) return;
        void cell.start(peerId, peers).catch(() => {
          if (!cancelled) miner.stop("needs-proxy", "Community mining discovery is unavailable.");
        });
        const endpoint = cell.selectedEndpoint;
        if (endpoint !== lastEndpoint) { miner.stop(); lastEndpoint = endpoint; }
        const context = `${peerId}:${endpoint ?? ""}`;
        if (attemptedContext === context) return;
        attemptedContext = context;
        miner.start({ peerId, mesh, proxyUrl: endpoint });
      };
      // Cell callbacks only reconcile mining, avoiding recursive discovery starts.
      const onEndpoint = () => {
        const endpoint = cell.selectedEndpoint;
        if (endpoint === lastEndpoint) return;
        lastEndpoint = endpoint;
        miner.stop();
        if (getMintMeMinerEnabled() && mesh.getPhase() === "online" && mesh.getConnectedPeers().length) {
          attemptedContext = `${mesh.getPeerId()}:${endpoint ?? ""}`;
          miner.start({ peerId: mesh.getPeerId(), mesh, proxyUrl: endpoint });
        }
      };
      const unsubs = [cell.subscribe(onEndpoint), mesh.onPeersChange(reconcile), mesh.onPhaseChange(reconcile), onMintMeMinerEnabledChange(reconcile)];
      reconcile();
      cleanup = () => { unsubs.forEach(unsub => unsub()); cell.stop(); miner.stop(); };
    });
    return () => { cancelled = true; cleanup(); };
  }, [isReady, user?.id]);

  // Community payouts run for every signed-in member on the mesh, mining or not.
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    if (!isReady || !user || isGuestUser(user)) return;
    void Promise.all([
      import("@/lib/p2p/swarmMesh.standalone"),
      import("@/lib/blockchain/mintmeMiner/communityPayoutService"),
    ]).then(async ([meshModule, payoutModule]) => {
      if (cancelled) return;
      const mesh = meshModule.getSwarmMeshStandalone();
      const payout = await payoutModule.createMeshCommunityPayout(mesh);
      if (cancelled) return;
      payout.start();
      const tick = () => { if (mesh.getPhase() === "online") void payout.tick().catch(() => {}); };
      const timer = window.setInterval(tick, 60_000);
      const unsub = mesh.onPeersChange(tick);
      tick();
      cleanup = () => { window.clearInterval(timer); unsub(); payout.stop(); };
    }).catch(() => {});
    return () => { cancelled = true; cleanup(); };
  }, [isReady, user?.id]);
  return null;
}