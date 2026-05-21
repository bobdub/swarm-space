import type { ToolTarget } from '@/lib/world/toolTargets';

let selectedToolTarget: ToolTarget | null = null;
const listeners = new Set<(target: ToolTarget | null) => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener(selectedToolTarget);
    } catch (error) {
      console.warn('[toolTargetStore] listener error', error);
    }
  }
}

export function getToolTarget(): ToolTarget | null {
  return selectedToolTarget;
}

export function setToolTarget(target: ToolTarget | null): void {
  selectedToolTarget = target;
  notify();
}

export function subscribeToolTarget(listener: (target: ToolTarget | null) => void): () => void {
  listeners.add(listener);
  try {
    listener(selectedToolTarget);
  } catch {
    /* noop */
  }
  return () => {
    listeners.delete(listener);
  };
}
