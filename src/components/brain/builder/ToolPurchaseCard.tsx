/**
 * ToolPurchaseCard — buy a Market tool (a prefab with `priceSwarm`) with
 * SWARM or Credits. Credits are quoted at the Market's live spot rate.
 * Project rules: no native <form>, every button `type="button"`.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Prefab } from '@/lib/brain/prefabHouseCatalog';
import { buyTool, toolQuote, type ToolPurchaseCurrency } from '@/lib/world/toolPurchases';

export function ToolPurchaseCard({
  prefab,
  userId,
  onBought,
  onCancel,
}: {
  prefab: Prefab;
  userId?: string;
  onBought: () => void;
  onCancel: () => void;
}) {
  const [quote, setQuote] = useState<{ swarm: number; credits: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void toolQuote(prefab.id).then((q) => { if (live) setQuote(q); }).catch(() => {});
    return () => { live = false; };
  }, [prefab.id]);

  const buy = async (currency: ToolPurchaseCurrency) => {
    if (!userId) { toast.error('Sign in to buy tools.'); return; }
    setBusy(true);
    try {
      await buyTool(userId, prefab.id, currency);
      toast.success(`${prefab.label} is yours.`);
      onBought();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not buy the tool. Nothing was charged.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Buy ${prefab.label}`}
      data-testid={`tool-purchase-${prefab.id}`}
      className="col-span-full rounded-xl border border-primary/40 bg-primary/10 p-3 text-[12px]"
    >
      <div className="font-semibold">{prefab.label}</div>
      <p className="mt-1 text-muted-foreground">
        The only tool that works the Gold Vein. Bought once from the Market, then it is yours to pick up.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !quote}
          onClick={() => void buy('SWARM')}
          data-testid="tool-buy-swarm"
          className="rounded-lg border border-primary/60 px-3 py-1.5 font-medium hover:bg-primary/20 disabled:opacity-50"
        >
          Buy · {quote ? `${quote.swarm} SWARM` : '…'}
        </button>
        <button
          type="button"
          disabled={busy || !quote}
          onClick={() => void buy('CREDITS')}
          data-testid="tool-buy-credits"
          className="rounded-lg border border-primary/60 px-3 py-1.5 font-medium hover:bg-primary/20 disabled:opacity-50"
        >
          Buy · {quote ? `${quote.credits.toLocaleString()} Credits` : '…'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-muted/50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
