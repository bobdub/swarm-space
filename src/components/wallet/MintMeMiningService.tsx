import { useEffect } from "react";
import { useAuthReady } from "@/hooks/useAuthReady";
import { isGuestUser } from "@/lib/preview/guestAccess";
import { getMintMeBridgeUrl, getMintMeMinerEnabled, onMintMeMinerEnabledChange } from "@/lib/mining/mintmeMinerPreference";

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
      import("@/lib/storage/providers/personalServerStore"),
    ]).then(([meshModule, minerModule, serverStore]) => {
      if (cancelled) return;
      const mesh = meshModule.getSwarmMeshStandalone();
      const miner = minerModule.getMintMeMiner();
      let attemptedContext = "";
      const reconcile = () => {
        if (!getMintMeMinerEnabled()) { attemptedContext = ""; miner.stop("off"); return; }
        // Mining runs only through the bridge on the user's own personal server.
        const endpoint = getMintMeBridgeUrl();
        if (!endpoint) {
          attemptedContext = "";
          miner.stop("needs-proxy", "Attach a public personal server to mine. Find it in Settings → Storage → Personal Servers.");
          return;
        }
        const peers = mesh.getConnectedPeers();
        if (mesh.getPhase() !== "online" || !peers.length) {
          attemptedContext = ""; miner.stop("needs-mesh", "Waiting for a mesh connection."); return;
        }
        const peerId = mesh.getPeerId();
        if (!peerId) return;
        const context = `${peerId}:${endpoint}`;
        if (attemptedContext === context) return;
        if (attemptedContext) miner.stop();
        attemptedContext = context;
        miner.start({ peerId, mesh, proxyUrl: endpoint });
      };
      const unsubs = [
        mesh.onPeersChange(reconcile), mesh.onPhaseChange(reconcile), onMintMeMinerEnabledChange(reconcile),
        serverStore.subscribePersonalServers(reconcile),
      ];
      reconcile();
      cleanup = () => { unsubs.forEach(unsub => unsub()); miner.stop(); };
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
      const claims = await (await import("@/lib/blockchain/mintmeMiner/autoClaim")).createMeshAutoClaim(mesh);
      if (cancelled) return;
      payout.start(); claims.start();
      const tick = () => { if (mesh.getPhase() === "online") { void payout.tick().catch(() => {}); void claims.tick().catch(() => {}); } };
      const timer = window.setInterval(tick, 60_000);
      const unsub = mesh.onPeersChange(tick);
      tick();
      cleanup = () => { window.clearInterval(timer); unsub(); payout.stop(); claims.stop(); };
    }).catch(() => {});
    return () => { cancelled = true; cleanup(); };
  }, [isReady, user?.id]);

  // Direct MintMe deposits (no MetaMask): credit what arrived at the native receiving address.
  useEffect(() => {
    if (!isReady || !user || isGuestUser(user)) return;
    let cancelled = false;
    const uid = user.id;
    let syncing = false;
    const sync = async () => {
      if (cancelled || syncing) return;
      syncing = true;
      const notify = async (credited: number, symbol: string) => {
        if (cancelled || credited <= 0) return;
        const { notifySystem } = await import("@/lib/notifications");
        if (!cancelled) {
          await notifySystem({
            userId: uid,
            type: "wallet_deposit",
            title: `${credited} ${symbol} arrived.`,
            content: "The deposit is in your native wallet.",
            link: "/wallet",
            linkLabel: "Open wallet",
          });
        }
      };
      try {
        const [native, custom] = await Promise.all([
          import("@/lib/blockchain/wallets/nativeMintmeDirect"),
          import("@/lib/blockchain/deposits/customTokens"),
        ]);
        if (cancelled) return;
        await native.syncNativeMintMeDeposits(uid).then(n => notify(n, "MINTME"))
          .catch(e => console.warn("[wallet] MINTME deposit check failed", e));
        await custom.hydrateCustomTokens(uid);
        for (const token of custom.listCustomTokens(uid)) {
          if (cancelled) break;
          await custom.syncCustomTokenDeposits(uid, custom.customTokenRef(token)).then(n => notify(n, token.symbol))
            .catch(e => console.warn(`[wallet] ${token.symbol} deposit check failed`, e));
        }
      } catch { /* locked vault or MintMe unreachable: retry next tick */ }
      finally { syncing = false; }
    };
    const first = window.setTimeout(sync, 5_000);
    const timer = window.setInterval(sync, 120_000);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [isReady, user?.id]);
  return null;
}