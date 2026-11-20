/**
 * Shy Node (node dashboard). Default: not shy — nodes join in unless the
 * person opts out. A shy node: Infinity does not chime in on its posts
 * (unless mentioned) and never learns from what it writes.
 *
 * Kept dependency-free so content creation paths can read it cheaply.
 */
const SHY_MODE_KEY = 'entity-voice-shy-node';

export function getShyMode(): boolean {
  try {
    const v = localStorage.getItem(SHY_MODE_KEY);
    if (v === null) return false;
    return v === 'true';
  } catch { return false; }
}

export function setShyMode(value: boolean): void {
  try { localStorage.setItem(SHY_MODE_KEY, String(value)); } catch { /* ignore */ }
}
