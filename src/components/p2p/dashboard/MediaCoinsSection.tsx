/**
 * Media Coins — one row per piece of Media Coin content held on this node
 * (Content Distribution, Node Dashboard). Rows are keyed by merkleRoot:
 * the original coin and every Support Coin share one row.
 *
 * Tools per row:
 *  - View Content: opens the post, or the media file when no post is known.
 *  - Support Coin: engraves the content into one of your own hollow coins
 *    (a new coinId) and relays it. Disabled without a hollow coin.
 *  - Delete Sync: removes the local copy and refuses any future coin
 *    carrying the same content, from the creator or any supporter.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Coins, Eye, HandCoins, Trash2, Route, Users, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getMediaCoinContentUrl,
  refreshMediaCoinContents,
  useMediaCoinContents,
  type MediaCoinContentSummary,
} from "@/lib/blockchain/mediaCoinContentStore";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function useHollowCoinAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => {
      void import("@/lib/blockchain/mediaCoinRuntime")
        .then((m) => m.hasHollowCoin())
        .then((ok) => { if (alive) setAvailable(ok); })
        .catch(() => { if (alive) setAvailable(false); });
    };
    check();
    const events = ["swarm-coin-minted", "blockchain-transaction", "media-coin-content-changed"];
    for (const e of events) window.addEventListener(e, check);
    const t = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
      for (const e of events) window.removeEventListener(e, check);
    };
  }, []);
  return available;
}

export function MediaCoinsSection() {
  const rows = useMediaCoinContents();
  const hollow = useHollowCoinAvailable();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void refreshMediaCoinContents();
    // Chunk counts of arriving content: refresh at most every 2 s.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onTransfer = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; void refreshMediaCoinContents(); }, 2_000);
    };
    window.addEventListener("media-coin-transfer", onTransfer);
    return () => {
      window.removeEventListener("media-coin-transfer", onTransfer);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const view = useCallback(async (row: MediaCoinContentSummary) => {
    if (row.postId) { navigate(`/posts/${row.postId}`); return; }
    const url = await getMediaCoinContentUrl(row.merkleRoot);
    if (url) window.open(url, "_blank", "noopener");
    else toast.info("This content is still arriving");
  }, [navigate]);

  const support = useCallback(async (row: MediaCoinContentSummary) => {
    setBusy(row.merkleRoot);
    try {
      const { supportMediaCoin } = await import("@/lib/blockchain/mediaCoinRuntime");
      const { coinId } = await supportMediaCoin(row.merkleRoot);
      toast.success(`Supported · engraved into coin ${coinId.slice(0, 12)}… and relayed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't support this coin");
    } finally {
      setBusy(null);
    }
  }, []);

  const deleteSync = useCallback(async (row: MediaCoinContentSummary) => {
    if (confirmDelete !== row.merkleRoot) { setConfirmDelete(row.merkleRoot); return; }
    setConfirmDelete(null);
    setBusy(row.merkleRoot);
    try {
      const { deleteMediaCoinSync } = await import("@/lib/blockchain/mediaCoinRuntime");
      await deleteMediaCoinSync(row.merkleRoot);
      toast.success("Removed · coins carrying this content are now refused here");
    } catch {
      toast.error("Couldn't delete this sync");
    } finally {
      setBusy(null);
    }
  }, [confirmDelete]);

  const used = rows.reduce((s, r) => s + r.storedBytes, 0);

  return (
    <div className="space-y-2 border-t border-foreground/10 pt-3" data-testid="media-coins-section">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[0.6rem] uppercase tracking-wider text-foreground/40">
          <Coins className="h-3 w-3 text-amber-400" />
          <span>Media Coins ({rows.length})</span>
        </div>
        {rows.length > 0 && (
          <Badge variant="outline" className="text-[0.55rem] uppercase tracking-widest text-foreground/40 border-foreground/20">
            {formatBytes(used)} stored
          </Badge>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-foreground/30">
          No Media Coin content yet. Posts over 50 MB travel by Media Coin and show here.
        </p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {rows.map((row) => {
            const supporters = new Set(row.supporters.map((s) => s.supporterId)).size;
            const rowBusy = busy === row.merkleRoot;
            return (
              <div key={row.merkleRoot} className="rounded-md border border-foreground/10 p-2 space-y-1.5" data-testid="media-coin-row">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-xs font-medium" title={row.name}>{row.name}</span>
                  {!row.complete && (
                    <Badge variant="outline" className="text-[0.55rem] border-amber-500/40 text-amber-400">
                      {row.chunksHeld}/{row.totalChunks} chunks
                    </Badge>
                  )}
                  {row.createdBySelf && (
                    <Badge variant="outline" className="text-[0.55rem] border-primary/40 text-primary">yours</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-foreground/50">
                  <span>{formatBytes(row.size)}</span>
                  <span className="inline-flex items-center gap-1" title="Most hops seen"><Route className="h-3 w-3" />{row.hops} hops</span>
                  <span className="inline-flex items-center gap-1" title="Supporters"><Users className="h-3 w-3" />{supporters} supporters</span>
                  <span className="inline-flex items-center gap-1" title="Storage used here"><HardDrive className="h-3 w-3" />{formatBytes(row.storedBytes)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[0.65rem]" disabled={rowBusy} onClick={() => { void view(row); }}>
                    <Eye className="h-3 w-3" /> View Content
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[0.65rem]"
                    disabled={rowBusy || !hollow || !row.complete}
                    title={!hollow ? "You need a hollow coin to support content" : !row.complete ? "Still arriving" : "Engrave into one of your hollow coins and relay"}
                    onClick={() => { void support(row); }}
                  >
                    <HandCoins className="h-3 w-3" /> Support Coin
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[0.65rem] border-destructive/50 text-destructive hover:bg-destructive/10"
                    disabled={rowBusy}
                    onClick={() => { void deleteSync(row); }}
                    onBlur={() => setConfirmDelete((c) => (c === row.merkleRoot ? null : c))}
                  >
                    <Trash2 className="h-3 w-3" /> {confirmDelete === row.merkleRoot ? "Confirm delete" : "Delete Sync"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
