export type SignalingControlAction = 'pause-all' | 'pause-inbound' | 'pause-outbound';

export interface SignalingActionMetadata {
  title: string;
  description: string;
  impact: string;
  resumeHint: string;
  defaultDuration?: number | null;
}

export const SIGNALING_ACTIONS: Record<SignalingControlAction, SignalingActionMetadata> = {
  'pause-all': {
    title: 'Pause all signaling and traffic',
    description:
      'Incoming handshakes and outbound dials will be rejected until you resume networking. Existing peers remain connected but new connections will fail.',
    impact:
      'Use this when you need a full network quarantine. Background diagnostics and mesh maintenance will halt until signaling resumes.',
    resumeHint: 'Auto-resume ensures you do not forget to re-open the node after an emergency stop.',
    defaultDuration: 5 * 60 * 1000,
  },
  'pause-inbound': {
    title: 'Pause inbound handshakes',
    description:
      'Inbound peers will be rejected while outbound dialing remains available. Existing peers stay connected.',
    impact:
      'Choose this when you need to stop new peers from attaching while keeping current sessions online.',
    resumeHint: 'Inbound pauses are easy to forget; consider selecting an automatic resume window.',
    defaultDuration: 3 * 60 * 1000,
  },
  'pause-outbound': {
    title: 'Pause outbound dialing',
    description:
      'Your node will stop initiating new peer connections but will continue accepting inbound sessions.',
    impact:
      'This is useful when investigating outbound flooding or when you want to freeze reconnection storms.',
    resumeHint: 'Auto-resume helps restore proactive dialing once mitigation checks are complete.',
    defaultDuration: 2 * 60 * 1000,
  },
};
