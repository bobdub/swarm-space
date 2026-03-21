import { useState, useEffect } from 'react';
import { Zap, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { switchNetworkMode, getCurrentMode, getModeLabel, type NetworkMode } from '@/lib/p2p/networkModeSwitcher';
import { useP2PContext } from '@/contexts/P2PContext';
import { subscribeToConnectionState } from '@/lib/p2p/connectionState';

interface NetworkModeToggleProps {
  /** Compact = small pill for wifi popover; full = labeled toggle for dashboard */
  variant?: 'compact' | 'full';
  className?: string;
}

export function NetworkModeToggle({ variant = 'compact', className }: NetworkModeToggleProps) {
  const { enable, disable, isEnabled } = useP2PContext();
  const [mode, setMode] = useState<NetworkMode>(getCurrentMode());
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setMode(getCurrentMode());
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const handleSwitch = async (target: NetworkMode) => {
    if (target === mode || switching) return;

    setSwitching(true);
    const targetLabel = getModeLabel(target);

    toast.info(`Switching to ${targetLabel}…`, { id: 'mode-switch', duration: 2500 });

    try {
      await switchNetworkMode(target, {
        enable,
        disable,
        isOnline: isEnabled,
      });
      setMode(target);
      toast.success(`Connected to ${targetLabel}`, { id: 'mode-switch', duration: 3000 });
    } catch {
      toast.error('Mode switch failed', { id: 'mode-switch' });
    } finally {
      setSwitching(false);
    }
  };

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center rounded-full border border-border/40 bg-muted/30 p-0.5', className)}>
        <button
          onClick={() => handleSwitch('swarm')}
          disabled={switching}
          className={cn(
            'flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider transition-all',
            mode === 'swarm'
              ? 'bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-white shadow-sm'
              : 'text-foreground/50 hover:text-foreground/80'
          )}
        >
          <Zap className="h-3 w-3" />
          Swarm
        </button>
        <button
          onClick={() => handleSwitch('builder')}
          disabled={switching}
          className={cn(
            'flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider transition-all',
            mode === 'builder'
              ? 'bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-white shadow-sm'
              : 'text-foreground/50 hover:text-foreground/80'
          )}
        >
          <Wrench className="h-3 w-3" />
          Builder
        </button>
      </div>
    );
  }

  // Full variant for dashboard
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="text-xs text-foreground/50 uppercase tracking-wider">Mode</span>
      <div className="flex items-center rounded-lg border border-border/40 bg-muted/20 p-1 gap-1">
        <button
          onClick={() => handleSwitch('swarm')}
          disabled={switching}
          className={cn(
            'flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all',
            mode === 'swarm'
              ? 'bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-white shadow-md'
              : 'text-foreground/50 hover:text-foreground/70 hover:bg-muted/40'
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          SWARM Mesh
        </button>
        <button
          onClick={() => handleSwitch('builder')}
          disabled={switching}
          className={cn(
            'flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all',
            mode === 'builder'
              ? 'bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-white shadow-md'
              : 'text-foreground/50 hover:text-foreground/70 hover:bg-muted/40'
          )}
        >
          <Wrench className="h-3.5 w-3.5" />
          Builder
        </button>
      </div>
      {switching && (
        <span className="text-[0.6rem] text-foreground/40 animate-pulse">switching…</span>
      )}
    </div>
  );
}
