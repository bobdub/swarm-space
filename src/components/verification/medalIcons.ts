import { Cpu, Hourglass, Scan, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { VerificationMedal } from "@/types/verification";

export const MEDAL_ICON_COMPONENTS: Record<VerificationMedal, LucideIcon> = {
  Dream_Matcher: Sparkles,
  Last_Reflection: Scan,
  Patience_Protocol: Hourglass,
  Irony_Chip: Cpu,
};

export function getMedalIcon(medal: VerificationMedal): LucideIcon | null {
  return MEDAL_ICON_COMPONENTS[medal] ?? null;
}
