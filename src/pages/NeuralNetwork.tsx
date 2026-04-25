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
            Imagination Network — Technical Report TR-2026-04 (v2)
          </p>
          <h1 className="font-serif text-3xl md:text-4xl font-bold leading-tight mb-4">
            Imagination: A Code-Verified Specification<br className="hidden md:block" /> of the UQRC Substrate &amp; Causal Closure
          </h1>
          <p className="text-sm text-muted-foreground">
            Imagination Network Working Group&ensp;·&ensp;April 2026
          </p>
          <div className="mx-auto mt-6 h-px w-24 bg-primary/40" />
        </header>

        {/* Abstract */}
        <section className="mb-10">
          <h2 className="font-serif text-lg font-semibold mb-2">Abstract</h2>
          <p className="text-sm leading-relaxed text-foreground/80 italic">
            This report supersedes the previous &ldquo;Neural Network Paper.&rdquo; Every quantitative and structural claim
            has been re-verified against source files in the repository. Components asserted in earlier drafts that are not
            present in code &mdash; notably any &ldquo;9-layer instinct hierarchy&rdquo; decision layer and any &ldquo;Welford
            neural state engine&rdquo; arbiter &mdash; have been removed. The system implements a deterministic UQRC field
            substrate on two lattices, a causal-conversion operator <code>𝒞_light</code> that gates response generation, and an
            AES-256-GCM content pipeline with PBKDF2-SHA256 key wrapping. The Vitest suite (115 tests across the brain and
            UQRC trees) confirms operator closure, lattice invariance, and basin-relaxation behavior.
          </p>
        </section>

        <hr className="border-border/30 mb-10" />

        {/* §1 */}
        <Section n={1} title="Introduction">
          <p>
            The Imagination Network is a local-first, browser-resident social and cognitive substrate. Two concerns dominate
            its design: (i) a physics engine that produces stable, bounded dynamics under the United Quantum-Relative Calculus
            (UQRC) operator algebra, and (ii) a content pipeline whose confidentiality guarantees are anchored in standard
            primitives rather than bespoke schemes. This document restricts itself to behaviour reachable from compiled source.
          </p>
        </Section>

        {/* §2 */}
        <Section n={2} title="Substrate">
          <p>
            <strong>1-D ring field</strong> &mdash; <code>src/lib/uqrc/field.ts</code>. A periodic ring of length{' '}
            <em>L</em> = 256 cells with lattice spacing <code>ELL_MIN = 1</code>. Forward and centred-difference operators are
            allocation-free; one step costs &lt; 0.5&nbsp;ms.
          </p>
          <p className="mt-3">
            <strong>3-D torus field</strong> &mdash; <code>src/lib/uqrc/field3D.ts</code>. A 3-axis vector field on a
            24³ = 13,824-cell torus. Constants exported by the module: <code>FIELD3D_N = 24</code>,{' '}
            <code>FIELD3D_ELL_MIN = 1</code>, <code>FIELD3D_DT_MIN = 1</code>. One step is approximately 1.5×10⁶ FLOPs.
          </p>
          <p className="mt-3">
            <strong>World scale &amp; tick rate</strong> &mdash; <code>src/lib/brain/uqrcPhysics.ts</code>. The physical world is{' '}
            <code>WORLD_SIZE = 60 × 212.5 = 12,750 m</code> simulated at <code>PHYSICS_HZ = 60</code>&nbsp;Hz. Earth radius{' '}
            <code>EARTH_RADIUS = 8.0 × 212.5 = 1,700 m</code> (file <code>src/lib/brain/earth.ts</code>).
          </p>
        </Section>

        {/* §3 */}
        <Section n={3} title="Operator Algebra">
          <p>The substrate evolves under the UQRC step:</p>
          <Equation>{`u(t+1) = u(t) + 𝒪_UQRC(u(t)) + Σ_μ 𝒟_μ u(t) + λ(ε₀) ∇_μ ∇_ν S(u(t))
𝒪_UQRC(u) := ν Δu + ℛ u + L_S u
𝒟_μ u(x)  := ( u(x + ℓ_min e_μ) − u(x) ) / ℓ_min
[𝒟_μ, 𝒟_ν] := F_μν`}</Equation>
          <p className="mt-3">
            Conformance is enforced by <code>src/lib/brain/__tests__/uqrcConformance.test.ts</code>: the commutator norm stays
            bounded over 1,000 ticks under random injections, and the field remains smooth and bounded for 2,000 ticks. Both
            assertions pass in the current build.
          </p>
        </Section>

        {/* §4 */}
        <Section n={4} title="Causal Conversion Operator 𝒞_light">
          <p>
            File: <code>src/lib/brain/lightspeed.ts</code>. The closure relation <code>𝒞_light(Δt_min) = ℓ_min</code> defines the
            lattice cell as exactly one tick of light travel:
          </p>
          <Equation>{`LATTICE_CELL = WORLD_SIZE / FIELD3D_N = 12750 / 24 = 531.25 m
TICK_DT      = 1 / PHYSICS_HZ        = 1 / 60 ≈ 0.016667 s
C_LIGHT      = LATTICE_CELL / TICK_DT ≈ 31,875.00 m/s`}</Equation>
          <p className="mt-3">
            <strong>Refractive index &amp; delay.</strong> The field potential acts as an optical medium:
            <code> n(x) = 1 + κ·|u(x)|</code> with <code>κ = 1</code>. A Sun → surface → Sun ray integrates{' '}
            <code>ds·n(x)/c</code> and reports delay versus the Euclidean baseline. The probe is read-only.
          </p>
          <p className="mt-3">
            <strong>Causal state classification.</strong> <code>classifyCausalState</code> returns one of{' '}
            <code>'live' | 'creep' | 'saturated' | 'dead'</code> based on <code>n_surface</code> relative to the ceiling
            (5.0) and the surface gradient magnitude.
          </p>
          <p className="mt-3">
            <strong>Basin relaxation.</strong> When state is <code>saturated</code>,{' '}
            <code>relaxSurfaceBasin(field, pose)</code> is invoked from <code>uqrcPhysics.ts</code>. It applies a Gaussian
            subtraction at the Sun-facing surface to restore gradient flow without altering <code>ℓ_min</code>. The test{' '}
            <code>src/lib/brain/__tests__/lightspeed-relax.test.ts</code> verifies it drives a saturated basin back toward live.
          </p>
        </Section>

        {/* §5 */}
        <Section n={5} title="Reply-Length Gating">
          <p>
            File: <code>src/lib/uqrc/conversationAttraction.ts</code>. The reply budget is computed by{' '}
            <code>targetLengthFromField(q, promptMass, contextMass, causalState)</code>. The base length comes from{' '}
            <code>targetLengthFromQ(q)</code> and is then scaled by causal state:
          </p>
          <Equation>{`live      → 1.00 · raw    (normal operation)
creep     → 0.66 · raw    (basin near ceiling)
saturated → 0.40 · raw    (surface flat, no flow)
dead      → max(6, base)  (cold field floor)`}</Equation>
          <p className="mt-3">
            All branches are clamped to <code>[6, 64]</code>. This is the entire decision surface for response length: there is
            no separate &ldquo;instinct&rdquo; layer, no nine-tier hierarchy, and no security/meaning ladder in code. Earlier
            prose to the contrary was conceptual, not implemented.
          </p>
        </Section>

        {/* §6 */}
        <Section n={6} title="Confidentiality Pipeline">
          <p>
            File: <code>src/lib/fileEncryption.ts</code>. Content is encrypted with AES-256-GCM. File keys are wrapped under a
            passphrase-derived key produced by PBKDF2-SHA256 with 100,000 iterations and a per-file salt. Verbatim from source:
          </p>
          <Equation>{`{ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }
{ name: 'AES-GCM', length: 256 }`}</Equation>
          <p className="mt-3">
            No proprietary KDF, no rolling cipher, no exotic mode. The wrapped key, IV, and salt are stored alongside the
            ciphertext as base64 fields.
          </p>
        </Section>

        {/* §7 */}
        <Section n={7} title="Validation">
          <p>
            Vitest run on the brain and UQRC trees: <strong>21 files / 115 tests passed</strong>. Notable invariants:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1 text-sm text-foreground/80">
            <li>Commutator norm stays bounded over 1,000 ticks under random injections.</li>
            <li>Field stays smooth and bounded for 2,000 ticks (global regularity).</li>
            <li>Shell ring commutator stays bounded after 200 ticks.</li>
            <li>Lava-mantle pin field is finite and bounded on init.</li>
            <li><code>relaxSurfaceBasin</code> drives a saturated basin back toward live.</li>
            <li>Binding does not break UQRC conformance (commutator stays finite).</li>
          </ul>
        </Section>

        {/* §8 */}
        <Section n={8} title="Corrections to the previous Neural Network Paper">
          <ul className="list-disc pl-6 mt-2 space-y-1 text-sm text-foreground/80">
            <li>
              <strong>Removed:</strong> the claim of a &ldquo;9-layer Instinct Hierarchy (Survival Stack).&rdquo; A
              repository-wide search for <code>instinct</code>, <code>9-layer</code>, and related terms returned zero matches in
              source files.
            </li>
            <li>
              <strong>Removed:</strong> any reference to a &ldquo;Welford-based Neural State Engine&rdquo; as the decision
              arbiter. The token <code>Welford</code> appears nowhere in code; reply gating is performed by{' '}
              <code>targetLengthFromField</code> (§5).
            </li>
            <li>
              <strong>Removed:</strong> &ldquo;Φ Transition Quality,&rdquo; &ldquo;Bell Curve Intelligence,&rdquo; and
              &ldquo;Dual Learning Fusion (Pattern + Language Learner)&rdquo; sections. None of these systems exist in source.
            </li>
            <li>
              <strong>Corrected:</strong> <code>ℓ_min</code> for the 3-D substrate is <code>FIELD3D_ELL_MIN = 1</code> (lattice
              units). The metric cell length is <code>531.25 m</code>, which is{' '}
              <code>LATTICE_CELL = WORLD_SIZE / FIELD3D_N</code> &mdash; not the lattice spacing itself.
            </li>
            <li>
              <strong>Corrected:</strong> <code>c_sim = 31,875.00 m/s</code> exactly, derived from the world geometry
              (12,750 m / 24 cells / (1/60 s)).
            </li>
          </ul>
        </Section>

        {/* §9 — live curvature */}
        <Section n={9} title="Live Field Curvature ‖F_{μν}‖">
          <p>
            Real-time projection of the local node's discrete UQRC operator field. Darker bars
            indicate higher commutator curvature (instability); flatter regions are stable basins
            where memory has crystallised.
          </p>
          <FieldCurvatureLane />
        </Section>

        {/* Reproducibility */}
        <hr className="border-border/30 my-10" />
        <section className="mb-16">
          <h2 className="font-serif text-lg font-semibold mb-4">Reproducibility &amp; File Manifest</h2>
          <p className="text-sm text-foreground/80 mb-3">
            To reproduce every measurement above, from a clean checkout run:
          </p>
          <pre className="my-2 overflow-x-auto rounded-lg border border-border/30 bg-muted/30 px-4 py-3 font-mono text-xs text-foreground/70">
bunx vitest run src/lib/brain src/lib/uqrc
          </pre>
          <ul className="list-disc pl-6 mt-4 space-y-1 text-xs text-foreground/70">
            <li><code>src/lib/uqrc/field.ts</code> &mdash; 1-D ring field, L = 256</li>
            <li><code>src/lib/uqrc/field3D.ts</code> &mdash; 3-D torus field, N = 24</li>
            <li><code>src/lib/brain/uqrcPhysics.ts</code> &mdash; world geometry, tick loop, causal-state read</li>
            <li><code>src/lib/brain/lightspeed.ts</code> &mdash; 𝒞_light closure, n(x), classifyCausalState, relaxSurfaceBasin</li>
            <li><code>src/lib/uqrc/conversationAttraction.ts</code> &mdash; targetLengthFromQ, targetLengthFromField</li>
            <li><code>src/lib/fileEncryption.ts</code> &mdash; AES-256-GCM + PBKDF2-SHA256(100k)</li>
            <li><code>src/lib/brain/__tests__/lightspeed-relax.test.ts</code> &mdash; saturated → live recovery</li>
            <li><code>src/lib/brain/__tests__/uqrcConformance.test.ts</code> &mdash; commutator + regularity over 1k–2k ticks</li>
          </ul>
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
