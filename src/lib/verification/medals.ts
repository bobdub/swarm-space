import type { VerificationMedal, VerificationMetrics } from "./types";
import { calculateOverallEntropy } from "./entropy";

interface MedalEvaluation {
  medal: VerificationMedal;
  cardIcon?: string;
}

/**
 * Determine which medal to award based on verification metrics
 * Priority order: Dream Matcher > Last Reflection > Patience Protocol > Irony Chip
 */
export function awardMedal(metrics: VerificationMetrics): MedalEvaluation {
  const entropy = calculateOverallEntropy(metrics);

  // Dream Matcher: Perfect accuracy < 60s AND entropy > 0.8
  if (
    metrics.completionTime < 60000 &&
    metrics.accuracyRate === 1.0 &&
    entropy > 0.8
  ) {
    return { medal: "dream-matcher" };
  }

  // Last Reflection: Flipped same card 3+ times
  if (metrics.repeatCount && metrics.repeatCount >= 3 && metrics.repeatedCard !== undefined) {
    return { 
      medal: "last-reflection",
      cardIcon: metrics.repeatedCard.toString(),
    };
  }

  // Patience Protocol: Completed between 90-150s AND entropy > 0.4
  if (
    metrics.completionTime >= 90000 &&
    metrics.completionTime <= 150000 &&
    entropy > 0.4
  ) {
    return { medal: "patience-protocol" };
  }

  // Irony Chip: Default if passed minimum entropy threshold
  if (entropy >= 0.3) {
    return { medal: "irony-chip" };
  }

  // Should not reach here if validation passed, but return irony-chip as fallback
  return { medal: "irony-chip" };
}

/**
 * Get medal display information
 */
export function getMedalInfo(medal: VerificationMedal): {
  title: string;
  description: string;
  icon: string;
} {
  switch (medal) {
    case "dream-matcher":
      return {
        title: "Dream Matcher",
        description: "Perfect precision with natural motion",
        icon: "🧩",
      };
    case "last-reflection":
      return {
        title: "Last Reflection",
        description: "Found patterns in the reflection",
        icon: "🪞",
      };
    case "patience-protocol":
      return {
        title: "Patience Protocol",
        description: "Steady and deliberate mastery",
        icon: "⏳",
      };
    case "irony-chip":
      return {
        title: "Irony Chip",
        description: "Verified human consciousness",
        icon: "🤖",
      };
  }
}
