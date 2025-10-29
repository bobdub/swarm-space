import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  "Flux Mesh is a peer-to-peer collaboration mesh. Every node is sovereign, availability depends on the peers online, and participation means honoring the decentralized governance described in the Terms of Service.",
  "Eligibility requires that you can enter binding agreements where you live and that you follow local laws on cryptography, networking, and content. Credentials or keys issued to you are personal and must be safeguarded.",
  "You are responsible for the security of your device, storage, and encryption keys. Report suspected vulnerabilities responsibly and avoid attempts to deanonymise or exploit other peers.",
  "Respect community standards: no harassment, discrimination, spam, malware, or abusive behavior. Label sensitive or NSFW material, keep it away from public meshes when requested, and honour opt-outs.",
  "You keep the rights to the work you publish. Sharing on the mesh grants other nodes permission to cache and relay it until you retract it, and forks must clearly state how they differ from the primary network.",
  "Community moderators may isolate disruptive nodes. Continued use after policy updates signals acceptance, and you may always fork the project if you disagree with future revisions.",
];

export const OnboardingGate = () => {
  const {
    state: { needsTosAcceptance },
    acceptTos,
  } = useOnboarding();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);

  useEffect(() => {
    setHasScrolledToEnd(false);
  }, [needsTosAcceptance]);

  const updateScrollCompletion = useCallback(() => {
    const viewport = scrollViewportRef.current;

    if (!viewport) {
      return;
    }

    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

    setHasScrolledToEnd((previous) =>
      previous || distanceFromBottom <= SCROLL_GUARD_BUFFER_PX,
    );
  }, []);

  const handleScroll = useCallback(() => {
    updateScrollCompletion();
  }, [updateScrollCompletion]);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!needsTosAcceptance || !viewport) {
      return;
    }

    const autoAcceptIfNotScrollable = () => {
      const maxScrollableDistance =
        viewport.scrollHeight - viewport.clientHeight;

      if (maxScrollableDistance <= SCROLL_GUARD_BUFFER_PX) {
        setHasScrolledToEnd(true);
        return true;
      }

      return false;
    };

    if (!autoAcceptIfNotScrollable()) {
      updateScrollCompletion();
    }

    if (typeof window !== "undefined") {
      if (typeof window.ResizeObserver !== "undefined") {
        const resizeObserver = new window.ResizeObserver(() => {
          if (!autoAcceptIfNotScrollable()) {
            updateScrollCompletion();
          }
        });

        resizeObserver.observe(viewport);

        return () => {
          resizeObserver.disconnect();
        };
      }

      const handleWindowResize = () => {
        if (!autoAcceptIfNotScrollable()) {
          updateScrollCompletion();
        }
      };

      window.addEventListener("resize", handleWindowResize);

      return () => {
        window.removeEventListener("resize", handleWindowResize);
      };
    }
  }, [needsTosAcceptance, updateScrollCompletion]);

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
            Scroll through the summary below. You can review the complete policy in the
            repository at <code>TOS.md</code> or <code>docs/TOS_draft.md</code>.
          </p>
          <div
            ref={scrollViewportRef}
            className="h-64 space-y-4 overflow-y-auto rounded-md border px-6 py-4 text-sm"
            onScroll={handleScroll}
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
