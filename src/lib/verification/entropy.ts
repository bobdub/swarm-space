import type { VerificationMetrics } from "./types";

/**
 * Calculate mouse movement entropy based on movement patterns
 */
export function calculateMouseEntropy(
  movements: Array<{ x: number; y: number; timestamp: number }>
): number {
  if (movements.length < 2) {
    return 0;
  }

  const velocities: number[] = [];
  let totalDistance = 0;
  let directionChanges = 0;
  let lastVector: { dx: number; dy: number } | null = null;
  const uniquePositions = new Set<string>();

  for (let i = 1; i < movements.length; i++) {
    const current = movements[i];
    const previous = movements[i - 1];
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const dt = current.timestamp - previous.timestamp;

    if (dt <= 0) {
      continue;
    }

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0 && dt < 16) {
      continue; // discard zero-length vectors captured within the same frame
    }

    totalDistance += distance;

    if (lastVector) {
      const previousMagnitude = Math.sqrt(lastVector.dx * lastVector.dx + lastVector.dy * lastVector.dy);
      const currentMagnitude = Math.sqrt(dx * dx + dy * dy);

      if (previousMagnitude > 0 && currentMagnitude > 0) {
        const dot = lastVector.dx * dx + lastVector.dy * dy;
        const directionSimilarity = dot / (previousMagnitude * currentMagnitude);

        if (directionSimilarity < 0.85) {
          directionChanges += 1;
        }
      }
    }

    lastVector = { dx, dy };

    const velocity = distance / dt;
    velocities.push(Math.min(velocity, 3));

    const quantizedX = Math.round(current.x / 5);
    const quantizedY = Math.round(current.y / 5);
    uniquePositions.add(`${quantizedX}:${quantizedY}`);
  }

  const coverageScore = Math.min(uniquePositions.size / Math.max(movements.length / 1.5, 1), 1);

  let velocityScore = 0;
  if (velocities.length > 0) {
    const mean = velocities.reduce((sum, v) => sum + v, 0) / velocities.length;
    const variance = velocities.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / velocities.length;
    const stdDev = Math.sqrt(variance);
    velocityScore = Math.min(stdDev / 25, 1);
  }

  const directionBase = movements.length > 2 ? movements.length - 2 : 1;
  const directionScore = Math.min(directionChanges / directionBase * 1.2, 1);
  const pathScore = Math.min(totalDistance / 600, 1);

  const combined = velocityScore * 0.35 + directionScore * 0.35 + pathScore * 0.2 + coverageScore * 0.1;

  return Math.min(combined, 1);
}

/**
 * Calculate click timing entropy based on interval patterns
 */
export function calculateClickTimingEntropy(timings: number[]): number {
  if (timings.length < 4) {
    return 0;
  }

  // Calculate intervals between clicks
  const intervals: number[] = [];
  for (let i = 1; i < timings.length; i++) {
    intervals.push(timings[i] - timings[i - 1]);
  }

  const sanitized = intervals
    .map((interval) => {
      if (!Number.isFinite(interval)) {
        return 0;
      }
      const clamped = Math.min(Math.max(interval, 60), 4000);
      return clamped;
    })
    .filter((interval) => interval > 0);

  if (sanitized.length === 0) {
    return 0;
  }

  // Calculate coefficient of variation
  const mean = sanitized.reduce((sum, i) => sum + i, 0) / sanitized.length;
  const variance = sanitized.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / sanitized.length;
  const stdDev = Math.sqrt(variance);

  if (mean === 0) {
    return 0;
  }

  const coefficientOfVariation = stdDev / mean;

  // Normalize to 0-1 range (more variation = more human-like)
  return Math.min(coefficientOfVariation, 1);
}

/**
 * Calculate overall entropy score from verification metrics
 */
export function calculateEntropyBreakdown(metrics: VerificationMetrics): {
  overall: number;
  mouseEntropy: number;
  clickEntropy: number;
} {
  const mouseEntropy = calculateMouseEntropy(metrics.mouseMovements);
  const clickEntropy = calculateClickTimingEntropy(metrics.clickTimings);
  const overall = mouseEntropy * 0.6 + clickEntropy * 0.4;

  return {
    overall,
    mouseEntropy,
    clickEntropy,
  };
}

export function calculateOverallEntropy(metrics: VerificationMetrics): number {
  return calculateEntropyBreakdown(metrics).overall;
}
