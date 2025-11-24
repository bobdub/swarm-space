import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { P2PProvider } from "@/contexts/P2PContext";
import { StreamingProvider } from "@/contexts/StreamingContext";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { WalkthroughProvider } from "@/contexts/WalkthroughContext";
import { PreviewProvider } from "@/contexts/PreviewContext";
import OnboardingGate from "@/components/onboarding/OnboardingGate";
import WalkthroughModal from "@/components/onboarding/WalkthroughModal";
import CreditEventListener from "@/components/CreditEventListener";
import { StreamingRoomTray } from "@/components/streaming/StreamingRoomTray";
import { StreamNotificationBanner } from "@/components/streaming/StreamNotificationBanner";
import { LegacyUserVerificationPrompt } from "@/components/verification/LegacyUserVerificationPrompt";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Settings from "./pages/Settings";
import Explore from "./pages/Explore";
import Notifications from "./pages/Notifications";
import Files from "./pages/Files";
import Tasks from "./pages/Tasks";
import Planner from "./pages/Planner";
import Create from "./pages/Create";
import Profile from "./pages/Profile";
import Moderation from "./pages/Moderation";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectSettings from "./pages/ProjectSettings";
import Search from "./pages/Search";
import NotFound from "./pages/NotFound";
import Posts from "./pages/Posts";
import Trending from "./pages/Trending";
import PostDetail from "./pages/PostDetail";
import NodeDashboard from "./pages/NodeDashboard";
import Wallet from "./pages/Wallet";
import Preview from "./pages/Preview";
import { NodeDashboardEventBridge } from "@/components/p2p/NodeDashboardEventBridge";
import { PreviewBanner } from "@/components/PreviewBanner";
import { useStreaming } from "@/hooks/useStreaming";

const queryClient = new QueryClient();

function AppContent() {
  const { activeRoom, joinRoom, connect } = useStreaming();
  const navigate = useNavigate();

  const handleJoinStream = async (roomId: string) => {
    try {
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
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/preview" element={<Preview />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/posts" element={<Posts />} />
        <Route path="/posts/:postId" element={<PostDetail />} />
        <Route path="/trending" element={<Trending />} />
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
        <Route path="/node-dashboard" element={<NodeDashboard />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/search" element={<Search />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {activeRoom && <StreamingRoomTray />}
      <StreamNotificationBanner onJoin={handleJoinStream} />
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
                <LegacyUserVerificationPrompt />
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  <AppContent />
                  <WalkthroughModal />
                  <OnboardingGate />
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
