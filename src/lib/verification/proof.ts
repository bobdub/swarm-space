import type { VerificationProof, VerificationMetrics, VerificationMedal } from "./types";
import { sha256 } from "@/lib/crypto";

/**
 * Generate a cryptographic proof for verification completion
 */
export async function generateVerificationProof(params: {
  userId: string;
  medal: VerificationMedal;
  metrics: VerificationMetrics;
  creditsEarned: number;
}): Promise<VerificationProof> {
  const { userId, medal, metrics, creditsEarned } = params;

  // Get user's public key
  const userDataStr = localStorage.getItem("me");
  let publicKey: string;

  if (userDataStr) {
    const userData = JSON.parse(userDataStr);
    publicKey = userData.publicKey;
  } else {
    publicKey = "anonymous";
  }

  const proof: Omit<VerificationProof, "signature"> = {
    id: crypto.randomUUID(),
    userId,
    humanVerified: true,
    medal,
    creditsEarned,
    metrics,
    timestamp: new Date().toISOString(),
    publicKey,
  };

  // Create deterministic JSON for hashing
  const proofData = JSON.stringify({
    id: proof.id,
    userId: proof.userId,
    humanVerified: proof.humanVerified,
    medal: proof.medal,
    creditsEarned: proof.creditsEarned,
    timestamp: proof.timestamp,
    entropyHash: await hashEntropy(metrics),
  });

  // Create signature hash
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(proofData);
  const signature = await sha256(dataBuffer);

  return {
    ...proof,
    signature,
  };
}

/**
 * Verify a verification proof's authenticity
 */
export async function verifyVerificationProof(proof: VerificationProof): Promise<boolean> {
  try {
    const proofData = JSON.stringify({
      id: proof.id,
      userId: proof.userId,
      humanVerified: proof.humanVerified,
      medal: proof.medal,
      creditsEarned: proof.creditsEarned,
      timestamp: proof.timestamp,
      entropyHash: await hashEntropy(proof.metrics),
    });

    // Recompute signature hash
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(proofData);
    const expectedSignature = await sha256(dataBuffer);

    return expectedSignature === proof.signature;
  } catch (error) {
    console.error("[VerificationProof] Verification failed:", error);
    return false;
  }
}

/**
 * Hash entropy metrics for proof integrity
 */
async function hashEntropy(metrics: VerificationMetrics): Promise<string> {
  const data = `${metrics.entropy}:${metrics.completionTime}:${metrics.flipsTotal}`;
  const encoder = new TextEncoder();
  return await sha256(encoder.encode(data));
}
