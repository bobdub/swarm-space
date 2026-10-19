import { describe, expect, it } from 'vitest';
import { InfinityRoomConsent } from '../infinityRoomConsent';

const reply = { id: 'infinity:question', infinityReplyTo: 'question', text: 'One shared response' };
describe('Shared Infinity room replies', () => {
  it.each(['audio', 'text'] as const)('delivers the same reply once in %s mode', (mode) => {
    const room = new InfinityRoomConsent<typeof reply>();
    expect(room.receive(reply, mode)).toEqual({ visible: [reply], ask: false });
    expect(room.receive({ ...reply, id: 'duplicate' }, mode).visible).toEqual([]);
  });
  it('asks an off user once, then reveals buffered replies on accept', () => {
    const room = new InfinityRoomConsent<typeof reply>();
    expect(room.receive(reply, 'off')).toEqual({ visible: [], ask: true });
    const second = { ...reply, id: 'second', infinityReplyTo: 'second-question' };
    expect(room.receive(second, 'off').ask).toBe(false);
    expect(room.choose(true)).toEqual([reply, second]);
    expect(room.receive({ ...reply, id: 'third', infinityReplyTo: 'third-question' }, 'off').visible).toHaveLength(1);
  });
  it('honors decline for the room, without disabling a later explicit mode', () => {
    const room = new InfinityRoomConsent<typeof reply>();
    room.receive(reply, 'off');
    expect(room.choose(false)).toEqual([]);
    expect(room.receive({ ...reply, infinityReplyTo: 'second' }, 'off')).toEqual({ visible: [], ask: false });
    expect(room.receive({ ...reply, infinityReplyTo: 'third' }, 'text').visible).toHaveLength(1);
    expect(new InfinityRoomConsent<typeof reply>().receive(reply, 'off').ask).toBe(true);
  });
});