/**
 * Infinity TTS — Web Speech API wrapper.
 * Local, free, browser-native. No backend.
 */

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  // Prefer en-* female if discoverable, else first en-*, else first voice.
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const female = en.find((v) => /female|samantha|victoria|karen|moira|tessa|zira/i.test(v.name));
  cachedVoice = female ?? en[0] ?? voices[0] ?? null;
  return cachedVoice;
}

/** Speak a line as Infinity. No-op if speechSynthesis is unavailable. */
export function speakInfinity(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!text || !text.trim()) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.pitch = 1.05;
    utter.rate = 0.95;
    utter.volume = 0.95;
    // Cancel any prior queue to avoid speech pile-up.
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  } catch {
    /* best-effort */
  }
}

/** Cancel any in-flight or queued Infinity utterances. */
export function cancelInfinity(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/** Pre-warm the voice list (some browsers populate asynchronously). */
export function primeInfinityVoice(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    pickVoice();
    if (!cachedVoice) {
      window.speechSynthesis.onvoiceschanged = () => {
        cachedVoice = null;
        pickVoice();
      };
    }
  } catch {
    /* ignore */
  }
}