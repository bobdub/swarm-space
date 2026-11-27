import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

let activeMic = 'mic-a';
const switchMicrophone = vi.fn(async (id: string) => { activeMic = id; return null; });

const auth = { user: { id: 'u1', username: 'me' } };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/webrtc/manager', () => ({
  getWebRTCManager: () => ({
    getActiveCameraId: () => null,
    getActiveMicrophoneId: () => activeMic,
    switchCamera: vi.fn(),
    switchMicrophone,
  }),
}));

import { BuilderDeviceOptions } from '@/components/brain/builder/BuilderDeviceOptions';

function mockDevices(list: Array<Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => list,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}

describe('BuilderDeviceOptions (builder Options + chat Settings)', () => {
  beforeEach(() => {
    activeMic = 'mic-a';
    switchMicrophone.mockClear();
  });

  it('keeps two mounted copies in sync after a switch', async () => {
    mockDevices([
      { deviceId: 'mic-a', kind: 'audioinput', label: 'Mic A' },
      { deviceId: 'mic-b', kind: 'audioinput', label: 'Mic B' },
    ]);
    render(
      <>
        <BuilderDeviceOptions />
        <BuilderDeviceOptions testId="chat-device-options" />
      </>,
    );
    const builder = await screen.findByTestId('builder-device-options');
    const chat = await screen.findByTestId('chat-device-options');
    expect(within(chat).getByText('Mic A').closest('button')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(builder).getByText('Mic B'));
    await waitFor(() => expect(switchMicrophone).toHaveBeenCalledWith('mic-b'));
    await waitFor(() =>
      expect(within(chat).getByText('Mic B').closest('button')).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('shows the hint when no inputs can be listed', async () => {
    mockDevices([]);
    render(<BuilderDeviceOptions testId="chat-device-options" emptyHint="No microphone found" />);
    expect(await screen.findByText('No microphone found')).toBeInTheDocument();
  });
});
