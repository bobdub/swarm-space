interface Point {
  x: number;
  y: number;
  t: number;
}

export interface EntropyAccumulator {
  start(x: number, y: number, t: number): void;
  addPoint(x: number, y: number, t: number): void;
  result(): { entropy: number; samples: number };
}

function clampEntropy(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function computeShannonEntropy(probabilities: number[]): number {
  const filtered = probabilities.filter((p) => p > 0);
  if (filtered.length === 0) {
    return 0;
  }

  const logBase = Math.log2(filtered.length);
  if (logBase === 0) {
    return 0;
  }

  const entropy = -filtered.reduce((sum, probability) => {
    return sum + probability * Math.log2(probability);
  }, 0);

  return entropy / logBase;
}

export class MovementEntropyAccumulator implements EntropyAccumulator {
  private lastPoint: Point | null = null;
  private readonly buckets: number[] = new Array(16).fill(0);
  private sampleCount = 0;

  start(x: number, y: number, t: number) {
    this.lastPoint = { x, y, t };
  }

  addPoint(x: number, y: number, t: number) {
    if (!this.lastPoint) {
      this.start(x, y, t);
      return;
    }

    const dt = Math.max(1, t - this.lastPoint.t);
    const dx = x - this.lastPoint.x;
    const dy = y - this.lastPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 2) {
      this.lastPoint = { x, y, t };
      return;
    }

    const angle = Math.atan2(dy, dx);
    const speed = distance / dt;
    const directionBucket = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 8) % 8;
    const speedBucket = Math.min(7, Math.floor(Math.min(speed * 12, 7)));

    const bucketIndex = directionBucket * 2 + (speedBucket > 3 ? 1 : 0);
    this.buckets[bucketIndex] += 1;
    this.sampleCount += 1;
    this.lastPoint = { x, y, t };
  }

  result() {
    if (this.sampleCount === 0) {
      return { entropy: 0, samples: 0 };
    }

    const probabilities = this.buckets.map((count) => count / this.sampleCount);
    const entropy = computeShannonEntropy(probabilities);
    return { entropy: clampEntropy(entropy), samples: this.sampleCount };
  }
}
