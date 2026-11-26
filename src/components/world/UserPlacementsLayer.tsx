/**
 * UserPlacementsLayer — renders prefabs placed by users via AssetCaster.
 * Subscribes to `worldPlacementsStore` and wraps each record with
 * `BuilderBlockView` so the engine's tick-derived world transform drives
 * a simple box mesh sized + coloured from the prefab catalog.
 */
import { useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import {
  listPlacements,
  subscribePlacements,
  removeLocalPlacement,
  touchLocalPlacement,
  isPlacementSuppressed,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';
import { useBuilderRenderMode } from '@/lib/brain/builderRenderModeStore';
import { useUnsupportedPosts } from '@/lib/content/unsupportedPostsStore';
import { idleDays, isMainBrainScope, MAIN_BRAIN_IDLE_MS } from '@/lib/world/placementActivity';
import { getPrefab, FIRE_PIT_ID, TRADING_STAND_ID } from '@/lib/brain/prefabHouseCatalog';
import { TradingStandView } from '@/components/world/TradingStandView';
import { FirePitView, FirePitControls } from '@/components/world/FirePitView';
import {
  getHeldTool,
  setHeldTool,
  subscribeHeldTool,
  type HeldTool,
} from '@/lib/world/heldToolStore';
import { getToolTarget, setToolTarget, subscribeToolTarget } from '@/lib/world/toolTargetStore';
import { toolTargetFromPlacement, type ToolTarget } from '@/lib/world/toolTargets';
import { WallPostBillboard } from '@/components/world/WallPostBillboard';
import { ownsPlacement } from '@/lib/world/buildOwnership';
import { WallViewerControls } from '@/components/world/WallViewerControls';
import { listWallInteractions, recordWallView, subscribeWallInteractions } from '@/lib/world/wallInteractionsStore';
import { canViewerInteract, goldLustre, VIEWER_REACH_M } from '@/lib/world/wallInteractionRules';
import { isPeerMuted, useMutedPeers } from '@/lib/brain/mutedPeersStore';

interface UserPlacementsLayerProps {
  selfId: string;
  selectedPlacementId: string | null;
  onSelectPlacement: (placementId: string | null) => void;
  onEditPlacement: (record: PlacementRecord) => void;
  onDeletePlacement: (record: PlacementRecord) => void;
  /** Walls only — opens the in-world post composer. */
  onDecoratePlacement?: (record: PlacementRecord) => void;
  /** When true, suppress the selection action chip (used while the
   *  decorate composer is open so the popover doesn't sit behind it). */
  suppressActionChip?: boolean;
}

export function UserPlacementsLayer({
  selfId,
  selectedPlacementId,
  onSelectPlacement,
  onEditPlacement,
  onDeletePlacement,
  onDecoratePlacement,
  suppressActionChip = false,
}: UserPlacementsLayerProps) {
  const [records, setRecords] = useState<PlacementRecord[]>(() => listPlacements());
  useEffect(() => subscribePlacements(setRecords), []);
  // Muted (or blocked) peers' building items are hidden on this device.
  const mutedPeers = useMutedPeers();
  const [held, setHeld] = useState<HeldTool | null>(() => getHeldTool());
  useEffect(() => subscribeHeldTool(setHeld), []);
  const [toolTarget, setSelectedToolTarget] = useState<ToolTarget | null>(() => getToolTarget());
  useEffect(() => subscribeToolTarget(setSelectedToolTarget), []);
  const [, setInteractionTick] = useState(0);
  useEffect(() => subscribeWallInteractions(() => setInteractionTick((n) => n + 1)), []);
  const [viewerTarget, setViewerTarget] = useState<string | null>(null);
  // Fire pit a visitor tapped: shows its Light / Add wood chip.
  const [fireTarget, setFireTarget] = useState<string | null>(null);
  // Light builder mode bypasses every placement; Stop Support removes walls
  // pinning that post. Both re-render this layer when they change.
  const renderMode = useBuilderRenderMode();
  useUnsupportedPosts();
  useEffect(() => {
    if (!selectedPlacementId) return;
    if (!records.some((rec) => rec.placementId === selectedPlacementId)) onSelectPlacement(null);
  }, [records, selectedPlacementId, onSelectPlacement]);
  useEffect(() => {
    if (!toolTarget || toolTarget.kind !== 'placement') return;
    if (!records.some((rec) => rec.placementId === toolTarget.id)) setToolTarget(null);
  }, [records, toolTarget]);

  // Light mode: no placement meshes, colliders or <Html> layers at all.
  if (renderMode === 'light') return null;

  return (
    <>
      {records.map((rec) => {
        const prefab = getPrefab(rec.prefabId);
        if (!prefab) return null;
        if (isPeerMuted(rec.actorId)) return null;
        // Stop Support: a wall pinning an unsupported post is not drawn —
        // no box, no collider, no billboard — so the room opens up.
        if (isPlacementSuppressed(rec)) return null;
        const bodyId = `${prefab.id}:${rec.placementId}`;
        const owned = ownsPlacement(rec, selfId);
        const isFirePit = prefab.id === FIRE_PIT_ID;
        const isStand = prefab.id === TRADING_STAND_ID;
        // The fire pit and the Trading Stand live in the Tools tab but are built, not carried.
        const isHoldable =
          !isFirePit && !isStand && (prefab.sectionId === 'tools' || prefab.sectionId === 'consumables');
        const isWall = prefab.sectionId === 'walls';
        const decorationPostId = rec.decoration?.postId ?? null;
        const visitor = isWall && canViewerInteract(rec, selfId);
        const interactions = isWall ? listWallInteractions(rec.placementId, rec.actorId) : [];
        const reinforceCount = interactions.filter((i) => i.kind === 'reinforce').length;
        const gold = goldLustre(reinforceCount);
        const stamps = interactions.filter((i) => i.kind === 'graffiti');
        const myStamps = stamps.filter((i) => i.actorId === selfId).length;
        const stampCounts = new Map<string, number>();
        stamps.forEach((i) => stampCounts.set(i.emoji!, (stampCounts.get(i.emoji!) ?? 0) + 1));
        const viewing = visitor && viewerTarget === rec.placementId;
        const editing = selectedPlacementId === rec.placementId && !held && suppressActionChip;
        return (
          <BuilderBlockView key={bodyId} bodyId={bodyId}>
            {() => {
               const selected = owned && rec.placementId === selectedPlacementId;
              const targeted = toolTarget?.kind === 'placement' && toolTarget.id === rec.placementId;
              const tapWidth = Math.max(prefab.width + 0.42, 0.72);
              const tapHeight = Math.max(prefab.height + 0.42, 1.1);
              const tapDepth = Math.max(prefab.depth + 0.42, 0.72);
              return (
                <group>
                  {isFirePit ? (
                    <FirePitView
                      pitId={rec.placementId}
                      width={prefab.width}
                      height={prefab.height}
                      highlight={selected || targeted}
                    />
                  ) : isStand ? (
                    <TradingStandView
                      width={prefab.width}
                      depth={prefab.depth}
                      height={prefab.height}
                      highlight={selected || targeted}
                    />
                  ) : (
                  <mesh
                    position={[0, prefab.height / 2, 0]}
                    castShadow
                    receiveShadow
                  >
                    <boxGeometry args={[prefab.width, prefab.height, prefab.depth]} />
                    <meshStandardMaterial
                      color={reinforceCount > 0 ? goldTint(prefab.color, gold.t) : prefab.color}
                      roughness={reinforceCount > 0 ? gold.roughness : 0.7}
                      metalness={reinforceCount > 0 ? gold.metalness : 0.05}
                      emissive={selected || targeted ? prefab.color : reinforceCount > 0 ? '#b45309' : '#000000'}
                      emissiveIntensity={selected ? 0.28 : targeted ? 0.2 : gold.emissiveIntensity}
                      side={2}
                    />
                  </mesh>
                  )}
                  {isWall && decorationPostId && (
                    <WallPostBillboard
                      postId={decorationPostId}
                      placementId={rec.placementId}
                      width={prefab.width}
                      height={prefab.height}
                      depth={prefab.depth}
                    />
                  )}
                   {owned && !editing && (
                    <mesh
                      position={[0, prefab.height / 2, 0]}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (held) {
                            setToolTarget(
                              targeted ? null : toolTargetFromPlacement(rec, prefab.label),
                            );
                          return;
                        }
                          setToolTarget(null);
                        onSelectPlacement(selected ? null : rec.placementId);
                      }}
                    >
                      <boxGeometry args={[tapWidth, tapHeight, tapDepth]} />
                      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={2} />
                    </mesh>
                  )}
                  {visitor && (
                    <mesh
                      position={[0, prefab.height / 2, 0]}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.distance > VIEWER_REACH_M) return;
                        if (!viewing) recordWallView(rec.placementId, selfId);
                        setViewerTarget(viewing ? null : rec.placementId);
                      }}
                    >
                      <boxGeometry args={[tapWidth, tapHeight, tapDepth]} />
                      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={2} />
                    </mesh>
                  )}
                  {isFirePit && !owned && (
                    <mesh
                      position={[0, prefab.height / 2, 0]}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (held) return;
                        if (e.distance > VIEWER_REACH_M) return;
                        setFireTarget(fireTarget === rec.placementId ? null : rec.placementId);
                      }}
                    >
                      <boxGeometry args={[tapWidth, tapHeight, tapDepth]} />
                      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={2} />
                    </mesh>
                  )}
                  {isFirePit && !owned && fireTarget === rec.placementId && !held && (
                    <Html position={[0, prefab.height + 1.1, 0]} center distanceFactor={8} occlude zIndexRange={[100, 0]}
                      style={{ pointerEvents: 'auto', userSelect: 'none' }}>
                      <FirePitControls pitId={rec.placementId} selfId={selfId} onClose={() => setFireTarget(null)} />
                    </Html>
                  )}
                  {stampCounts.size > 0 && (
                    <Html position={[0, 0.35, prefab.depth / 2 + 0.05]} center distanceFactor={8} occlude zIndexRange={[50, 0]}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      <div style={{ display: 'flex', gap: 4, padding: '2px 6px', borderRadius: 999,
                        background: 'hsla(265,70%,8%,0.7)', fontSize: 13, color: 'white', whiteSpace: 'nowrap' }}>
                        {[...stampCounts].map(([e, n]) => <span key={e}>{e}{n > 1 ? <sup style={{ fontSize: 9 }}>{n}</sup> : null}</span>)}
                      </div>
                    </Html>
                  )}
                  {viewing && (
                    <Html position={[0, prefab.height + 0.7, 0]} center distanceFactor={8} occlude zIndexRange={[100, 0]}
                      style={{ pointerEvents: 'auto', userSelect: 'none' }}>
                      <WallViewerControls
                        placementId={rec.placementId}
                        ownerId={rec.actorId}
                        selfId={selfId}
                        postId={decorationPostId}
                        priorStamps={myStamps}
                        onClose={() => setViewerTarget(null)}
                      />
                    </Html>
                  )}
                  {selected && !held && !suppressActionChip && (
                    <>
                      <mesh position={[0, prefab.height / 2, 0]}>
                        <boxGeometry args={[prefab.width + 0.08, prefab.height + 0.08, prefab.depth + 0.08]} />
                        <meshBasicMaterial color={prefab.color} wireframe transparent opacity={0.7} depthWrite={false} />
                      </mesh>
                      <Html
                        position={[0, prefab.height + 0.7, 0]}
                        center
                        distanceFactor={8}
                        occlude
                        zIndexRange={[100, 0]}
                        style={{ pointerEvents: 'auto', userSelect: 'none' }}
                      >
                        <div
                          onPointerDown={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            gap: 6,
                            padding: '6px 8px',
                            borderRadius: 999,
                            background: 'hsla(265,70%,8%,0.92)',
                            border: '2px solid hsla(265,80%,65%,0.7)',
                            boxShadow: '0 0 16px hsla(265,80%,65%,0.45)',
                            fontFamily: 'system-ui, sans-serif',
                            fontSize: 12,
                            color: 'white',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isHoldable && (
                            <button
                              type="button"
                              onClick={() => {
                                setHeldTool({ prefabId: rec.prefabId, source: rec });
                                setToolTarget(null);
                                void removeLocalPlacement(rec.placementId);
                                onSelectPlacement(null);
                              }}
                              style={{ ...btnStyle, color: '#86efac' }}
                            >
                              Pick up
                            </button>
                          )}
                          {isFirePit && (
                            <FirePitControls pitId={rec.placementId} selfId={selfId} compact />
                          )}
                          <button type="button" onClick={() => onEditPlacement(rec)} style={btnStyle}>
                            {isWall ? 'Move' : 'Edit'}
                          </button>
                          {isWall && onDecoratePlacement && (
                            <button
                              type="button"
                              onClick={() => onDecoratePlacement(rec)}
                              style={{ ...btnStyle, color: '#7dd3fc' }}
                            >
                              {decorationPostId ? 'Re-decorate' : 'Decorate'}
                            </button>
                          )}
                          {isMainBrainScope(rec) && (
                            <button
                              type="button"
                              onClick={() => { void touchLocalPlacement(rec.placementId); }}
                              title={`Main Brain items rest after ${Math.round(MAIN_BRAIN_IDLE_MS / 86_400_000)} days without activity. Refresh keeps this one active for everyone.`}
                              style={{ ...btnStyle, color: idleDays(rec) >= 4 ? '#fcd34d' : '#a7f3d0' }}
                            >
                              Refresh{idleDays(rec) > 0 ? ` · ${idleDays(rec)}d` : ''}
                            </button>
                          )}
                          <button type="button" onClick={() => onDeletePlacement(rec)} style={{ ...btnStyle, color: '#fda4af' }}>Delete</button>
                        </div>
                      </Html>
                    </>
                  )}
                </group>
              );
            }}
          </BuilderBlockView>
        );
      })}
    </>
  );
}

const btnStyle: React.CSSProperties = {
  appearance: 'none',
  border: 'none',
  background: 'hsla(0,0%,100%,0.08)',
  color: 'white',
  borderRadius: 999,
  padding: '4px 10px',
  fontWeight: 700,
  cursor: 'pointer',
  minWidth: 48,
};
/** Blend a base hex colour toward bullion gold. */
function goldTint(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#f59e0b';
  const n = parseInt(m[1], 16);
  const g = [0xf5, 0x9e, 0x0b];
  const k = 0.25 + 0.75 * t;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (g[i] - v) * k));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
