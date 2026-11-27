/**
 * MediaCoinAttachments — shows a post's Media Coin (courier mode) media.
 *
 * Content is read from the Media Coin content store by merkleRoot, never
 * through the torrent swarm. Until a coin brings it here, the card shows
 * its arrival progress; content refused with Delete Sync says so.
 */
import { useEffect, useState } from "react";
import { Coins, Loader2, Ban, Download } from "lucide-react";
import type { MediaCoinPostRef } from "@/types";
import {
  getMediaCoinContent,
  getMediaCoinContentUrl,
  type MediaCoinSupporter,
} from "@/lib/blockchain/mediaCoinContentStore";
import { isMediaCoinRefused, subscribeRefusedMediaCoins } from "@/lib/blockchain/refusedMediaCoinsStore";

type State =
  | { kind: "loading" }
  | { kind: "held"; url: string }
  | { kind: "arriving"; percent: number }
  | { kind: "refused" };

function useMediaCoinContent(ref: MediaCoinPostRef): State {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (isMediaCoinRefused(ref.merkleRoot)) { if (alive) setState({ kind: "refused" }); return; }
      const url = await getMediaCoinContentUrl(ref.merkleRoot).catch(() => null);
      if (!alive) return;
      if (url) setState({ kind: "held", url });
      else setState((s) => (s.kind === "arriving" ? s : { kind: "arriving", percent: 0 }));
    };
    void load();
    const onChanged = (e: Event) => {
      const root = (e as CustomEvent<{ merkleRoot?: string }>).detail?.merkleRoot;
      if (!root || root === ref.merkleRoot) void load();
    };
    const onTransfer = (e: Event) => {
      const d = (e as CustomEvent<{ merkleRoot?: string; direction?: string; chunks?: number; total?: number }>).detail;
      if (d?.merkleRoot !== ref.merkleRoot || d.direction !== "in" || !d.total) return;
      const percent = Math.min(99, Math.round(((d.chunks ?? 0) / d.total) * 100));
      setState((s) => (s.kind === "held" ? s : { kind: "arriving", percent }));
    };
    window.addEventListener("media-coin-content-changed", onChanged);
    window.addEventListener("media-coin-transfer", onTransfer);
    const unsub = subscribeRefusedMediaCoins(() => { void load(); });
    return () => {
      alive = false;
      window.removeEventListener("media-coin-content-changed", onChanged);
      window.removeEventListener("media-coin-transfer", onTransfer);
      unsub();
    };
  }, [ref.merkleRoot]);
  return state;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function MediaCoinItem({ item }: { item: MediaCoinPostRef }) {
  const state = useMediaCoinContent(item);
  const aspect = item.mediaWidth && item.mediaHeight ? { aspectRatio: `${item.mediaWidth} / ${item.mediaHeight}` } : undefined;
  const frame = "rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] backdrop-blur";

  if (state.kind === "refused") {
    return (
      <div className={`${frame} flex items-center gap-2 px-5 py-4 text-sm text-foreground/60`}>
        <Ban className="h-4 w-4" /> {item.name} · removed from this device (Delete Sync)
      </div>
    );
  }
  if (state.kind !== "held") {
    const isAudio = item.mime.startsWith("audio/");
    return (
      <div
        className={`${frame} flex flex-col items-center justify-center gap-2 text-sm text-foreground/60 ${isAudio ? "px-4 py-5" : ""}`}
        style={isAudio ? undefined : aspect ?? { aspectRatio: "16 / 9" }}
        data-testid="media-coin-arriving"
      >
        <Loader2 className="h-5 w-5 animate-spin text-[hsl(174,59%,66%)]" />
        <span className="text-xs">
          {state.kind === "arriving" && state.percent > 0
            ? `Arriving by Media Coin… ${state.percent}%`
            : `Waiting for a Media Coin · ${formatSize(item.size)}`}
        </span>
      </div>
    );
  }
  if (item.mime.startsWith("image/")) {
    return <img src={state.url} alt={item.name} className={`${frame} w-full object-contain`} style={aspect} loading="lazy" />;
  }
  if (item.mime.startsWith("video/")) {
    return <video src={state.url} controls playsInline preload="metadata" className={`${frame} w-full`} style={aspect} />;
  }
  if (item.mime.startsWith("audio/")) {
    return <audio src={state.url} controls preload="metadata" className="w-full" />;
  }
  return (
    <a href={state.url} download={item.name} className={`${frame} flex items-center gap-3 px-5 py-4 text-sm text-foreground/80 hover:text-foreground`}>
      <Download className="h-4 w-4" /> {item.name} · {formatSize(item.size)}
    </a>
  );
}

/** Supporters of a post's Media Coin content, read from the content store. */
function useSupporters(refs: MediaCoinPostRef[]): MediaCoinSupporter[] {
  const [supporters, setSupporters] = useState<MediaCoinSupporter[]>([]);
  const key = refs.map((r) => r.merkleRoot).join(",");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const seen = new Map<string, MediaCoinSupporter>();
      for (const root of key.split(",").filter(Boolean)) {
        const rec = await getMediaCoinContent(root);
        for (const s of rec?.supporters ?? []) if (!seen.has(s.supporterId)) seen.set(s.supporterId, s);
      }
      if (alive) setSupporters(Array.from(seen.values()));
    };
    void load();
    const onChanged = () => { void load(); };
    window.addEventListener("media-coin-content-changed", onChanged);
    return () => { alive = false; window.removeEventListener("media-coin-content-changed", onChanged); };
  }, [key]);
  return supporters;
}

export function MediaCoinSupportedBadge({ refs, authorId, extraNames = [] }: { refs: MediaCoinPostRef[]; authorId?: string; extraNames?: string[] }) {
  const supporters = useSupporters(refs);
  const names = Array.from(new Set([
    ...supporters.filter((s) => s.supporterId !== authorId).map((s) => s.name || `${s.supporterId.slice(0, 8)}…`),
    ...extraNames,
  ]));
  if (names.length === 0) return null;
  const shown = names.slice(0, 2).join(", ");
  const more = names.length > 2 ? ` +${names.length - 2}` : "";
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200"
      title={names.join(", ")}
      data-testid="media-coin-supported-by"
    >
      <Coins className="h-3.5 w-3.5" /> Supported by {shown}{more}
    </div>
  );
}

export function MediaCoinAttachments({ refs }: { refs: MediaCoinPostRef[] }) {
  return (
    <div className="space-y-3" data-testid="media-coin-attachments">
      {refs.map((r) => <MediaCoinItem key={r.merkleRoot} item={r} />)}
    </div>
  );
}
