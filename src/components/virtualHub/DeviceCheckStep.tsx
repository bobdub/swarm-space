import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mic, Volume2, Check } from "lucide-react";
import { toast } from "sonner";

interface DeviceCheckStepProps {
  audioInputId?: string;
  audioOutputId?: string;
  onChange: (prefs: { audioInputId?: string; audioOutputId?: string }) => void;
  onPermissionGranted: (granted: boolean) => void;
}

export function DeviceCheckStep({
  audioInputId,
  audioOutputId,
  onChange,
  onPermissionGranted,
}: DeviceCheckStepProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [granted, setGranted] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [testingTone, setTestingTone] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setMicLevel(0);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const startMic = useCallback(
    async (micId?: string) => {
      stop();
      setRequesting(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { deviceId: { exact: micId } } : true,
          video: false,
        });
        streamRef.current = stream;
        setGranted(true);
        onPermissionGranted(true);

        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.deviceId.trim().length > 0));

        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const rms =
            Math.sqrt(
              data.reduce((s, v) => s + v * v, 0) / data.length
            ) / 255;
          setMicLevel(rms);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        toast.error("Microphone access denied. Please allow access to continue.");
        setGranted(false);
        onPermissionGranted(false);
      } finally {
        setRequesting(false);
      }
    },
    [stop, onPermissionGranted]
  );

  const playTestTone = useCallback(async () => {
    if (testingTone) return;
    setTestingTone(true);
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      await new Promise((r) => setTimeout(r, 800));
      osc.stop();
      await ctx.close();
    } catch {
      toast.error("Audio test failed.");
    } finally {
      setTestingTone(false);
    }
  }, [testingTone]);

  const mics = devices.filter((d) => d.kind === "audioinput");
  const speakers = devices.filter((d) => d.kind === "audiooutput");

  return (
    <div className="space-y-4">
      {!granted ? (
        <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Mic className="h-4 w-4" /> Microphone permission
          </div>
          <p className="text-sm text-muted-foreground">
            Allow access so you can speak in the virtual hub.
          </p>
          <Button
            type="button"
            onClick={() => void startMic()}
            disabled={requesting}
            className="w-full"
          >
            {requesting ? "Requesting…" : "Allow microphone"}
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-primary" />
            <span>Microphone connected</span>
          </div>

          <div className="space-y-1">
            <Label className="flex items-center gap-2 text-xs">
              <Mic className="h-3.5 w-3.5" /> Mic level
            </Label>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-75"
                style={{ width: `${Math.min(micLevel * 100 * 3, 100)}%` }}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {mics.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Microphone</Label>
                <Select
                  value={audioInputId || mics[0].deviceId}
                  onValueChange={(v) => {
                    onChange({ audioInputId: v, audioOutputId });
                    void startMic(v);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {mics.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Mic ${d.deviceId.slice(0, 5)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {speakers.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Speaker</Label>
                <Select
                  value={audioOutputId || speakers[0].deviceId}
                  onValueChange={(v) =>
                    onChange({ audioInputId, audioOutputId: v })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {speakers.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Speaker ${d.deviceId.slice(0, 5)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void playTestTone()}
            disabled={testingTone}
            className="gap-1.5"
          >
            <Volume2 className={testingTone ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} />
            {testingTone ? "Playing tone…" : "Play test tone"}
          </Button>
        </>
      )}
    </div>
  );
}