import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/brain/builder/BuilderOptionsPanel', () => ({ BuilderOptionsPanel: () => null }));
vi.mock('@/components/brain/builder/ToolPurchaseCard', () => ({ ToolPurchaseCard: () => null }));
vi.mock('@/components/remix/LabTab', () => ({ LabTab: () => null }));
vi.mock('@/lib/world/toolPurchases', () => ({ ownsTool: async () => false, TOOL_PURCHASE_EVENT: 'tool-purchase' }));
vi.mock('@/lib/remix/mintedPrefabsStore', () => ({ subscribeMintedPrefabs: () => () => {} }));
vi.mock('@/lib/brain/toolMintStore', () => ({ subscribeForgedTools: () => () => {} }));

import { BuilderInventory } from '@/components/brain/builder/BuilderInventory';
import { _resetHarvestedForTest, recordHarvest } from '@/lib/remix/harvestedInventory';
import { _resetPlayModeForTest, setMeshOnline } from '@/lib/world/playMode';
import type { UseBrainBuilder } from '@/lib/brain/useBrainBuilder';

const builder = { selectPrefab: vi.fn(), selectedPrefabId: null } as unknown as UseBrainBuilder;

function renderPanel() {
  render(<BuilderInventory open builder={builder} onClose={() => {}} />);
  fireEvent.click(screen.getByTestId('inventory-section-gathered'));
}

describe('BuilderInventory offline goods', () => {
  beforeEach(() => {
    _resetHarvestedForTest();
    _resetPlayModeForTest({ online: true });
    // 3 wood gathered online (C×6), 2 wood and 4 fish gathered offline.
    recordHarvest('C', 6, 'online');
    recordHarvest('C', 4, 'offline');
    recordHarvest('good:fish', 4, 'offline');
  });

  it('marks offline gathers and says they are offline goods in offline play', () => {
    _resetPlayModeForTest({ online: false });
    renderPanel();
    expect(screen.getByTestId('builder-offline-notice').textContent).toMatch(/offline goods/);
    expect(screen.getByTestId('material-total-wood').textContent).toContain('5');
    expect(screen.getByTestId('material-offline-wood').textContent).toBe('2 offline');
    expect(screen.getByTestId('gathered-offline-wood').textContent).toBe('2 offline');
    expect(screen.getByTestId('gathered-offline-fish').textContent).toBe('4 offline');
    expect(screen.queryByTestId('material-offline-stone')).toBeNull();
  });

  it('drops the marks and the offline counts once online', () => {
    _resetPlayModeForTest({ online: false });
    renderPanel();
    act(() => setMeshOnline(true));
    expect(screen.queryByTestId('builder-offline-notice')).toBeNull();
    expect(screen.queryByTestId('material-offline-wood')).toBeNull();
    expect(screen.getByTestId('material-total-wood').textContent).toContain('3');
    expect(screen.getByTestId('builder-offline-held-note')).toBeTruthy();
  });

  it('shows no offline note online when nothing was gathered offline', () => {
    _resetHarvestedForTest();
    recordHarvest('C', 6, 'online');
    renderPanel();
    expect(screen.queryByTestId('builder-offline-notice')).toBeNull();
    expect(screen.queryByTestId('builder-offline-held-note')).toBeNull();
  });
});
