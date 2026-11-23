import { describe, it, expect } from "vitest";
import {
  AUDIO_MAX_BITRATE,
  AUDIO_MIN_BITRATE,
  AUDIO_TRANSCODE_SOURCE_MAX_BYTES,
  maxAudioMinutes,
  planAudioEncode,
  shouldTranscodeAudio,
} from "../audioTranscode";
import { MESH_POST_UPLOAD_LIMIT_BYTES } from "../meshUploadLimits";

const MB = 1024 * 1024;
const LIMIT = MESH_POST_UPLOAD_LIMIT_BYTES;

describe("shouldTranscodeAudio", () => {
  it("only compresses audio that is over the limit", () => {
    expect(shouldTranscodeAudio({ type: "audio/wav", size: 250 * MB }, LIMIT)).toBe(true);
    expect(shouldTranscodeAudio({ type: "audio/mpeg", size: 10 * MB }, LIMIT)).toBe(false);
    expect(shouldTranscodeAudio({ type: "video/mp4", size: 250 * MB }, LIMIT)).toBe(false);
    expect(shouldTranscodeAudio({ type: "audio/wav", size: AUDIO_TRANSCODE_SOURCE_MAX_BYTES + 1 }, LIMIT)).toBe(false);
  });
});

describe("planAudioEncode", () => {
  it("keeps full quality when the clip is short enough", () => {
    // 25 minutes of CD-quality WAV is ~250 MB; at 128 kbps it is ~24 MB.
    expect(planAudioEncode(25 * 60, LIMIT)).toEqual({ bitrate: AUDIO_MAX_BITRATE, numberOfChannels: 2 });
  });

  it("lowers the bitrate so a long recording still fits", () => {
    const seconds = 3 * 60 * 60;
    const plan = planAudioEncode(seconds, LIMIT)!;
    expect(plan.bitrate).toBeLessThan(AUDIO_MAX_BITRATE);
    expect(plan.bitrate).toBeGreaterThanOrEqual(AUDIO_MIN_BITRATE);
    expect((plan.bitrate / 8) * seconds).toBeLessThanOrEqual(LIMIT);
    expect(plan.numberOfChannels).toBe(1);
  });

  it("refuses clips that would fall below the minimum bitrate", () => {
    expect(planAudioEncode((maxAudioMinutes(LIMIT) + 5) * 60, LIMIT)).toBeNull();
    expect(planAudioEncode(0, LIMIT)).toBeNull();
    expect(planAudioEncode(Number.NaN, LIMIT)).toBeNull();
  });

  it("fits about four hours of speech in one 50 MB post", () => {
    expect(maxAudioMinutes(LIMIT)).toBeGreaterThanOrEqual(240);
  });
});
