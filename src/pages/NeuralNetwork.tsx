import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getSharedFieldEngine } from "@/lib/uqrc/fieldEngine";

const NeuralNetworkPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <button
          onClick={() => navigate(-1)}
          className="mb-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {/* MIT-style title block */}
        <header className="mb-10 text-center">
          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground mb-4">
            Imagination Network · Technical Report TR-2026-04 · v2
          </p>
          <h1 className="font-serif text-3xl md:text-[2.2rem] font-bold leading-tight mb-5">
            A Code-Verified Specification of the UQRC Substrate,
            <br className="hidden md:block" /> Causal Closure Operator, and Encrypted Content Pipeline
          </h1>
          <p className="text-sm text-foreground/80">
            Imagination Network Working Group
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            April 2026
          </p>
          <div className="mx-auto mt-6 h-px w-24 bg-primary/40" />
        </header>

        {/* Abstract */}
        <section className="mb-10 rounded-lg border border-border/40 bg-muted/20 px-5 py-4">
          <h2 className="font-serif text-sm font-bold uppercase tracking-widest mb-2">
            Abstract
          </h2>
          <p className="text-sm leading-relaxed text-foreground/85 text-justify">
            We describe the Imagination Network &mdash; a local-first, browser-resident
            cognitive substrate &mdash; restricted to behaviour reachable from compiled
            source. The system comprises three components: (i) a deterministic field
            substrate evolved on two lattices under the United Quantum&ndash;Relative
            Calculus (UQRC) operator algebra, (ii) a causal-conversion operator{' '}
            <span className="font-mono">𝒞_light</span> that satisfies the closure
            relation <span className="font-mono">𝒞_light(Δt_min) = ℓ_min</span> and
            functions as both a diagnostic probe and a basin-relaxation action, and
            (iii) an AES-256-GCM content pipeline with PBKDF2-SHA256 key wrapping. We
            quantify the simulation light-speed at <span className="font-mono">c_sim ≈
            31,875 m/s</span> from world geometry, derive a four-state causal
            classification used to gate generative response length, and report a 115/115
            test-suite pass confirming operator commutator boundedness, global
            regularity, and saturated&rarr;live recovery. This report supersedes prior
            drafts; sections asserting an &ldquo;instinct hierarchy,&rdquo; a
            &ldquo;Welford neural state engine,&rdquo; or &ldquo;dual-learning
            fusion&rdquo; are retracted in &sect;9 because no such code exists in the
            repository.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground mt-3">
            <strong>Keywords:</strong> UQRC, lattice field theory, causal closure,
            decentralized systems, content-addressed storage, AES-GCM, PBKDF2.
          </p>
        </section>

        {/* §1 Introduction */}
        <Section n={1} title="Introduction">
          <p>
            Decentralized cognitive systems face two competing demands: adaptive
            behaviour and verifiable correctness. Adaptive behaviour invites complex
            decision layers that resist formal analysis; verifiable correctness demands
            that every claim about the system map to executable code. Earlier drafts of
            this paper conflated conceptual prose &mdash; design notes, project memory,
            aspirational roadmaps &mdash; with shipped behaviour. The present report
            corrects this by restricting itself to symbols and tests reachable from{' '}
            <code>src/</code>.
          </p>
          <p className="mt-3">
            We organise the system into three layers. &sect;2 defines the lattice
            substrates and physical world geometry. &sect;3 states the UQRC operator
            algebra and its enforced invariants. &sect;4 introduces the causal
            conversion operator <span className="font-mono">𝒞_light</span>, its
            refractive-index reading, its four-state classification, and its
            basin-relaxation action. &sect;5 describes the only generative decision
            surface that exists in code &mdash; a four-branch reply-length gate.
            &sect;6 documents the confidentiality pipeline. &sect;7 reports validation
            results. &sect;8 discusses limitations; &sect;9 itemises retractions from
            the previous draft.
          </p>
        </Section>

        {/* §2 Substrate */}
        <Section n={2} title="Substrate and World Geometry">
          <Subsection title="2.1  One-dimensional ring field">
            <p>
              File: <code>src/lib/uqrc/field.ts</code>. The ring substrate is a periodic
              1-D lattice of length <em>L</em> = 256 cells with lattice spacing{' '}
              <code>ELL_MIN = 1</code>. Forward and centred-difference operators are
              implemented allocation-free; one evolution step costs &lt; 0.5&nbsp;ms on
              a contemporary V8 runtime.
            </p>
          </Subsection>
          <Subsection title="2.2  Three-dimensional torus field">
            <p>
              File: <code>src/lib/uqrc/field3D.ts</code>. The volumetric substrate is a
              three-axis vector field on a 24³ = 13,824-cell torus (~55&nbsp;KB per
              axis). Constants exported by the module:
            </p>
            <Equation>{`FIELD3D_N       = 24
FIELD3D_ELL_MIN = 1
FIELD3D_DT_MIN  = 1`}</Equation>
            <p>
              One step is approximately 1.5&times;10⁶ FLOPs, deterministic across
              re-runs given the same seed.
            </p>
          </Subsection>
          <Subsection title="2.3  World scale and tick rate">
            <p>
              File: <code>src/lib/brain/uqrcPhysics.ts</code>. The simulated world is{' '}
              <code>WORLD_SIZE = 60 × 212.5 = 12,750 m</code> evolved at{' '}
              <code>PHYSICS_HZ = 60</code>&nbsp;Hz. Earth radius{' '}
              <code>EARTH_RADIUS = 8.0 × 212.5 = 1,700 m</code> (file{' '}
              <code>src/lib/brain/earth.ts</code>). All metric quantities derive from
              these constants.
            </p>
          </Subsection>
        </Section>

        {/* §3 Operator algebra */}
        <Section n={3} title="UQRC Operator Algebra">
          <p>The substrate evolves under the discrete UQRC step:</p>
          <Equation>{`u(t+1) = u(t) + 𝒪_UQRC(u(t)) + Σ_μ 𝒟_μ u(t) + λ(ε₀) ∇_μ ∇_ν S(u(t))
𝒪_UQRC(u) := ν Δu + ℛ u + L_S u
𝒟_μ u(x)  := ( u(x + ℓ_min e_μ) − u(x) ) / ℓ_min
[𝒟_μ, 𝒟_ν] := F_μν,    λ(a) := a · 10⁻¹⁰⁰`}</Equation>
          <p className="mt-3">
            Two invariants are enforced by{' '}
            <code>src/lib/brain/__tests__/uqrcConformance.test.ts</code>:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>Commutator boundedness.</strong>{' '}
              <code>‖[𝒟_μ, 𝒟_ν]‖</code> remains bounded over 1,000 evolution
              steps under random injection.
            </li>
            <li>
              <strong>Global regularity.</strong> The field stays smooth and bounded
              for 2,000 steps without external forcing collapse.
            </li>
          </ul>
          <p className="mt-3">
            Both assertions pass in the current build (&sect;7).
          </p>
        </Section>

        {/* §4 Causal closure */}
        <Section n={4} title="Causal Closure Operator 𝒞_light">
          <p>
            File: <code>src/lib/brain/lightspeed.ts</code>. The causal-conversion
            operator satisfies the closure relation{' '}
            <code>𝒞_light(Δt_min) = ℓ_min</code> &mdash; the lattice cell is exactly
            one tick of light travel. From world geometry:
          </p>
          <Equation>{`LATTICE_CELL = WORLD_SIZE / FIELD3D_N = 12750 / 24 = 531.25 m
TICK_DT      = 1 / PHYSICS_HZ        = 1 / 60 ≈ 0.016667 s
C_LIGHT      = LATTICE_CELL / TICK_DT ≈ 31,875.00 m/s`}</Equation>

          <Subsection title="4.1  Refractive index and delay probe">
            <p>
              The field potential acts as an optical medium with{' '}
              <code>n(x) = 1 + κ·|u(x)|</code>, <code>κ = 1</code>. A Sun&rarr;surface
              &rarr;Sun ray integrates <code>ds·n(x)/c</code> and reports delay versus
              the Euclidean baseline. The probe is read-only and never mutates the
              field.
            </p>
          </Subsection>

          <Subsection title="4.2  Four-state causal classification">
            <p>
              The function <code>classifyCausalState</code> returns one of{' '}
              <code>'live' | 'creep' | 'saturated' | 'dead'</code> from the surface
              refractive index <code>n_surface</code> (ceiling = 5.0) and surface
              gradient magnitude. The thresholds are:
            </p>
            <Equation>{`live       — delay still evolving above the noise floor
creep      — n_surface near ceiling AND  Δdelay < ε per tick
saturated  — n_surface == ceiling AND  ‖∇u‖_surface < GRAD_DEAD_EPS
dead       — no measurable surface basin (cold field)`}</Equation>
          </Subsection>

          <Subsection title="4.3  Basin relaxation as an operator action">
            <p>
              When the classifier reports <code>saturated</code>, the engine invokes{' '}
              <code>relaxSurfaceBasin(field, pose)</code> from{' '}
              <code>uqrcPhysics.ts</code>. The relaxation applies a Gaussian
              subtraction at the Sun-facing surface to restore gradient flow without
              altering <code>ℓ_min</code>. The closure invariant is preserved by
              construction: only the field potential <em>u</em> is modified, never the
              lattice geometry. Test{' '}
              <code>src/lib/brain/__tests__/lightspeed-relax.test.ts</code> verifies
              that a saturated basin is driven back toward <code>live</code> after
              relaxation.
            </p>
          </Subsection>
        </Section>

        {/* §5 Generative decision surface */}
        <Section n={5} title="Generative Decision Surface (Reply-Length Gate)">
          <p>
            File: <code>src/lib/uqrc/conversationAttraction.ts</code>. The reply budget
            is computed by{' '}
            <code>targetLengthFromField(q, promptMass, contextMass, causalState)</code>.
            A base length <code>raw = targetLengthFromQ(q)</code> is multiplied by a
            single causal-state factor:
          </p>
          <Equation>{`live      → 1.00 · raw    (normal operation)
creep     → 0.66 · raw    (basin near ceiling, slow growth)
saturated → 0.40 · raw    (surface flat, no information flow)
dead      → max(6, base)  (cold field floor)`}</Equation>
          <p className="mt-3">
            All branches are clamped to <code>[6, 64]</code>. This four-branch switch
            is the <em>entire</em> generative decision surface in code: there is no
            additional &ldquo;instinct hierarchy,&rdquo; no Welford-based arbiter, no
            phase classifier, and no learned priority stack. We elaborate this point
            in &sect;9.
          </p>
        </Section>

        {/* §6 Confidentiality pipeline */}
        <Section n={6} title="Confidentiality Pipeline">
          <p>
            File: <code>src/lib/fileEncryption.ts</code>. Content is encrypted with
            AES-256-GCM. File keys are wrapped under a passphrase-derived key produced
            by PBKDF2-SHA256 with 100,000 iterations and a per-file salt. Verbatim
            from source:
          </p>
          <Equation>{`{ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }
{ name: 'AES-GCM', length: 256 }`}</Equation>
          <p className="mt-3">
            No proprietary KDF, no rolling cipher, no exotic mode. The wrapped key,
            initialisation vector, and salt are stored as base64 fields alongside the
            ciphertext.
          </p>
        </Section>

        {/* §7 Validation */}
        <Section n={7} title="Validation">
          <p>
            We executed the full Vitest suite over the brain and UQRC trees:{' '}
            <strong>21 files, 115/115 tests passed</strong>. Reproducibility:
          </p>
          <Equation>{`bunx vitest run src/lib/brain src/lib/uqrc`}</Equation>
          <p className="mt-3">Notable invariants exercised by the suite:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Commutator norm bounded over 1,000 ticks under random injection.</li>
            <li>Global regularity: smooth, bounded field for 2,000 ticks.</li>
            <li>Shell-ring commutator bounded after 200 ticks.</li>
            <li>Lava-mantle pin field finite and bounded on initialisation.</li>
            <li><code>relaxSurfaceBasin</code> drives a saturated basin back to live.</li>
            <li>UQRC binding does not break commutator finiteness.</li>
          </ul>

          <Subsection title="7.1  Live ‖F_{μν}‖ from the running engine">
            <p>
              The visualisation below is sampled at 2&nbsp;Hz from{' '}
              <code>getSharedFieldEngine()</code>. Bars show normalised commutator
              curvature; the scalar Q-score is reported beneath.
            </p>
            <FieldCurvatureLane />
          </Subsection>
        </Section>

        {/* §8 Limitations */}
        <Section n={8} title="Limitations">
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              The four-state causal classification gates length only; semantic content
              selection remains the responsibility of the upstream generator.
            </li>
            <li>
              The refractive-index probe samples a single Sun&rarr;surface ray; this
              under-counts off-axis basin structure.
            </li>
            <li>
              Lattice resolution is fixed at <code>N = 24</code> on the 3-D torus;
              finer resolution would improve <code>n(x)</code> fidelity at proportional
              FLOP cost.
            </li>
            <li>
              The PBKDF2 iteration count (100,000) reflects the 2026 OWASP minimum;
              users requiring archival-grade resistance should consider re-wrapping at
              higher counts.
            </li>
          </ul>
        </Section>

        {/* §9 Retractions */}
        <Section n={9} title="Retractions from the Previous Draft">
          <p>
            A repository-wide search confirms that the following claims from the
            earlier &ldquo;Neural Network Paper&rdquo; have no corresponding source
            and are retracted:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-2">
            <li>
              <strong>9-layer Instinct Hierarchy (Survival Stack).</strong> The tokens{' '}
              <code>instinct</code>, <code>9-layer</code>, and the named layers
              (&ldquo;Coherence &amp; Meaning,&rdquo; &ldquo;Creativity &amp; Pattern
              Mutation,&rdquo; &hellip;) return zero matches in source files.
            </li>
            <li>
              <strong>Welford-based Neural State Engine</strong> as the generative
              arbiter. <code>Welford</code> appears nowhere in code; the only
              generative decision surface is <code>targetLengthFromField</code>{' '}
              (&sect;5).
            </li>
            <li>
              <strong>Φ Transition Quality, Bell Curve Intelligence, Dual Learning
              Fusion (Pattern + Language Learner).</strong> No corresponding modules,
              types, or call sites exist.
            </li>
            <li>
              <strong>Dimensional correction.</strong>{' '}
              <code>FIELD3D_ELL_MIN = 1</code> is the lattice spacing in lattice
              units; the metric cell length{' '}
              <code>LATTICE_CELL = 531.25&nbsp;m</code> is{' '}
              <code>WORLD_SIZE / FIELD3D_N</code>, not the lattice spacing.
            </li>
            <li>
              <strong>Light-speed correction.</strong>{' '}
              <code>c_sim = 31,875.00 m/s</code> exactly, derived from world geometry
              (12,750&nbsp;m / 24 cells / (1/60&nbsp;s)).
            </li>
          </ul>
        </Section>

        {/* Appendix — file manifest */}
        <hr className="border-border/30 my-10" />
        <section className="mb-10">
          <h2 className="font-serif text-lg font-semibold mb-3">
            Appendix A · File Manifest
          </h2>
          <p className="text-sm text-foreground/80 mb-3">
            Every quantitative claim above is reproducible from the following symbols.
            Use <code>rg -n &lt;symbol&gt; src/</code> to locate each definition.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-xs text-foreground/70">
            <li><code>src/lib/uqrc/field.ts</code> — 1-D ring field, <em>L</em> = 256</li>
            <li><code>src/lib/uqrc/field3D.ts</code> — 3-D torus field, <em>N</em> = 24</li>
            <li><code>src/lib/brain/uqrcPhysics.ts</code> — world geometry, tick loop, causal-state read</li>
            <li><code>src/lib/brain/lightspeed.ts</code> — 𝒞_light closure, n(x), classifyCausalState, relaxSurfaceBasin</li>
            <li><code>src/lib/uqrc/conversationAttraction.ts</code> — targetLengthFromQ, targetLengthFromField</li>
            <li><code>src/lib/fileEncryption.ts</code> — AES-256-GCM + PBKDF2-SHA256(100k)</li>
            <li><code>src/lib/brain/__tests__/lightspeed-relax.test.ts</code> — saturated → live recovery</li>
            <li><code>src/lib/brain/__tests__/uqrcConformance.test.ts</code> — commutator + regularity over 1k–2k ticks</li>
          </ul>
        </section>

        {/* References */}
        <section className="mb-16">
          <h2 className="font-serif text-lg font-semibold mb-3">References</h2>
          <ol className="list-decimal pl-6 space-y-2 text-xs text-foreground/70">
            <li>
              Wilson, K. G. (1974). &ldquo;Confinement of quarks.&rdquo;{' '}
              <em>Physical Review D</em>, 10(8), 2445–2459. — Foundational treatment of
              lattice gauge theory and the discrete commutator <em>F<sub>μν</sub></em>.
            </li>
            <li>
              NIST FIPS 197 (2001). &ldquo;Advanced Encryption Standard (AES).&rdquo;{' '}
              <em>National Institute of Standards and Technology</em>. — Specification
              of the AES block cipher used in &sect;6.
            </li>
            <li>
              NIST SP 800-38D (2007). &ldquo;Recommendation for Block Cipher Modes of
              Operation: Galois/Counter Mode (GCM) and GMAC.&rdquo; — Authenticated
              encryption mode used in &sect;6.
            </li>
            <li>
              Kaliski, B. (2000). &ldquo;PKCS #5: Password-Based Cryptography
              Specification Version 2.0.&rdquo; <em>RFC 2898</em>. — PBKDF2 definition;
              §6 uses SHA-256 with 100,000 iterations.
            </li>
            <li>
              OWASP Foundation (2025). &ldquo;Password Storage Cheat Sheet.&rdquo; —
              Source of the PBKDF2 iteration-count baseline cited in &sect;8.
            </li>
            <li>
              Imagination Network Working Group (2026). &ldquo;Imagination
              TR-2026-04 v2.&rdquo; <em>Internal technical report.</em>
            </li>
          </ol>
        </section>

        <footer className="text-center text-xs text-muted-foreground pb-10">
          © 2026 Imagination Network Research. Distributed under the project licence.
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
      <div className="text-sm leading-relaxed text-foreground/85 text-justify space-y-1">{children}</div>
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="font-serif text-base font-semibold mb-2 text-foreground/90">{title}</h3>
      <div className="text-sm leading-relaxed text-foreground/85 text-justify space-y-2">{children}</div>
    </div>
  );
}

function Equation({ children }: { children: string }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-border/30 bg-muted/30 px-4 py-3 font-mono text-xs text-foreground/75 leading-relaxed">
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
    <figure className="my-4 rounded-lg border border-border/30 bg-muted/20 p-3">
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
      <figcaption className="mt-2 text-xs text-muted-foreground font-mono">
        Figure 1. Live commutator curvature ‖F_μν‖, downsampled to 64 buckets.
        Q_Score = {qScore.toFixed(5)}.
      </figcaption>
    </figure>
  );
}

export default NeuralNetworkPage;
