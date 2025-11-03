import { getAllByIndex, put } from "@/lib/store";
import type {
  VerificationMedal,
  VerificationMedalRecord,
  VerificationProofEnvelope,
} from "@/types/verification";

export interface VerificationRecord {
  id: string;
  userId: string;
  issuedAt: string;
  medal: VerificationMedal;
  manifestId: string;
  signature: string;
  publicKey: string;
  entropyScore: number;
  entropyScoreHash: string;
  totalTimeMs: number;
  moveCount: number;
  accuracy: number;
  createdAt: string;
  medalCardImage?: string | null;
}

export async function saveVerificationRecord(
  userId: string,
  envelope: VerificationProofEnvelope,
): Promise<VerificationRecord> {
  const record: VerificationRecord = {
    id: envelope.payload.sessionId,
    userId,
    issuedAt: envelope.payload.issuedAt,
    medal: envelope.payload.medal,
    manifestId: envelope.manifestId,
    signature: envelope.signature,
    publicKey: envelope.publicKey,
    entropyScore: envelope.payload.entropyScore,
    entropyScoreHash: envelope.payload.entropyScoreHash,
    totalTimeMs: envelope.payload.totalTimeMs,
    moveCount: envelope.payload.moveCount,
    accuracy: envelope.payload.accuracy,
    createdAt: new Date().toISOString(),
    medalCardImage: envelope.payload.medalCardImage ?? null,
  };

  await put("humanVerification", record);
  return record;
}

export async function listVerificationRecordsForUser(
  userId: string,
): Promise<VerificationRecord[]> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return [];
  }

  try {
    return await getAllByIndex<VerificationRecord>("humanVerification", "userId", userId);
  } catch (error) {
    console.warn(`[Verification] Failed to load medal history for ${userId}`, error);
    return [];
  }
}

export function toMedalRecord(record: VerificationRecord): VerificationMedalRecord {
  return {
    medal: record.medal,
    earnedAt: record.issuedAt,
    cardImage: record.medalCardImage ?? null,
    entropyScore: record.entropyScore,
    totalTimeMs: record.totalTimeMs,
  };
}

export async function loadMedalHistoryForUser(
  userId: string,
): Promise<VerificationMedalRecord[]> {
  if (!userId) {
    return [];
  }

  const records = await listVerificationRecordsForUser(userId);
  return records
    .map(toMedalRecord)
    .sort((a, b) => (a.earnedAt < b.earnedAt ? 1 : -1));
}
