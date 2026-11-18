/**
 * swingEnergy — how much energy a player's swing puts into `applyImpact`.
 *
 * The swing used to be `max(0.2, toolMass * (0.3 + intensity * 8))`. Stone
 * tools derive to ~0.05 kg and the field probe's intensity is ~1e-5, so
 * every player swing landed on the 0.2 floor. Against a tree that gives an
 * effective cut of ~0.06 (a cut needs ≥ 1), so trees, rock and even grass
 * could never be cut in play — only the tests, which pass 12 directly,
 * ever saw a cut.
 *
 * Most of a real swing comes from the body, not the tool's own weight, so
 * the arm supplies a fixed baseline and the tool mass and field intensity
 * add on top. Tool sharpness, head density, target bond and curvature load
 * still decide the outcome inside `applyImpact`: a stone axe fells a tree,
 * a stone pick chips rock, a shovel breaks sod, and gold, platinum,
 * diamond and lava still refuse.
 */

/** Energy the player's arm puts into a swing, before the tool adds its own. */
export const PLAYER_SWING_ENERGY = 5.5;

export function playerSwingEnergy(toolMass: number, intensity: number): number {
  const mass = Number.isFinite(toolMass) ? Math.max(0, toolMass) : 0;
  const i = Number.isFinite(intensity) ? Math.max(0, intensity) : 0;
  return PLAYER_SWING_ENERGY + mass * (0.3 + i * 8);
}
