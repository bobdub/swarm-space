import type {
  VerificationMedal,
  VerificationMedalRecord,
  VerificationMetrics,
} from "@/types/verification";

export interface MedalDecision {
  medal: VerificationMedal | null;
  cardImage?: string | null;
}

const DREAM_MATCHER_THRESHOLD = 0.8;
const PATIENCE_THRESHOLD = 0.4;
const MIN_ENTROPY_FOR_IRONY = 0.2;

export function assignMedal(
  metrics: VerificationMetrics,
  repeatedCardImage?: string | null,
): MedalDecision {
  const { entropyScore, totalTimeMs, perfectAccuracy, repeatedCardFlips, accuracy } = metrics;
  const totalSeconds = totalTimeMs / 1000;

  if (perfectAccuracy && totalSeconds <= 60 && entropyScore > DREAM_MATCHER_THRESHOLD) {
    return { medal: "Dream_Matcher" };
  }

  if (repeatedCardFlips >= 3) {
    return { medal: "Last_Reflection", cardImage: repeatedCardImage ?? null };
  }

  if (totalSeconds > 90 && totalSeconds <= 150 && entropyScore > PATIENCE_THRESHOLD) {
    return { medal: "Patience_Protocol" };
  }

  if (entropyScore >= MIN_ENTROPY_FOR_IRONY && accuracy >= 0.4) {
    return { medal: "Irony_Chip" };
  }

  return { medal: null };
}

const MEDAL_PRIORITY: Record<VerificationMedal, number> = {
  Dream_Matcher: 0,
  Last_Reflection: 1,
  Patience_Protocol: 2,
  Irony_Chip: 3,
};

export function sortMedalsByPriority(medals: VerificationMedal[]): VerificationMedal[] {
  return [...medals].sort((a, b) => MEDAL_PRIORITY[a] - MEDAL_PRIORITY[b]);
}

export function selectHighestPriorityMedal(
  medals: VerificationMedal[],
): VerificationMedal | null {
  const sorted = sortMedalsByPriority(medals);
  return sorted.length > 0 ? sorted[0] : null;
}

export function selectHighestPriorityMedalRecord(
  records: VerificationMedalRecord[],
): VerificationMedalRecord | null {
  if (records.length === 0) {
    return null;
  }

  const latestByMedal = new Map<VerificationMedal, VerificationMedalRecord>();

  for (const record of records) {
    const existing = latestByMedal.get(record.medal);
    if (!existing || existing.earnedAt < record.earnedAt) {
      latestByMedal.set(record.medal, record);
    }
  }

  const highestMedal = selectHighestPriorityMedal([...latestByMedal.keys()]);
  return highestMedal ? latestByMedal.get(highestMedal) ?? null : null;
}
