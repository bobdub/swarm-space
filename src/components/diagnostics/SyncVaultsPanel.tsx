import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listVaults, purgeVault, type SyncVault } from "@/lib/blockchain/syncVault";
import { isVaultsEnabled, setVaultsEnabled } from "@/lib/blockchain/vaultConfig";

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SyncVaultsPanel() {
  const [vaults, setVaults] = useState<SyncVault[]>([]);
  const [enabled, setEnabled] = useState<boolean>(isVaultsEnabled());
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      setVaults(await listVaults());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">Sync Vaults</h2>
        <Button
          type="button"
          variant={enabled ? "secondary" : "outline"}
          size="sm"
          onClick={() => {
            const next = !enabled;
            setVaultsEnabled(next);
            setEnabled(next);
          }}
        >
          {enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Uses sealed SWARM coins as a local media cache per connected peer.
        Hits skip the torrent fetch entirely. Toggle off to bypass.
      </p>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : vaults.length === 0 ? (
        <div className="text-xs text-muted-foreground">No vaults yet — connect a peer and receive media to allocate one.</div>
      ) : (
        <div className="space-y-2">
          {vaults.map((v) => {
            const size = v.coins.reduce((s, c) => s + c.fillBytes, 0);
            const cap = v.coins.reduce((s, c) => s + c.capacityBytes, 0);
            const hitRate = v.hits + v.misses > 0 ? Math.round((v.hits / (v.hits + v.misses)) * 100) : 0;
            return (
              <div key={v.peerId} className="rounded border border-border/60 p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono">{v.peerId.slice(0, 16)}…</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => { await purgeVault(v.peerId); await refresh(); }}
                  >
                    Purge
                  </Button>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {v.coins.length} coin{v.coins.length === 1 ? "" : "s"} · {fmtMB(size)} / {fmtMB(cap)} · {Object.keys(v.index).length} pieces · hit-rate {hitRate}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}