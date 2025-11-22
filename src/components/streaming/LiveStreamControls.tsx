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
  onStreamPause?: () => void;
  onStreamResume?: () => void;
  onStreamEnd?: () => void;
}

export function LiveStreamControls({
  roomId,
  isHost,
  onStreamStart,
  onStreamStop,
  onStreamPause,
  onStreamResume,
  onStreamEnd,
}: LiveStreamControlsProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
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

  const addVideoTrack = async () => {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
      });

      const videoTrack = videoStream.getVideoTracks()[0];
      
      if (streamRef.current) {
        streamRef.current.addTrack(videoTrack);
      } else {
        streamRef.current = new MediaStream([videoTrack]);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = streamRef.current;
      }

      setIsCameraOn(true);
      toast.success("Camera activated");
    } catch (error) {
      console.error("[LiveStreamControls] Failed to start camera:", error);
      toast.error("Failed to access camera");
    }
  };

  const addAudioTrack = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audioTrack = audioStream.getAudioTracks()[0];
      
      if (streamRef.current) {
        streamRef.current.addTrack(audioTrack);
      } else {
        streamRef.current = new MediaStream([audioTrack]);
      }

      setIsMicOn(true);
      toast.success("Microphone activated");
    } catch (error) {
      console.error("[LiveStreamControls] Failed to start microphone:", error);
      toast.error("Failed to access microphone");
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

  const toggleCamera = async () => {
    setIsInitializing(true);
    try {
      const videoTrack = streamRef.current?.getVideoTracks()[0];
      
      if (videoTrack) {
        // Track exists, just toggle it
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      } else {
        // No video track, add one
        await addVideoTrack();
      }
    } finally {
      setIsInitializing(false);
    }
  };

  const toggleMic = async () => {
    setIsInitializing(true);
    try {
      const audioTrack = streamRef.current?.getAudioTracks()[0];
      
      if (audioTrack) {
        // Track exists, just toggle it
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      } else {
        // No audio track, add one
        await addAudioTrack();
      }
    } finally {
      setIsInitializing(false);
    }
  };

  const handleStartStreaming = async () => {
    // Ensure at least audio is available for streaming
    if (!streamRef.current || streamRef.current.getAudioTracks().length === 0) {
      await addAudioTrack();
    }
    
    setIsStreaming(true);
    onStreamStart?.();
    toast.success("Started streaming to room");
  };

  const handlePauseStreaming = () => {
    setIsPaused(true);
    onStreamPause?.();
    toast.info("Stream paused");
  };

  const handleResumeStreaming = () => {
    setIsPaused(false);
    onStreamResume?.();
    toast.success("Stream resumed");
  };

  const handleStopStreaming = () => {
    setIsStreaming(false);
    setIsPaused(false);
    onStreamStop?.();
    toast.info("Stopped streaming");
  };

  const handleEndStream = () => {
    setIsStreaming(false);
    setIsPaused(false);
    stopLocalStream();
    onStreamEnd?.();
    toast.info("Stream ended");
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
                <>
                  {!isPaused ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handlePauseStreaming}
                      disabled={isInitializing}
                      className="gap-2"
                    >
                      <Video className="h-4 w-4" />
                      Pause Stream
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="default"
                      onClick={handleResumeStreaming}
                      disabled={isInitializing}
                      className="gap-2"
                    >
                      <Video className="h-4 w-4" />
                      Resume Stream
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleStopStreaming}
                    className="gap-2"
                  >
                    <Video className="h-4 w-4" />
                    Stop Broadcast
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleEndStream}
                    className="gap-2"
                  >
                    <Video className="h-4 w-4" />
                    End Stream
                  </Button>
                </>
              )}
            </>
          )}
        </div>

        {isStreaming && (
          <div className="flex items-center justify-center gap-2 text-sm">
            {isPaused ? (
              <>
                <div className="h-2 w-2 rounded-full bg-yellow-500" />
                <span className="font-medium text-yellow-500">PAUSED</span>
              </>
            ) : (
              <>
                <div className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
                <span className="font-medium text-destructive">LIVE</span>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
