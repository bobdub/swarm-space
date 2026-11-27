import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopyMessageButton } from '../CopyMessageButton';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Chat message copy button', () => {
  it('copies the raw Markdown text and confirms', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const raw = '**Plan**\n- step one\n`npm run build`';
    render(<CopyMessageButton text={raw} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(raw));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('falls back to execCommand when the Clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    render(<CopyMessageButton text="hello peers" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});
