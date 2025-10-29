import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { SCROLL_GUARD_BUFFER_PX } from "@/lib/onboarding/constants";

const TOS_PARAGRAPHS = [
  "Flux Mesh is a peer-to-peer collaboration network focused on privacy-preserving coordination. Participation requires that you review and accept the community Terms of Service.",
  "By joining, you agree to steward your local data responsibly, respect community members, and refrain from attempts to extract identifying metadata from the mesh.",
  "Content you generate is stored locally first. Synchronisation with peers only occurs when you explicitly opt-in, and you retain the right to export or remove your work at any time.",
  "Security responsibilities are shared: keep your keys safe, report suspected vulnerabilities, and never attempt to deanonymise others without consent.",
  "Flux Mesh operates with zero tolerance for harassment, abuse, spam, or attempts to weaponise the network. Violations may lead to loss of access to mesh features and community enforcement actions.",
  "This draft is iterating alongside the product. Acceptance today covers the foundational rules above until an updated version is published in the TOS document.",
];

export const OnboardingGate = () => {
  const {
    state: { needsTosAcceptance },
    acceptTos,
  } = useOnboarding();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);

  useEffect(() => {
    if (!needsTosAcceptance) {
      setHasScrolledToEnd(false);
      return;
    }

    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (distanceFromBottom <= SCROLL_GUARD_BUFFER_PX) {
        setHasScrolledToEnd(true);
      }
    };

    handleScroll();
    viewport.addEventListener("scroll", handleScroll);

    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [needsTosAcceptance]);

  const description = useMemo(
    () =>
      "You must review the Flux Mesh Terms of Service before accessing the application.",
    [],
  );

  return (
    <Dialog open={needsTosAcceptance}>
      <DialogContent
        className="max-w-3xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
        aria-describedby="flux-tos-description"
      >
        <DialogHeader>
          <DialogTitle>Review the Flux Mesh Terms of Service</DialogTitle>
          <DialogDescription id="flux-tos-description">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Scroll through the draft below. A link to the full policy is available in
            the repository at <code>docs/TOS_draft.md</code>.
          </p>
          <div
            ref={scrollViewportRef}
            className="h-64 space-y-4 overflow-y-auto rounded-md border px-6 py-4 text-sm"
          >
            {TOS_PARAGRAPHS.map((paragraph, index) => (
              <p key={index} className="leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Your acceptance will be stored locally. If a future version of the Terms
            of Service ships, you will be asked to review the updates again.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={acceptTos} disabled={!hasScrolledToEnd}>
            I have read and accept the Terms of Service
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingGate;
