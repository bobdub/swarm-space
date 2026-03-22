import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Camera, CameraOff, Mic, MicOff, Video } from "lucide-react";
import { toast } from "sonner";
import { useWebRTC } from "@/hooks/useWebRTC";

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
  const [isInitializing, setIsInitializing] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const joinedRoomRef = useRef<string | null>(null);

  const {
    participants,
    localStream,
    isAudioEnabled,
    isVideoEnabled,
    joinRoom,
    startLocalStream,
    toggleAudio,
    toggleVideo,
  } = useWebRTC();

  const hasAudioTrack = Boolean(localStream?.getAudioTracks().length);
  const hasVideoTrack = Boolean(localStream?.getVideoTracks().length);
  const isMicOn = hasAudioTrack && isAudioEnabled;
  const isCameraOn = hasVideoTrack && isVideoEnabled;

  useEffect(() => {
    if (!roomId || joinedRoomRef.current === roomId) {
      return;
    }

    joinedRoomRef.current = roomId;
    setIsInitializing(true);
    void joinRoom(roomId)
      .catch((error) => {
        console.error("[LiveStreamControls] Failed to join WebRTC room:", error);
      })
      .finally(() => {
        setIsInitializing(false);
      });
  }, [roomId, joinRoom]);

  useEffect(() => {
    if (!localVideoRef.current) return;

    localVideoRef.current.srcObject = localStream ?? null;
    if (localStream) {
      void localVideoRef.current.play().catch(() => {
        // autoplay may be blocked until user interaction
      });
    }
  }, [localStream]);

  const toggleCamera = async () => {
    setIsInitializing(true);
    try {
      if (!hasVideoTrack) {
        const includeAudio = hasAudioTrack ? isAudioEnabled : false;
        await startLocalStream(includeAudio, true);
        toast.success("Camera activated");
      } else {
        toggleVideo();
      }
    } catch (error) {
      console.error("[LiveStreamControls] Failed to toggle camera:", error);
      toast.error("Failed to access camera");
    } finally {
      setIsInitializing(false);
    }
  };

  const toggleMic = async () => {
    setIsInitializing(true);
    try {
      if (!hasAudioTrack) {
        const includeVideo = hasVideoTrack ? isVideoEnabled : false;
        await startLocalStream(true, includeVideo);
        toast.success("Microphone activated");
      } else {
        toggleAudio();
      }
    } catch (error) {
      console.error("[LiveStreamControls] Failed to toggle microphone:", error);
      toast.error("Failed to access microphone");
    } finally {
      setIsInitializing(false);
    }
  };

  const handleStartStreaming = async () => {
    try {
      // Ensure at least audio is available for streaming.
      if (!hasAudioTrack) {
        const includeVideo = hasVideoTrack ? isVideoEnabled : false;
        await startLocalStream(true, includeVideo);
      } else if (!isAudioEnabled) {
        toggleAudio();
      }

      setIsStreaming(true);
      onStreamStart?.();
      toast.success("Started streaming to room");
    } catch (error) {
      console.error("[LiveStreamControls] Failed to start streaming:", error);
      toast.error("Could not start broadcast audio");
    }
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

        <div className="hidden" aria-hidden>
          {participants.map((participant) =>
            participant.stream ? (
              <audio
                key={participant.peerId}
                autoPlay
                playsInline
                ref={(element) => {
                  if (!element || !participant.stream) return;
                  if (element.srcObject !== participant.stream) {
                    element.srcObject = participant.stream;
                  }
                  void element.play().catch(() => {
                    // autoplay may be blocked until user interaction
                  });
                }}
              />
            ) : null,
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
