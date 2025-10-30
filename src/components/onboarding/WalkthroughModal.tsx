import { useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { WALKTHROUGH_STEPS, type WalkthroughStep } from "@/lib/onboarding/constants";

const CORE_STEPS = WALKTHROUGH_STEPS.filter((step) => step !== "done");

type StepContent = {
  title: string;
  description: string[];
  tip?: string;
};

const STEP_CONTENT: Record<WalkthroughStep, StepContent> = {
  welcome: {
    title: "Welcome to Flux Mesh",
    description: [
      "Flux is a collaborative mesh where peers share creations, energy, and credit signals.",
      "This quick tour highlights the core surfaces so you can start creating immediately.",
    ],
    tip: "You can always reopen the walkthrough later from Settings if you want a refresher.",
  },
  mesh: {
    title: "Discover the Mesh",
    description: [
      "The live mesh map shows who is online and which spaces are active in real time.",
      "Use the P2P controls to connect with collaborators or tune discovery to your projects.",
    ],
    tip: "Presence pulses and connection badges help you see when teammates are ready to sync.",
  },
  projects: {
    title: "Organize Projects",
    description: [
      "Create projects to anchor milestones, files, and tasks around a shared goal.",
      "Task boards and posts keep momentum visible for every contributor in the mesh.",
    ],
    tip: "Invite peers directly from a project to grant them the right context immediately.",
  },
  credits: {
    title: "Share Credits",
    description: [
      "Credits signal appreciation and unlock achievements across the network.",
      "Send credits to peers after reviews, mentorship, or shipping impactful work.",
    ],
    tip: "You can review your history from the top navigation bar's credit ledger.",
  },
  done: {
    title: "You're ready to explore",
    description: [
      "You've completed the Flux walkthrough. Dive in, or revisit steps anytime from Settings.",
    ],
  },
};

const stepOrder = new Map<WalkthroughStep, number>(
  WALKTHROUGH_STEPS.map((step, index) => [step, index]),
);

const getProgressValue = (currentStep: WalkthroughStep) => {
  const currentIndex = stepOrder.get(currentStep) ?? 0;
  const maxIndex = CORE_STEPS.length - 1;
  if (maxIndex <= 0) {
    return currentStep === "done" ? 100 : 0;
  }

  const boundedIndex = Math.min(currentIndex, maxIndex);
  const progress = Math.round((boundedIndex / maxIndex) * 100);
  return currentStep === "done" ? 100 : progress;
};

const WalkthroughModal = () => {
  const { state, start, resume, completeStep, dismiss } = useWalkthrough();
  const { state: onboardingState } = useOnboarding();
  const { currentStep: activeStep, completedSteps, isActive, isDismissed } = state;

  const shouldAutoStart = useMemo(
    () =>
      !onboardingState.needsTosAcceptance &&
      !onboardingState.walkthroughDone &&
      !isDismissed,
    [onboardingState.needsTosAcceptance, onboardingState.walkthroughDone, isDismissed],
  );

  useEffect(() => {
    if (!shouldAutoStart) {
      return;
    }

    if (isActive || activeStep === "done") {
      return;
    }

    if (completedSteps.length > 0) {
      resume();
    } else {
      start();
    }
  }, [activeStep, completedSteps.length, isActive, resume, shouldAutoStart, start]);
  const content = STEP_CONTENT[activeStep] ?? STEP_CONTENT.welcome;
  const isFinalStep = activeStep === CORE_STEPS[CORE_STEPS.length - 1];

  const handleAdvance = () => {
    completeStep();
  };

  const open = isActive && activeStep !== "done";
  const progress = getProgressValue(activeStep);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dismiss();
        }
      }}
    >
      <DialogContent aria-describedby="flux-walkthrough-description" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          <DialogDescription id="flux-walkthrough-description">
            Step {Math.min((stepOrder.get(activeStep) ?? 0) + 1, CORE_STEPS.length)} of {CORE_STEPS.length}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Progress value={progress} className="h-2" aria-label="Walkthrough progress" />
          <div className="space-y-2 text-sm text-muted-foreground">
            {content.description.map((line, index) => (
              <p key={index} className="leading-relaxed">
                {line}
              </p>
            ))}
          </div>
          {content.tip ? (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Tip:</span> {content.tip}
            </div>
          ) : null}
          <Separator />
          <ol className="grid grid-cols-2 gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {CORE_STEPS.map((step) => {
              const index = stepOrder.get(step) ?? 0;
              const completed = completedSteps.includes(step);
              const isCurrent = step === activeStep;
              return (
                <li
                  key={step}
                  className={`rounded-md border px-2 py-2 text-center transition ${
                    completed
                      ? "border-primary/80 bg-primary/10 text-primary"
                      : isCurrent
                        ? "border-primary/60 bg-primary/5 text-foreground"
                        : "border-border/60 bg-background"
                  }`}
                >
                  <span className="block text-[0.7rem] font-semibold">
                    {index + 1}. {step.replace(/^(.)/, (char) => char.toUpperCase())}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant="secondary"
            onClick={() => dismiss()}
            className="sm:order-2"
          >
            Skip walkthrough
          </Button>
          <Button onClick={handleAdvance} className="w-full sm:order-1">
            {isFinalStep ? "Finish walkthrough" : "Next step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WalkthroughModal;
