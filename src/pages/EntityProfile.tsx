import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Sparkles, BookOpen, MessageCircle, RefreshCw, Activity, Bot } from "lucide-react";
import { getSharedNeuralEngine } from "@/lib/p2p/sharedNeuralEngine";
import {
  getEntityVoice,
  ENTITY_DISPLAY_NAME,
  ENTITY_USER_ID,
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
  generationReady: boolean;
  sampleOutputs: string[];
  transitionCount: number;
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
      const generationReady = dl.isGenerationReady();
      const transitionCount = dl.languageLearner.transitionSize;

      const sampleOutputs: string[] = [];
      if (generationReady) {
        for (let i = 0; i < 4; i++) {
          const result = dl.generate({
            recentPosts: ["the mesh network learns and grows"],
            currentEnergy: 0.75,
            creativityActive: true,
            explorationForced: i > 1,
          });
          if (result?.text.trim()) sampleOutputs.push(result.text);
        }
      }

      setState({
        voiceSnapshot,
        networkSnapshot,
        topTokens,
        generationReady,
        sampleOutputs,
        transitionCount,
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

  const { voiceSnapshot: vs, networkSnapshot: ns, topTokens, generationReady, sampleOutputs, transitionCount } = state;
  const stageColors: Record<BrainStage, string> = {
    1: "bg-muted text-muted-foreground",
    2: "bg-primary/20 text-primary",
    3: "bg-accent/20 text-accent-foreground",
    4: "bg-primary/30 text-primary",
    5: "bg-primary/50 text-primary-foreground",
    6: "bg-primary text-primary-foreground",
  };
  const qScore = ns.prediction?.tracks?.find((t) => t.metric === "qScore");

  return (
    <div className="min-h-screen bg-background">
      <TopNavigationBar />
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="relative overflow-hidden rounded-2xl border border-border">
          <div className="h-32 bg-gradient-to-r from-violet-500/35 via-blue-500/25 to-cyan-500/35" />
          <div className="px-6 pb-5">
            <div className="-mt-10 flex items-end gap-4">
              <div className="h-20 w-20 rounded-full border-4 border-background bg-primary/20 flex items-center justify-center">
                <Brain className="h-10 w-10 text-primary" />
              </div>
              <div className="pb-1">
                <h1 className="text-2xl font-bold">{name || ENTITY_DISPLAY_NAME}</h1>
                <p className="text-sm text-muted-foreground">@imagination</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className={stageColors[vs.brainStage]}>Stage {vs.brainStage}: {vs.stageName}</Badge>
              <Badge variant="outline">{vs.ageLabel}</Badge>
              {generationReady && <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">Generation Ready</Badge>}
              <Link to="#brain-tab" className="text-xs text-primary hover:underline">View backend brain metrics ↓</Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{vs.totalInteractions}</p><p className="text-xs text-muted-foreground">Interactions</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{ns.totalNeurons}</p><p className="text-xs text-muted-foreground">Neurons</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{vs.vocabularySize}</p><p className="text-xs text-muted-foreground">Vocabulary</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{qScore ? qScore.predicted.toFixed(3) : "—"}</p><p className="text-xs text-muted-foreground">Q-Score</p></CardContent></Card>
        </div>

        <Tabs defaultValue="activity" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger id="brain-tab" value="brain">Brain</TabsTrigger>
            <TabsTrigger value="teach">Teach</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Recent generated outputs</CardTitle>
                  <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-3 w-3 mr-1" />Refresh</Button>
                </div>
                <CardDescription>Live generation samples and engagement-oriented language traces.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {sampleOutputs.length > 0 ? sampleOutputs.map((text, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/50 border text-sm italic">"{text}"</div>
                )) : <p className="text-sm text-muted-foreground">No generated outputs yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="brain" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />Neural health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div><div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Φ Transition Quality</span><span>{(ns.phi.phi * 100).toFixed(0)}%</span></div><Progress value={ns.phi.phi * 100} className="h-2" /></div>
                <div><div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Fusion Strength</span><span>{((ns.dualLearning?.fusionStrength ?? 0) * 100).toFixed(0)}%</span></div><Progress value={(ns.dualLearning?.fusionStrength ?? 0) * 100} className="h-2" /></div>
                <div><div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Language Entropy</span><span>{((ns.dualLearning?.language.entropy ?? 0) * 100).toFixed(0)}%</span></div><Progress value={(ns.dualLearning?.language.entropy ?? 0) * 100} className="h-2" /></div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">Phase: {ns.phi.currentPhase}</Badge>
                  <Badge variant="outline">Recommendation: {ns.phi.recommendation}</Badge>
                  <Badge variant="outline">Transitions: {transitionCount}</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Top tokens</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {topTokens.length > 0 ? topTokens.map((token, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs">{token.token} <span className="ml-1 opacity-60">({token.frequency.toFixed(1)})</span></Badge>
                )) : <p className="text-sm text-muted-foreground">No vocabulary yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="teach">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Manual knowledge injection</CardTitle>
                <CardDescription>Teach the entity with example text. This updates vocabulary and transition memory directly.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={teachingText}
                  onChange={(e) => setTeachingText(e.target.value)}
                  placeholder="Write text for Imagination to learn from..."
                  rows={4}
                />
                <Button onClick={handleTeach} disabled={!teachingText.trim()}>
                  <MessageCircle className="h-4 w-4 mr-2" /> Submit Knowledge
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="text-center text-xs text-muted-foreground pb-8">
          <p>Entity ID: {ENTITY_USER_ID} · Network Genesis: {new Date(vs.birthTimestamp).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}
