

## Neural Network Technical Paper — MIT-Style Page + Settings Link

Create a new page at `/neural-network` styled like an academic research paper (MIT CSAIL / arXiv format) documenting the Imagination Network's neural architecture. Link it from the Settings doc list.

---

### New File: `src/pages/NeuralNetwork.tsx`

An academic-style document page with:

**Structure** (modeled after MIT technical reports):
- **Title block**: "Imagination: A Self-Organizing Neural Mesh for Decentralized Content Networks" — authors: "Swarm Space Research"
- **Abstract**: 150-word summary of the neural mesh architecture
- **1. Introduction**: What problem this solves (centralized social networks, single points of failure)
- **2. Architecture Overview**: Three-tier P2P stack, neural state engine, bell curve baselines — with a simple ASCII topology diagram
- **3. Neural State Engine**: Welford's online algorithm for behavior baselines, synapse weight model, interaction kinds, neuron state
- **4. Φ Transition Quality**: Phase detection (bootstrapping → stable → degraded → recovering), quality scoring, adaptive recommendations (tighten/relax)
- **5. Bell Curve Intelligence**: Z-score outlier detection, percentile routing, trust-weighted gossip paths
- **6. Instinct Hierarchy**: The 9 layers, how they prioritize network behavior
- **7. Dual Learning Fusion**: Pattern + language learner integration, content event scoring
- **8. Predictive Error Correction**: û(t+1) = Predict(u(t)), Q_Score formula, UQRC integration
- **9. Security Model**: In-memory vault, signaling envelope encryption, peer-gated mining
- **10. Conclusion & Future Work**: Content engagement, autonomous entity, cross-session memory coins

**Styling**:
- Serif-like feel using Tailwind (`font-serif` for headings, clean body text)
- Numbered sections with `§` prefix
- Equations rendered in monospace blocks
- Citations/references section at bottom
- Back button to navigate(-1)

---

### Modified Files

**`src/App.tsx`** — Add route:
```
import NeuralNetworkPage from "./pages/NeuralNetwork";
<Route path="/neural-network" element={<NeuralNetworkPage />} />
```

**`src/pages/Settings.tsx`** — Add to the docs list (line 750, after "About the Network"):
```
{ icon: Sparkles, label: "Neural Network Paper", desc: "Technical architecture of the mesh intelligence layer", path: "/neural-network" }
```

---

### Content Sources

All content derived from existing codebase — no fabrication:
- `neuralStateEngine.ts` — types, bell curve, Φ, synapse model
- `instinctHierarchy.ts` — 9 layers
- `dualLearningFusion.ts` — fusion snapshots
- `patternLearner.ts` / `languageLearner.ts` — learning models
- `docs/UQRC_BRAIN_MAP.md` — Q_Score formula
- Project knowledge — UQRC equations

