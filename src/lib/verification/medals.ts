import type { VerificationMedal } from "./types";

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
