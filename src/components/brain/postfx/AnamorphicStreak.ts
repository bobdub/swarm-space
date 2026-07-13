import { Effect, BlendFunction } from 'postprocessing';
import { Uniform } from 'three';

/**
 * AnamorphicStreak — horizontal-only blur of the high-luminance pixels,
 * added onto the frame. Produces the classic cinematic horizontal lens
 * streak on the brightest stars/lights.
 *
 * It reads the input color, extracts pixels above `threshold`, blurs
 * them horizontally with a small tap kernel (scaled by `length`), and
 * adds the result back tinted slightly cool-blue for the anamorphic look.
 */
const fragment = /* glsl */ `
  uniform float uStrength;
  uniform float uLength;
  uniform float uThreshold;
  uniform vec3 uTint;

  vec3 sampleBright(sampler2D tex, vec2 uv) {
    vec3 c = texture2D(tex, uv).rgb;
    float l = max(max(c.r, c.g), c.b);
    float k = smoothstep(uThreshold, uThreshold + 0.15, l);
    return c * k;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 texel = vec2(1.0 / resolution.x, 0.0);
    float span = uLength * 60.0;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    // 15 taps, symmetric, gaussian-ish falloff.
    for (int i = -7; i <= 7; i++) {
      float fi = float(i);
      float w = exp(-(fi * fi) / 18.0);
      vec2 off = texel * fi * span;
      acc += sampleBright(inputBuffer, uv + off) * w;
      wsum += w;
    }
    vec3 streak = (acc / max(wsum, 0.0001)) * uTint * uStrength;
    outputColor = vec4(inputColor.rgb + streak, inputColor.a);
  }
`;

export class AnamorphicStreakEffect extends Effect {
  constructor({
    strength = 0.7,
    length = 0.35,
    threshold = 0.9,
    tint = [0.72, 0.86, 1.0] as [number, number, number],
  } = {}) {
    super('AnamorphicStreakEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uStrength', new Uniform(strength)],
        ['uLength', new Uniform(length)],
        ['uThreshold', new Uniform(threshold)],
        ['uTint', new Uniform(tint)],
      ]),
    });
  }
}