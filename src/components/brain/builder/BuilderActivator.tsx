/**
 * BuilderActivator — small hammer-icon button that toggles Builder Mode.
 * Lives in the top HUD cluster alongside Mic / Camera / Chat.
 *
 * No `<form>`, explicit `type="button"` per project stability rules.
 */
import { Hammer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BuilderMode } from '@/lib/brain/useBrainBuilder';

interface BuilderActivatorProps {
  mode: BuilderMode;
  onToggle: () => void;
}

export function BuilderActivator({ mode, onToggle }: BuilderActivatorProps) {
  const active = mode === 'build';
  return (
    <Button
      type="button"
      size="icon"
      variant={active ? 'default' : 'ghost'}
      aria-label={active ? 'Exit Builder Mode' : 'Enter Builder Mode'}
      aria-pressed={active}
      title={active ? 'Exit Builder Mode' : 'Builder Mode'}
      onClick={onToggle}
      className="h-9 w-9 rounded-full backdrop-blur-sm"
    >
      <Hammer className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

export default BuilderActivator;