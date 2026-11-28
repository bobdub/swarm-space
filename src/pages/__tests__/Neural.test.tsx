import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Neural from '../Neural';
import { neuralChecks } from '@/lib/p2p/neuralChecks';
import { getSynapseMapStats, type SynapseMapStats } from '@/lib/p2p/synapseExchanger';
import { getResistanceWeights } from '@/lib/p2p/synapticDispatch';

const baseStats = (over: Partial<SynapseMapStats> = {}): SynapseMapStats => ({
  ...getSynapseMapStats(),
  ...over,
});
const w = (over: Partial<ReturnType<typeof getResistanceWeights>> = {}) => ({ ...getResistanceWeights(), ...over });

afterEach(cleanup);

describe('neuralChecks', () => {
  it('waits, and does not fail, on a fresh tab with the exchanger running', () => {
    const checks = neuralChecks(baseStats({ running: true }), w());
    expect(checks.find((c) => c.label === 'Exchanger running')?.state).toBe('pass');
    expect(checks.filter((c) => c.state === 'fail')).toHaveLength(0);
  });

  it('passes every check on a healthy, learning node', () => {
    const checks = neuralChecks(
      baseStats({ running: true, published: 3, lastPublishedAt: Date.now(), received: 5, nodes: 2, refused: 1, assists: 2 }),
      w({ samples: 4 }),
    );
    expect(checks.every((c) => c.state === 'pass')).toBe(true);
  });

  it('flags a stopped exchanger, mostly refused records and broken weights', () => {
    const checks = neuralChecks(
      baseStats({ running: false, received: 1, refused: 9 }),
      w({ latency: 0.9, failure: 0.9, load: 0.01 }),
    );
    const failed = checks.filter((c) => c.state === 'fail').map((c) => c.label);
    expect(failed).toEqual(['Exchanger running', 'Bad records are refused', 'Source weights are learning']);
  });

  it('treats shy and unsigned as waiting, not failing', () => {
    const shy = neuralChecks(baseStats({ running: true, shy: true }), w());
    const unsigned = neuralChecks(baseStats({ running: true, unsigned: true }), w());
    expect(shy.find((c) => c.label === 'Our record is shared')?.state).toBe('wait');
    expect(unsigned.find((c) => c.label === 'Our record is shared')?.detail).toMatch(/signing key/);
  });
});

describe('Neural page', () => {
  it('renders checks, the map and the weights without sending anything', () => {
    render(<MemoryRouter><Neural /></MemoryRouter>);
    expect(screen.getByTestId('neural-page')).toBeTruthy();
    expect(screen.getByText('Checks')).toBeTruthy();
    expect(screen.getByText('Synapse map')).toBeTruthy();
    expect(screen.getByText('Source weights')).toBeTruthy();
    expect(screen.getByTestId('neural-status').textContent).toBe('Off');
    expect(screen.getByText(/starting weights read 0\.374/)).toBeTruthy();
  });
});
