import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useBrowserQScore } from '@/hooks/useBrowserQScore';
import { subscribeGuardrails, type GuardrailsEvent } from '@/lib/guardrails/bus';
import { getDeviceProfile, suggestDemotion } from '@/lib/guardrails/deviceProfile';
import { getLoadingPoint } from '@/lib/guardrails/loadingChain';

function levelColor(level: string): string {
  switch (level) {
    case 'critical': return 'text-red-400';
    case 'degrade':  return 'text-orange-400';
    case 'warn':     return 'text-yellow-300';
    default:         return 'text-emerald-400';
  }
}

export function BrowserGuardrailsCard() {
  const q = useBrowserQScore();
  const [lastPause, setLastPause] = useState<string | null>(null);
  const [stepLog, setStepLog] = useState<GuardrailsEvent[]>([]);
  const [profile, setProfile] = useState(() => getDeviceProfile());

  useEffect(() => {
    const unsub = subscribeGuardrails((evt) => {
      if (evt.type === 'chain-paused') setLastPause(evt.reason);
      if (evt.type === 'chain-resumed') setLastPause(null);
      if (evt.type === 'chain-step') {
        setStepLog((prev) => [...prev.slice(-9), evt]);
      }
    });
    const t = setInterval(() => setProfile(getDeviceProfile()), 5000);
    return () => { unsub(); clearInterval(t); };
  }, []);

  const suggestion = suggestDemotion();

  return (
    <Card className="space-y-4 rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
      <div>
        <h2 className="text-xl font-bold">Browser Guardrails</h2>
        <p className="text-sm text-foreground/60">
          Live view of Browser QScore and the loading chain.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.35)] p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Browser Q</p>
          <p className={`text-3xl font-bold ${levelColor(q.level)}`}>{q.score.toFixed(2)}</p>
          <p className={`text-xs ${levelColor(q.level)}`}>{q.level}</p>
        </div>
        <div className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.35)] p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Chain</p>
          <p className="text-sm font-semibold">
            {lastPause ? 'Paused' : 'Running'}
          </p>
          <p className="text-xs text-foreground/60 break-words">
            {lastPause ?? 'No pauses pending.'}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-foreground/50 mb-2">
          Recent chain steps
        </p>
        {stepLog.length === 0 ? (
          <p className="text-xs text-foreground/50">No events yet.</p>
        ) : (
          <ul className="space-y-1">
            {stepLog.map((evt, i) => {
              if (evt.type !== 'chain-step') return null;
              const point = getLoadingPoint(evt.id);
              return (
                <li key={i} className="text-xs text-foreground/70 flex justify-between gap-3">
                  <span>{point?.label ?? evt.id}</span>
                  <span className={evt.state === 'error' ? 'text-red-400' : 'text-foreground/50'}>
                    {evt.state}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {suggestion && (
        <div className="rounded-2xl border border-accent/40 bg-accent/10 p-4 text-xs">
          <p className="font-semibold text-accent">Suggested profile</p>
          <p className="text-foreground/70 mt-1">
            Your device often pauses at <span className="font-mono">{suggestion}</span>. Try moving it later in Settings → Browser Guardrails.
          </p>
        </div>
      )}

      <p className="text-[11px] text-foreground/40">
        Samples logged: {profile.samples.length}
      </p>
    </Card>
  );
}

export default BrowserGuardrailsCard;