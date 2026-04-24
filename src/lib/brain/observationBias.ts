/**
 * observationBias — color is an *observation channel*, not a property.
 *
 * The shader/UI consults this LUT to translate a physics `SurfaceClass`
 * into RGB for the current observer. Switching channels never touches
 * physics — wading depth, walking speed, dry mask remain whatever the
 * surface class says they are.
 *
 * Channels:
 *   - desktop-srgb       : default sRGB rendering
 *   - mobile-p3          : wider gamut for OLED phones
 *   - colorblind-deuter  : deuteranopia-safe palette
 *   - physics-true       : Hapke-style albedo spectrum (debug only)
 *
 * Why hard-coded? Because color *is* the bias — the network can't compute
 * what an observer's display will do with a wavelength. We pin the
 * mapping per channel and let the observer pick their channel.
 */
import type { SurfaceClass } from './surfaceClass';

export type ObservationChannel =
  | 'desktop-srgb'
  | 'mobile-p3'
  | 'colorblind-deuter'
  | 'physics-true';

/** RGB triplet in 0..1 linear space. */
export type RGB = [number, number, number];

export const OBSERVATION_PALETTES: Record<
  ObservationChannel,
  Record<SurfaceClass, RGB>
> = {
  'desktop-srgb': {
    ocean:    [0.05, 0.18, 0.40],
    shore:    [0.55, 0.50, 0.30],
    land:     [0.20, 0.45, 0.18],
    volcLand: [0.32, 0.18, 0.12],
    ice:      [0.92, 0.95, 0.98],
  },
  'mobile-p3': {
    // OLED: deeper blacks, slightly more saturated greens/blues.
    ocean:    [0.03, 0.22, 0.55],
    shore:    [0.62, 0.55, 0.30],
    land:     [0.18, 0.55, 0.20],
    volcLand: [0.40, 0.20, 0.10],
    ice:      [0.95, 0.98, 1.00],
  },
  'colorblind-deuter': {
    // Deuteranopia-safe: replace green↔red ambiguity with blue↔orange.
    ocean:    [0.10, 0.20, 0.55],
    shore:    [0.85, 0.70, 0.30],
    land:     [0.40, 0.55, 0.85],
    volcLand: [0.95, 0.55, 0.10],
    ice:      [0.95, 0.95, 0.95],
  },
  'physics-true': {
    // Approximate Hapke albedo for sea/sand/grass/basalt/snow at zenith.
    ocean:    [0.06, 0.08, 0.10],   // a≈0.07
    shore:    [0.40, 0.36, 0.28],   // a≈0.35
    land:     [0.14, 0.26, 0.10],   // grass a≈0.18
    volcLand: [0.05, 0.04, 0.04],   // basalt a≈0.05
    ice:      [0.78, 0.80, 0.82],   // a≈0.80
  },
};

/**
 * Pick the default observation channel for the current device. Pure DOM
 * sniff, no React hooks — safe to call from non-render code.
 */
export function detectDefaultChannel(): ObservationChannel {
  if (typeof window === 'undefined') return 'desktop-srgb';
  const params = new URLSearchParams(window.location.search);
  const override = params.get('palette') as ObservationChannel | null;
  if (override && override in OBSERVATION_PALETTES) return override;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const p3 = window.matchMedia?.('(color-gamut: p3)').matches;
  if (coarse && p3) return 'mobile-p3';
  return 'desktop-srgb';
}

export function colorFor(
  channel: ObservationChannel,
  cls: SurfaceClass,
): RGB {
  return OBSERVATION_PALETTES[channel][cls];
}