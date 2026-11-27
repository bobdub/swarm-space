import { describe, expect, it } from 'vitest';
import { blocksLook, NO_LOOK } from '../lookGuard';

describe('blocksLook', () => {
  it('lets a press on the open scene turn the camera', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    expect(blocksLook(canvas)).toBe(false);
    expect(blocksLook(null)).toBe(false);
  });

  it('keeps a drag that starts anywhere inside a floating window off the camera', () => {
    const win = document.createElement('div');
    win.setAttribute('data-no-look', NO_LOOK['data-no-look']);
    const inner = document.createElement('canvas');
    win.appendChild(inner);
    document.body.appendChild(win);
    expect(blocksLook(win)).toBe(true);
    expect(blocksLook(inner)).toBe(true);
  });

  it('still ignores presses on controls', () => {
    const btn = document.createElement('button');
    const icon = document.createElement('span');
    btn.appendChild(icon);
    expect(blocksLook(icon)).toBe(true);
  });
});
