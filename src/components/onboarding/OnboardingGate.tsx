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
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { useAuth } from "@/hooks/useAuth";
import { SCROLL_GUARD_BUFFER_PX } from "@/lib/onboarding/constants";
import tosContent from "../../../TOS.md?raw";

type TosSection =
  | { type: "heading"; level: 1 | 2; content: string }
  | { type: "paragraph"; content: string }
  | { type: "unordered-list"; content: string[] }
  | { type: "ordered-list"; content: string[] }
  | { type: "quote"; content: string }
  | { type: "divider" };

const parseTosContent = (content: string): TosSection[] => {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks = normalized.split(/\n{2,}/);
  const sections: TosSection[] = [];

  chunks.forEach((chunk) => {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (line === "---") {
        sections.push({ type: "divider" });
        index += 1;
        continue;
      }

      if (line.startsWith("## ")) {
        sections.push({
          type: "heading",
          level: 2,
          content: line.replace(/^##\s+/, ""),
        });
        index += 1;
        continue;
      }

      if (line.startsWith("# ")) {
        sections.push({
          type: "heading",
          level: 1,
          content: line.replace(/^#\s+/, ""),
        });
        index += 1;
        continue;
      }

      if (line.startsWith(">")) {
        const quoteLines: string[] = [];
        while (index < lines.length && lines[index].startsWith(">")) {
          quoteLines.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        sections.push({
          type: "quote",
          content: quoteLines.join(" "),
        });
        continue;
      }

      if (line.startsWith("- ")) {
        const items: string[] = [];
        while (index < lines.length && lines[index].startsWith("- ")) {
          items.push(lines[index].replace(/^-+\s*/, ""));
          index += 1;
        }
        sections.push({ type: "unordered-list", content: items });
        continue;
      }

      if (/^\d+\./.test(line)) {
        const items: string[] = [];
        while (index < lines.length && /^\d+\./.test(lines[index])) {
          items.push(lines[index].replace(/^\d+\.\s*/, ""));
          index += 1;
        }
        sections.push({ type: "ordered-list", content: items });
        continue;
      }

      sections.push({ type: "paragraph", content: line });
      index += 1;
    }
  });

  return sections;
};

export const OnboardingGate = () => {
  const { user } = useAuth();
  const {
    state: { needsTosAcceptance },
    acceptTos,
  } = useOnboarding();
  const {
    state: walkthroughState,
    start: startWalkthrough,
    resume: resumeWalkthrough,
  } = useWalkthrough();
  const { currentStep, completedSteps, isDismissed } = walkthroughState;
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);

  // Only show TOS if user is logged in
  const shouldShowTos = user && needsTosAcceptance;

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

  const launchWalkthrough = useCallback(() => {
    if (isDismissed || currentStep === "done") {
      return;
    }

    if (completedSteps.length > 0) {
      resumeWalkthrough();
    } else {
      startWalkthrough();
    }
  }, [completedSteps.length, currentStep, isDismissed, resumeWalkthrough, startWalkthrough]);

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

  const tosSections = useMemo(() => parseTosContent(tosContent), []);

  const hasTosContent = tosSections.length > 0;

  return (
    <Dialog open={shouldShowTos}>
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
            Scroll through the full policy below. The content matches the canonical Terms of
            Service stored in <code>TOS.md</code> within the repository.
          </p>
          <div
            ref={scrollViewportRef}
            className="h-64 space-y-4 overflow-y-auto rounded-md border px-6 py-4 text-sm"
            onScroll={handleScroll}
          >
            {hasTosContent ? (
              tosSections.map((section, index) => {
                switch (section.type) {
                  case "heading": {
                    const HeadingTag = section.level === 1 ? "h2" : "h3";
                    return (
                      <HeadingTag
                        key={`heading-${index}`}
                        className="font-semibold uppercase tracking-[0.2em] text-foreground"
                      >
                        {section.content}
                      </HeadingTag>
                    );
                  }
                  case "quote":
                    return (
                      <blockquote
                        key={`quote-${index}`}
                        className="border-l-2 border-border/60 pl-4 italic text-muted-foreground"
                      >
                        {section.content}
                      </blockquote>
                    );
                  case "unordered-list":
                    return (
                      <ul
                        key={`ul-${index}`}
                        className="list-disc space-y-1 pl-6 text-muted-foreground"
                      >
                        {section.content.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}</li>
                        ))}
                      </ul>
                    );
                  case "ordered-list":
                    return (
                      <ol
                        key={`ol-${index}`}
                        className="list-decimal space-y-1 pl-6 text-muted-foreground"
                      >
                        {section.content.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}</li>
                        ))}
                      </ol>
                    );
                  case "divider":
                    return (
                      <hr
                        key={`divider-${index}`}
                        className="border-border/60"
                        aria-hidden="true"
                      />
                    );
                  case "paragraph":
                  default:
                    return (
                      <p
                        key={`paragraph-${index}`}
                        className="leading-relaxed text-muted-foreground"
                      >
                        {section.content}
                      </p>
                    );
                }
              })
            ) : (
              <p className="leading-relaxed text-muted-foreground">
                The Terms of Service could not be loaded. Please refer to the TOS.md file in the
                repository.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Your acceptance will be stored locally. If a future version of the Terms
            of Service ships, you will be asked to review the updates again.
          </p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              acceptTos();
              launchWalkthrough();
            }}
            disabled={!hasScrolledToEnd}
          >
            I have read and accept the Terms of Service
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingGate;
