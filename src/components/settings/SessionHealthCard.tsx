import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { getCurrentUser, getStoredAccounts, hasIntentionalSignOut } from "@/lib/auth";
import { get } from "@/lib/store";
import { useSession } from "@/hooks/useSession";

interface Report {
  hasQuickEntry: boolean;
  lastActiveId: string | null;
  accountCount: number;
  storageReadable: boolean;
  intentionalSignOut: boolean;
}

async function buildReport(): Promise<Report> {
  const hasQuickEntry = getCurrentUser() != null;
  const intentionalSignOut = hasIntentionalSignOut();
  let lastActiveId: string | null = null;
  let accountCount = 0;
  let storageReadable = true;
  try {
    const entry = await get<{ k: string; v: string | null }>("meta", "meta:lastActiveUserId");
    lastActiveId = entry?.v ?? null;
    accountCount = (await getStoredAccounts()).length;
  } catch {
    storageReadable = false;
  }
  return { hasQuickEntry, lastActiveId, accountCount, storageReadable, intentionalSignOut };
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
      <span className="text-sm">{label}</span>
      <Badge variant={ok ? "default" : "secondary"}>{value}</Badge>
    </div>
  );
}

/**
 * Session health — shows which sign-in markers exist on this device so a
 * "signed out but never signed out" report can be checked, not guessed.
 */
export function SessionHealthCard() {
  const session = useSession();
  const [report, setReport] = useState<Report | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setReport(await buildReport());
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Card className="rounded-3xl border border-border/60 p-6 mt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h2 className="text-lg font-bold">Session health</h2>
            <p className="text-sm text-foreground/60">
              What this device remembers about your sign-in.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-2">
        <Row
          label="Signed in right now"
          value={session.status === "signed-in" ? "Yes" : session.status === "unknown" ? "Checking…" : "No"}
          ok={session.status === "signed-in"}
        />
        {report && (
          <>
            <Row label="Quick session entry" value={report.hasQuickEntry ? "Present" : "Missing"} ok={report.hasQuickEntry} />
            <Row label="Last-used account marker" value={report.lastActiveId ? "Present" : "Missing"} ok={!!report.lastActiveId} />
            <Row label="Accounts saved on this device" value={String(report.accountCount)} ok={report.accountCount > 0} />
            <Row label="Local storage readable" value={report.storageReadable ? "Yes" : "No"} ok={report.storageReadable} />
            <Row label="Signed out on purpose" value={report.intentionalSignOut ? "Yes" : "No"} ok={!report.intentionalSignOut} />
          </>
        )}
      </div>
    </Card>
  );
}

export default SessionHealthCard;
