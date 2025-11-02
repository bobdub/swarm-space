import { describe, expect, it } from 'bun:test';
import { SIGNALING_ACTIONS } from '@/components/p2p/dashboard/signalingActions';

describe('Signaling control confirmations', () => {
  it('defines default auto-resume windows for pause actions', () => {
    expect(SIGNALING_ACTIONS['pause-all'].defaultDuration).toBe(5 * 60 * 1000);
    expect(SIGNALING_ACTIONS['pause-inbound'].defaultDuration).toBe(3 * 60 * 1000);
    expect(SIGNALING_ACTIONS['pause-outbound'].defaultDuration).toBe(2 * 60 * 1000);
  });

  it('provides operator guidance text for confirmation dialogs', () => {
    Object.values(SIGNALING_ACTIONS).forEach((metadata) => {
      expect(metadata.description.length).toBeGreaterThan(0);
      expect(metadata.resumeHint.length).toBeGreaterThan(0);
    });
  });
});
