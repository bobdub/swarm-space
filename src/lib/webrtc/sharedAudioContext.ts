let context: AudioContext | null = null;

/** One call AudioContext for capture, fallback playback and speaker meters. */
export function getCallAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  try {
    if (!context || context.state === 'closed') context = new AudioContext();
    return context;
  } catch { return null; }
}

export function resumeCallAudio(): void {
  const ctx = getCallAudioContext();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
}