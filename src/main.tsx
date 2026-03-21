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

// Auto-start the correct P2P mode based on persisted connection state
const connState = loadConnectionState();
if (connState.mode === 'swarm') {
  const mesh = getSwarmMeshStandalone();
  void mesh.autoStart();
} else {
  // Builder mode
  const bm = getStandaloneBuilderMode();
  void bm.autoStart();
}

// Test mode auto-starts independently from its own flags
const tm = getTestMode();
void tm.autoStart();

createRoot(document.getElementById("root")!).render(<App />);
