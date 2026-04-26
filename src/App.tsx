import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { recordAppEvent } from "@/lib/uqrc/appHealth";
import { P2PProvider } from "@/contexts/P2PContext";
import { StreamingProvider } from "@/contexts/StreamingContext";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { WalkthroughProvider } from "@/contexts/WalkthroughContext";
import { PreviewProvider } from "@/contexts/PreviewContext";
import WalkthroughModal from "@/components/onboarding/WalkthroughModal";
import CreditEventListener from "@/components/CreditEventListener";
import { DBUpgradeOverlay } from "@/components/DBUpgradeOverlay";

import { AutoMiningService } from "@/components/AutoMiningService";
import { StreamingBackgroundService } from "@/components/streaming/StreamingBackgroundService";
import { BrainChatLauncher } from "@/components/brain/BrainChatLauncher";
import { StreamNotificationBanner } from "@/components/streaming/StreamNotificationBanner";
import { PreJoinModal } from "@/components/streaming/PreJoinModal";

import { MobileBottomBar } from "@/components/MobileBottomBar";
import { NodeDashboardEventBridge } from "@/components/p2p/NodeDashboardEventBridge";
import { PreviewBanner } from "@/components/PreviewBanner";
import { useStreaming } from "@/hooks/useStreaming";
import { useState } from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { EnterBrainButton } from "@/components/brain/EnterBrainButton";
import { useAuthReady } from "@/hooks/useAuthReady";

// ── Lazy-loaded route pages ──
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Settings = lazy(() => import("./pages/Settings"));
const Explore = lazy(() => import("./pages/Explore"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Files = lazy(() => import("./pages/Files"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Planner = lazy(() => import("./pages/Planner"));
const Create = lazy(() => import("./pages/Create"));
const Profile = lazy(() => import("./pages/Profile"));
const Moderation = lazy(() => import("./pages/Moderation"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const ProjectSettings = lazy(() => import("./pages/ProjectSettings"));
const Search = lazy(() => import("./pages/Search"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Posts = lazy(() => import("./pages/Posts"));
const PostDetail = lazy(() => import("./pages/PostDetail"));
const BlogDetail = lazy(() => import("./pages/BlogDetail"));
const NodeDashboard = lazy(() => import("./pages/NodeDashboard"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Preview = lazy(() => import("./pages/Preview"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const WhitepaperPage = lazy(() => import("./pages/Whitepaper"));
const PrivacyPage = lazy(() => import("./pages/Privacy"));
const AboutNetworkPage = lazy(() => import("./pages/AboutNetwork"));
const NeuralNetworkPage = lazy(() => import("./pages/NeuralNetwork"));
const VirtualHub = lazy(() => import("./pages/VirtualHub"));
const BrainUniverse = lazy(() => import("./pages/BrainUniverse"));

// Eager preload of the Brain chunk as soon as auth resolves with a logged-in
// user. Removes the visible "Suspense fallback → wrong page" flash some
// browsers exhibit when navigating from `/` to `/brain`.
function BrainChunkPreloader() {
  const { user, isReady } = useAuthReady();
  useEffect(() => {
    if (isReady && user) {
      void import("./pages/BrainUniverse");
    }
  }, [isReady, user]);
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

function AppContent() {
  const { joinRoom, connect } = useStreaming();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingJoinRoomId, setPendingJoinRoomId] = useState<string | null>(null);

  useEffect(() => {
    // Per-route navigation pulse → field. Pages that error often will
    // accumulate curvature and surface in AppHealthBadge hotspots.
    try {
      recordAppEvent("route", location.pathname || "/", { reward: 0.1 });
    } catch { /* ignore */ }
  }, [location.pathname]);

  const handleJoinStream = async (roomId: string) => {
    setPendingJoinRoomId(roomId);
  };

  const handlePreJoinComplete = async (selection: {
    audio: boolean;
    video: boolean;
    audioDeviceId?: string;
    videoDeviceId?: string;
  }) => {
    const roomId = pendingJoinRoomId;
    if (!roomId) return;
    setPendingJoinRoomId(null);
    try {
      if (typeof window !== "undefined") {
        (window as any).__swarmPreJoin = { roomId, ...selection };
        window.dispatchEvent(
          new CustomEvent("stream-prejoin-selection", {
            detail: { roomId, ...selection },
          }),
        );
      }
      await connect();
      await joinRoom(roomId);
      navigate("/");
    } catch (error) {
      console.error("[App] Failed to join stream:", error);
    }
  };

  return (
    <>
      <PreviewBanner />
      <NodeDashboardEventBridge />
      <BrainChunkPreloader />

      <div className="pb-16 md:pb-0">
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
          <Routes>
            {/* Public routes — no login required */}
            <Route path="/auth" element={<Auth />} />
            <Route path="/preview" element={<Preview />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/whitepaper" element={<WhitepaperPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/about-network" element={<AboutNetworkPage />} />

            {/* Landing page — public, no login required */}
            <Route path="/" element={<Index />} />
            <Route path="/index" element={<Index />} />

            {/* Guarded routes — require login */}
            <Route element={<AuthGuard />}>
              <Route path="/posts" element={<Posts />} />
              <Route path="/posts/:postId" element={<PostDetail />} />
              <Route path="/blog/:postId" element={<BlogDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/moderation" element={<Moderation />} />
              <Route path="/files" element={<Files />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/planner" element={<Planner />} />
              <Route path="/create" element={<Create />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/u/:username" element={<Profile />} />
              <Route path="/projects/:projectId" element={<ProjectDetail />} />
              <Route path="/projects/:projectId/settings" element={<ProjectSettings />} />
              <Route path="/projects/:projectId/hub" element={<VirtualHub />} />
              <Route path="/brain" element={<BrainUniverse />} />
              <Route path="/node-dashboard" element={<NodeDashboard />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/search" element={<Search />} />
              <Route path="/neural-network" element={<NeuralNetworkPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>

      {/* Persistent mobile bottom navigation */}
      <MobileBottomBar />

      <StreamingBackgroundService />
      <BrainChatLauncher />
      <EnterBrainButton />
      <StreamNotificationBanner onJoin={handleJoinStream} />
      <PreJoinModal
        open={pendingJoinRoomId !== null}
        roomTitle="Live room"
        onJoin={handlePreJoinComplete}
        onCancel={() => setPendingJoinRoomId(null)}
      />
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <PreviewProvider>
        <OnboardingProvider>
          <WalkthroughProvider>
            <P2PProvider>
              <StreamingProvider>
                <CreditEventListener />
                <AutoMiningService />
                <DBUpgradeOverlay />
                
                
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  <AppContent />
                  <WalkthroughModal />
                </BrowserRouter>
              </StreamingProvider>
            </P2PProvider>
          </WalkthroughProvider>
        </OnboardingProvider>
      </PreviewProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;