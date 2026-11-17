import { useCallback, useEffect, useState } from 'react';
import { Check, SwitchCamera } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface CameraSwitchMenuProps {
  /** Only offered while the camera is on, since switching needs a live track. */
  cameraOn: boolean;
  /** Called with the (same, mutated) local stream after a successful switch. */
  onSwitched?: (stream: MediaStream) => void;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  className?: string;
  iconClassName?: string;
}

/**
 * Lets the user pick another video input mid-call. The swap happens on the
 * existing peer connections (RTCRtpSender.replaceTrack), so nobody leaves
 * or rejoins. Hidden when there is only one camera to choose from.
 */
export function CameraSwitchMenu({
  cameraOn,
  onSwitched,
  size = 'sm',
  variant = 'outline',
  className,
  iconClassName = 'h-4 w-4',
}: CameraSwitchMenuProps): JSX.Element | null {
  const { user } = useAuth();
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setCameras(list.filter((d) => d.kind === 'videoinput' && d.deviceId.trim().length > 0));
    } catch {
      setCameras([]);
    }
    if (user) setActiveId(getWebRTCManager(user.id, user.username).getActiveCameraId());
  }, [user]);

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { void refresh(); };
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refresh, cameraOn]);

  const pick = useCallback(async (deviceId: string) => {
    if (!user || switching || deviceId === activeId) return;
    setSwitching(true);
    try {
      const stream = await getWebRTCManager(user.id, user.username).switchCamera(deviceId);
      setActiveId(deviceId);
      onSwitched?.(stream);
    } catch (err) {
      console.warn('[CameraSwitch] switch failed', err);
      toast.error('Could not switch to that camera');
      void refresh();
    } finally {
      setSwitching(false);
    }
  }, [activeId, onSwitched, refresh, switching, user]);

  if (!cameraOn || cameras.length < 2) return null;

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void refresh(); }}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          className={className}
          disabled={switching}
          aria-label="Switch camera"
          title="Switch camera"
        >
          <SwitchCamera className={cn(iconClassName, switching && 'animate-pulse')} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[1000]">
        <DropdownMenuLabel>Camera</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {cameras.map((cam, i) => (
          <DropdownMenuItem
            key={cam.deviceId}
            onSelect={() => { void pick(cam.deviceId); }}
            className="gap-2"
          >
            <Check className={cn('h-4 w-4', cam.deviceId === activeId ? 'opacity-100' : 'opacity-0')} />
            <span className="truncate">{cam.label || `Camera ${i + 1}`}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
