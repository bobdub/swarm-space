import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ShipControls } from '../sea/ShipWheel';

const crew = vi.hoisted(() => ({
  role: 'helm' as 'helm' | 'rod',
  holdSail: vi.fn(), stopMastHold: vi.fn(), setCrewInput: vi.fn(), cast: vi.fn(),
}));
vi.mock('@/lib/brain/sea/crew', () => ({
  OUT_OF_FOOD_NOTE: 'No food', getCrewRole: () => crew.role,
  subscribeCrew: () => () => {}, getMastHold: () => null,
  holdSail: crew.holdSail, stopMastHold: crew.stopMastHold,
  isOutOfFood: () => false, setCrewInput: crew.setCrewInput, setFoodPurse: vi.fn(),
}));
vi.mock('@/lib/brain/sea/vessel', () => ({ getVillageBoat: () => ({
  cmd: { sail: 0 }, windOnBow: () => ({ speed: 1, from: 0 }), speed: () => 0,
}) }));
vi.mock('@/lib/world/materials', () => ({ materialTotals: () => ({ food: 5 }), spendMaterials: vi.fn() }));
vi.mock('@/lib/world/playerHarvest', () => ({ recordPlayerHarvest: vi.fn() }));
vi.mock('@/lib/brain/earth', () => ({ getEarthPoseTime: () => 123 }));
vi.mock('@/lib/brain/sea/sharks', () => ({ recordSharkCaught: vi.fn() }));
vi.mock('@/lib/brain/sea/fishing', () => ({
  BITE_WINDOW_S: 6, FIGHT_MISSES: 2, castOrReel: crew.cast,
  getFishing: () => ({ phase: 'idle' }), markerAt: () => 0.5,
  setFishingReward: vi.fn(), setSharkCheck: vi.fn(), subscribeFishing: () => () => {},
}));
vi.mock('@/lib/brain/sea/villageBoat', () => ({
  fishingDepth: () => 12, fishingSchoolNear: () => true, fishingShark: () => null,
  fishingSharkStillThere: () => false, myBoatAground: () => false, pushOffMyBoat: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); crew.role = 'helm'; });

describe('compact boat action input', () => {
  it('holds the sail direction until release or cancellation', () => {
    const view = render(<ShipControls mobile={false} readoutTarget={null} />);
    const raise = view.getByRole('button', { name: 'Hold to raise sail' });
    fireEvent.pointerDown(raise);
    expect(crew.holdSail).toHaveBeenLastCalledWith(1);
    fireEvent.pointerUp(raise);
    expect(crew.stopMastHold).toHaveBeenCalledTimes(1);
    const lower = view.getByRole('button', { name: 'Hold to lower sail' });
    fireEvent.pointerDown(lower);
    expect(crew.holdSail).toHaveBeenLastCalledWith(-1);
    fireEvent.pointerCancel(lower);
    expect(crew.stopMastHold).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(crew.setCrewInput).toHaveBeenLastCalledWith({ wheel: 0, sail: 0, row: 0, rowTurn: 0 });
  });
  it('casts with current shared time and fishing conditions', () => {
    crew.role = 'rod';
    const view = render(<ShipControls mobile readoutTarget={null} />);
    fireEvent.pointerDown(view.getByRole('button', { name: 'Cast the line' }));
    expect(crew.cast).toHaveBeenCalledExactlyOnceWith(123, 12, true, null);
  });
});