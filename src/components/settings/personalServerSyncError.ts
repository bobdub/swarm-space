/**
 * Classify a raw personal-server sync error for display.
 *
 * Status codes are matched as standalone numbers only — chunk refs are hex
 * hashes (e.g. `chunk-401f2ab…`), and a substring match on "401"/"403"
 * used to mislabel hash-mismatch or missing-chunk errors as credential
 * rejections.
 */
const STATUS_400 = /(?<![0-9a-z])400(?![0-9a-z])/;
const STATUS_CREDENTIAL = /(?<![0-9a-z])(401|403)(?![0-9a-z])/;

export function friendlySyncError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('hash mismatch') || STATUS_400.test(m)) return `The server refused an upload (${message}). Tap "Sync now" to retry with the updated format.`;
  if (m.includes('failed to fetch') || m.includes('cors') || m.includes('network')) return `Couldn't reach the server — check it's online and allows this site (CORS). (${message})`;
  if (STATUS_CREDENTIAL.test(m) || m.includes('credential')) return `The server rejected this device's access key — relink the server. (${message})`;
  if (m.includes('cap')) return `The server is full — raise its storage limit or free space. (${message})`;
  return message;
}
