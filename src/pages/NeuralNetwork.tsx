import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getSharedFieldEngine } from "@/lib/uqrc/fieldEngine";

const NeuralNetworkPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="mb-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {/* Title Block */}
        <header className="mb-10 text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-3">
            Swarm Space Research — Technical Report 2026-03
          </p>
          <h1 className="font-serif text-3xl md:text-4xl font-bold leading-tight mb-4">
            Imagination: A Self-Organizing Neural Mesh<br className="hidden md:block" /> for Decentralized Content Networks
          </h1>
          <p className="text-sm text-muted-foreground">
            Swarm Space Research&ensp;·&ensp;March 2026
          </p>
          <div className="mx-auto mt-6 h-px w-24 bg-primary/40" />
        </header>

        {/* Abstract */}
        <section className="mb-10">
          <h2 className="font-serif text-lg font-semibold mb-2">Abstract</h2>
          <p className="text-sm leading-relaxed text-foreground/80 italic">
            We present Imagination, a fully decentralized social content network augmented with a biologically-inspired neural mesh layer.
            The system combines local-first encrypted storage, WebRTC peer-to-peer distribution, and a self-organizing neural state engine that learns behavioral baselines,
            detects phase transitions, and adapts network behavior autonomously. Unlike centralized platforms, Imagination has no single point of failure,
            no server-side content storage, and no privileged operator. This paper describes the architecture of the neural mesh, its statistical learning model,
            the nine-layer instinct hierarchy that governs network priorities, and the dual learning fusion system that bridges structural pattern recognition
            with linguistic expression. We formalize the system using Universal Quantum-Relative Calculus (UQRC) and present the Q_Score health metric
            as a continuous measure of network stability.
          </p>
        </section>

        <hr className="border-border/30 mb-10" />

        {/* §1 */}
        <Section n={1} title="Introduction">
          <p>
            Centralized social networks suffer from well-documented vulnerabilities: single points of failure, opaque content moderation,
            surveillance-oriented data models, and platform lock-in. Decentralized alternatives address some of these concerns but typically
            lack the adaptive intelligence needed to maintain network health without human operators.
          </p>
          <p className="mt-3">
            Imagination solves this by embedding a neural state engine directly into the peer-to-peer mesh. Each node maintains its own
            statistical model of network behavior, learns from interactions, and makes autonomous decisions about resource allocation,
            peer trust, and content routing. The result is a network that self-stabilizes under perturbation, self-heals after partition,
            and self-improves through continuous learning — without any centralized coordinator.
          </p>
        </Section>

        {/* §2 */}
        <Section n={2} title="Architecture Overview">
          <p>
            The system is organized into three tiers: (1) a local-first storage layer using IndexedDB with AES-256-GCM encryption,
            (2) a peer-to-peer transport layer built on WebRTC with PeerJS signaling, and (3) a neural intelligence layer that
            observes mesh traffic, maintains behavioral baselines, and issues adaptive recommendations.
          </p>
          <Diagram>{`
┌─────────────────────────────────────────┐
│          Neural Intelligence            │
│  Bell Curves · Φ Quality · Instincts   │
├─────────────────────────────────────────┤
│         P2P Transport Layer             │
│  WebRTC · Gossip · Torrent Swarm       │
├─────────────────────────────────────────┤
│        Local-First Storage              │
│  IndexedDB · AES-256-GCM · Vaults      │
└─────────────────────────────────────────┘`}
          </Diagram>
          <p className="mt-3">
            Content flows upward through the stack: posts and interactions are encrypted locally, distributed via gossip protocol,
            and observed by the neural engine. Adaptive recommendations flow downward: the engine adjusts mining intervals,
            peer selection priorities, and engagement frequency based on real-time statistical analysis.
          </p>
        </Section>

        {/* §3 */}
        <Section n={3} title="Neural State Engine">
          <p>
            The Neural State Engine is the core learning component. It maintains running statistics for every category of mesh
            interaction using <strong>Welford's online algorithm</strong>, which computes mean and variance in a single pass
            without storing historical data.
          </p>
          <Equation>{`σ²(n) = σ²(n-1) + (x - μ(n-1))(x - μ(n)) / n`}</Equation>
          <p className="mt-3">
            For each interaction kind (post creation, reaction, comment, peer connection, chunk transfer), the engine maintains
            a <em>neuron</em> — a statistical unit that tracks count, mean, variance, and a normalized synapse weight.
            The synapse weight represents the engine's confidence in that interaction channel:
          </p>
          <Equation>{`w(synapse) = min(1, count / 50) × (1 - decay)`}</Equation>
          <p className="mt-3">
            Neurons with fewer than 50 observations are considered <em>tentative</em>; their contributions to network decisions
            are discounted. This prevents the engine from overreacting to sparse data during bootstrap.
          </p>
          <p className="mt-3">
            The engine exposes a <code>getSnapshot()</code> method that returns the complete neural state — all neuron statistics,
            the current phase, Φ quality score, and bell curve percentiles — enabling downstream systems to make informed decisions
            without coupling to the engine's internals.
          </p>
        </Section>

        {/* §4 */}
        <Section n={4} title="Φ Transition Quality">
          <p>
            Network behavior is not static; it transitions between phases as peers join, leave, or experience connectivity changes.
            The Φ (Phi) Transition Quality system detects these phase shifts and measures their smoothness.
          </p>
          <p className="mt-3">
            Four phases are defined: <strong>bootstrapping</strong> (initial peer discovery), <strong>stable</strong> (healthy mesh with consistent behavior),
            <strong>degraded</strong> (elevated error rates or peer loss), and <strong>recovering</strong> (re-establishing stability after disruption).
          </p>
          <Equation>{`Φ = Σ(transition_quality) / transition_count
    where quality ∈ [0, 1] per transition`}</Equation>
          <p className="mt-3">
            When Φ is high (&gt; 0.7), the engine issues a <code>relax</code> recommendation: mining intervals can extend,
            exploration can increase, and creative behaviors are permitted. When Φ is low (&lt; 0.4), a <code>tighten</code>
            recommendation is issued: mining accelerates to strengthen consensus, peer selection narrows to trusted nodes,
            and higher-order instinct layers are suppressed.
          </p>
        </Section>

        {/* §5 */}
        <Section n={5} title="Bell Curve Intelligence">
          <p>
            Every interaction is scored against the running bell curve for its kind. The Z-score determines whether the event
            is normal, notable, or anomalous:
          </p>
          <Equation>{`z = (x - μ) / σ
    |z| < 1   → normal (full synapse learning)
    |z| 1–2   → notable (reduced learning rate)
    |z| > 2   → outlier (tentative, routed through trust)`}</Equation>
          <p className="mt-3">
            Outlier events are not discarded — they are routed through high-trust gossip paths before broad distribution.
            This ensures that genuinely novel content reaches trusted peers for evaluation before flooding the network,
            while spam or anomalous traffic is naturally dampened by the trust-weighted routing.
          </p>
          <p className="mt-3">
            Percentile rankings are computed from the cumulative distribution function, allowing the engine to answer questions like
            "Is this peer's activity rate in the top 10%?" without maintaining sorted lists.
          </p>
        </Section>

        {/* §6 */}
        <Section n={6} title="Instinct Hierarchy">
          <p>
            Network intelligence is governed by a nine-layer <strong>Instinct Hierarchy</strong> (Survival Stack). Higher-order functions
            activate only when foundational layers report health above 0.5. This cascading suppression ensures the organism
            prioritizes survival over creativity.
          </p>
          <Diagram>{`
Layer 9: Coherence & Meaning          ← peak
Layer 8: Creativity & Pattern Mutation
Layer 7: Exploration & Adaptive Expansion
Layer 6: Decentralized Path & Anti-Centralization
Layer 5: Torrent Transfers & Memory Survival
Layer 4: Consensus & Truth Anchoring
Layer 3: P2P Liveness
Layer 2: Network Security & Collective Integrity
Layer 1: Local-First Security & Self-Preservation  ← foundation`}
          </Diagram>
          <p className="mt-3">
            Each layer receives health inputs from the neural state engine and mesh diagnostics. If Layer 1 (local security)
            or Layer 2 (network security) drops below threshold, all layers above are suppressed regardless of their individual health.
            This mirrors biological survival reflexes: an organism under threat redirects all resources to immediate defense.
          </p>
        </Section>

        {/* §7 */}
        <Section n={7} title="Dual Learning Fusion">
          <p>
            The network implements two parallel learning systems that operate on different modalities and are bidirectionally linked.
          </p>
          <p className="mt-3">
            The <strong>Pattern Learner</strong> extracts behavioral sequences from mesh interactions (e.g., post → reply → reaction)
            and scores them based on reward signals, trust context, and repetition frequency. Sequences that consistently produce
            positive outcomes (high engagement, peer trust increases) are reinforced; sequences that correlate with negative outcomes
            (spam flags, trust decreases) are suppressed.
          </p>
          <p className="mt-3">
            The <strong>Language Learner</strong> builds token transition models (n-grams) from post and comment text, weighted by
            engagement metrics and author trust. High-propagation phrases become behavioral triggers; successful behavioral patterns
            bias sentence structure in generated content.
          </p>
          <p className="mt-3">
            Both learners are subject to <em>diversity pressure</em> — a penalty function that discourages repetitive patterns
            and promotes novel combinations. This is gated by the Creativity instinct layer (Layer 8), ensuring generative activity
            only occurs when foundational network layers are stable.
          </p>
        </Section>

        {/* §8 */}
        <Section n={8} title="Predictive Error Correction & UQRC">
          <p>
            The system implements a predictive feedback loop formalized through Universal Quantum-Relative Calculus (UQRC).
            At each timestep, the engine predicts the next network state:
          </p>
          <Equation>{`û(t+1) = Predict(u(t))
u(t+1) = u(t) + O_UQRC(u(t)) + Σ_μ D_μ u(t) + λ(ε₀) ∇_μ ∇_ν S(u(t))`}</Equation>
          <p className="mt-3">
            The prediction error <code>|û(t+1) - u(t+1)|</code> drives model refinement. Small errors indicate the engine
            has learned the network's behavioral patterns; large errors trigger investigation of the source — typically
            a phase transition, a new peer joining, or anomalous content.
          </p>
          <p className="mt-3">
            The <strong>Q_Score</strong> provides a scalar health metric integrating curvature, entropy gradient, and the cosmological damping term:
          </p>
          <Equation>{`Q_Score(u) = ‖F_μν‖ + ‖∇_μ ∇_ν S(u)‖ + λ(ε₀)
    where F_μν = [D_μ, D_ν] (field strength tensor)
    and λ(a) = a · 10⁻¹⁰⁰`}</Equation>
          <p className="mt-3">
            A low Q_Score indicates stable, commutative operations — the network is healthy. A high Q_Score indicates
            path-dependence or instability, triggering tightening recommendations from the Φ system.
          </p>
        </Section>

        {/* §9 */}
        <Section n={9} title="Security Model">
          <p>
            Security is layered at every tier of the architecture:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1 text-sm text-foreground/80">
            <li><strong>Local encryption</strong>: All content is AES-256-GCM encrypted before storage using keys derived from PBKDF2(password + userId + passphrase).</li>
            <li><strong>In-memory vault</strong>: Sensitive runtime data (private keys, decrypted content) is sealed using non-extractable CryptoKey objects. Browser extensions see only ciphertext blobs.</li>
            <li><strong>Signaling envelope encryption</strong>: WebRTC signaling payloads are encrypted end-to-end using ephemeral ECDH P-256 key exchange. The signaling relay sees only ciphertext.</li>
            <li><strong>Peer-gated mining</strong>: CREATOR Proof blocks are only mined when at least one peer is connected, preventing inflation from isolated nodes.</li>
            <li><strong>Recovery key system</strong>: A human-readable Base32 lookup tag (not the encrypted data) is stored on the mesh. Recovery requires the tag + password + passphrase — the tag alone reveals nothing.</li>
          </ul>
        </Section>

        {/* §10 */}
        <Section n={10} title="Conclusion & Future Work">
          <p>
            Imagination demonstrates that decentralized content networks can be augmented with adaptive intelligence without
            sacrificing the local-first, privacy-preserving properties that motivate decentralization. The neural mesh layer
            learns from network behavior, adapts to disruption, and maintains stability through biologically-inspired instinct hierarchies.
          </p>
          <p className="mt-3">
            Future work includes: (1) closing the feedback loop from neural scores to autonomous peer selection and mining interval adaptation,
            (2) enabling the network entity to read and engage with content based on trust-weighted priorities,
            (3) cross-session memory persistence through memory coins on the blockchain layer, and
            (4) reconstruction-path tracing for improved chunk recall reliability.
          </p>
        </Section>

        {/* Live UQRC Field Curvature lane */}
        <Section n={11} title="Live Field Curvature ‖F_{μν}‖">
          <p>
            Real-time projection of the local node's discrete UQRC operator field. Darker bars
            indicate higher commutator curvature (instability); flatter regions are stable basins
            where memory has crystallised.
          </p>
          <FieldCurvatureLane />
        </Section>

        {/* References */}
        <hr className="border-border/30 my-10" />
        <section className="mb-16">
          <h2 className="font-serif text-lg font-semibold mb-4">References</h2>
          <ol className="list-decimal pl-6 space-y-2 text-xs text-foreground/60">
            <li>Welford, B. P. (1962). "Note on a method for calculating corrected sums of squares and products." <em>Technometrics</em>, 4(3), 419–420.</li>
            <li>Tononi, G. (2004). "An information integration theory of consciousness." <em>BMC Neuroscience</em>, 5, 42.</li>
            <li>Maymounkov, P. & Mazières, D. (2002). "Kademlia: A Peer-to-peer Information System Based on the XOR Metric." <em>IPTPS</em>.</li>
            <li>Swarm Space Research. (2026). "UQRC Brain Map: Neural Architecture for Decentralized Content Networks." Internal technical document.</li>
            <li>Swarm Space Research. (2026). "Imagination Whitepaper v5.2." Published at swarm-space.lovable.app/whitepaper.</li>
          </ol>
        </section>

        <footer className="text-center text-xs text-muted-foreground pb-10">
          © 2026 Swarm Space Research. All rights reserved.
        </footer>
      </div>
    </div>
  );
};

