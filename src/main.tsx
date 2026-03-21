import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeBlockchainIntegration } from "./lib/blockchain";
import { getTestMode } from "./lib/p2p/testMode.standalone";

// Initialize blockchain integration
initializeBlockchainIntegration();

// Auto-start Test Mode if flags say enabled (persists across refresh)
const tm = getTestMode();
void tm.autoStart();

createRoot(document.getElementById("root")!).render(<App />);
