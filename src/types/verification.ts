export type VerificationMedal =
  | "Dream_Matcher"
  | "Last_Reflection"
  | "Patience_Protocol"
  | "Irony_Chip";

export interface VerificationMetrics {
  totalTimeMs: number;
  moveCount: number;
  perfectAccuracy: boolean;
  repeatedCardId: string | null;
  repeatedCardFlips: number;
  entropyScore: number;
  accuracy: number;
}

export interface VerificationSessionResult {
  medal: VerificationMedal;
  cardImage?: string | null;
  metrics: VerificationMetrics;
  issuedAt: string;
  creditsAwarded: number;
}

export interface VerificationProofPayload {
  human_verified: true;
  userId: string;
  medal: VerificationMedal;
  medalCardImage?: string | null;
  entropyScore: number;
  totalTimeMs: number;
  moveCount: number;
  accuracy: number;
  creditsAwarded: number;
  issuedAt: string;
  sessionId: string;
  manifestId: string;
}

export interface VerificationProofEnvelope {
  manifestId: string;
  signature: string;
  publicKey: string;
  payload: VerificationProofPayload;
  signedAt: string;
}

export interface VerificationMedalRecord {
  medal: VerificationMedal;
  earnedAt: string;
  cardImage?: string | null;
  entropyScore: number;
  totalTimeMs: number;
}

export interface VerificationStateSnapshot {
  requiresVerification: boolean;
  cooldownUntil: string | null;
  lastPromptedAt: string | null;
  activeProof: VerificationProofEnvelope | null;
  medalHistory: VerificationMedalRecord[];
}
