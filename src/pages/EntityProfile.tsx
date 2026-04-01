import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Sparkles, BookOpen, MessageCircle, RefreshCw, Activity, Bot, Calendar } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { getSharedNeuralEngine } from "@/lib/p2p/sharedNeuralEngine";
import { getAll } from "@/lib/store";
import {
  getEntityVoice,
  ENTITY_DISPLAY_NAME,
  ENTITY_USER_ID,
  type BrainStage,
  type EntityVoiceSnapshot,
} from "@/lib/p2p/entityVoice";
import type { NeuralNetworkSnapshot } from "@/lib/p2p/neuralStateEngine";
import type { TokenStats } from "@/lib/p2p/languageLearner";
import type { Post } from "@/types";
import { toast } from "sonner";

interface EntityState {
  voiceSnapshot: EntityVoiceSnapshot;
  networkSnapshot: NeuralNetworkSnapshot;
  topTokens: TokenStats[];
  generationReady: boolean;
  sampleOutputs: string[];
  entityPosts: Post[];
  memoryCoinPeers: Array<{ peerId: string; coins: number; memory: number; trust: number }>;
  transitionSamples: Array<{ pattern: string; weight: number }>;
  transitionCount: number;
}

const TOPIC_STOP_WORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "have", "will", "your", "you", "our", "are", "was", "were",
  "about", "into", "their", "there", "them", "they", "what", "when", "where", "which", "while", "has", "had", "its",
  "not", "just", "can", "all", "but", "too", "out", "who", "how", "new", "get", "use"
]);

const normalizeTopicToken = (rawToken: string): string | null => {
  const normalized = rawToken
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.length < 3) return null;
  if (TOPIC_STOP_WORDS.has(normalized)) return null;
  if (/^[a-f0-9]{8,}$/.test(normalized)) return null;
  if (/^(peer|node|user|id|mesh|swarm|network)$/i.test(normalized)) return null;
  return normalized;
};

const deriveTopicsFromPosts = (posts: Post[], limit = 20): TokenStats[] => {
  const tokenCounts = new Map<string, number>();
  posts.forEach((post) => {
    post.content
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-z0-9_]+/)
      .forEach((token) => {
        const topic = normalizeTopicToken(token);
        if (!topic) return;
        tokenCounts.set(topic, (tokenCounts.get(topic) ?? 0) + 1);
      });
  });

  return Array.from(tokenCounts.entries())
    .map(([token, frequency]) => ({ token, frequency }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, limit);
};

