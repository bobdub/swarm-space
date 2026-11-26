import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { isBrowserStorageHigh } from './storageUsage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  HardDrive,
  FolderOpen,
  Unplug,
  AlertTriangle,
  Check,
} from 'lucide-react';
import {
  getAllProviders,
  getProvider,
  registerProvider,
  unregisterProvider,
  setTierOverride,
  clearTierOverride,
  getThresholds,
  updateThresholds,
} from '@/lib/storage/providers';
import { ExternalDeviceProvider } from '@/lib/storage/providers/externalDeviceProvider';
import {
  supportsExternalStorage,
  getCapabilityLevel,
  getCapabilityLabel,
} from '@/lib/storage/providers/capabilities';
import type { StorageCapacity, StorageThresholds } from '@/lib/storage/providers/types';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function StorageTargetsPanel() {
  const [browserCapacity, setBrowserCapacity] = useState<StorageCapacity | null>(null);
  const [externalConnected, setExternalConnected] = useState(false);
  const [externalProvider, setExternalProvider] = useState<ExternalDeviceProvider | null>(null);
  const [loading, setLoading] = useState(false);

  const capability = getCapabilityLevel();

  const refreshCapacity = useCallback(async () => {
    const browser = getProvider('critical');
    const cap = await browser.getCapacity();
    setBrowserCapacity(cap);
  }, []);

  // Attempt restore on mount
  useEffect(() => {
    void refreshCapacity();

    const interval = window.setInterval(() => { void refreshCapacity(); }, 15_000);
    const onFocus = () => { void refreshCapacity(); };
    window.addEventListener('focus', onFocus);

    if (supportsExternalStorage()) {
      const provider = new ExternalDeviceProvider();
      provider.tryRestore().then((restored) => {
        if (restored) {
          registerProvider(provider);
          setTierOverride('bulk', provider.id);
          setTierOverride('replica', provider.id);
          setExternalProvider(provider);
          setExternalConnected(true);
        }
      });
    }
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshCapacity]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const provider = new ExternalDeviceProvider();
      const success = await provider.connect();
      if (success) {
        registerProvider(provider);
        setTierOverride('bulk', provider.id);
        setTierOverride('replica', provider.id);
        setExternalProvider(provider);
        setExternalConnected(true);
        toast.success('External storage connected');
      }
    } catch (error) {
      console.error('[StorageTargets] Connect failed:', error);
      toast.error('Failed to connect external storage');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    if (externalProvider) {
      externalProvider.disconnect();
      unregisterProvider(externalProvider.id);
      clearTierOverride('bulk');
      clearTierOverride('replica');
      setExternalProvider(null);
      setExternalConnected(false);
      toast.success('External storage disconnected');
    }
  };

  const usagePercent =
    browserCapacity && browserCapacity.total > 0
      ? Math.round((browserCapacity.used / browserCapacity.total) * 100)
      : 0;
  const highUsage = browserCapacity != null &&
    isBrowserStorageHigh(browserCapacity.used, browserCapacity.total);

  return (
    <div className="space-y-6">
      {/* Browser Storage */}
      <Card className={cn(
        'rounded-lg border p-6',
        highUsage ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-card',
      )}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <HardDrive className={cn('h-5 w-5', highUsage ? 'text-destructive' : 'text-primary')} />
              Browser Storage
            </h2>
            <p className="text-sm text-foreground/60 mt-1">
              Default storage backend using IndexedDB
            </p>
          </div>
          <span className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-medium',
            highUsage ? 'bg-destructive/20 text-destructive' : 'bg-primary/10 text-primary')}>
            {highUsage ? 'Nearly full' : 'Active'}
          </span>
        </div>

        {browserCapacity && browserCapacity.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">
                {formatBytes(browserCapacity.used)} of {formatBytes(browserCapacity.total)}
              </span>
              <span className={cn(highUsage ? 'font-medium text-destructive' : 'text-foreground/60')}>{usagePercent}%</span>
            </div>
            <Progress value={usagePercent} className={cn('h-2', highUsage && '[&>div]:bg-destructive')} />
          </div>
        )}
      </Card>

      {/* External Device */}
      <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-accent" />
              External Device
            </h2>
            <p className="text-sm text-foreground/60 mt-1">
              Offload large data to a local directory via File System Access API
            </p>
          </div>
          {externalConnected && (
            <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-medium text-accent">
              Connected
            </span>
          )}
        </div>

        {capability === 'full' ? (
          <div className="space-y-3">
            {externalConnected ? (
              <div className="flex items-center gap-3">
                <Check className="h-4 w-4 text-green-400" />
                <span className="text-sm text-foreground/80">
                  Directory connected — bulk data routes to external device.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto gap-2"
                  onClick={handleDisconnect}
                >
                  <Unplug className="h-3 w-3" />
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button
                className="w-full gap-2"
                onClick={handleConnect}
                disabled={loading}
              >
                <FolderOpen className="h-4 w-4" />
                {loading ? 'Connecting...' : 'Connect External Storage'}
              </Button>
            )}
          </div>
        ) : (
          <Alert className="border-yellow-500/30 bg-yellow-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              {getCapabilityLabel(capability)}
            </AlertDescription>
          </Alert>
        )}
      </Card>
    </div>
  );
}
