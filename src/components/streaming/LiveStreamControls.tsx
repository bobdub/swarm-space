import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Camera, CameraOff, Circle, Mic, MicOff, Pause, Play, Square, Video } from "lucide-react";
import { toast } from "sonner";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useRecording, type RecordingResult } from "@/hooks/useRecording";

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

interface LiveStreamControlsProps {
  roomId: string;
  isHost: boolean;
  onStreamStart?: () => void;
  onStreamStop?: () => void;
  onStreamPause?: () => void;
  onStreamResume?: () => void;
  onStreamEnd?: (recording?: RecordingResult) => void | Promise<void>;
  onRecordingStateChange?: (active: boolean) => void;
}

export function LiveStreamControls({
  roomId,
  isHost,
  onStreamStart,
  onStreamStop,
  onStreamPause,
  onStreamResume,
  onStreamEnd,
  onRecordingStateChange,
}: LiveStreamControlsProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const recordingPromiseRef = useRef<Promise<RecordingResult> | null>(null);
  const completedRecordingRef = useRef<RecordingResult | null>(null);

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

  const {
    isRecording,
    isPaused: isRecordingPaused,
    elapsed,
    pauseMarkers,
    start: startRecording,
    pause: pauseRecording,
    resume: resumeRecording,
    stop: stopRecording,
  } = useRecording();

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

  const handleStartRecording = useCallback(() => {
    // Gather all streams: local + remote participants
    const streams: MediaStream[] = [];
    if (localStream) streams.push(localStream);
    for (const p of participants) {
      if (p.stream) streams.push(p.stream);
    }
    if (streams.length === 0) {
      toast.error("No audio/video to record — enable your mic or camera first");
      return;
    }
    completedRecordingRef.current = null;
    const promise = startRecording(streams);
    recordingPromiseRef.current = promise;
    toast.success("Recording started");
  }, [localStream, participants, startRecording]);

  const handleToggleRecordingPause = useCallback(() => {
    if (isRecordingPaused) {
      resumeRecording();
      toast.info("Recording resumed");
    } else {
      pauseRecording();
      toast.info("Recording paused");
    }
  }, [isRecordingPaused, pauseRecording, resumeRecording]);

  const handleStopRecording = useCallback(async () => {
    stopRecording();
    toast.info("Recording stopped — saving…");

    // Save the finished recording but do not end the stream yet.
    // Replay attachment is finalized when host ends/leaves the room.
    if (recordingPromiseRef.current) {
      const recording = await recordingPromiseRef.current;
      recordingPromiseRef.current = null;
      completedRecordingRef.current = recording;
      toast.success("Recording saved — end stream to publish replay");
    }
  }, [stopRecording]);

  const handleEndStream = useCallback(async () => {
    let recording: RecordingResult | undefined = completedRecordingRef.current ?? undefined;

    if (recordingPromiseRef.current) {
      if (isRecording) {
        stopRecording();
      }
      recording = await recordingPromiseRef.current;
      recordingPromiseRef.current = null;
      completedRecordingRef.current = recording;
    }

    setIsStreaming(false);
    setIsPaused(false);
    await onStreamEnd?.(recording);
    completedRecordingRef.current = null;
  }, [isRecording, stopRecording, onStreamEnd]);

  // Listen for host-end-stream event (triggered when host clicks Leave)
  useEffect(() => {
    const handler = () => {
      void handleEndStream();
    };
    window.addEventListener("host-end-stream", handler);
    return () => window.removeEventListener("host-end-stream", handler);
  }, [handleEndStream]);

  // Timeline bar showing pause markers
  const renderPauseTimeline = () => {
    if (!isRecording || elapsed === 0) return null;

    return (
      <div className="space-y-1">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
          {/* Active progress */}
          <div className="absolute inset-y-0 left-0 bg-destructive/80" style={{ width: "100%" }} />
          {/* Pause markers */}
          {pauseMarkers.map((marker, i) => {
            const pct = Math.min((marker.timestamp / elapsed) * 100, 100);
            return (
              <div
                key={i}
                className={`absolute top-0 h-full w-0.5 ${
                  marker.type === "pause" ? "bg-yellow-400" : "bg-emerald-400"
                }`}
                style={{ left: `${pct}%` }}
                title={`${marker.type === "pause" ? "⏸" : "▶"} ${formatTime(marker.timestamp)}`}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[10px] text-foreground/50">
          <span>00:00</span>
          <span>{formatTime(elapsed)}</span>
        </div>
      </div>
    );
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
          {/* Recording indicator overlay */}
          {isRecording && (
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold backdrop-blur">
              <Circle className="h-2.5 w-2.5 animate-pulse fill-destructive text-destructive" />
              <span className="text-destructive">
                {isRecordingPaused ? "PAUSED" : "REC"}
              </span>
              <span className="text-foreground/70">{formatTime(elapsed)}</span>
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

          {/* Recording controls */}
          {isHost && (
            <>
              {!isRecording ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={handleStartRecording}
                  disabled={isInitializing}
                  aria-label="Start recording"
                  title="Start recording"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <Circle className="h-4 w-4 fill-current" />
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={handleToggleRecordingPause}
                    aria-label={isRecordingPaused ? "Resume recording" : "Pause recording"}
                    title={isRecordingPaused ? "Resume recording" : "Pause recording"}
                    className="border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10"
                  >
                    {isRecordingPaused ? (
                      <Play className="h-4 w-4 fill-current" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={handleStopRecording}
                    aria-label="Stop recording"
                    title="Stop recording"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </Button>
                </>
              )}
            </>
          )}

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

        {/* Pause markers timeline */}
        {renderPauseTimeline()}

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
                  void element.play().catch(() => {});
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
