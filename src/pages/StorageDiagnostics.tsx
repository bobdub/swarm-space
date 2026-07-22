import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, Download, Upload, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAll, openDB } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import { getSwarmChain } from "@/lib/blockchain/chain";
import { recoverCreatorTokenFromChain } from "@/lib/blockchain/tokenRecovery";
import {
  exportFullState,
  importFullState,
  downloadBackup,
  type FullBackup,
} from "@/lib/backup/exportFullState";

interface StoreReport {
  name: string;
  count: number;
  error?: string;
}

interface DiagReport {
  user?: { id: string; username: string; avatarRef?: string };
  localStorage: Record<string, boolean>;
  stores: StoreReport[];
  chainLength: number;
  pendingTx: number;
  hasDeployTx: boolean;
  hasProfileTokenRow: boolean;
  hasVault: boolean;
  avatarManifestFound: boolean;
  avatarChunkCount: number;
  errors: string[];
}

const LS_KEYS = ["me", "__swarm_chain_snapshot", "__swarm_chain_snapshot_prev", "p2p-connection-state"];

const STORES = [
  "users",
  "blockchain",
  "tokenBalances",
  "profileTokens",
  "profileTokenHoldings",
  "creatorVaults",
  "coinListings",
  "participantListings",
  "manifests",
  "chunks",
  "rewardPool",
  "meta",
];

async function runDiagnostics(): Promise<DiagReport> {
  const errors: string[] = [];
  const ls: Record<string, boolean> = {};
  for (const k of LS_KEYS) ls[k] = localStorage.getItem(k) !== null;

  const stores: StoreReport[] = [];
  try {
    const db = await openDB();
    const available = new Set(Array.from(db.objectStoreNames));
    for (const name of STORES) {
      if (!available.has(name)) {
        stores.push({ name, count: 0, error: "store missing" });
        continue;
      }
      try {
        const rows = await getAll(name);
        stores.push({ name, count: rows.length });
      } catch (err) {
        stores.push({ name, count: 0, error: (err as Error).message });
      }
    }
  } catch (err) {
    errors.push(`openDB failed: ${(err as Error).message}`);
  }

  const me = getCurrentUser();
  let hasDeployTx = false;
  let chainLength = 0;
  let pendingTx = 0;
  let hasProfileTokenRow = false;
  let hasVault = false;
  let avatarManifestFound = false;
  let avatarChunkCount = 0;

  try {
    const chain = getSwarmChain();
    await chain.whenReady();
    const blocks = chain.getChain();
    const pending = chain.getPendingTransactions();
    chainLength = blocks.length;
    pendingTx = pending.length;
    if (me) {
      const isDeploy = (tx: { type: string; from?: string }) =>
        (tx.type === "profile_token_deploy" || tx.type === "creator_token_deploy") &&
        tx.from === me.id;
      hasDeployTx =
        pending.some(isDeploy) ||
        blocks.some((b) => (b.transactions ?? []).some(isDeploy));
    }
  } catch (err) {
    errors.push(`chain read: ${(err as Error).message}`);
  }

  if (me) {
    try {
      const { getProfileToken } = await import("@/lib/blockchain/storage");
      const t = await getProfileToken(me.id);
      hasProfileTokenRow = !!t;
      if (t) {
        const { getCreatorVault } = await import("@/lib/blockchain/creatorVault");
        hasVault = !!(await getCreatorVault(t.tokenId));
      }
    } catch (err) {
      errors.push(`token check: ${(err as Error).message}`);
    }
    const avatarRef = me.profile?.avatarRef;
    if (avatarRef) {
      try {
        const { get } = await import("@/lib/store");
        const manifest = await get<{ chunks?: unknown[] }>("manifests", avatarRef);
        avatarManifestFound = !!manifest;
        avatarChunkCount = manifest?.chunks?.length ?? 0;
      } catch (err) {
        errors.push(`avatar manifest: ${(err as Error).message}`);
      }
    }
  }

  return {
    user: me
      ? { id: me.id, username: me.username, avatarRef: me.profile?.avatarRef }
      : undefined,
    localStorage: ls,
    stores,
    chainLength,
    pendingTx,
    hasDeployTx,
    hasProfileTokenRow,
    hasVault,
    avatarManifestFound,
    avatarChunkCount,
    errors,
  };
}

