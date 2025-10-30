import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { P2PProvider } from "@/contexts/P2PContext";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { WalkthroughProvider } from "@/contexts/WalkthroughContext";
import OnboardingGate from "@/components/onboarding/OnboardingGate";
import WalkthroughModal from "@/components/onboarding/WalkthroughModal";
import CreditEventListener from "@/components/CreditEventListener";
import Index from "./pages/Index";
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
import Search from "./pages/Search";
import NotFound from "./pages/NotFound";
import Posts from "./pages/Posts";
import Trending from "./pages/Trending";
import PostDetail from "./pages/PostDetail";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <OnboardingProvider>
        <WalkthroughProvider>
          <P2PProvider>
            <CreditEventListener />
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
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
                <Route path="/search" element={<Search />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
            <WalkthroughModal />
            <OnboardingGate />
          </P2PProvider>
        </WalkthroughProvider>
      </OnboardingProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
