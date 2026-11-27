import { afterEach, describe, expect, it } from 'vitest';
import {
  isNetworkChatDocked,
  isNetworkChatOpen,
  requestOpenNetworkChat,
  setNetworkChatDocked,
  setNetworkChatOpen,
} from '../networkChatStore';

describe('network chat dock', () => {
  afterEach(() => setNetworkChatOpen(false));

  it('docks to the bottom while staying open', () => {
    requestOpenNetworkChat();
    setNetworkChatDocked(true);
    expect(isNetworkChatOpen()).toBe(true);
    expect(isNetworkChatDocked()).toBe(true);
  });

  it('pops a docked chat back up when Chat is picked from the menu', () => {
    requestOpenNetworkChat();
    setNetworkChatDocked(true);
    requestOpenNetworkChat();
    expect(isNetworkChatDocked()).toBe(false);
  });

  it('forgets the dock when the chat is closed', () => {
    requestOpenNetworkChat();
    setNetworkChatDocked(true);
    setNetworkChatOpen(false);
    expect(isNetworkChatDocked()).toBe(false);
    setNetworkChatOpen(true);
    expect(isNetworkChatDocked()).toBe(false);
  });
});
