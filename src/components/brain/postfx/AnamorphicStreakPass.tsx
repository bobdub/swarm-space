import { forwardRef, useMemo } from 'react';
import { AnamorphicStreakEffect } from './AnamorphicStreak';

export interface AnamorphicStreakProps {
  strength?: number;
  length?: number;
  threshold?: number;
}

// Wrap the postprocessing Effect so <EffectComposer> children can mount it.
export const AnamorphicStreak = forwardRef<AnamorphicStreakEffect, AnamorphicStreakProps>(
  function AnamorphicStreak({ strength = 0.7, length = 0.35, threshold = 0.9 }, ref) {
    const effect = useMemo(
      () => new AnamorphicStreakEffect({ strength, length, threshold }),
      [strength, length, threshold],
    );
    return <primitive ref={ref} object={effect} dispose={null} />;
  },
);