export default function StorageDiagnostics() {
  const navigate = useNavigate();
  const [report, setReport] = useState<DiagReport | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      setReport(await runDiagnostics());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleRecover = async () => {
    const me = getCurrentUser();
    if (!me) return toast.error("Not signed in");
    setBusy(true);
    try {
      const r = await recoverCreatorTokenFromChain(me.id);
      if (r.status === "recovered") toast.success(`Restored ${r.token?.ticker}`);
      else if (r.status === "already-present") toast.info("Token already present");
      else toast.warning("No deploy transaction found in local chain");
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const bundle = await exportFullState();
      downloadBackup(bundle);
      toast.success("Backup downloaded");
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as FullBackup;
      const { restoredStores, restoredKeys } = await importFullState(bundle);
      toast.success(`Restored ${restoredStores} stores, ${restoredKeys} keys. Reload the page to apply.`);
      await refresh();
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/40 bg-background/80 p-3 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Storage Diagnostics</h1>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleRecover} disabled={busy}>
              <Wrench className="mr-2 h-4 w-4" /> Restore Creator Token
            </Button>
            <Button size="sm" variant="outline" onClick={handleExport} disabled={busy}>
              <Download className="mr-2 h-4 w-4" /> Export full backup
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="mr-2 h-4 w-4" /> Restore from backup
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f);
                e.target.value = "";
              }}
            />
          </div>
          <p className="mt-2 text-xs text-foreground/60">
            Backups include your identity, chain snapshot, tokens, vaults, listings, manifests and chunks. Store them safely — anyone with the file can impersonate this identity.
          </p>
        </Card>

        {report && (
          <>
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-primary">Identity</h2>
              {report.user ? (
                <ul className="space-y-1 text-sm">
                  <li>User: <b>@{report.user.username}</b></li>
                  <li>ID: <code className="text-xs">{report.user.id}</code></li>
                  <li>Avatar ref: <code className="text-xs">{report.user.avatarRef ?? "—"}</code></li>
                  <li>Avatar manifest: {report.avatarManifestFound ? `yes (${report.avatarChunkCount} chunks)` : "missing"}</li>
                </ul>
              ) : (
                <p className="text-sm text-foreground/60">Not signed in</p>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-primary">Creator Token</h2>
              <ul className="space-y-1 text-sm">
                <li>Deploy tx in local chain: {report.hasDeployTx ? "yes" : "no"}</li>
                <li>profileTokens row: {report.hasProfileTokenRow ? "yes" : "missing"}</li>
                <li>creatorVault row: {report.hasVault ? "yes" : "missing"}</li>
                <li>Chain height: {report.chainLength} · Pending tx: {report.pendingTx}</li>
              </ul>
            </Card>

            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-primary">localStorage</h2>
              <ul className="space-y-1 text-sm font-mono">
                {Object.entries(report.localStorage).map(([k, v]) => (
                  <li key={k}>{v ? "✓" : "✗"} {k}</li>
                ))}
              </ul>
            </Card>

            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-primary">IndexedDB stores</h2>
              <div className="grid grid-cols-2 gap-1 text-sm font-mono">
                {report.stores.map((s) => (
                  <div key={s.name} className={s.error ? "text-destructive" : ""}>
                    {s.name}: {s.error ? s.error : s.count}
                  </div>
                ))}
              </div>
            </Card>

            {report.errors.length > 0 && (
              <Card className="border-destructive/40 p-4">
                <h2 className="mb-2 text-sm font-semibold text-destructive">Errors</h2>
                <ul className="space-y-1 text-xs">
                  {report.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}