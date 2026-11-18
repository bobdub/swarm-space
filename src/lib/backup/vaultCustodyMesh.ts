/**
 * Attaches the recovery-vault custody protocol to the standalone Swarm Mesh.
 * Idempotent: boot (main.tsx) and the /recover page both call it.
 */
import { getSwarmMeshStandalone } from "../p2p/swarmMesh.standalone";
import { getCurrentUser } from "../auth";
import { isGuestUser } from "../preview/guestAccess";
import { isVaultCustodyAttached, startVaultCustody } from "./vaultCustody";

export function attachVaultCustodyToMesh(): void {
  if (isVaultCustodyAttached()) return;
  const mesh = getSwarmMeshStandalone();
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
