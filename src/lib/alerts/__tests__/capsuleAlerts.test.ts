import { describe, expect, it } from 'vitest';
import {
  createCapsuleAlertService,
  type CapsuleAlertEvent,
  type CapsuleAlertState,
} from '../capsuleAlerts';

function setup(threshold = 3, initial: CapsuleAlertState | null = null) {
  let stored = initial;
  const events: CapsuleAlertEvent[] = [];
  const service = createCapsuleAlertService({
    threshold,
    now: () => 1000,
    persistence: {
      read: async () => stored,
      write: async (state) => {
        stored = state;
      },
    },
    notify: (event) => events.push(event),
  });
  return { service, events, stored: () => stored };
}

describe('capsule alert service', () => {
  it('stays quiet below the threshold', async () => {
    const { service, events } = setup(3);
    await service.recordFailure('a');
    await service.recordFailure('b');
    expect(events).toHaveLength(0);
    expect((await service.getState()).consecutiveFailures).toBe(2);
  });

  it('alerts once the streak reaches the threshold and persists the last failure', async () => {
    const { service, events, stored } = setup(2);
    await service.recordFailure('a');
    await service.recordFailure('b');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'failure', streak: 2 });
    expect(stored()).toMatchObject({ alerting: true, lastFailureMessage: 'b', lastFailureAt: 1000 });
  });

  it('sends a recovery notice only after an alert, and resets the streak', async () => {
    const quiet = setup(3);
    await quiet.service.recordFailure('a');
    await quiet.service.recordSuccess();
    expect(quiet.events).toHaveLength(0);
    expect(quiet.stored()?.consecutiveFailures).toBe(0);

    const loud = setup(1);
    await loud.service.recordFailure('a');
    await loud.service.recordSuccess({ peers: 4 });
    expect(loud.events.map((e) => e.type)).toEqual(['failure', 'recovery']);
    expect(loud.events[1].details).toEqual({ peers: 4 });
    expect(loud.stored()).toMatchObject({ consecutiveFailures: 0, alerting: false, lastSuccessAt: 1000 });
  });

  it('treats unreadable or malformed state as a fresh streak', async () => {
    const { service } = setup(3, { consecutiveFailures: 'x' } as unknown as CapsuleAlertState);
    expect((await service.recordFailure('a')).consecutiveFailures).toBe(1);
  });
});
