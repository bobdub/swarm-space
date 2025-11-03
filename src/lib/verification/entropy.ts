import type { VerificationMetrics } from "./types";

/**
 * Calculate mouse movement entropy based on movement patterns
 */
export function calculateMouseEntropy(
  movements: Array<{ x: number; y: number; timestamp: number }>
): number {
  if (movements.length < 10) {
    return 0;
  }

  // Calculate velocity changes
  const velocities: number[] = [];
  for (let i = 1; i < movements.length; i++) {
    const dx = movements[i].x - movements[i - 1].x;
    const dy = movements[i].y - movements[i - 1].y;
    const dt = movements[i].timestamp - movements[i - 1].timestamp;

    if (dt <= 0) {
      continue;
    }

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0 && dt < 16) {
      continue; // discard zero-length vectors captured within the same frame
    }

    const velocity = distance / dt;
    velocities.push(velocity);
  }

  if (velocities.length === 0) {
    return 0;
  }

  // Calculate standard deviation of velocities
  const mean = velocities.reduce((sum, v) => sum + v, 0) / velocities.length;
  const variance = velocities.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / velocities.length;
  const stdDev = Math.sqrt(variance);

  // Normalize to 0-1 range (higher variance = higher entropy = more human-like)
  const normalized = Math.min(stdDev / 50, 1);

  return normalized;
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
export function calculateOverallEntropy(metrics: VerificationMetrics): number {
  const mouseEntropy = calculateMouseEntropy(metrics.mouseMovements);
  const clickEntropy = calculateClickTimingEntropy(metrics.clickTimings);

  // Weighted combination (60% mouse, 40% click timing)
  return mouseEntropy * 0.6 + clickEntropy * 0.4;
}
