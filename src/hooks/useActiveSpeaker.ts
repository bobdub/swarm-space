import { useEffect, useRef, useState } from "react";
import type { VideoParticipant } from "@/lib/webrtc/types";

/**
 * Detects which remote participant is currently the loudest speaker by
 * sampling per-stream RMS through a single shared AudioContext. Polls at
 * 500 ms to keep CPU low. Returns the loudest peerId or null.
 *
 * Lifted from the legacy StreamingRoomTray so the new BrainChatPanel can
 * draw an active-speaker ring in the users rail.
 */
export function useActiveSpeaker(participants: VideoParticipant[]): string | null {
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const sharedAudioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<
    Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; streamId: string }>
  >(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      analysersRef.current.clear();
      if (sharedAudioCtxRef.current) {
        sharedAudioCtxRef.current.close().catch(() => {});
        sharedAudioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!participants.length) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setActiveSpeaker(null);
      return;
    }

    if (!sharedAudioCtxRef.current || sharedAudioCtxRef.current.state === "closed") {
      try {
        sharedAudioCtxRef.current = new AudioContext();
      } catch {
        return;
      }
    }
    const ctx = sharedAudioCtxRef.current;

    const currentPeerIds = new Set<string>();
    for (const p of participants) {
      if (!p.stream) continue;
      currentPeerIds.add(p.peerId);
      const existing = analysersRef.current.get(p.peerId);
      if (existing && existing.streamId === p.stream.id) continue;
      if (existing) {
        try { existing.source.disconnect(); } catch { /* ok */ }
      }
      try {
        const src = ctx.createMediaStreamSource(p.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        analysersRef.current.set(p.peerId, { source: src, analyser, streamId: p.stream.id });
      } catch { /* ignore */ }
    }
    for (const [peerId, entry] of analysersRef.current) {
      if (!currentPeerIds.has(peerId)) {
        try { entry.source.disconnect(); } catch { /* ok */ }
        analysersRef.current.delete(peerId);
      }
    }

    if (!intervalRef.current) {
      const data = new Uint8Array(128);
      intervalRef.current = setInterval(() => {
        let maxRms = 0;
        let loudest: string | null = null;
        for (const [peerId, { analyser }] of analysersRef.current) {
          analyser.getByteFrequencyData(data);
          const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) / 255;
          if (rms > maxRms && rms > 0.02) {
            maxRms = rms;
            loudest = peerId;
          }
        }
        setActiveSpeaker(loudest);
      }, 500);
    }
  }, [participants]);

  return activeSpeaker;
}