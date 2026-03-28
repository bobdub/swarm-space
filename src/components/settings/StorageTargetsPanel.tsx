import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  HardDrive,
  FolderOpen,
  Unplug,
  Download,
  Upload,
  RefreshCw,
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
import { downloadArchive, importArchive } from '@/lib/storage/providers/archiveFallback';
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
  const [migrating, setMigrating] = useState(false);

  const capability = getCapabilityLevel();

  const refreshCapacity = useCallback(async () => {
    const browser = getProvider('critical');
    const cap = await browser.getCapacity();
    setBrowserCapacity(cap);
  }, []);

  // Attempt restore on mount
  useEffect(() => {
    void refreshCapacity();

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

  const handleExportArchive = async () => {
    setMigrating(true);
    try {
      await downloadArchive();
      toast.success('Archive downloaded');
    } catch (error) {
      console.error('[StorageTargets] Export failed:', error);
      toast.error('Failed to export archive');
    } finally {
      setMigrating(false);
    }
  };

  const handleImportArchive = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMigrating(true);
    try {
      const result = await importArchive(file);
      toast.success(`Imported ${result.manifests} manifests and ${result.chunks} chunks`);
    } catch (error) {
      console.error('[StorageTargets] Import failed:', error);
      toast.error('Failed to import archive');
    } finally {
      setMigrating(false);
      e.target.value = '';
    }
  };

  const usagePercent =
    browserCapacity && browserCapacity.total > 0
      ? Math.round((browserCapacity.used / browserCapacity.total) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Browser Storage */}
      <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              Browser Storage
            </h2>
            <p className="text-sm text-foreground/60 mt-1">
              Default storage backend using IndexedDB
            </p>
          </div>
          <span className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400">
            Active
          </span>
        </div>

        {browserCapacity && browserCapacity.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">
                {formatBytes(browserCapacity.used)} of {formatBytes(browserCapacity.total)}
              </span>
              <span className="text-foreground/60">{usagePercent}%</span>
            </div>
            <Progress value={usagePercent} className="h-2" />
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

      {/* Archive Export/Import */}
      <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
        <h2 className="text-xl font-bold mb-2">Data Archive</h2>
        <p className="text-sm text-foreground/60 mb-4">
          Export or import your manifests and chunks as a portable archive file.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="outline"
            className="gap-2 flex-1"
            onClick={handleExportArchive}
            disabled={migrating}
          >
            <Download className="h-4 w-4" />
            {migrating ? 'Exporting...' : 'Export Archive'}
          </Button>
          <label className="flex-1">
            <div className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground">
              <Upload className="h-4 w-4" />
              Import Archive
            </div>
            <input
              type="file"
              accept=".json,.gz"
              className="hidden"
              onChange={handleImportArchive}
              disabled={migrating}
            />
          </label>
        </div>
      </Card>
    </div>
  );
}
