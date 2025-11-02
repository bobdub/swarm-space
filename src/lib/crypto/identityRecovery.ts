import { arrayBufferToBase64, base64ToArrayBuffer, sha256 } from '../crypto';

export interface IdentityRecoveryConfig {
  total: number;
  threshold: number;
}

export interface IdentityRecoveryBundle {
  version: 1;
  total: number;
  threshold: number;
  createdAt: string;
  shares: string[];
}

export interface IdentityRecoveryShareDescriptor {
  version: 1;
  index: number;
  total: number;
  threshold: number;
  createdAt: string;
  data: string;
  checksum: string;
}

const SHARE_PREFIX = 'IDR1-';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

function initField(): void {
  if (GF_EXP[1] !== 0) {
    return;
  }
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = multiplyNoTable(x, 2);
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
  GF_LOG[0] = 0;
}

function multiplyNoTable(a: number, b: number): number {
  let result = 0;
  let aa = a;
  let bb = b;
  while (bb > 0) {
    if (bb & 1) {
      result ^= aa;
    }
    const highBit = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (highBit) {
      aa ^= 0x1b;
    }
    bb >>= 1;
  }
  return result;
}

function gfAdd(a: number, b: number): number {
  return a ^ b;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  const logSum = GF_LOG[a] + GF_LOG[b];
  return GF_EXP[logSum % 255];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero in GF(256)');
  }
  if (a === 0) {
    return 0;
  }
  let logDiff = GF_LOG[a] - GF_LOG[b];
  if (logDiff < 0) {
    logDiff += 255;
  }
  return GF_EXP[logDiff];
}

function evalPolynomial(coefficients: number[], x: number): number {
  let result = 0;
  let power = 1;
  for (const coefficient of coefficients) {
    result = gfAdd(result, gfMul(coefficient, power));
    power = gfMul(power, x);
  }
  return result;
}

function shareSecret(secret: Uint8Array, total: number, threshold: number): Uint8Array[] {
  initField();
  const polynomials: number[][] = [];
  for (let i = 0; i < secret.length; i++) {
    const coefficients = new Array<number>(threshold);
    coefficients[0] = secret[i];
    for (let j = 1; j < threshold; j++) {
      coefficients[j] = crypto.getRandomValues(new Uint8Array(1))[0];
    }
    polynomials.push(coefficients);
  }

  const shares: Uint8Array[] = [];
  for (let shareIndex = 1; shareIndex <= total; shareIndex++) {
    const share = new Uint8Array(secret.length + 1);
    share[0] = shareIndex;
    for (let byteIndex = 0; byteIndex < secret.length; byteIndex++) {
      const value = evalPolynomial(polynomials[byteIndex], shareIndex);
      share[byteIndex + 1] = value;
    }
    shares.push(share);
  }
  return shares;
}

function combineShares(shares: Uint8Array[], threshold: number): Uint8Array {
  initField();
  if (shares.length < threshold) {
    throw new Error('Insufficient shares to recover secret');
  }
  const length = shares[0].length;
  if (length < 2) {
    throw new Error('Invalid share length');
  }
  for (let i = 1; i < threshold; i++) {
    if (shares[i].length !== length) {
      throw new Error('Share lengths do not match');
    }
  }
  const secretLength = length - 1;
  const result = new Uint8Array(secretLength);

  for (let byteIndex = 0; byteIndex < secretLength; byteIndex++) {
    let accumulator = 0;
    for (let i = 0; i < threshold; i++) {
      const shareI = shares[i];
      const xi = shareI[0];
      const yi = shareI[byteIndex + 1];
      if (yi === 0) {
        continue;
      }
      let numerator = 1;
      let denominator = 1;
      for (let j = 0; j < threshold; j++) {
        if (i === j) continue;
        const shareJ = shares[j];
        const xj = shareJ[0];
        numerator = gfMul(numerator, xj);
        const diff = xi ^ xj;
        if (diff === 0) {
          throw new Error('Duplicate share identifiers detected');
        }
        denominator = gfMul(denominator, diff);
      }
      const term = gfMul(yi, gfDiv(numerator, denominator));
      accumulator = gfAdd(accumulator, term);
    }
    result[byteIndex] = accumulator;
  }

  return result;
}

