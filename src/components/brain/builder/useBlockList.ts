import { useEffect, useMemo, useRef, useState } from 'react';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';

function sameMembers(a: BuilderBlock[], b: BuilderBlock[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].bodyId !== b[i].bodyId) return false;
  return true;
}

/**
 * The engine's blocks that pass `filter`, re-rendering the caller only when
 * that set of blocks changes.
 *
 * The engine emits an event for every place, remove and upgrade, and NPCs
 * upgrade their body blocks on every tick (8 Hz each), with more events
 * arriving from peers while connected. A layer that re-rendered on every
 * event re-ran every child's render each time. Per-block changes (position,
 * kind, meta) are already handled by each `BuilderBlockView`, so a list
 * layer only needs to know when its membership changes.
 *
 * `filter` is read through a ref, so callers may pass an inline function.
 */
export function useBlockList(filter: (block: BuilderBlock) => boolean): BuilderBlock[] {
  const engine = useMemo(() => getBuilderBlockEngine(), []);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const [blocks, setBlocks] = useState(() => engine.listBlocks(filter));
  const listedRef = useRef(new Set(blocks.map((b) => b.bodyId)));

  useEffect(() => {
    const refresh = () => {
      const next = engine.listBlocks(filterRef.current);
      listedRef.current = new Set(next.map((b) => b.bodyId));
      setBlocks((prev) => (sameMembers(prev, next) ? prev : next));
    };
    refresh();
    return engine.subscribe((evt) => {
      // An upgrade only changes membership when it flips the filter result.
      if (evt.type === 'upgrade' && filterRef.current(evt.block) === listedRef.current.has(evt.block.bodyId)) return;
      refresh();
    });
  }, [engine]);

  return blocks;
}
