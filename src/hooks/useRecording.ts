import { useCallback, useRef, useState } from "react";

export interface PauseMarker {
  type: "pause" | "resume";
  timestamp: number; // ms since recording start
}

export interface RecordingResult {
  blob: Blob;
  duration: number;
  pauseMarkers: PauseMarker[];
  mimeType: string;
}

/**
 * Hook that records mixed audio+video from all provided MediaStreams
 * using the MediaRecorder API. Supports pause/resume with markers.
 */
export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pauseMarkers, setPauseMarkers] = useState<PauseMarker[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((result: RecordingResult) => void) | null>(null);
  const markersRef = useRef<PauseMarker[]>([]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setInterval(() => {
      if (recorderRef.current?.state === "recording") {
        setElapsed(Date.now() - startTimeRef.current);
      }
    }, 250);
  }, [clearTimer]);

  /**
   * Start recording from a set of MediaStreams (local + remotes).
   * Returns a promise that resolves with the RecordingResult when `stop()` is called.
   */
  const start = useCallback(
    (streams: MediaStream[]): Promise<RecordingResult> => {
      // Mix all streams into one using AudioContext + canvas for video
      const audioCtx = new AudioContext();
      const destination = audioCtx.createMediaStreamDestination();

      let hasVideo = false;
      const videoTracks: MediaStreamTrack[] = [];

      for (const stream of streams) {
        // Audio tracks → mix
        if (stream.getAudioTracks().length > 0) {
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(destination);
        }
        // Video tracks → take first available
        for (const vt of stream.getVideoTracks()) {
          if (vt.readyState === "live") {
            videoTracks.push(vt);
            hasVideo = true;
          }
        }
      }

      const mixedStream = new MediaStream(destination.stream.getAudioTracks());

      // Add first live video track if available
      if (hasVideo && videoTracks.length > 0) {
        mixedStream.addTrack(videoTracks[0]);
      }

      // Pick best supported mime
      const mimeType = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "audio/webm;codecs=opus",
        "audio/webm",
      ].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

      const recorder = new MediaRecorder(mixedStream, {
        mimeType: mimeType || undefined,
      });

      chunksRef.current = [];
      markersRef.current = [];
      setPauseMarkers([]);
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorderRef.current = recorder;
      setIsRecording(true);
      setIsPaused(false);
      setElapsed(0);

      recorder.start(1000); // 1s chunks for resilience
      startTimer();

      return new Promise<RecordingResult>((resolve) => {
        resolveRef.current = resolve;

        recorder.onstop = () => {
          clearTimer();
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "video/webm",
          });
          const result: RecordingResult = {
            blob,
            duration: Date.now() - startTimeRef.current,
            pauseMarkers: [...markersRef.current],
            mimeType: recorder.mimeType || "video/webm",
          };
          setIsRecording(false);
          setIsPaused(false);
          resolve(result);
          resolveRef.current = null;

          // Cleanup audio context
          audioCtx.close().catch(() => {});
        };
      });
    },
    [startTimer, clearTimer],
  );

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    recorder.pause();
    const marker: PauseMarker = {
      type: "pause",
      timestamp: Date.now() - startTimeRef.current,
    };
    markersRef.current.push(marker);
    setPauseMarkers([...markersRef.current]);
    setIsPaused(true);
    clearTimer();
  }, [clearTimer]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;

    recorder.resume();
    const marker: PauseMarker = {
      type: "resume",
      timestamp: Date.now() - startTimeRef.current,
    };
    markersRef.current.push(marker);
    setPauseMarkers([...markersRef.current]);
    setIsPaused(false);
    startTimer();
  }, [startTimer]);

  const stop = useCallback((): void => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  return {
    isRecording,
    isPaused,
    elapsed,
    pauseMarkers,
    start,
    pause,
    resume,
    stop,
  };
}
