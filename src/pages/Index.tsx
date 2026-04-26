import { TopNavigationBar } from "@/components/TopNavigationBar";
import { HeroSection } from "@/components/HeroSection";
import { FeatureHighlights } from "@/components/FeatureHighlights";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuthReady } from "@/hooks/useAuthReady";
import { usePreview } from "@/contexts/PreviewContext";
import { SwarmApprovalCard } from "@/components/onboarding/SwarmApprovalCard";
import { SignupWizard } from "@/components/onboarding/SignupWizard";
import type { UserMeta } from "@/lib/auth";
import { getCanonicalHome } from "@/lib/routing/canonicalHome";

export default function Index() {
  const { user, isReady } = useAuthReady();
  const { isPreviewMode } = usePreview();
  const [signupOpen, setSignupOpen] = useState(false);
  const navigate = useNavigate();

  // Redirect to preview page if in preview mode
  useEffect(() => {
    if (isPreviewMode) {
      navigate('/preview', { replace: true });
    }
  }, [isPreviewMode, navigate]);

  const handleSignupComplete = (_user: UserMeta) => {
    setSignupOpen(false);
  };

  // Single, deterministic redirect: once auth has resolved, logged-in users
  // go straight to the Brain lobby. No rAF safety nets, no double effects —
  // `useAuthReady` guarantees every consumer sees the same `isReady` tick.
  if (isReady && user && !isPreviewMode) {
    return <Navigate to={getCanonicalHome(user)} replace />;
  }

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
