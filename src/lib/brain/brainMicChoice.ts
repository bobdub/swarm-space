/**
 * Brain entry + microphone choice.
 *
 * Entering the Brain never requires a microphone. The entry gate records
 * whether the user turned their mic on or chose to listen only, and every
 * Brain voice binding (the Brain page and the "Brain synced" dock on other
 * pages) reads this choice so a listen-only user is never asked for the
 * mic until they press the mic button themselves.
 *
 * Without a mic the call still works both ways for listening: the WebRTC
 * manager always negotiates send+receive audio slots, so peers' voices
 * arrive, and turning the mic on later just fills the empty slot.
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'brain-entry-complete';

export interface BrainEntryRecord {
  avatarId?: string;
  audioInputId?: string;
  /** True once the user has turned their mic on for the Brain. */
  hasMic: boolean;
  /** True when the user entered without a mic (listen only). */
  micSkipped?: boolean;
  ts: number;
}

const listeners = new Set<() => void>();

function read(): BrainEntryRecord | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrainEntryRecord> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      avatarId: typeof parsed.avatarId === 'string' ? parsed.avatarId : undefined,
      audioInputId: typeof parsed.audioInputId === 'string' ? parsed.audioInputId : undefined,
      hasMic: parsed.hasMic === true,
      micSkipped: parsed.micSkipped === true,
      ts: typeof parsed.ts === 'number' ? parsed.ts : 0,
    };
  } catch {
    return null;
  }
}

function write(record: BrainEntryRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* quota / private mode: the choice still applies for this session */
  }
  snapshot = record.hasMic;
  listeners.forEach((fn) => fn());
}

let snapshot = read()?.hasMic ?? false;

/** True once the entry gate was finished, with or without a mic. */
export function isBrainEntryComplete(): boolean {
  const rec = read();
  return !!rec && (rec.hasMic || rec.micSkipped === true);
}

/** True when the user chose to use their mic in the Brain. */
export function hasBrainMic(): boolean {
  return read()?.hasMic ?? false;
}

/** Record that the entry gate was finished. */
export function completeBrainEntry(opts: { avatarId?: string; audioInputId?: string; hasMic: boolean }): void {
  write({
    avatarId: opts.avatarId,
    audioInputId: opts.audioInputId,
    hasMic: opts.hasMic,
    micSkipped: !opts.hasMic,
    ts: Date.now(),
  });
}

/** Turn the Brain mic choice on or off, keeping the rest of the record. */
export function setBrainMic(on: boolean): void {
  const prev = read();
  write({
    ...(prev ?? { ts: Date.now() }),
    hasMic: on,
    micSkipped: !on,
    ts: Date.now(),
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    snapshot = read()?.hasMic ?? false;
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** Live Brain mic choice for React components. */
export function useBrainMicChoice(): boolean {
  return useSyncExternalStore(subscribe, () => snapshot, () => false);
}
