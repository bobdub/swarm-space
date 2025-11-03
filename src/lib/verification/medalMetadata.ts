import type { VerificationMedal } from "@/types/verification";

export interface MedalMetadata {
  label: string;
  description: string;
}

export const MEDAL_METADATA: Record<VerificationMedal, MedalMetadata> = {
  Dream_Matcher: {
    label: "Dream Matcher",
    description: "Perfect accuracy under a minute with high entropy.",
  },
  Last_Reflection: {
    label: "Last Reflection",
    description: "Recovered after repeating a card at least three times.",
  },
  Patience_Protocol: {
    label: "Patience Protocol",
    description: "Deliberate play that finished between 90 and 150 seconds with solid entropy.",
  },
  Irony_Chip: {
    label: "Irony Chip",
    description: "Earned by completing Dream Match with reliable entropy when no other medal applies.",
  },
};

export function getMedalMetadata(medal: VerificationMedal): MedalMetadata {
  return MEDAL_METADATA[medal] ?? { label: medal, description: "" };
}
