/**
 * Shrink long audio so it fits the mesh post limit.
 *
 * A 250 MB WAV/FLAC recording is far over `MESH_POST_UPLOAD_LIMIT_BYTES`,
 * but the same audio as Opus (or AAC) at a speech/music bitrate is a few
 * tens of MB. Before a large audio file is chunked and encrypted we
 * re-encode it in the browser, choosing the highest bitrate that still
 * lands under the limit for the file's duration. The output is a single
 * `.m4a` (MP4 audio), which every modern browser's <audio> plays.
 *
 * Decoding streams through the source file (no full read into memory) and
 * runs on WebCodecs via mediabunny, which is loaded only when needed.
 */

/** Largest source audio we will try to compress (above this, decoding takes too long). */
export const AUDIO_TRANSCODE_SOURCE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Best bitrate we ever spend; Opus/AAC at 128 kbps stereo is near-transparent. */
export const AUDIO_MAX_BITRATE = 128_000;
/** Lowest bitrate we accept; still clear for speech, mono. */
export const AUDIO_MIN_BITRATE = 24_000;
/** Below this bitrate we fold to mono so the bits go to clarity, not width. */
export const AUDIO_MONO_BELOW_BITRATE = 48_000;
/** Leave room for container overhead and encoder overshoot. */
const SIZE_HEADROOM = 0.9;

export class AudioTranscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioTranscodeError";
  }
}

export const isAudioFile = (file: Pick<File, "type">) => file.type.startsWith("audio/");

/** Audio over the limit (but not absurdly large) is compressed instead of rejected. */
export function shouldTranscodeAudio(file: Pick<File, "type" | "size">, limitBytes: number): boolean {
  return isAudioFile(file) && file.size > limitBytes && file.size <= AUDIO_TRANSCODE_SOURCE_MAX_BYTES;
}

export interface AudioEncodePlan {
  bitrate: number;
  numberOfChannels: 1 | 2;
}

/**
 * Highest bitrate that fits `limitBytes` for a clip of `durationSeconds`,
 * capped at AUDIO_MAX_BITRATE. Returns null if even AUDIO_MIN_BITRATE
 * would not fit (the clip is too long for one post).
 */
export function planAudioEncode(durationSeconds: number, limitBytes: number): AudioEncodePlan | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const fit = Math.floor((limitBytes * SIZE_HEADROOM * 8) / durationSeconds / 1000) * 1000;
  const bitrate = Math.min(AUDIO_MAX_BITRATE, fit);
  if (bitrate < AUDIO_MIN_BITRATE) return null;
  return { bitrate, numberOfChannels: bitrate < AUDIO_MONO_BELOW_BITRATE ? 1 : 2 };
}

/** Longest clip (in whole minutes) that fits `limitBytes` at the minimum bitrate. */
export function maxAudioMinutes(limitBytes: number): number {
  return Math.floor((limitBytes * SIZE_HEADROOM * 8) / AUDIO_MIN_BITRATE / 60);
}

export interface TranscodeAudioOptions {
  limitBytes: number;
  onProgress?: (percent: number) => void;
}

function outputName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "audio";
  return `${base}.m4a`;
}

/** Re-encode `file` to Opus/AAC in an .m4a that fits `limitBytes`. */
export async function transcodeAudioForMesh(file: File, { limitBytes, onProgress }: TranscodeAudioOptions): Promise<File> {
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (!track) throw new AudioTranscodeError("This audio format can't be read in this browser.");

    const duration = await input.computeDuration();
    const plan = planAudioEncode(duration, limitBytes);
    if (!plan) {
      throw new AudioTranscodeError(
        `This recording is too long for one post. Audio up to about ${maxAudioMinutes(limitBytes)} minutes fits.`
      );
    }

    const sampleRate = 48_000;
    const quality = new mb.Quality({ bitrate: plan.bitrate });
    const encodeOpts = { numberOfChannels: plan.numberOfChannels, sampleRate, quality };
    const codec = (await mb.canEncodeAudio("opus", encodeOpts))
      ? "opus"
      : (await mb.canEncodeAudio("aac", encodeOpts))
        ? "aac"
        : null;
    if (!codec) throw new AudioTranscodeError("This browser can't compress audio. Try a recent Chrome, Edge, Firefox or Safari.");

    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { discard: true },
      audio: { codec, quality, numberOfChannels: plan.numberOfChannels, sampleRate, forceTranscode: true },
      showWarnings: false,
    });
    if (!conversion.isValid) throw new AudioTranscodeError("This audio couldn't be compressed in this browser.");
    conversion.onProgress = (p) => onProgress?.(Math.round(p * 100));
    await conversion.execute();

    const buffer = target.buffer;
    if (!buffer || buffer.byteLength === 0) throw new AudioTranscodeError("Compressing the audio produced no data.");
    if (buffer.byteLength > limitBytes) throw new AudioTranscodeError("The compressed audio is still over the mesh limit.");
    return new File([buffer], outputName(file.name), { type: "audio/mp4", lastModified: file.lastModified });
  } catch (err) {
    if (err instanceof AudioTranscodeError) throw err;
    console.error("[audioTranscode] failed:", err);
    throw new AudioTranscodeError("This audio couldn't be compressed in this browser.");
  } finally {
    input.dispose();
  }
}
