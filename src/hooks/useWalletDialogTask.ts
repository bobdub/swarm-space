import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Dismissing a wallet dialog cancels link recording, not an already-submitted transfer. */
export function useWalletDialogTask(open: boolean) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      generation.current++;
      controller.current?.abort();
    }
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [open]);

  async function run<T>(task: (signal: AbortSignal) => Promise<T>, onSuccess: (value: T) => void) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const ticket = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await task(abort.signal);
      if (ticket === generation.current) onSuccess(result);
    } catch (error) {
      if (ticket === generation.current) toast.error(error instanceof Error ? error.message : "Wallet request failed");
    } finally {
      running.current = false;
      if (controller.current === abort) controller.current = null;
      setBusy(false);
    }
  }

  return { busy, run };
}