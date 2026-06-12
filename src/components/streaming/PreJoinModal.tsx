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
import { Camera, CameraOff, Mic, MicOff, VideoOff, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { getWebRTCManager } from "@/lib/webrtc/manager";

const PREFS_KEY = "swarm-preferred-devices";

interface DevicePrefs {
  audioInputId?: string;
  videoInputId?: string;
  audioOutputId?: string;
}

type MediaPermissionState = PermissionState | "unsupported";

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

async function queryMediaPermission(name: "microphone" | "camera"): Promise<MediaPermissionState> {
  if (!navigator.permissions?.query) return "unsupported";

  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return "unsupported";
  }
}

interface PreJoinModalProps {
  open: boolean;
  onJoin: (opts: { audio: boolean; video: boolean; audioDeviceId?: string; videoDeviceId?: string }) => void;
  onCancel: () => void;
  roomTitle: string;
}

export function PreJoinModal({ open, onJoin, onCancel, roomTitle }: PreJoinModalProps) {
  const { user } = useAuth();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>("");
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [testingMic, setTestingMic] = useState(false);
  const [testingAudio, setTestingAudio] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [micPermissionState, setMicPermissionState] = useState<MediaPermissionState>("unsupported");
  const [cameraPermissionState, setCameraPermissionState] = useState<MediaPermissionState>("unsupported");
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewOwnershipRef = useRef<"owned" | "shared" | null>(null);
  const autoPreviewAttemptedRef = useRef(false);

  const stopPreview = useCallback(() => {
    if (previewOwnershipRef.current === "owned") {
      previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    }
    previewStreamRef.current = null;
    previewOwnershipRef.current = null;
    setPreviewStream(null);
    setMicLevel(0);

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    const currentAudioCtx = audioCtxRef.current;
    audioCtxRef.current = null;
    currentAudioCtx?.close().catch(() => {});
  }, []);

  const enumerateDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const validDevices = list.filter((device) => device.deviceId.trim().length > 0);
      setDevices(validDevices);

      const prefs = loadPrefs();
      const validMics = validDevices.filter((device) => device.kind === "audioinput");
      const validCams = validDevices.filter((device) => device.kind === "videoinput");
      const validSpeakers = validDevices.filter((device) => device.kind === "audiooutput");

      const nextMic = prefs.audioInputId && validMics.some((device) => device.deviceId === prefs.audioInputId)
        ? prefs.audioInputId
        : validMics[0]?.deviceId ?? "";
      const nextCamera = prefs.videoInputId && validCams.some((device) => device.deviceId === prefs.videoInputId)
        ? prefs.videoInputId
        : validCams[0]?.deviceId ?? "";
      const nextSpeaker = prefs.audioOutputId && validSpeakers.some((device) => device.deviceId === prefs.audioOutputId)
        ? prefs.audioOutputId
        : validSpeakers[0]?.deviceId ?? "";

      setSelectedMic(nextMic);
      setSelectedCamera(nextCamera);
      setSelectedSpeaker(nextSpeaker);

      return { nextMic, nextCamera, nextSpeaker };
    } catch {
      setDevices([]);
      return { nextMic: "", nextCamera: "", nextSpeaker: "" };
    }
  }, []);

  const adoptSharedPreview = useCallback((stream: MediaStream) => {
    previewOwnershipRef.current = "shared";
    previewStreamRef.current = stream;
    setPreviewStream(stream);

    const sharedVideoTrack = stream.getVideoTracks()[0];
    const nextCameraEnabled = Boolean(sharedVideoTrack?.enabled ?? sharedVideoTrack);
    setCameraEnabled(nextCameraEnabled);

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const poll = () => {
      analyser.getByteFrequencyData(data);
      const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length) / 255;
      setMicLevel(rms);
      animFrameRef.current = requestAnimationFrame(poll);
    };
    poll();
  }, []);

  const tryUseExistingStream = useCallback((micId?: string, camId?: string) => {
    if (!user) return false;

    const existingStream = getWebRTCManager(user.id, user.username).getLocalStream();
    const hasLiveTracks = existingStream?.getTracks().some((track) => track.readyState === "live");
    const matchesRequestedMic = !micId || existingStream?.getAudioTracks().some((track) => {
      const settings = typeof track.getSettings === "function" ? track.getSettings() : undefined;
      return settings?.deviceId === micId;
    });
    const matchesRequestedCam = !camId || existingStream?.getVideoTracks().some((track) => {
      const settings = typeof track.getSettings === "function" ? track.getSettings() : undefined;
      return settings?.deviceId === camId;
    });

    if (!existingStream || !hasLiveTracks || !matchesRequestedMic || !matchesRequestedCam) {
      return false;
    }

    adoptSharedPreview(existingStream);
    return true;
  }, [adoptSharedPreview, user]);

  const startPreview = useCallback(async (
    micId?: string,
    camId?: string,
    includeVideo: boolean = false,
    options?: { markPermissionDenied?: boolean },
  ) => {
    stopPreview();
    setPermissionDenied(false);

    try {
      if (tryUseExistingStream(micId, camId)) {
        return true;
      }
    } catch {
      // Fall through to a fresh permission request when the shared stream
      // is unavailable, stale, or tied to a different device selection.
    }

    const buildConstraints = (wantVideo: boolean): MediaStreamConstraints => ({
      audio: micId ? { deviceId: { exact: micId } } : true,
      video: wantVideo
        ? (camId ? { deviceId: { exact: camId } } : true)
        : false,
    });

    try {
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(includeVideo));
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        if (
          includeVideo && (
          name === "NotFoundError" ||
          name === "OverconstrainedError" ||
          name === "NotAllowedError" ||
          name === "PermissionDeniedError" ||
          name === "NotReadableError"
          )
        ) {
          // Fall back to audio-only: the camera may be missing, blocked,
          // or already in use by another app (common on mobile). Live chat
          // only strictly requires a microphone.
          stream = await navigator.mediaDevices.getUserMedia(buildConstraints(false));
          setCameraEnabled(false);
        } else {
          throw error;
        }
      }

      previewStreamRef.current = stream;
      previewOwnershipRef.current = "owned";
      setPreviewStream(stream);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = cameraEnabled;
      }

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const poll = () => {
        analyser.getByteFrequencyData(data);
        const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length) / 255;
        setMicLevel(rms);
        animFrameRef.current = requestAnimationFrame(poll);
      };
      poll();

      return true;
    } catch (error: unknown) {
      const name = error instanceof DOMException ? error.name : "";
      if (options?.markPermissionDenied !== false) {
        setPermissionDenied(name === "NotAllowedError" || name === "PermissionDeniedError");
      }
      setPreviewStream(null);
      previewStreamRef.current = null;
      setMicLevel(0);
      return false;
    }
  }, [cameraEnabled, stopPreview, tryUseExistingStream]);

  const requestMediaAccess = useCallback(async () => {
    if (isRequestingAccess) return false;

    setIsRequestingAccess(true);

    console.info("[PreJoinModal] Permission snapshot", { micPermissionState, cameraPermissionState });

    if (micPermissionState === "denied") {
      setPermissionDenied(true);
      setIsRequestingAccess(false);
      toast.error("Microphone access is blocked in your browser settings.");
      return false;
    }

    const granted = await startPreview(undefined, undefined, cameraPermissionState === "granted");

    if (granted) {
      await enumerateDevices();
    } else {
      toast.error("Microphone access is required before testing or joining.");
    }

    setIsRequestingAccess(false);
    return granted;
  }, [cameraPermissionState, enumerateDevices, isRequestingAccess, micPermissionState, startPreview]);

  const requestCameraAccess = useCallback(async (nextCameraId?: string) => {
    if (cameraPermissionState === "denied") {
      toast.error("Camera access is blocked in your browser settings.");
      return false;
    }

    if (!previewStreamRef.current) {
      const granted = await requestMediaAccess();
      if (!granted) return false;
    }

    const granted = await startPreview(
      selectedMic || undefined,
      nextCameraId || selectedCamera || undefined,
      true,
      { markPermissionDenied: false },
    );

    if (!granted) {
      toast.error("Camera is optional, but it is unavailable right now.");
      void queryMediaPermission("camera").then(setCameraPermissionState);
      return false;
    }

    await enumerateDevices();
    void queryMediaPermission("camera").then(setCameraPermissionState);
    return true;
  }, [cameraPermissionState, enumerateDevices, requestMediaAccess, selectedCamera, selectedMic, startPreview]);

  useEffect(() => {
    if (!open) {
      autoPreviewAttemptedRef.current = false;
      stopPreview();
      return;
    }

    const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    setIsMobileDevice(Boolean(coarsePointer || mobileUserAgent));

    const prefs = loadPrefs();
    setSelectedMic(prefs.audioInputId ?? "");
    setSelectedCamera(prefs.videoInputId ?? "");
    setSelectedSpeaker(prefs.audioOutputId ?? "");
    setDevices([]);
    setPermissionDenied(false);
    setIsRequestingAccess(false);
    setTestingMic(false);
    setTestingAudio(false);
    setCameraEnabled(true);
    setMicLevel(0);
    setMicPermissionState("unsupported");
    setCameraPermissionState("unsupported");

    void queryMediaPermission("microphone").then(setMicPermissionState);
    void queryMediaPermission("camera").then(setCameraPermissionState);

    void enumerateDevices().then(({ nextMic }) => {
      try {
        if (!previewStreamRef.current) {
          tryUseExistingStream(nextMic || undefined);
        }
      } catch {
        // Ignore shared-stream detection failures; the explicit Allow button
        // still remains as the fallback path.
      }
    });

    return () => {
      stopPreview();
    };
  }, [enumerateDevices, open, stopPreview, tryUseExistingStream]);

  useEffect(() => {
    if (!open || previewStreamRef.current || autoPreviewAttemptedRef.current) return;
    if (micPermissionState !== "granted") return;

    autoPreviewAttemptedRef.current = true;
    void startPreview(selectedMic || undefined, selectedCamera || undefined, cameraPermissionState === "granted")
      .then((granted) => {
        if (granted) {
          void enumerateDevices();
        }
      });
  }, [cameraPermissionState, enumerateDevices, micPermissionState, open, selectedCamera, selectedMic, startPreview]);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
      void videoRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  const handleJoin = (muted: boolean) => {
    if (!previewStreamRef.current) return;

    const hasVideo = cameraEnabled && Boolean(previewStreamRef.current.getVideoTracks().length);
    savePrefs({ audioInputId: selectedMic, videoInputId: selectedCamera, audioOutputId: selectedSpeaker });
    stopPreview();
    onJoin({
      audio: !muted,
      video: hasVideo,
      audioDeviceId: selectedMic || undefined,
      videoDeviceId: selectedCamera || undefined,
    });
  };

  const handleCancel = () => {
    stopPreview();
    onCancel();
  };

  const handleToggleCamera = () => {
    const videoTrack = previewStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack) {
      void requestCameraAccess();
      return;
    }

    const nextEnabled = !videoTrack.enabled;
    videoTrack.enabled = nextEnabled;
    setCameraEnabled(nextEnabled);
  };

  const handleTestMic = async () => {
    if (testingMic) return;

    if (!previewStreamRef.current) {
      const granted = await requestMediaAccess();
      if (!granted || !previewStreamRef.current) return;
    }

    setTestingMic(true);
    try {
      const recorder = new MediaRecorder(previewStreamRef.current, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      recorder.stop();
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      const blob = new Blob(chunks, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch {
      toast.error("Microphone test failed. Please try again.");
    } finally {
      setTestingMic(false);
    }
  };

  const handleTestAudio = async () => {
    if (testingAudio) return;

    setTestingAudio(true);
    try {
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.15;
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      oscillator.stop();
      await ctx.close();
    } catch {
      toast.error("Audio test failed. Please try again.");
    } finally {
      setTestingAudio(false);
    }
  };

  const mics = devices.filter((device) => device.kind === "audioinput");
  const cams = devices.filter((device) => device.kind === "videoinput");
  const speakers = devices.filter((device) => device.kind === "audiooutput");
  const hasPreview = Boolean(previewStream);
  const hasVideoTrack = Boolean(previewStream?.getVideoTracks().length);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Join "{roomTitle}"</DialogTitle>
          <DialogDescription>Use this setup screen to verify your microphone and optionally add a camera before joining.</DialogDescription>
        </DialogHeader>

        {!hasPreview ? (
          <div className="space-y-4 rounded-md border border-border bg-muted/30 p-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Mic className="h-4 w-4" />
                Microphone access
              </div>
              <p className="text-sm text-muted-foreground">
                {isMobileDevice
                  ? "On mobile, allow your microphone first. Camera is optional and can be added after the preview opens."
                  : "Allow your microphone to continue. Camera is optional and can be added after the preview opens."}
              </p>
              {permissionDenied && (
                <p className="text-sm text-destructive">
                  Access was denied. Please allow microphone access in your browser, then try again.
                </p>
              )}
            </div>

            <Button onClick={() => void requestMediaAccess()} disabled={isRequestingAccess} className="w-full">
              {isRequestingAccess ? "Requesting access…" : isMobileDevice ? "Allow microphone" : "Continue with microphone"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn("h-full w-full object-cover", !cameraEnabled && "hidden")}
              />
              {(!hasVideoTrack || !cameraEnabled) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted">
                  <VideoOff className="h-12 w-12 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Camera optional</span>
                </div>
              )}
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
                onClick={handleToggleCamera}
                disabled={isRequestingAccess}
              >
                {cameraEnabled ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
              </Button>
            </div>

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

            <div className="grid gap-3 sm:grid-cols-3">
              {mics.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Microphone</Label>
                  <Select
                    value={selectedMic || undefined}
                    onValueChange={(value) => {
                      setSelectedMic(value);
                      void startPreview(value, selectedCamera || undefined, hasVideoTrack);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose mic" /></SelectTrigger>
                    <SelectContent>
                      {mics.map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label || `Mic ${device.deviceId.slice(0, 5)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {cams.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Camera</Label>
                  <Select
                    value={selectedCamera || undefined}
                    onValueChange={(value) => {
                      setSelectedCamera(value);
                      void requestCameraAccess(value);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose camera" /></SelectTrigger>
                    <SelectContent>
                      {cams.map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label || `Camera ${device.deviceId.slice(0, 5)}`}
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
                    value={selectedSpeaker || undefined}
                    onValueChange={(value) => {
                      setSelectedSpeaker(value);
                      savePrefs({ audioInputId: selectedMic, videoInputId: selectedCamera, audioOutputId: value });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose speaker" /></SelectTrigger>
                    <SelectContent>
                      {speakers.map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label || `Speaker ${device.deviceId.slice(0, 5)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleTestMic} disabled={testingMic} className="gap-1.5 text-xs">
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
          <Button variant="secondary" onClick={() => handleJoin(true)} disabled={!hasPreview || permissionDenied || isRequestingAccess}>
            Join Muted
          </Button>
          <Button onClick={() => handleJoin(false)} disabled={!hasPreview || permissionDenied || isRequestingAccess}>
            Join Room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
