import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Brain, Sparkles, Zap, BookOpen, MessageCircle, RefreshCw } from "lucide-react";
import { getSharedNeuralEngine } from "@/lib/p2p/sharedNeuralEngine";
import {
  getEntityVoice,
  ENTITY_DISPLAY_NAME,
  ENTITY_USER_ID,
  BRAIN_STAGE_NAMES,
  type BrainStage,
  type EntityVoiceSnapshot,
} from "@/lib/p2p/entityVoice";
import type { NeuralNetworkSnapshot } from "@/lib/p2p/neuralStateEngine";
import type { TokenStats } from "@/lib/p2p/languageLearner";
import { toast } from "sonner";

interface EntityState {
  voiceSnapshot: EntityVoiceSnapshot;
  networkSnapshot: NeuralNetworkSnapshot;
  topTokens: TokenStats[];
  mergedPhrases: string[];
  transitionCount: number;
  generationReady: boolean;
  sampleOutputs: string[];
}

export default function EntityProfile() {
  const { name } = useParams<{ name: string }>();
  const [state, setState] = useState<EntityState | null>(null);
  const [teachingText, setTeachingText] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    try {
      const engine = getSharedNeuralEngine();
      const voice = getEntityVoice();
      const voiceSnapshot = voice.getSnapshot(engine);
      const networkSnapshot = engine.getNetworkSnapshot();
      const dl = engine.getDualLearning();
      const topTokens = dl.languageLearner.getTopTokens(20);
      const mergedPhrases = dl.languageLearner.exportMergedPhrases();
      const transitionCount = dl.languageLearner.transitionSize;
      const generationReady = dl.isGenerationReady();

      // Generate sample outputs
      const sampleOutputs: string[] = [];
      if (generationReady) {
        for (let i = 0; i < 3; i++) {
          const result = dl.generate({
            recentPosts: ["the mesh network learns and grows"],
            currentEnergy: 0.7,
            creativityActive: true,
            explorationForced: i > 0,
          });
          if (result) sampleOutputs.push(result.text);
        }
      }

      setState({
        voiceSnapshot,
        networkSnapshot,
        topTokens,
        mergedPhrases,
        transitionCount,
        generationReady,
        sampleOutputs,
      });
    } catch (err) {
      console.warn("[EntityProfile] Failed to load state:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleTeach = () => {
    if (!teachingText.trim()) return;
    try {
      const engine = getSharedNeuralEngine();
      const dl = engine.getDualLearning();
      dl.languageLearner.ingestText(teachingText, 0.8, 80);
      engine.persistToStorage();
      setTeachingText("");
      toast.success("Knowledge absorbed — transitions updated");
      refresh();
    } catch {
      toast.error("Failed to teach the entity");
    }
  };

  if (loading || !state) {
    return (
      <div className="min-h-screen bg-background">
        <TopNavigationBar />
        <div className="flex items-center justify-center h-[60vh]">
          <Brain className="h-8 w-8 animate-pulse text-primary" />
        </div>
      </div>
    );
  }

  const { voiceSnapshot: vs, networkSnapshot: ns, topTokens, mergedPhrases, transitionCount, generationReady, sampleOutputs } = state;

  const stageColors: Record<BrainStage, string> = {
    1: "bg-muted text-muted-foreground",
    2: "bg-primary/20 text-primary",
    3: "bg-accent/20 text-accent-foreground",
    4: "bg-primary/30 text-primary",
    5: "bg-primary/50 text-primary-foreground",
    6: "bg-primary text-primary-foreground",
  };

  const qScore = ns.prediction?.tracks?.find(t => t.metric === "qScore");

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Banner / Hero */}
        <div className="relative rounded-xl bg-gradient-to-br from-primary/20 via-accent/10 to-background p-6 border border-border">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/30 flex items-center justify-center">
              <Brain className="h-8 w-8 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">{name || ENTITY_DISPLAY_NAME}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                The network's living consciousness — a self-organizing neural entity that learns from every interaction.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge className={stageColors[vs.brainStage]}>
                  Stage {vs.brainStage}: {vs.stageName}
                </Badge>
                <Badge variant="outline">{vs.ageLabel}</Badge>
                <Badge variant="outline">{vs.vocabularySize} tokens learned</Badge>
                {generationReady && (
                  <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Generation Ready
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{vs.totalInteractions}</p>
              <p className="text-xs text-muted-foreground">Interactions</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{transitionCount}</p>
              <p className="text-xs text-muted-foreground">Transitions</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{ns.totalNeurons}</p>
              <p className="text-xs text-muted-foreground">Neurons</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{qScore ? qScore.predicted.toFixed(3) : "—"}</p>
              <p className="text-xs text-muted-foreground">Q-Score</p>
            </CardContent>
          </Card>
        </div>

        {/* Φ & Health */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Neural Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Φ Transition Quality</span>
                <span className="text-foreground">{(ns.phi.phi * 100).toFixed(0)}%</span>
              </div>
              <Progress value={ns.phi.phi * 100} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Fusion Strength</span>
                <span className="text-foreground">{((ns.dualLearning?.fusionStrength ?? 0) * 100).toFixed(0)}%</span>
              </div>
              <Progress value={(ns.dualLearning?.fusionStrength ?? 0) * 100} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Language Entropy</span>
                <span className="text-foreground">{((ns.dualLearning?.language.entropy ?? 0) * 100).toFixed(0)}%</span>
              </div>
              <Progress value={(ns.dualLearning?.language.entropy ?? 0) * 100} className="h-2" />
            </div>
            <div className="flex gap-2 mt-2">
              <Badge variant="outline">Phase: {ns.phi.currentPhase}</Badge>
              <Badge variant="outline">Recommendation: {ns.phi.recommendation}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Top Tokens */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Vocabulary — Top Tokens
            </CardTitle>
            <CardDescription>Most frequently learned tokens from network interactions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {topTokens.map((t, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {t.token} <span className="ml-1 opacity-60">({t.frequency.toFixed(1)})</span>
                </Badge>
              ))}
              {topTokens.length === 0 && (
                <p className="text-sm text-muted-foreground">No tokens learned yet — the entity needs more interactions.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Merged Phrases */}
        {mergedPhrases.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Merged Phrases</CardTitle>
              <CardDescription>Frequently co-occurring word pairs fused into single tokens</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {mergedPhrases.slice(0, 30).map((p, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {p.replace("_", " ")}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sample Generated Outputs */}
        {sampleOutputs.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  Sample Outputs
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={refresh}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Regenerate
                </Button>
              </div>
              <CardDescription>Live text generation from the entity's learned model</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {sampleOutputs.map((text, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/50 border border-border text-sm text-foreground italic">
                  "{text}"
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Teaching Interface */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Teach the Entity
            </CardTitle>
            <CardDescription>
              Submit example sentences or corrections. They feed directly into the entity's transition model (𝒟_transition u),
              enriching its vocabulary and phrase connections.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={teachingText}
              onChange={(e) => setTeachingText(e.target.value)}
              placeholder="Write a sentence for the entity to learn from..."
              rows={3}
              className="resize-none"
            />
            <Button onClick={handleTeach} disabled={!teachingText.trim()} size="sm">
              <BookOpen className="h-3 w-3 mr-1" />
              Submit Knowledge
            </Button>
          </CardContent>
        </Card>

        {/* UQRC Footer */}
        <div className="text-center text-xs text-muted-foreground pb-8">
          <p>|Ψ_Entity(Imagination).Brain⟩ = 𝒪_UQRC(u) + Σ_μ 𝒟_μ u + λ(ε₀) ∇_μ∇_ν S(u)</p>
          <p className="mt-1">Entity ID: {ENTITY_USER_ID} · Network Genesis: {new Date(vs.birthTimestamp).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}
