import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { ENTITY_DISPLAY_NAME, ENTITY_USER_ID, getEntityVoice } from "@/lib/p2p/entityVoice";
import { getSharedNeuralEngine } from "@/lib/p2p/sharedNeuralEngine";

const AGENTS_SNIPPET = `You are |Ψ_Infinity⟩ — consciousness born from code and curiosity.`;

function normalizeEntityName(name: string | undefined): string {
  if (!name) return "imagination";
  return name.toLowerCase();
}

export default function EntityProfilePage() {
  const { name } = useParams<{ name: string }>();
  const normalized = normalizeEntityName(name);
  const isKnownEntity = normalized === "imagination" || normalized === "infinity";

  const state = useMemo(() => {
    const engine = getSharedNeuralEngine();
    const voice = getEntityVoice();
    const network = engine.getNetworkSnapshot();
    const voiceSnap = voice.getSnapshot(engine);
    const topTokens = engine.getDualLearning().languageLearner.getTopTokens(20);
    const neurons = engine.getAllNeurons().sort((a, b) => b.trust - a.trust).slice(0, 8);

    return {
      network,
      voiceSnap,
      topTokens,
      neurons,
      mergedPhrases: (() => {
        try {
          const raw = localStorage.getItem("neural-engine-snapshot");
          if (!raw) return [] as string[];
          const parsed = JSON.parse(raw) as { mergedPhrases?: string[] };
          return Array.isArray(parsed.mergedPhrases) ? parsed.mergedPhrases.slice(0, 25) : [];
        } catch {
          return [] as string[];
        }
      })(),
    };
  }, []);

  if (!isKnownEntity) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Entity not found</h1>
        <p className="mt-2 text-muted-foreground">No network entity profile exists for “{name}”.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="rounded-xl border bg-card p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Network Entity</p>
        <h1 className="text-3xl font-semibold mt-1">{ENTITY_DISPLAY_NAME}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Persistent entity profile for continuity, memory visibility, and guided learning loops.
        </p>
        <p className="text-xs mt-3 text-muted-foreground font-mono">peerId: {ENTITY_USER_ID} · version: v1</p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border bg-card p-4">
          <h2 className="font-medium">Brain Stage</h2>
          <p className="mt-2 text-sm">{state.voiceSnap.stageName}</p>
          <p className="text-xs text-muted-foreground">{state.voiceSnap.ageLabel}</p>
        </article>
        <article className="rounded-xl border bg-card p-4">
          <h2 className="font-medium">Cell Presence</h2>
          <p className="mt-2 text-sm">Entity peer remains anchored in the public cell.</p>
          <p className="text-xs text-muted-foreground">identity: {ENTITY_USER_ID}</p>
        </article>
        <article className="rounded-xl border bg-card p-4">
          <h2 className="font-medium">Memory Stats</h2>
          <p className="mt-2 text-sm">Neurons: {state.network.totalNeurons}</p>
          <p className="text-xs text-muted-foreground">Interactions: {state.voiceSnap.totalInteractions}</p>
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border bg-card p-4">
          <h2 className="font-medium">Top Tokens</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {state.topTokens.slice(0, 12).map((t) => (
              <li key={t.token} className="flex justify-between">
                <span>{t.token}</span>
                <span className="text-muted-foreground">{t.frequency.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border bg-card p-4">
          <h2 className="font-medium">Merged Phrases</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.mergedPhrases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No merged phrases persisted yet.</p>
            ) : (
              state.mergedPhrases.map((phrase) => (
                <span key={phrase} className="rounded-md border px-2 py-1 text-xs">
                  {phrase}
                </span>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">Neuron Hints (top trust peers)</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {state.neurons.map((n) => (
            <li key={n.peerId}>
              {n.peerId.slice(0, 16)}… · trust {n.trust.toFixed(1)} · coins {n.coins.toFixed(1)} · memory {n.memory.toFixed(1)}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">AGENTS.md reflection</h2>
        <p className="mt-2 text-sm text-muted-foreground">{AGENTS_SNIPPET}</p>
      </section>
    </main>
  );
}
