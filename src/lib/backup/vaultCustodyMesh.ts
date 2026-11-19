/**
 * Attaches the recovery-vault custody protocol to the standalone Swarm Mesh.
 * Idempotent: boot (main.tsx) and the /recover page both call it.
 */
import { getSwarmMeshStandalone } from "../p2p/swarmMesh.standalone";
import { getCurrentUser } from "../auth";
import { isGuestUser } from "../preview/guestAccess";
import { isAccountRetired, onAccountRetired } from "../p2p/contentLifecycle";
import {
  isVaultCustodyAttached,
  onCustodyAck,
  retireHeldVault,
  setVaultRetirementCheck,
  startVaultCustody,
  type CustodyAckEvent,
} from "./vaultCustody";

/**
 * Quiet in-feed notice (no toast, no modal) the first time a peer confirms it
 * holds the current shell version — one per version, not one per peer.
 */
export async function notifyRecoveryReady(event: CustodyAckEvent): Promise<void> {
  if (!event.firstForVersion) return;
  const { createNotification } = await import("../notifications");
  const peerName = event.peerName || event.peerId;
  await createNotification({
    userId: event.userId,
    type: "recovery_ready",
    triggeredBy: event.peerId,
    triggeredByName: peerName,
    content: `Your encrypted recovery vault was safely received by peer ${peerName}. Tap to view your Recovery Link.`,
    link: "/settings#security",
  });
}

export function attachVaultCustodyToMesh(): void {
  if (isVaultCustodyAttached()) return;
  const mesh = getSwarmMeshStandalone();
  onCustodyAck((event) => { void notifyRecoveryReady(event).catch(() => { /* notification store busy */ }); });
  // A signed account tombstone (e.g. the retiring side of an account merge)
  // closes that identity's recovery vault here: drop it, never serve it again.
  setVaultRetirementCheck((userId) => isAccountRetired(userId));
  onAccountRetired((userId) => { void retireHeldVault(userId).catch(() => { /* store busy */ }); });
  startVaultCustody({
    transport: mesh,
    getActiveUserId: () => {
      const me = getCurrentUser();
      return me && !isGuestUser(me) ? me.id : null;
    },
    getPeerName: (peerId) => {
      const entry = mesh.getLibrary().find((p) => p.peerId === peerId);
      return entry?.displayName || entry?.username || undefined;
    },
  });
}
