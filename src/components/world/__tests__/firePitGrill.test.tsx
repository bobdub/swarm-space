/**
 * The fire pit chip offers the grill: a cook button for each raw food the
 * player holds, live only while the fire burns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { message: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));

import { FirePitControls } from '../FirePitView';
import { _resetFireForTest, recordFuel } from '@/lib/world/fireStore';
import { _resetCookingForTest, grillJobs, heldRaw } from '@/lib/world/cooking';
import { _resetHarvestedForTest, recordHarvestForResource } from '@/lib/remix/harvestedInventory';

beforeEach(() => {
  _resetFireForTest();
  _resetHarvestedForTest();
  _resetCookingForTest();
});
afterEach(() => cleanup());

describe('fire pit grill controls', () => {
  it('hides the grill when the player has no raw food', () => {
    const view = render(<FirePitControls pitId="pit" selfId="me" />);
    expect(view.queryByTestId('fire-pit-grill')).toBeNull();
  });

  it('puts a fish on the grill of a lit fire', () => {
    recordHarvestForResource('fish', 2);
    recordFuel('pit', 'me', 1, Date.now());
    const view = render(<FirePitControls pitId="pit" selfId="me" />);
    const cook = view.getByTestId('fire-pit-cook-fish') as HTMLButtonElement;
    expect(cook.disabled).toBe(false);
    act(() => { fireEvent.click(cook); });
    expect(heldRaw('fish')).toBe(1);
    expect(grillJobs('pit')).toHaveLength(1);
    expect(view.getAllByTestId('fire-pit-grill-job')).toHaveLength(1);
  });

  it('cannot cook over a cold pit', () => {
    recordHarvestForResource('chicken', 1);
    const view = render(<FirePitControls pitId="pit" selfId="me" />);
    expect((view.getByTestId('fire-pit-cook-chicken') as HTMLButtonElement).disabled).toBe(true);
  });
});
