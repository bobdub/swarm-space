/**
 * BarLightSwitchButton — a plain DOM button pinned to the corner of the
 * brain view that toggles the SurfaceBar's interior lights.
 *
 * Deliberately NOT rendered inside the WebGL canvas. That is the whole
 * point: it's a normal HTML button, so the click cannot be swallowed
 * by a raycast miss, an invisible collider, or an orbit control eating
 * the event. State is held in a tiny external store that SurfaceBar
 * subscribes to.
 */
import { useBarLightsOn, toggleBarLights } from '@/lib/brain/barLightsStore';

export function BarLightSwitchButton() {
  const on = useBarLightsOn();
  return (
    <button
      type="button"
      data-testid="bar-light-switch"
      onClick={(e) => {
        e.stopPropagation();
        toggleBarLights();
      }}
      className="pointer-events-auto select-none"
      style={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: 60,
        padding: '10px 16px',
        borderRadius: 999,
        border: '2px solid #3a2a1a',
        background: on ? '#2a1a10' : '#0f0a06',
        color: on ? '#ffd9a8' : '#7a6a5a',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
        fontSize: 13,
        letterSpacing: 1,
        cursor: 'pointer',
        boxShadow: on
          ? '0 0 12px rgba(255, 176, 112, 0.6)'
          : '0 0 4px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
      aria-label="Toggle bar interior lights"
    >
      Bar Lights: {on ? 'ON' : 'OFF'}
    </button>
  );
}

export default BarLightSwitchButton;