export default function EntityProfile() {
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
      const topTokens = dl.languageLearner.getTopTokens(80);
      const generationReady = dl.isGenerationReady();
      const transitionCount = dl.languageLearner.transitionSize;
      const digest = engine.exportDigest();
      const memoryCoinPeers = [...digest.neurons]
        .sort((a, b) => (b.coins + b.memory) - (a.coins + a.memory))
        .slice(0, 6)
        .map((n) => ({ peerId: n.peerId, coins: n.coins, memory: n.memory, trust: n.trust }));
      const transitionSamples = Object.entries(digest.transitions ?? {})
        .map(([pattern, data]) => ({ pattern, weight: data.totalWeight }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 8);

      const sampleOutputs: string[] = [];
      if (generationReady) {
        for (let i = 0; i < 4; i++) {
          const result = dl.generate({
            recentPosts: ["the mesh network learns and grows"],
            currentEnergy: 0.75,
            creativityActive: true,
            explorationForced: i > 1,
          });
          if (result?.text.trim()) {
            const cleaned = result.text
              .replace(/_/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            if (cleaned.length > 0 && !/[0-9a-f]{10,}/i.test(cleaned)) {
              sampleOutputs.push(cleaned);
            }
          }
        }
      }

      void getAll<Post>("posts").then((allPosts) => {
        const entityPosts = allPosts
          .filter((post) => post.author === ENTITY_USER_ID)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 12);
        const topReadableTopics = topTokens
          .map((entry) => ({ token: normalizeTopicToken(entry.token), frequency: entry.frequency }))
          .filter((entry): entry is TokenStats => Boolean(entry.token))
          .reduce<TokenStats[]>((acc, entry) => {
            const existing = acc.find((item) => item.token === entry.token);
            if (existing) {
              existing.frequency += entry.frequency;
              return acc;
            }
            acc.push({ token: entry.token, frequency: entry.frequency });
            return acc;
          }, [])
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 20);
        const postTopics = deriveTopicsFromPosts(entityPosts, 20);
        const mergedTopTokens = [...topReadableTopics];
        postTopics.forEach((topic) => {
          const found = mergedTopTokens.find((entry) => entry.token === topic.token);
          if (found) {
            found.frequency += topic.frequency;
          } else {
            mergedTopTokens.push(topic);
          }
        });
        const resolvedTopTokens = mergedTopTokens
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 20);

        setState({
          voiceSnapshot,
          networkSnapshot,
          topTokens: resolvedTopTokens,
          generationReady,
          sampleOutputs,
          entityPosts,
          memoryCoinPeers,
          transitionSamples,
          transitionCount,
        });
      });
    } catch (err) {
      console.warn("[EntityProfile] Failed to load state:", err);
      setLoading(false);
      return;
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

  const { voiceSnapshot: vs, networkSnapshot: ns, topTokens, generationReady, sampleOutputs, entityPosts, memoryCoinPeers, transitionSamples, transitionCount } = state;
  const stageColors: Record<BrainStage, string> = {
    1: "bg-muted text-muted-foreground",
    2: "bg-primary/20 text-primary",
    3: "bg-accent/20 text-accent-foreground",
    4: "bg-primary/30 text-primary",
    5: "bg-primary/50 text-primary-foreground",
    6: "bg-primary text-primary-foreground",
  };
  const qScore = ns.prediction?.tracks?.find((t) => t.metric === "qScore");
  const joinedDate = new Date(vs.birthTimestamp).toLocaleDateString();

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
                <h1 className="text-2xl font-bold">{ENTITY_DISPLAY_NAME}</h1>
                <p className="text-sm text-muted-foreground">@imagination</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <div className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                <span>Joined {joinedDate}</span>
              </div>
              <Badge variant="outline">{vs.ageLabel}</Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Imagination participates like a regular user profile. Brain diagnostics stay hidden until you open the Brain tab.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{vs.totalInteractions}</p><p className="text-xs text-muted-foreground">Interactions</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{entityPosts.length}</p><p className="text-xs text-muted-foreground">Recent Posts</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{topTokens.length}</p><p className="text-xs text-muted-foreground">Active Topics</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{generationReady ? "Online" : "Learning"}</p><p className="text-xs text-muted-foreground">Status</p></CardContent></Card>
        </div>

        <Tabs defaultValue="activity" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="activity">Posts</TabsTrigger>
            <TabsTrigger id="brain-tab" value="brain">Brain</TabsTrigger>
            <TabsTrigger value="teach">About</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Recent posts</CardTitle>
                  <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-3 w-3 mr-1" />Refresh</Button>
                </div>
                <CardDescription>Latest public-facing outputs from Imagination.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {entityPosts.length > 0 ? entityPosts.map((post) => (
                  <PostCard key={post.id} post={post} />
                )) : sampleOutputs.length > 0 ? sampleOutputs.map((text, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/50 border text-sm italic">"{text}"</div>
                )) : <p className="text-sm text-muted-foreground">No generated outputs yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="brain" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />Neural health</CardTitle>
                <CardDescription>Backend metrics are intentionally isolated behind this tab.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div><div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Φ Transition Quality</span><span>{(ns.phi.phi * 100).toFixed(0)}%</span></div><Progress value={ns.phi.phi * 100} className="h-2" /></div>
                <div><div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Fusion Strength</span><span>{((ns.dualLearning?.fusionStrength ?? 0) * 100).toFixed(0)}%</span></div><Progress value={(ns.dualLearning?.fusionStrength ?? 0) * 100} className="h-2" /></div>
                <div><div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Language Entropy</span><span>{((ns.dualLearning?.language.entropy ?? 0) * 100).toFixed(0)}%</span></div><Progress value={(ns.dualLearning?.language.entropy ?? 0) * 100} className="h-2" /></div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge className={stageColors[vs.brainStage]}>Stage {vs.brainStage}: {vs.stageName}</Badge>
                  <Badge variant="outline">Phase: {ns.phi.currentPhase}</Badge>
                  <Badge variant="outline">Recommendation: {ns.phi.recommendation}</Badge>
                  <Badge variant="outline">Q-Score: {qScore ? qScore.predicted.toFixed(3) : "—"}</Badge>
                  <Badge variant="outline">Transitions: {transitionCount}</Badge>
                  <Badge variant="outline">Neurons: {ns.totalNeurons}</Badge>
                  <Badge variant="outline">Vocabulary: {vs.vocabularySize}</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Top topics</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {topTokens.length > 0 ? topTokens.map((token, idx) => (
                  <Badge key={`${token.token}-${idx}`} variant="secondary" className="text-xs">{token.token} <span className="ml-1 opacity-60">({token.frequency.toFixed(1)})</span></Badge>
                )) : <p className="text-sm text-muted-foreground">No readable topics yet.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Memory coins across mesh</CardTitle>
                <CardDescription>Peers with strongest synced memory + coin state.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {memoryCoinPeers.length > 0 ? memoryCoinPeers.map((peer) => (
                  <div key={peer.peerId} className="flex items-center justify-between rounded-md border p-2 text-xs">
                    <span className="font-mono truncate max-w-[170px]">{peer.peerId}</span>
                    <span className="text-muted-foreground">coins {peer.coins} · memory {peer.memory} · trust {peer.trust.toFixed(1)}</span>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No mesh memory coin data yet.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Transition references</CardTitle>
                <CardDescription>Most-used transition patterns currently shaping generation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {transitionSamples.length > 0 ? transitionSamples.map((t) => (
                  <div key={t.pattern} className="flex items-center justify-between rounded-md border p-2 text-xs">
                    <span className="font-mono truncate max-w-[220px]">{t.pattern}</span>
                    <span className="text-muted-foreground">{t.weight.toFixed(1)}</span>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No transition references yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="teach">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />About Imagination</CardTitle>
                <CardDescription>
                  User-facing profile view. If you want to inspect or tune cognition, use the Brain tab.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Imagination behaves like a normal account in the social feed and discovery surfaces. Advanced controls remain opt-in.
                </p>
                <Textarea
                  value={teachingText}
                  onChange={(e) => setTeachingText(e.target.value)}
                  placeholder="Optional: write text for Imagination to learn from..."
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