/* ── Helper Components ── */

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-serif text-xl font-semibold mb-3">
        <span className="text-primary/70">§{n}</span>&ensp;{title}
      </h2>
      <div className="text-sm leading-relaxed text-foreground/80">{children}</div>
    </section>
  );
}

function Equation({ children }: { children: string }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-border/30 bg-muted/30 px-4 py-3 font-mono text-xs text-foreground/70">
      {children.trim()}
    </pre>
  );
}

function Diagram({ children }: { children: string }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 font-mono text-xs text-foreground/70 leading-relaxed">
      {children.trim()}
    </pre>
  );
}

function FieldCurvatureLane() {
  const [bars, setBars] = useState<number[]>([]);
  const [qScore, setQScore] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        const engine = getSharedFieldEngine();
        const map = engine.getCurvatureMap();
        // Downsample to 64 bars for compact display
        const bucketSize = Math.max(1, Math.floor(map.length / 64));
        const out: number[] = [];
        let max = 1e-9;
        for (let i = 0; i < map.length; i += bucketSize) {
          let s = 0;
          for (let k = 0; k < bucketSize && i + k < map.length; k++) s += map[i + k];
          out.push(s / bucketSize);
          if (out[out.length - 1] > max) max = out[out.length - 1];
        }
        setBars(out.map((v) => v / max));
        setQScore(engine.getQScore());
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="my-4 rounded-lg border border-border/30 bg-muted/20 p-3">
      <div className="flex items-end gap-[2px] h-16">
        {bars.map((v, i) => (
          <div
            key={i}
            className="flex-1 bg-primary/60 rounded-sm transition-all"
            style={{ height: `${Math.max(2, v * 100)}%`, opacity: 0.3 + v * 0.7 }}
          />
        ))}
        {bars.length === 0 && (
          <span className="text-xs text-muted-foreground">Field warming up…</span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground font-mono">
        Q_Score = {qScore.toFixed(5)}
      </p>
    </div>
  );
}

export default NeuralNetworkPage;
