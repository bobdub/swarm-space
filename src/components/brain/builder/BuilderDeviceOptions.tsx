/**
 * BuilderDeviceOptions — camera and microphone pickers for the builder's
 * Options tab. Switching happens on the live call (RTCRtpSender.replaceTrack)
 * so nobody drops; with the camera or mic off, the pick is remembered and
 * used the next time it turns on. Kept here, not in the live HUD, so the
 * world isn't crowded with buttons.
 *
 * Also shown in the Brain chat Settings tab. Every mounted copy reads the
 * same WebRTC manager and saved preference, and a switch made in one copy
 * is broadcast (`DEVICE_OPTIONS_CHANGED_EVENT`) so the other refreshes.
 */
import { useCallback, useEffect, useState } from 'react';
import { Mic, Video } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getWebRTCManager } from '@/lib/webrtc/manager';

const PREFS_KEY = 'swarm-preferred-devices';

/** Fired on window after any copy of these pickers switches an input. */
export const DEVICE_OPTIONS_CHANGED_EVENT = 'swarm-device-options-changed';

type Kind = 'audio' | 'video';

function preferredId(kind: Kind): string | null {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as {
      audioInputId?: string;
      videoInputId?: string;
    };
    return (kind === 'audio' ? prefs.audioInputId : prefs.videoInputId) ?? null;
  } catch {
    return null;
  }
}

interface BuilderDeviceOptionsProps {
  /** Test id for the wrapper; lets two mounted copies be told apart. */
  testId?: string;
  /** Shown instead of nothing when no inputs can be listed. */
  emptyHint?: string;
}

export function BuilderDeviceOptions({
  testId = 'builder-device-options',
  emptyHint,
}: BuilderDeviceOptionsProps = {}) {
  const { user } = useAuth();
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [activeCam, setActiveCam] = useState<string | null>(null);
  const [activeMic, setActiveMic] = useState<string | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.deviceId.trim().length > 0);
      setCameras(list.filter((d) => d.kind === 'videoinput'));
      setMics(list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'));
    } catch {
      setCameras([]);
      setMics([]);
    }
    const manager = user ? getWebRTCManager(user.id, user.username) : null;
    setActiveCam(manager?.getActiveCameraId() ?? preferredId('video'));
    setActiveMic(manager?.getActiveMicrophoneId() ?? preferredId('audio'));
  }, [user]);

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { void refresh(); };
    md.addEventListener('devicechange', onChange);
    window.addEventListener(DEVICE_OPTIONS_CHANGED_EVENT, onChange);
    return () => {
      md.removeEventListener('devicechange', onChange);
      window.removeEventListener(DEVICE_OPTIONS_CHANGED_EVENT, onChange);
    };
  }, [refresh]);

  const pick = useCallback(async (kind: Kind, deviceId: string) => {
    if (!user || busy) return;
    const manager = getWebRTCManager(user.id, user.username);
    setBusy(kind);
    try {
      if (kind === 'video') await manager.switchCamera(deviceId);
      else await manager.switchMicrophone(deviceId);
    } catch (err) {
      console.warn('[BuilderDeviceOptions] switch failed', err);
      toast.error(kind === 'video' ? 'Could not switch to that camera' : 'Could not switch to that microphone');
    } finally {
      setBusy(null);
      void refresh();
      window.dispatchEvent(new Event(DEVICE_OPTIONS_CHANGED_EVENT));
    }
  }, [busy, refresh, user]);

  if (cameras.length === 0 && mics.length === 0) {
    return emptyHint ? (
      <p className="text-xs text-foreground/50" data-testid={`${testId}-empty`}>{emptyHint}</p>
    ) : null;
  }

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-2" data-testid={testId}>
      <DeviceRow
        kind="video"
        label="Camera"
        icon={<Video className="h-3 w-3" aria-hidden="true" />}
        devices={cameras}
        activeId={activeCam}
        busy={busy === 'video'}
        onPick={pick}
      />
      <DeviceRow
        kind="audio"
        label="Microphone"
        icon={<Mic className="h-3 w-3" aria-hidden="true" />}
        devices={mics}
        activeId={activeMic}
        busy={busy === 'audio'}
        onPick={pick}
      />
    </div>
  );
}

function DeviceRow({
  kind,
  label,
  icon,
  devices,
  activeId,
  busy,
  onPick,
}: {
  kind: Kind;
  label: string;
  icon: React.ReactNode;
  devices: MediaDeviceInfo[];
  activeId: string | null;
  busy: boolean;
  onPick: (kind: Kind, deviceId: string) => void;
}) {
  if (devices.length === 0) return null;
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {devices.map((d, i) => {
          const active = d.deviceId === activeId || (!activeId && i === 0);
          return (
            <button
              key={d.deviceId}
              type="button"
              data-testid={`builder-${kind}-device`}
              aria-pressed={active}
              disabled={busy}
              title={d.label || `${label} ${i + 1}`}
              onClick={() => onPick(kind, d.deviceId)}
              className={[
                'inline-flex max-w-[180px] shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] transition-colors disabled:opacity-50',
                active
                  ? 'border-primary/60 bg-primary/15 text-primary'
                  : 'border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70',
              ].join(' ')}
            >
              <span className="truncate">{d.label || `${label} ${i + 1}`}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
