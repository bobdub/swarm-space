import { put } from "@/lib/store";
import type { VerificationProofEnvelope, VerificationMedal } from "@/types/verification";

export interface VerificationRecord {
  id: string;
  userId: string;
  issuedAt: string;
  medal: VerificationMedal;
  manifestId: string;
  signature: string;
  publicKey: string;
  entropyScore: number;
  totalTimeMs: number;
  moveCount: number;
  accuracy: number;
  createdAt: string;
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
    totalTimeMs: envelope.payload.totalTimeMs,
    moveCount: envelope.payload.moveCount,
    accuracy: envelope.payload.accuracy,
    createdAt: new Date().toISOString(),
  };

  await put("humanVerification", record);
  return record;
}
