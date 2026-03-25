/**
 * NetworkEntityBridge — React component that attaches the Network Entity
 * to the swarm mesh when the mesh goes online, and detaches on unmount.
 *
 * Renders nothing — pure side-effect bridge.
 */

import { useEffect, useRef } from 'react';
import { getSwarmMeshStandalone } from '@/lib/p2p/swarmMesh.standalone';
import {
  getNetworkEntityBridge,
  destroyNetworkEntityBridge,
} from '@/lib/networkEntity/meshBridge';

export function NetworkEntityBridge() {
  const attachedRef = useRef(false);

  useEffect(() => {
    const mesh = getSwarmMeshStandalone();
    const bridge = getNetworkEntityBridge();

    // Attach when mesh is online
    const unsub = mesh.onPhaseChange((phase) => {
      if (phase === 'online' && !attachedRef.current) {
        bridge.attach(mesh);
        attachedRef.current = true;
      } else if (phase === 'off' && attachedRef.current) {
        bridge.detach();
        attachedRef.current = false;
      }
    });

    return () => {
      unsub();
      if (attachedRef.current) {
        destroyNetworkEntityBridge();
        attachedRef.current = false;
      }
    };
  }, []);

  return null;
}
