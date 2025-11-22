import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeBlockchainIntegration } from "./lib/blockchain";

// Initialize blockchain integration
initializeBlockchainIntegration();

createRoot(document.getElementById("root")!).render(<App />);
