import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Camera, CameraOff, Mic, MicOff, Video } from "lucide-react";
import { toast } from "sonner";

interface LiveStreamControlsProps {
  roomId: string;
  isHost: boolean;
  onStreamStart?: () => void;
  onStreamStop?: () => void;
}

export function LiveStreamControls({
  roomId,
  isHost,
  onStreamStart,
  onStreamStop,
}: LiveStreamControlsProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup stream on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startLocalStream = async () => {
    if (streamRef.current) return;
    
    setIsInitializing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setIsCameraOn(true);
      setIsMicOn(true);
      toast.success("Camera and microphone activated");
    } catch (error) {
      console.error("[LiveStreamControls] Failed to start media stream:", error);
      toast.error("Failed to access camera/microphone");
    } finally {
      setIsInitializing(false);
    }
  };

  const stopLocalStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    setIsCameraOn(false);
    setIsMicOn(false);
    setIsStreaming(false);
  };

  const toggleCamera = () => {
    if (!streamRef.current) {
      startLocalStream();
      return;
    }

    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOn(videoTrack.enabled);
    }
  };

  const toggleMic = () => {
    if (!streamRef.current) {
      startLocalStream();
      return;
    }

    const audioTrack = streamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMicOn(audioTrack.enabled);
    }
  };

  const handleStartStreaming = async () => {
    if (!streamRef.current) {
      await startLocalStream();
    }
    
    setIsStreaming(true);
    onStreamStart?.();
    toast.success("Started streaming to room");
  };

  const handleStopStreaming = () => {
    setIsStreaming(false);
    onStreamStop?.();
    toast.info("Stopped streaming");
  };

  return (
    <Card className="border border-white/10 bg-background/50 p-4">
      <div className="space-y-4">
        {/* Video preview */}
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          {!isCameraOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <CameraOff className="h-12 w-12 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            size="icon"
            variant={isCameraOn ? "default" : "outline"}
            onClick={toggleCamera}
            disabled={isInitializing}
            aria-label={isCameraOn ? "Turn off camera" : "Turn on camera"}
          >
            {isCameraOn ? (
              <Camera className="h-4 w-4" />
            ) : (
              <CameraOff className="h-4 w-4" />
            )}
          </Button>

          <Button
            type="button"
            size="icon"
            variant={isMicOn ? "default" : "outline"}
            onClick={toggleMic}
            disabled={isInitializing}
            aria-label={isMicOn ? "Mute microphone" : "Unmute microphone"}
          >
            {isMicOn ? (
              <Mic className="h-4 w-4" />
            ) : (
              <MicOff className="h-4 w-4" />
            )}
          </Button>

          {isHost && (
            <>
              {!isStreaming ? (
                <Button
                  type="button"
                  variant="default"
                  onClick={handleStartStreaming}
                  disabled={isInitializing}
                  className="gap-2"
                >
                  <Video className="h-4 w-4" />
                  Start Broadcasting
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleStopStreaming}
                  className="gap-2"
                >
                  <Video className="h-4 w-4" />
                  Stop Broadcasting
                </Button>
              )}
            </>
          )}
        </div>

        {isStreaming && (
          <div className="flex items-center justify-center gap-2 text-sm text-destructive">
            <div className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
            <span className="font-medium">LIVE</span>
          </div>
        )}
      </div>
    </Card>
  );
}
