import { useEffect, useState } from "react";
import { Stamp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  getExternalTimestampsEnabled, getTimestampReceipts, onExternalTimestampsChange,
  receiptToOtsFile, setExternalTimestampsEnabled,
} from "@/lib/blockchain/externalTimestamps";

/** Optional OpenTimestamps anchoring of chain checkpoints. Off by default. */
export function ExternalTimestampsPanel() {
  const [enabled, setEnabled] = useState(() => getExternalTimestampsEnabled());
  const [receipts, setReceipts] = useState(() => getTimestampReceipts());
  useEffect(() => onExternalTimestampsChange(() => {
    setEnabled(getExternalTimestampsEnabled());
    setReceipts(getTimestampReceipts());
  }), []);

  const latest = receipts[receipts.length - 1];
  const file = latest ? receiptToOtsFile(latest) : null;
  const download = () => {
    if (!latest || !file) return;
    const url = URL.createObjectURL(new Blob([file], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `swarm-checkpoint-${latest.height}.ots`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="external-timestamps-switch" className="flex items-center gap-1.5 text-base font-semibold">
            <Stamp className="h-4 w-4 text-primary" />
            Outside timestamps
          </Label>
          <p className="text-xs text-muted-foreground">
            Off by default. Sends the newest chain checkpoint's hash (and nothing else) to the OpenTimestamps
            calendars, which anchor it in Bitcoin. Your choice is saved on this device.
          </p>
        </div>
        <Switch id="external-timestamps-switch" checked={enabled} onCheckedChange={setExternalTimestampsEnabled} />
      </div>
      {latest ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Block #{latest.height}: {latest.status === "pending"
              ? `sent to ${latest.proofs.length} calendar${latest.proofs.length === 1 ? "" : "s"}, waiting for Bitcoin`
              : "calendars unreachable, will retry"}
          </span>
          {file ? <Button size="sm" variant="outline" onClick={download}>Download .ots</Button> : null}
        </div>
      ) : null}
    </Card>
  );
}
