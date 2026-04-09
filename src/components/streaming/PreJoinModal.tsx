/**
 * PreJoinModal — Device setup screen shown before joining a WebRTC room.
 * Camera preview, mic activity meter, device selectors, test buttons.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, CameraOff, Mic, MicOff, Volume2, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PREFS_KEY = "swarm-preferred-devices";

interface DevicePrefs {
  audioInputId?: string;
  videoInputId?: string;
  audioOutputId?: string;
}

function loadPrefs(): DevicePrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePrefs(prefs: DevicePrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

interface PreJoinModalProps {
  open: boolean;
  onJoin: (opts: { audio: boolean; video: boolean; audioDeviceId?: string; videoDeviceId?: string }) => void;
  onCancel: () => void;
  roomTitle: string;
}

export function PreJoinModal({ open, onJoin, onCancel, roomTitle }: PreJoinModalProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>("");
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [testingMic, setTestingMic] = useState(false);
  const [testingAudio, setTestingAudio] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const enumerateDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);

      const prefs = loadPrefs();
      const validMics = list.filter((d) => d.kind === "audioinput" && d.deviceId.trim().length > 0);
      const validCams = list.filter((d) => d.kind === "videoinput" && d.deviceId.trim().length > 0);
      const validSpeakers = list.filter((d) => d.kind === "audiooutput" && d.deviceId.trim().length > 0);

      const nextMic = prefs.audioInputId && validMics.some((d) => d.deviceId === prefs.audioInputId)
        ? prefs.audioInputId
        : validMics[0]?.deviceId ?? "";
      const nextCamera = prefs.videoInputId && validCams.some((d) => d.deviceId === prefs.videoInputId)
        ? prefs.videoInputId
        : validCams[0]?.deviceId ?? "";
      const nextSpeaker = prefs.audioOutputId && validSpeakers.some((d) => d.deviceId === prefs.audioOutputId)
        ? prefs.audioOutputId
        : validSpeakers[0]?.deviceId ?? "";

      setSelectedMic(nextMic);
      setSelectedCamera(nextCamera);
      setSelectedSpeaker(nextSpeaker);

      return { nextMic, nextCamera };
    } catch {
      return { nextMic: "", nextCamera: "" };
    }
  }, []);

  const startPreview = useCallback(async (micId?: string, camId?: string) => {
    // Stop previous via ref to avoid stale closure
    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
    setPermissionDenied(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: { exact: micId } } : true,
        video: camId ? { deviceId: { exact: camId } } : true,
      });
      previewStreamRef.current = stream;
      setPreviewStream(stream);

      // Mic level via AnalyserNode
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const poll = () => {
        analyser.getByteFrequencyData(data);
        const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) / 255;
        setMicLevel(rms);
        animFrameRef.current = requestAnimationFrame(poll);
      };
      poll();
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermissionDenied(true);
      }
    }
  }, []);

  useEffect(() => {
    if (open) {
      void enumerateDevices().then(({ nextMic, nextCamera }) => {
        void startPreview(nextMic || undefined, nextCamera || undefined);
      });
    }
    return () => {
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      audioCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
      void videoRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  const cleanup = useCallback(() => {
    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    previewStreamRef.current = null;
    setPreviewStream(null);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
    setMicLevel(0);
  }, []);

  const handleJoin = (muted: boolean) => {
    const hasVideo = cameraEnabled && Boolean(previewStream?.getVideoTracks().length);
    savePrefs({ audioInputId: selectedMic, videoInputId: selectedCamera, audioOutputId: selectedSpeaker });
    cleanup();
    onJoin({
      audio: !muted,
      video: hasVideo,
      audioDeviceId: selectedMic || undefined,
      videoDeviceId: selectedCamera || undefined,
    });
  };

  const handleCancel = () => {
    cleanup();
    onCancel();
  };

  const handleToggleCamera = () => {
    const videoTrack = previewStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setCameraEnabled(videoTrack.enabled);
    }
  };

  const handleTestMic = async () => {
    if (testingMic) return;
    // If no stream yet, request permissions first
    if (!previewStreamRef.current) {
      toast.info("Requesting microphone permissions…");
      await startPreview(selectedMic || undefined, selectedCamera || undefined);
      // Re-enumerate to get proper labels after permission grant
      await enumerateDevices();
      if (!previewStreamRef.current) {
        toast.error("Microphone access denied. Please allow permissions in your browser settings.");
        return;
      }
    }
    setTestingMic(true);
    try {
      const stream = previewStreamRef.current!;
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.start();
      await new Promise((r) => setTimeout(r, 3000));
      recorder.stop();
      await new Promise<void>((r) => { recorder.onstop = () => r(); });
      const blob = new Blob(chunks, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch {
      // ignore
    } finally {
      setTestingMic(false);
    }
  };

  const handleTestAudio = async () => {
    if (testingAudio) return;
    setTestingAudio(true);
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      await new Promise((r) => setTimeout(r, 1000));
      osc.stop();
      ctx.close();
    } catch {
      // ignore
    } finally {
      setTestingAudio(false);
    }
  };

  const mics = devices.filter((d) => d.kind === "audioinput" && d.deviceId.trim().length > 0);
  const cams = devices.filter((d) => d.kind === "videoinput" && d.deviceId.trim().length > 0);
  const speakers = devices.filter((d) => d.kind === "audiooutput" && d.deviceId.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Join "{roomTitle}"</DialogTitle>
          <DialogDescription>Set up your devices before joining the room.</DialogDescription>
        </DialogHeader>

        {permissionDenied ? (
          <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground">
            <p>Camera/microphone permissions were denied. Please allow access in your browser settings and try again.</p>
            <Button variant="outline" size="sm" onClick={() => void startPreview(selectedMic, selectedCamera)}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Camera preview */}
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              {!previewStream?.getVideoTracks().length && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted">
                  <CameraOff className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Mic level bar */}
            <div className="space-y-1">
              <Label className="flex items-center gap-2 text-xs text-foreground/70">
                <Mic className="h-3.5 w-3.5" /> Mic Level
              </Label>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-75"
                  style={{ width: `${Math.min(micLevel * 100 * 3, 100)}%` }}
                />
              </div>
            </div>

            {/* Device selectors */}
            <div className="grid gap-3 sm:grid-cols-3">
              {mics.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Microphone</Label>
                  <Select value={selectedMic || undefined} onValueChange={(v) => { setSelectedMic(v); void startPreview(v, selectedCamera || undefined); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose mic" /></SelectTrigger>
                    <SelectContent>
                      {mics.map((d) => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 5)}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {cams.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Camera</Label>
                  <Select value={selectedCamera || undefined} onValueChange={(v) => { setSelectedCamera(v); void startPreview(selectedMic || undefined, v); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose camera" /></SelectTrigger>
                    <SelectContent>
                      {cams.map((d) => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 5)}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {speakers.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Speaker</Label>
                  <Select value={selectedSpeaker || undefined} onValueChange={(v) => { setSelectedSpeaker(v); savePrefs({ audioInputId: selectedMic, videoInputId: selectedCamera, audioOutputId: v }); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose speaker" /></SelectTrigger>
                    <SelectContent>
                      {speakers.map((d) => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 5)}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Test buttons */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleTestMic} disabled={testingMic || !previewStream} className="gap-1.5 text-xs">
                {testingMic ? <MicOff className="h-3 w-3 animate-pulse" /> : <Mic className="h-3 w-3" />}
                {testingMic ? "Recording…" : "Test Mic"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleTestAudio} disabled={testingAudio} className="gap-1.5 text-xs">
                <Volume2 className={cn("h-3 w-3", testingAudio && "animate-pulse")} />
                {testingAudio ? "Playing…" : "Test Audio"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={handleCancel}>Cancel</Button>
          <Button variant="secondary" onClick={() => handleJoin(true)} disabled={permissionDenied}>
            Join Muted
          </Button>
          <Button onClick={() => handleJoin(false)} disabled={permissionDenied}>
            Join Room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
