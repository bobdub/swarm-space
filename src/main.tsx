import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeBlockchainIntegration } from "./lib/blockchain";
import { getTestMode } from "./lib/p2p/testMode.standalone";
import { getSwarmMeshStandalone } from "./lib/p2p/swarmMesh.standalone";
import { getStandaloneBuilderMode } from "./lib/p2p/builderMode.standalone";
import { loadConnectionState } from "./lib/p2p/connectionState";

// Initialize blockchain integration
initializeBlockchainIntegration();

// Auto-start the correct P2P mode based on persisted connection state.
// Only ONE mode may run at a time — they share the same peer-{nodeId}
// identity and running two causes PeerJS ID collisions.
const connState = loadConnectionState();
if (connState.enabled) {
  // A production mode is flagged on — start it, skip test mode
  if (connState.mode === 'swarm') {
    const mesh = getSwarmMeshStandalone();
    void mesh.autoStart();
  } else {
    const bm = getStandaloneBuilderMode();
    void bm.autoStart();
  }
} else {
  // No production mode active — allow test mode to auto-start
  // only if its own internal flags say enabled
  const tm = getTestMode();
  void tm.autoStart();
}

createRoot(document.getElementById("root")!).render(<App />);
