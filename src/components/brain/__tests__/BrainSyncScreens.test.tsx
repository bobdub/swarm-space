import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../BrainVideoGrid', () => ({
  TileVideo: ({ screenOf }: { screenOf?: string }) => <div data-testid={`video-${screenOf}`} />,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));

import { BrainSyncScreens } from '../BrainSyncScreens';

const share = (peerId: string) => ({ peerId, stream: {} as MediaStream });
const names = { a: 'ana', b: 'bo' };

describe('BrainSyncScreens', () => {
  it('gives every screen share its own window', () => {
    render(<BrainSyncScreens remote={[share('a'), share('b')]} nameByPeerId={names} />);
    expect(screen.getByRole('region', { name: "ana's screen" })).toBeTruthy();
    expect(screen.getByRole('region', { name: "bo's screen" })).toBeTruthy();
  });

  it('docks, restores and closes one window without touching the other', () => {
    render(<BrainSyncScreens remote={[share('a'), share('b')]} nameByPeerId={names} />);
    fireEvent.click(screen.getByRole('button', { name: "Dock ana's screen to the bottom" }));
    expect(screen.queryByRole('region', { name: "ana's screen" })).toBeNull();
    expect(screen.getByTestId('video-b')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Show ana's screen" }));
    expect(screen.getByTestId('video-a')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Close bo's screen" }));
    expect(screen.queryByTestId('video-b')).toBeNull();
    expect(screen.getByTestId('video-a')).toBeTruthy();
  });

  it('expands one share to full size and shrinks it back', () => {
    render(<BrainSyncScreens remote={[share('a'), share('b')]} nameByPeerId={names} />);
    fireEvent.click(screen.getByRole('button', { name: "Watch bo's screen full size" }));
    expect(screen.getByRole('button', { name: "Shrink bo's screen" })).toBeTruthy();
    expect(screen.getByTestId('video-a')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Shrink bo's screen" }));
    expect(screen.getByRole('button', { name: "Watch bo's screen full size" })).toBeTruthy();
  });
});
