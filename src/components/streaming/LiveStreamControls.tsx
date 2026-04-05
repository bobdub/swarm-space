import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Camera, CameraOff, Circle, Mic, MicOff, MonitorUp, MonitorOff, Pause, Play, Square, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useRecording, type RecordingResult } from "@/hooks/useRecording";
import { useStreaming } from "@/hooks/useStreaming";

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
  const [isInitializing, setIsInitializing] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const recordingPromiseRef = useRef<Promise<RecordingResult> | null>(null);
  const completedRecordingRef = useRef<RecordingResult | null>(null);
  const recordingFinalizeRef = useRef<Promise<RecordingResult | null> | null>(null);
  const backgroundFinalizeQueuedRef = useRef(false);

  const {
    roomsById,
    setRoomBroadcastState,
  } = useStreaming();

  const {
    participants,
    localStream,
    screenStream,
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    joinRoom,
    startLocalStream,
    startScreenShare,
    stopScreenShare,
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
  const room = roomsById[roomId];

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

    const initRoom = async () => {
      try {
        await joinRoom(roomId);
        // Auto-request mic+camera on room join so media persists across transitions
        if (!localStream) {
          await startLocalStream(true, true).catch(() => {
            // Camera may be unavailable — try audio only
            return startLocalStream(true, false);
          });
        }
      } catch (error) {
        console.error("[LiveStreamControls] Failed to join WebRTC room:", error);
      } finally {
        setIsInitializing(false);
      }
    };
    void initRoom();
  }, [roomId, joinRoom, startLocalStream]);

  const broadcastState = room?.broadcast?.state;
  const hasPromotedPost = Boolean(room?.broadcast?.postId);
  const isStreaming = broadcastState === "broadcast";
  const isPaused = broadcastState === "backstage" && hasPromotedPost;

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

  const handleToggleScreenShare = async () => {
    setIsInitializing(true);
    try {
      if (isScreenSharing) {
        stopScreenShare();
        toast.info("Screen share stopped");
      } else {
        await startScreenShare();
        toast.success("Screen sharing started");
      }
    } catch (error) {
      console.error("[LiveStreamControls] Failed to toggle screen share:", error);
      toast.error("Failed to share screen");
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
    setIsInitializing(true);
    try {
      if (!hasAudioTrack) {
        const includeVideo = hasVideoTrack ? isVideoEnabled : false;
        await startLocalStream(true, includeVideo);
      } else if (!isAudioEnabled) {
        toggleAudio();
      }

      const wasPromoted = Boolean(room?.broadcast?.postId);
      await setRoomBroadcastState(roomId, "broadcast", { autoPromote: true });
      onStreamStart?.();
      toast.success(
        wasPromoted
          ? "Started broadcasting — room is now discoverable"
          : "Promoted room and started broadcasting",
      );
    } catch (error) {
      console.error("[LiveStreamControls] Failed to start streaming:", error);
      toast.error(error instanceof Error ? error.message : "Could not start broadcasting");
    } finally {
      setIsInitializing(false);
    }
  };

  const handlePauseStreaming = async () => {
    setIsInitializing(true);
    try {
      await setRoomBroadcastState(roomId, "backstage");
      onStreamPause?.();
      toast.info("Broadcast moved to backstage");
    } catch (error) {
      console.error("[LiveStreamControls] Failed to pause streaming:", error);
      toast.error(error instanceof Error ? error.message : "Could not pause broadcast");
    } finally {
      setIsInitializing(false);
    }
  };

  const handleResumeStreaming = async () => {
    setIsInitializing(true);
    try {
      await setRoomBroadcastState(roomId, "broadcast");
      onStreamResume?.();
      toast.success("Broadcast resumed");
    } catch (error) {
      console.error("[LiveStreamControls] Failed to resume streaming:", error);
      toast.error(error instanceof Error ? error.message : "Could not resume broadcast");
    } finally {
      setIsInitializing(false);
    }
  };

  const handleStopStreaming = async () => {
    setIsInitializing(true);
    try {
      await setRoomBroadcastState(roomId, "backstage");
      onStreamStop?.();
      toast.info("Broadcast moved to backstage");
    } catch (error) {
      console.error("[LiveStreamControls] Failed to stop streaming:", error);
      toast.error(error instanceof Error ? error.message : "Could not stop broadcast");
    } finally {
      setIsInitializing(false);
    }
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
    backgroundFinalizeQueuedRef.current = false;
    const promise = startRecording(streams);
    recordingPromiseRef.current = promise;
    toast.success("Recording started");
  }, [localStream, participants, startRecording]);

  const queueBackgroundRecordingFinalization = useCallback(
    (pending: Promise<RecordingResult>) => {
      if (backgroundFinalizeQueuedRef.current) {
        return;
      }
      backgroundFinalizeQueuedRef.current = true;

      void pending
        .then((lateRecording) => {
          if (!lateRecording?.blob?.size) {
            return;
          }
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("stream-recording-finalized", {
                detail: { roomId, recording: lateRecording },
              }),
            );
          }
          toast.success("Recording finished processing in background");
        })
        .catch((error) => {
          console.error("[LiveStreamControls] Background recording finalization failed:", error);
        })
        .finally(() => {
          backgroundFinalizeQueuedRef.current = false;
        });
    },
    [roomId],
  );

  const handleToggleRecordingPause = useCallback(() => {
    if (isRecordingPaused) {
      resumeRecording();
      toast.info("Recording resumed");
    } else {
      pauseRecording();
      toast.info("Recording paused");
    }
  }, [isRecordingPaused, pauseRecording, resumeRecording]);

  const waitForRecordingResult = useCallback(
    async (timeoutMs: number): Promise<RecordingResult | null> => {
      if (completedRecordingRef.current) {
        return completedRecordingRef.current;
      }

      const pending = recordingPromiseRef.current;
      if (!pending) {
        return null;
      }

      if (recordingFinalizeRef.current) {
        return recordingFinalizeRef.current;
      }

      const finalizePromise = (async () => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        try {
          const timedOut = new Promise<null>((resolve) => {
            timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
          });

          const result = await Promise.race<RecordingResult | null>([
            pending,
            timedOut,
          ]);

          if (result) {
            completedRecordingRef.current = result;
            if (recordingPromiseRef.current === pending) {
              recordingPromiseRef.current = null;
            }
            return result;
          }

          // Keep listening in background in case browser finalizes slightly later.
          void pending
            .then((lateResult) => {
              completedRecordingRef.current = lateResult;
              if (recordingPromiseRef.current === pending) {
                recordingPromiseRef.current = null;
              }
            })
            .catch((error) => {
              console.error("[LiveStreamControls] Recording finalization failed:", error);
              if (recordingPromiseRef.current === pending) {
                recordingPromiseRef.current = null;
              }
            });

          return completedRecordingRef.current;
        } catch (error) {
          console.error("[LiveStreamControls] Recording finalization failed:", error);
          if (recordingPromiseRef.current === pending) {
            recordingPromiseRef.current = null;
          }
          return completedRecordingRef.current;
        } finally {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          recordingFinalizeRef.current = null;
        }
      })();

      recordingFinalizeRef.current = finalizePromise;
      return finalizePromise;
    },
    [],
  );

  const handleStopRecording = useCallback(async () => {
    stopRecording();
    toast.info("Recording stopped — saving…");

    // Save the finished recording but do not end the stream yet.
    // Replay attachment is finalized when host ends/leaves the room.
    if (recordingPromiseRef.current) {
      const pendingRecording = recordingPromiseRef.current;
      const recording = await waitForRecordingResult(10_000);
      if (recording?.blob.size) {
        toast.success("Recording saved — end stream to publish replay");
      } else {
        queueBackgroundRecordingFinalization(pendingRecording);
        toast.warning("Recording is still finalizing — you can still end and leave the room");
      }
    } else if (completedRecordingRef.current?.blob.size) {
      toast.success("Recording saved — end stream to publish replay");
    }
  }, [queueBackgroundRecordingFinalization, stopRecording, waitForRecordingResult]);

  const handleEndStream = useCallback(async () => {
    let recording: RecordingResult | undefined = completedRecordingRef.current ?? undefined;

    if (recordingPromiseRef.current) {
      const pendingRecording = recordingPromiseRef.current;
      if (isRecording) {
        stopRecording();
      }
      const finalized = await waitForRecordingResult(4_000);
      if (finalized?.blob.size) {
        recording = finalized;
      } else if (!completedRecordingRef.current) {
        queueBackgroundRecordingFinalization(pendingRecording);
        toast.warning("Recording save timed out — ending stream now");
      }
    }

    if (recording && recording.blob.size === 0) {
      recording = undefined;
    }

    await setRoomBroadcastState(roomId, "ended").catch((error) => {
      console.error("[LiveStreamControls] Failed to set ended broadcast state:", error);
    });
    await onStreamEnd?.(recording);
    completedRecordingRef.current = null;
  }, [
    isRecording,
    onStreamEnd,
    queueBackgroundRecordingFinalization,
    roomId,
    setRoomBroadcastState,
    stopRecording,
    waitForRecordingResult,
  ]);

  useEffect(() => {
    onRecordingStateChange?.(isRecording);
    window.dispatchEvent(
      new CustomEvent("stream-recording-state", {
        detail: { roomId, isRecording },
      }),
    );
  }, [isRecording, onRecordingStateChange, roomId]);

  useEffect(() => {
    const handleExternalRecordToggle = (event: Event) => {
      if (!isHost) return;
      const detail = (event as CustomEvent<{ roomId?: string }>).detail;
      if (detail?.roomId && detail.roomId !== roomId) return;

      if (isRecording) {
        void handleStopRecording();
      } else {
        handleStartRecording();
      }
    };

    window.addEventListener("stream-record-toggle", handleExternalRecordToggle);
    return () => window.removeEventListener("stream-record-toggle", handleExternalRecordToggle);
  }, [handleStartRecording, handleStopRecording, isHost, isRecording, roomId]);

  // Listen for host-end-stream event (triggered when host clicks Leave)
  useEffect(() => {
    const handler = () => {
      void handleEndStream();
    };
    window.addEventListener("host-end-stream", handler);
    return () => window.removeEventListener("host-end-stream", handler);
  }, [handleEndStream]);

  // Listen for room cleanup/ended events to reset joinedRoomRef
  useEffect(() => {
    const resetJoined = (event: Event) => {
      const detail = (event as CustomEvent<{ roomId?: string }>).detail;
      if (!detail?.roomId || detail.roomId === joinedRoomRef.current) {
        joinedRoomRef.current = null;
      }
    };
    window.addEventListener("stream-room-cleanup", resetJoined);
    window.addEventListener("stream-room-ended", resetJoined);
    return () => {
      window.removeEventListener("stream-room-cleanup", resetJoined);
      window.removeEventListener("stream-room-ended", resetJoined);
    };
  }, []);

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

        {/* Screen share preview */}
        {isScreenSharing && screenStream && (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-primary/30 bg-black">
            <video
              autoPlay
              playsInline
              muted
              className="h-full w-full object-contain"
              ref={(el) => {
                if (el) el.srcObject = screenStream;
              }}
            />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold backdrop-blur">
              <MonitorUp className="h-3 w-3 text-primary" />
              <span className="text-primary">Screen</span>
            </div>
          </div>
        )}

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

          <Button
            type="button"
            size="icon"
            variant={isScreenSharing ? "default" : "outline"}
            onClick={handleToggleScreenShare}
            disabled={isInitializing}
            aria-label={isScreenSharing ? "Stop screen share" : "Share screen"}
            title={isScreenSharing ? "Stop screen share" : "Share screen"}
            className={isScreenSharing ? "bg-primary text-primary-foreground" : ""}
          >
            {isScreenSharing ? (
              <MonitorOff className="h-4 w-4" />
            ) : (
              <MonitorUp className="h-4 w-4" />
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

        {/* Remote peer video grid */}
        {participants.length > 0 && (
          <div className={cn(
            "grid gap-2",
            participants.length === 1 ? "grid-cols-1" : "grid-cols-2"
          )}>
            {participants.map((participant) => (
              <div key={participant.peerId} className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                {participant.stream && participant.stream.getVideoTracks().length > 0 ? (
                  <video
                    autoPlay
                    playsInline
                    className="h-full w-full object-cover"
                    ref={(element) => {
                      if (!element || !participant.stream) return;
                      if (element.srcObject !== participant.stream) {
                        element.srcObject = participant.stream;
                      }
                      void element.play().catch(() => {});
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted">
                    <CameraOff className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                {/* Username overlay */}
                <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-foreground/80 backdrop-blur">
                  <span>{participant.username}</span>
                  {participant.isMuted && <MicOff className="h-3 w-3 text-destructive" />}
                </div>
                {/* Hidden audio fallback to ensure audio always plays */}
                {participant.stream && (
                  <audio
                    autoPlay
                    playsInline
                    ref={(element) => {
                      if (!element || !participant.stream) return;
                      if (element.srcObject !== participant.stream) {
                        element.srcObject = participant.stream;
                      }
                      void element.play().catch(() => {});
                    }}
                    className="hidden"
                  />
                )}
              </div>
            ))}
            {/* Remote screen shares */}
            {participants.filter(p => p.screenStream && p.screenStream.getVideoTracks().length > 0).map((participant) => (
              <div key={`screen-${participant.peerId}`} className="relative col-span-full aspect-video w-full overflow-hidden rounded-lg border border-primary/30 bg-black">
                <video
                  autoPlay
                  playsInline
                  className="h-full w-full object-contain"
                  ref={(element) => {
                    if (!element || !participant.screenStream) return;
                    if (element.srcObject !== participant.screenStream) {
                      element.srcObject = participant.screenStream;
                    }
                    void element.play().catch(() => {});
                  }}
                />
                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold backdrop-blur">
                  <MonitorUp className="h-3 w-3 text-primary" />
                  <span className="text-primary">{participant.username}'s Screen</span>
                </div>
              </div>
            ))}
          </div>
        )}

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
