/**
 * mediaCoinStuckWatch — DEPRECATED under the mined-only vault model.
 *
 * Vaults no longer fabricate coins, so there is nothing to unstick:
 * awaiting-engraver files sit patiently in `files[]` until the wallet
 * has a free mined coin (see mediaCoinWrapSweep / vault engraver).
 * The exported no-op keeps existing boot / debug call sites working.
 */
export async function resyncStalled(): Promise<{ failed: number; requeued: number; recovered: number }> {
  return { failed: 0, requeued: 0, recovered: 0 };
}

export function startStuckWatch(): void {
  // Intentional no-op.
}