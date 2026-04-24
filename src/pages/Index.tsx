import { TopNavigationBar } from "@/components/TopNavigationBar";
import { HeroSection } from "@/components/HeroSection";
import { FeatureHighlights } from "@/components/FeatureHighlights";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePreview } from "@/contexts/PreviewContext";
import { SwarmApprovalCard } from "@/components/onboarding/SwarmApprovalCard";
import { SignupWizard } from "@/components/onboarding/SignupWizard";
import type { UserMeta } from "@/lib/auth";

export default function Index() {
  const { user, isLoading } = useAuth();
  const { isPreviewMode } = usePreview();
  const [signupOpen, setSignupOpen] = useState(false);
  const navigate = useNavigate();

  // Redirect to preview page if in preview mode
  useEffect(() => {
    if (isPreviewMode) {
      navigate('/preview', { replace: true });
    }
  }, [isPreviewMode, navigate]);

  // Redirect logged-in users to the Brain lobby — gives P2P / sync time
  // to settle in the background while the user has something to do.
  // Explore's heavy IndexedDB fan-out is deferred until they walk over.
  useEffect(() => {
    // Gate on auth resolving so Chrome's stricter scheduler doesn't fall
    // through to /profile when useAuth resolves after the redirect window.
    if (!isLoading && user) {
      navigate('/brain', { replace: true });
    }
  }, [user, isLoading, navigate]);

  // Lightspeed-operator safety net: Chrome can defer the redirect frame when
  // PeerJS / IndexedDB boot races the auth restore. Re-check on the next two
  // animation frames so a late `user` resolve still lands on /brain instead
  // of leaving the visitor stranded on the marketing page.
  useEffect(() => {
    if (isLoading) return;
    if (!user) return;
    let raf1 = 0, raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (window.location.pathname === '/' || window.location.pathname === '/index') {
          navigate('/brain', { replace: true });
        }
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [user, isLoading, navigate]);

  const handleSignupComplete = (_user: UserMeta) => {
    setSignupOpen(false);
  };

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <HeroSection />
      <FeatureHighlights />

      {/* SWARM Approval Card for unauthenticated visitors */}
      <div className="px-6 py-16 md:py-24 bg-gradient-to-b from-transparent via-primary/5 to-transparent">
        <div className="max-w-4xl mx-auto">
          <SwarmApprovalCard onAccept={() => setSignupOpen(true)} />
        </div>
      </div>

      {/* Footer CTA */}
      <div className="px-6 py-16 text-center">
        <div className="max-w-2xl mx-auto animate-fade-in">
          <h2 className="text-2xl md:text-3xl font-display font-bold mb-4 text-foreground">
            Ready to take control of your data?
          </h2>
          <p className="text-foreground/60 mb-8">
            Join the decentralized revolution. No servers, no tracking, just you and your creativity.
          </p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_30px_hsla(326,71%,62%,0.5)]"
            onClick={() => setSignupOpen(true)}
          >
            Get Started
          </Button>
        </div>
      </div>

      <SignupWizard
        open={signupOpen}
        onComplete={handleSignupComplete}
        onDismiss={() => setSignupOpen(false)}
      />
    </div>
  );
}
