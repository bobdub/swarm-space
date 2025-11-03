export type VerificationMedal = 
  | "dream-matcher"
  | "last-reflection"
  | "patience-protocol"
  | "irony-chip";

export interface VerificationMetrics {
  completionTime: number;
  flipsTotal: number;
  accuracyRate: number;
  mouseMovements: Array<{ x: number; y: number; timestamp: number }>;
  clickTimings: number[];
  entropy: number;
  repeatedCard?: number;
  repeatCount?: number;
  repeatedCardIcon?: string;
}

export interface VerificationProof {
  id: string;
  userId: string;
  humanVerified: true;
  medal: VerificationMedal;
  creditsEarned: number;
  metrics: VerificationMetrics;
  timestamp: string;
  signature: string;
  publicKey: string;
}

export interface VerificationState {
  verified: boolean;
  verifiedAt: string | null;
  medal: VerificationMedal | null;
  promptShown: boolean;
  promptShownAt: string | null;
  attempts: number;
}

export interface MemoryCard {
  id: number;
  value: string;
  icon: string;
  flipped: boolean;
  matched: boolean;
}
