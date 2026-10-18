// Presentation warning only; transfer-blocking quota rules remain separate.
export function isBrowserStorageHigh(usedBytes: number, quotaBytes: number): boolean {
  return Number.isFinite(usedBytes) && Number.isFinite(quotaBytes) &&
    usedBytes >= 0 && quotaBytes > 0 && usedBytes / quotaBytes >= 0.8;
}