function encodeString(value: string): string {
  const bytes = textEncoder.encode(value);
  return arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function decodeString(value: string): string {
  const buffer = base64ToArrayBuffer(value);
  return textDecoder.decode(new Uint8Array(buffer));
}

function encodeShare(descriptor: IdentityRecoveryShareDescriptor): string {
  const payload = encodeString(JSON.stringify(descriptor));
  return `${SHARE_PREFIX}${payload}`;
}

function decodeShare(token: string): IdentityRecoveryShareDescriptor {
  if (!token.startsWith(SHARE_PREFIX)) {
    throw new Error('Invalid share token prefix');
  }
  const payload = token.slice(SHARE_PREFIX.length);
  const raw = decodeString(payload);
  const parsed = JSON.parse(raw) as IdentityRecoveryShareDescriptor;
  if (parsed.version !== 1) {
    throw new Error('Unsupported share version');
  }
  return parsed;
}

async function computeChecksum(descriptor: Omit<IdentityRecoveryShareDescriptor, 'checksum'>): Promise<string> {
  const base = `${descriptor.index}:${descriptor.total}:${descriptor.threshold}:${descriptor.data}`;
  const digest = await sha256(textEncoder.encode(base));
  return digest.slice(0, 16);
}

export async function generateRecoveryBundle(
  secretBase64: string,
  config: IdentityRecoveryConfig
): Promise<IdentityRecoveryBundle> {
  const { total, threshold } = config;
  if (!Number.isInteger(total) || !Number.isInteger(threshold)) {
    throw new Error('Total and threshold must be integers');
  }
  if (total < 2 || total > 255) {
    throw new Error('Total shares must be between 2 and 255');
  }
  if (threshold < 2 || threshold > total) {
    throw new Error('Threshold must be at least 2 and no greater than total shares');
  }

  const secretBytes = new Uint8Array(base64ToArrayBuffer(secretBase64));
  if (secretBytes.length === 0) {
    throw new Error('Secret payload is empty');
  }

  const shares = shareSecret(secretBytes, total, threshold);
  const createdAt = new Date().toISOString();
  const tokens: string[] = [];

  for (const share of shares) {
    const descriptor: IdentityRecoveryShareDescriptor = {
      version: 1,
      index: share[0],
      total,
      threshold,
      createdAt,
      data: arrayBufferToBase64(share.buffer),
      checksum: ''
    };
    descriptor.checksum = await computeChecksum(descriptor);
    tokens.push(encodeShare(descriptor));
  }

  return {
    version: 1,
    total,
    threshold,
    createdAt,
    shares: tokens
  };
}

export async function recoverSecretFromShares(tokens: string[]): Promise<string> {
  if (tokens.length === 0) {
    throw new Error('No shares provided');
  }

  const descriptors = tokens.map((token) => decodeShare(token));
  const total = descriptors[0].total;
  const threshold = descriptors[0].threshold;

  for (const descriptor of descriptors) {
    if (descriptor.total !== total || descriptor.threshold !== threshold) {
      throw new Error('Share metadata mismatch');
    }
    const expectedChecksum = await computeChecksum({ ...descriptor, checksum: '' });
    if (descriptor.checksum !== expectedChecksum) {
      throw new Error('Share checksum validation failed');
    }
  }

  if (descriptors.length < threshold) {
    throw new Error(`At least ${threshold} shares are required to recover the identity`);
  }

  const decodedShares = descriptors
    .slice(0, threshold)
    .map((descriptor) => new Uint8Array(base64ToArrayBuffer(descriptor.data)));

  const secretBytes = combineShares(decodedShares, threshold);
  return arrayBufferToBase64(secretBytes.buffer);
}

export function getShareSummary(token: string): {
  index: number;
  total: number;
  threshold: number;
  createdAt: string;
  checksum: string;
} {
  const descriptor = decodeShare(token);
  return {
    index: descriptor.index,
    total: descriptor.total,
    threshold: descriptor.threshold,
    createdAt: descriptor.createdAt,
    checksum: descriptor.checksum
  };
}
