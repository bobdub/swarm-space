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

export type RecordingQualityProfile = "low" | "medium" | "high";

export interface RecordingOptions {
  quality?: RecordingQualityProfile;
  compositeMultiParty?: boolean;
}

type RecordingPreset = {
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  width: number;
  height: number;
  fps: number;
};

const QUALITY_PRESETS: Record<RecordingQualityProfile, RecordingPreset> = {
  low: {
    videoBitsPerSecond: 1_000_000,
    audioBitsPerSecond: 64_000,
    width: 1280,
    height: 720,
    fps: 24,
  },
  medium: {
    videoBitsPerSecond: 1_800_000,
    audioBitsPerSecond: 96_000,
    width: 1280,
    height: 720,
    fps: 24,
  },
  high: {
    videoBitsPerSecond: 3_000_000,
    audioBitsPerSecond: 128_000,
    width: 1920,
    height: 1080,
    fps: 30,
  },
};

function pickSupportedMimeType(hasVideo: boolean): string {
  const mimeCandidates = hasVideo
    ? [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
        "video/webm",
      ]
    : ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/webm", "audio/mp4"];

  return mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function drawCompositeFrame(canvas: HTMLCanvasElement, videos: HTMLVideoElement[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const count = videos.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const tileW = canvas.width / cols;
  const tileH = canvas.height / rows;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  videos.forEach((video, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = col * tileW;
    const y = row * tileH;

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    const sourceAspect = (video.videoWidth || 16) / (video.videoHeight || 9);
    const targetAspect = tileW / tileH;

    let drawW = tileW;
    let drawH = tileH;
    if (sourceAspect > targetAspect) {
      drawH = tileW / sourceAspect;
    } else {
      drawW = tileH * sourceAspect;
    }

    const drawX = x + (tileW - drawW) / 2;
    const drawY = y + (tileH - drawH) / 2;
    ctx.drawImage(video, drawX, drawY, drawW, drawH);
  });
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
  const cleanupRecordingGraphRef = useRef<(() => void) | null>(null);

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
    (streams: MediaStream[], options?: RecordingOptions): Promise<RecordingResult> => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        throw new Error("Recording is already active");
      }

      cleanupRecordingGraphRef.current?.();
      cleanupRecordingGraphRef.current = null;

      const quality = options?.quality ?? "low";
      const preset = QUALITY_PRESETS[quality];
      const audioCtx = new AudioContext();
      const destination = audioCtx.createMediaStreamDestination();
      const sourceNodes: MediaStreamAudioSourceNode[] = [];

      const videoTracks: MediaStreamTrack[] = [];

      for (const stream of streams) {
        if (stream.getAudioTracks().length > 0) {
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(destination);
          sourceNodes.push(source);
        }

        for (const vt of stream.getVideoTracks()) {
          if (vt.readyState === "live") {
            videoTracks.push(vt);
          }
        }
      }

      const mixedStream = new MediaStream(destination.stream.getAudioTracks());
      const clonedTracks: MediaStreamTrack[] = [];
      const disposableVideos: HTMLVideoElement[] = [];
      let animationFrame = 0;
      let canvas: HTMLCanvasElement | null = null;

      const hasVideo = videoTracks.length > 0;
      const shouldComposite = hasVideo && (options?.compositeMultiParty ?? true) && videoTracks.length > 1;

      if (hasVideo && shouldComposite) {
        canvas = document.createElement("canvas");
        canvas.width = preset.width;
        canvas.height = preset.height;

        disposableVideos.push(
          ...videoTracks.map((track) => {
            const video = document.createElement("video");
            video.muted = true;
            video.playsInline = true;
            video.srcObject = new MediaStream([track]);
            void video.play().catch(() => {});
            return video;
          }),
        );

        const renderLoop = () => {
          if (canvas && disposableVideos.length > 0) {
            drawCompositeFrame(canvas, disposableVideos);
          }
          animationFrame = window.requestAnimationFrame(renderLoop);
        };
        renderLoop();

        const compositedTrack = canvas.captureStream(preset.fps).getVideoTracks()[0];
        if (compositedTrack) {
          mixedStream.addTrack(compositedTrack);
        }
      } else if (hasVideo) {
        const cloned = videoTracks[0].clone();
        clonedTracks.push(cloned);
        mixedStream.addTrack(cloned);
      }

      const mimeType = pickSupportedMimeType(hasVideo);

      const recorder = new MediaRecorder(mixedStream, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: hasVideo ? preset.videoBitsPerSecond : undefined,
        audioBitsPerSecond: preset.audioBitsPerSecond,
      });

      cleanupRecordingGraphRef.current = () => {
        if (animationFrame) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }

        for (const node of sourceNodes) {
          node.disconnect();
        }

        for (const video of disposableVideos) {
          video.pause();
          video.srcObject = null;
        }

        for (const track of clonedTracks) {
          track.stop();
        }

        for (const track of mixedStream.getTracks()) {
          track.stop();
        }

        void audioCtx.close().catch(() => {});
      };

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
            type: recorder.mimeType || (hasVideo ? "video/webm" : "audio/webm"),
          });
          const result: RecordingResult = {
            blob,
            duration: Date.now() - startTimeRef.current,
            pauseMarkers: [...markersRef.current],
            mimeType: recorder.mimeType || (hasVideo ? "video/webm" : "audio/webm"),
          };

          cleanupRecordingGraphRef.current?.();
          cleanupRecordingGraphRef.current = null;
          recorderRef.current = null;

          setIsRecording(false);
          setIsPaused(false);
          resolve(result);
          resolveRef.current = null;
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
