import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BarLightSwitchButton } from '@/components/brain/BarLightSwitchButton';
import { setBarLightsOn, getBarLightsOn } from '@/lib/brain/barLightsStore';

describe('BarLightSwitchButton', () => {
  beforeEach(() => setBarLightsOn(true));

  it('renders initial ON state', () => {
    render(<BarLightSwitchButton />);
    expect(screen.getByTestId('bar-light-switch')).toHaveTextContent('ON');
  });

  it('toggles the store on click', () => {
    render(<BarLightSwitchButton />);
    const btn = screen.getByTestId('bar-light-switch');
    expect(getBarLightsOn()).toBe(true);
    fireEvent.click(btn);
    expect(getBarLightsOn()).toBe(false);
    expect(btn).toHaveTextContent('OFF');
    fireEvent.click(btn);
    expect(getBarLightsOn()).toBe(true);
    expect(btn).toHaveTextContent('ON');
  });
});