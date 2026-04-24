import { useEffect, useRef } from 'react';

/**
 * USB / Bluetooth gamepad → Brain intent bridge.
 * Polls navigator.getGamepads() each animation frame and writes the
 * results into shared mutable globals supplied by the caller. Mobile
 * Safari (no Gamepad API) is a no-op.
 *
 * Mappings (XInput layout):
 *   Left stick   → moveInput.fwd / moveInput.right
 *   Right stick  → lookInput.yaw / lookInput.pitch (additive deltas)
 *   Right trigger (button 7) → onRunPress() once on press
 *   A (button 0)             → onJump() once on press
 */
export interface GamepadIntentTargets {
  moveInput: { fwd: number; right: number };
  lookInput: { yaw: number; pitch: number };
  onRunPress?: () => void;
  onJump?: () => void;
}

const DEAD_ZONE = 0.15;
function applyDeadZone(v: number): number {
  if (Math.abs(v) < DEAD_ZONE) return 0;
  const sign = v < 0 ? -1 : 1;
  return sign * ((Math.abs(v) - DEAD_ZONE) / (1 - DEAD_ZONE));
}

export function useGamepadIntent(targets: GamepadIntentTargets): void {
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return;
    }
    const lastButtons = new Map<number, boolean>();
    let raf = 0;
    const tick = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const t = targetsRef.current;
      let claimed = false;
      for (const pad of pads) {
        if (!pad) continue;
        claimed = true;
        const lx = applyDeadZone(pad.axes[0] ?? 0);
        const ly = applyDeadZone(pad.axes[1] ?? 0);
        const rx = applyDeadZone(pad.axes[2] ?? 0);
        const ry = applyDeadZone(pad.axes[3] ?? 0);
        // Max-magnitude merge with keyboard / touch.
        if (Math.abs(lx) > Math.abs(t.moveInput.right)) t.moveInput.right = lx;
        if (Math.abs(ly) > Math.abs(t.moveInput.fwd)) t.moveInput.fwd = -ly;
        // Right stick = additive look delta (like a slow drag).
        if (rx) t.lookInput.yaw += rx * 0.04;
        if (ry) t.lookInput.pitch += ry * 0.04;
        const rt = pad.buttons[7]?.pressed ?? false;
        if (rt && !lastButtons.get(7)) t.onRunPress?.();
        lastButtons.set(7, rt);
        const a = pad.buttons[0]?.pressed ?? false;
        if (a && !lastButtons.get(0)) t.onJump?.();
        lastButtons.set(0, a);
        break; // first connected pad wins
      }
      void claimed;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}