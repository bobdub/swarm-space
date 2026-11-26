import { RenderGovernorProbe, useAdaptiveDpr } from './useGovernedFrame';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ArrowLeft, MessageSquare, Compass } from 'lucide-react';
import { Mic, MicOff, Volume2, VolumeX, Video, VideoOff, MonitorUp, MonitorOff } from 'lucide-react';
import { Zap, Eye, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useGamepadIntent } from '@/hooks/useGamepadIntent';
import { CompassHUD } from '@/components/brain/CompassHUD';
import { headingFromCamera, setViewHeading } from '@/lib/brain/navigation';
import { MiniMapHUD } from '@/components/brain/MiniMapHUD';
import { BuilderActivator } from '@/components/brain/builder/BuilderActivator';
import { BuilderInventory } from '@/components/brain/builder/BuilderInventory';
import { PendingBuildsLayer } from '@/components/brain/builder/PendingBuildsLayer';
import { WorldDropsLayer } from '@/components/brain/world/WorldDropsLayer';
import {
  getCameraView,
  setCameraView,
  toggleShoulderView,
  subscribeCameraView,
  THIRD_PERSON_BACK_M,
  THIRD_PERSON_UP_M,
  type CameraView,
} from '@/lib/brain/cameraViewStore';
import { stagePendingBuild } from '@/lib/world/pendingBuildsStore';
import { BRAIN_PHYSICS_VERSION } from '@/lib/brain/brainPersistence';
import { BrainBuilderBar, equipCatalogTool } from '@/components/brain/builder/BrainBuilderBar';
import { isStoneHandTool } from '@/lib/brain/toolCatalog';
import { BuildGridOverlay } from '@/components/world/BuildGridOverlay';
import { PlotSurveyOverlay } from '@/components/world/PlotSurveyOverlay';
import { LandPlotsOverlay } from '@/components/world/LandPlotsOverlay';
import { useBrainBuilder, type PendingPlot } from '@/lib/brain/useBrainBuilder';
import { claimLandPlot, ownedFootprintSpanM, subscribeLandPlots } from '@/lib/world/landPlots';
import { WORLD_GRID_ORIGIN_ANCHOR } from '@/lib/world/buildGrid';
import { getSwarmBalance, burnSwarm } from '@/lib/blockchain/token';
import { getWebRTCManager, SCREEN_CAPTURE_CONSTRAINTS } from '@/lib/webrtc/manager';
import { sameParticipants } from '@/lib/webrtc/participantsEqual';
import { useAuth } from '@/hooks/useAuth';
import { BrainVideoGrid } from '@/components/brain/BrainVideoGrid';
import {
  getBrainPhysics,
  FIELD_HZ,
  WORLD_SIZE,
  type RescueReason,
} from '@/lib/brain/uqrcPhysics';
import { C_LIGHT } from '@/lib/brain/lightspeed';
import {
  loadPieces,
  savePieces,
  loadPortals,
  savePortals,
  loadBrainField,
  saveBrainField,
  type BrainPiece,
  type BrainPortal,
} from '@/lib/brain/brainPersistence';
import { InfinityBody } from '@/components/brain/InfinityBody';
import { BrainStatusReadout } from '@/components/brain/BrainStatusReadout';
import { needsBoomClearance } from '@/lib/brain/cameraClearance';
import { PortalDefect } from '@/components/brain/PortalDefect';
import { StarField } from '@/components/brain/StarField';
import { Constellations } from '@/components/brain/Constellations';
import { GalaxyVisual } from '@/components/brain/GalaxyVisual';
import { EarthBody } from '@/components/brain/EarthBody';
import { AtmosphereSky } from '@/components/brain/AtmosphereSky';
import { SunLight } from '@/components/brain/SunLight';
import { SurfaceTree } from '@/components/brain/SurfaceTree';
import { DockLayer } from '@/components/brain/sea/DockLayer';
import { SeaLifeLayer } from '@/components/brain/sea/SeaLifeLayer';
import { ChickenLayer } from '@/components/brain/land/ChickenLayer';
import { BoatHoldButton, JumpButton } from '@/components/brain/sea/BoatControls';
import { TradingStandPrompt } from '@/components/brain/TradingStandModal';
import { CrewJoystickSkin, ShipControls, useCrewRole } from '@/components/brain/sea/ShipWheel';
import { getCrewRole } from '@/lib/brain/sea/crew';
import { decodeBoatPresence, deckPointOn, getFleet } from '@/lib/brain/sea/fleet';
import { getLocalMeshPeerId } from '@/lib/streaming/webrtcSignalingBridge.standalone';
import { moveInput } from '@/lib/brain/moveInput';
import { SurfaceBar } from '@/components/brain/SurfaceBar';
import { PubGameLayer } from '@/components/pub/PubGameLayer';
import { PubDrinkProps } from '@/components/pub/PubDrinkProps';
import { NatureLayer } from '@/components/brain/nature/NatureLayer';
import { AssetCaster } from '@/components/world/AssetCaster';
import { UserPlacementsLayer } from '@/components/world/UserPlacementsLayer';
import { HeldToolHUD } from '@/components/world/HeldToolHUD';
import { WorldToolTargetsLayer } from '@/components/world/WorldToolTargetsLayer';
import { ToolSwingFX } from '@/components/world/ToolSwingFX';
import { CarvedCellsLayer } from '@/components/world/CarvedCellsLayer';
import { HeldToolMesh } from '@/components/world/HeldToolMesh';
import { BoundaryMarkerLayer } from '@/components/world/BoundaryMarkerLayer';
import { installLandClaimRules, migrateLegacyPlots, reconcileDeeds } from '@/lib/world/boundaryMarker';
import { subscribeLandClaims } from '@/lib/world/landClaimsStore';
import { WeatherLayer } from '@/components/world/WeatherLayer';
import {
  setPendingCast,
  clearPendingCast,
  confirmCast,
  rotateCast,
  getPendingCast,
  subscribeCast,
  type PendingCast,
} from '@/lib/world/assetCaster';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { canBuildAtWorldPoint } from '@/lib/world/landPermissions';
import { ownsPlacement } from '@/lib/world/buildOwnership';
import { isDev } from '@/lib/world/devRoles';
import {
  removeLocalPlacement,
  updateLocalPlacement,
  hydrateWorldPlacements,
  setActiveUniverse,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';
import { NpcSwarmLayer } from '@/components/brain/npc/NpcSwarmLayer';
import { BrainChatPanel, type BrainChatLine } from '@/components/brain/BrainChatPanel';
import { useBrainAppUpdate } from './useBrainAppUpdate';
import { DropPortalModal } from '@/components/brain/DropPortalModal';
import { WallDecorateComposer } from '@/components/world/WallDecorateComposer';
import { getCurrentUser } from '@/lib/auth';
import {
  ENTITY_DISPLAY_NAME,
  ENTITY_USER_ID,
  getEntityVoice,
} from '@/lib/p2p/entityVoice';
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';
import {
  recordTurn,
  getPrevTurn,
  attractToPrev,
} from '@/lib/uqrc/conversationAttraction';
import { canInfinityReply, canInfinitySpeak, resolveInfinityChatMode, resolveGuestInfinityChatMode, shouldOfferGuestConnection, type InfinityChatMode } from '@/lib/brain/infinityChatSettings';
import { useP2PContext } from '@/contexts/P2PContext';
import { InfinityRoomConsent } from '@/lib/brain/infinityRoomConsent';
import { applyGalaxyToField, getGalaxy } from '@/lib/brain/galaxy';
import { applyRoundCurvature } from '@/lib/brain/roundUniverse';
import { updateEarthCorePin } from '@/lib/brain/earthCore';
import { initLavaMantle } from '@/lib/brain/lavaMantle';
import { applyElementsToField, getElements, countByShell } from '@/lib/brain/elements';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { ElementsVisual } from '@/components/brain/ElementsVisual';
import {
  spawnOnEarth,
  EARTH_POSITION,
  EARTH_RADIUS,
  HUMAN_HEIGHT,
  BODY_CENTER_HEIGHT,
  radiusFromEarth,
  getEarthPose,
  beginEarthFrame,

  updateEarthPin,
  getAvatarMass,
  getSurfaceFrame,
  EYE_LIFT,
  getEarthSpawnTransform,
  BODY_SHELL_RADIUS,
  STRUCTURE_SHELL_RADIUS,
  projectToStructureShell,
  anchorOnEarth,
  VISIBLE_GROUND_RADIUS,
  FEET_SHELL_RADIUS,
} from '@/lib/brain/earth';
import { getLiveSiteFrame } from '@/lib/brain/earth';
import { quatRotate } from '@/lib/brain/earth';
import { worldPosToLocalNormal } from '@/lib/brain/earth';
import { feetRadiusAt, supportElevationAt } from '@/lib/brain/groundHeight';
import { RemoteAvatarBody } from '@/components/brain/RemoteAvatarBody';

// Legacy SurfaceApartment was removed (non-wet-work artifact). The debug
// HUD still reads "floor vs feet"; without an apartment there is no floor
// to compare against, so this stub keeps the HUD compiling and shows 0.
const apartmentTrackerState = { apartmentRadius: 0, feetRadius: 0 };
import {
  loadHubPrefs,
  saveHubPrefs,
  getAvatarMassFromId,
  subscribeAvatarChange,
} from '@/lib/virtualHub/avatars';
import { BrainEntryModal } from '@/components/brain/BrainEntryModal';
import { AvatarShaderWarmup } from '@/components/brain/AvatarShaderWarmup';
import { isGuestUser, brainDisplayName } from '@/lib/preview/guestAccess';
import { useBrainVoice } from '@/hooks/useBrainVoice';
import { encodeSelfPosition, localDistance, resolvePeerWorldPosition } from '@/lib/brain/peerPosition';
import { isBrainEntryComplete, setBrainMic, useBrainMicChoice } from '@/lib/brain/brainMicChoice';
import { useNetworkChatPeers } from '@/hooks/useNetworkChatPeers';
import { isPeerMuted, useMutedPeers } from '@/lib/brain/mutedPeersStore';
import { armChatChirpAudio, chirpForRemoteLine } from '@/lib/brain/chatChirp';
import { isBrainSynced, syncBrainRoom } from '@/lib/brain/brainSyncStore';
import type { BrainVariant } from '@/lib/brain/variants';
import {
  speakInfinity,
  cancelInfinity,
  primeInfinityVoice,
} from '@/lib/brain/infinityVoice';
import { commutatorNorm3D, entropyHessianNorm3D, FIELD3D_LAMBDA } from '@/lib/uqrc/field3D';
import {
  pinInfinityIntoField,
  sampleFieldForInfinity,
  feedFieldIntoNeural,
  getInfinityProjection,
  getInfinityPosition,
  setLastInfinitySnapshot,
  getLastInfinitySnapshot,
} from '@/lib/brain/infinityBinding';
import { getSharedNeuralEngine } from '@/lib/p2p/sharedNeuralEngine';
import { getFeatureFlags } from '@/config/featureFlags';
import { getBuilderTopView, setBuilderTopView, getBuilderLookScale } from '@/lib/brain/builderCameraStore';
import { getSeatPose } from '@/lib/pub/seatStore';
import { seatedTransform } from '@/lib/pub/seatLock';
import { selfLearnable } from '@/lib/brain/agent/learnConsent';
import { enqueueMemory } from '@/lib/brain/infinityMemory';
import { causalNow, networkNow } from '@/lib/time/networkClock';
import {
  isOverheadView,
  SPECTATOR_BACK_M,
  SPECTATOR_UP_M,
} from '@/lib/pub/spectatorCameraStore';

/** Field snapshot cadence — the project's 2.5 min throttled-write rule. */
const BRAIN_FIELD_SAVE_MS = 2.5 * 60 * 1000;

const lookInput = { yaw: 0, pitch: 0 };
/** Run/Flash sprint state — toggled by Shift / on-screen pill. */
const runState = { active: false, until: 0, cooldownUntil: 0 };
const RUN_DURATION_MS = 4000;
const RUN_COOLDOWN_MS = 6000;
// Bolt sprint scales intent by 2.0. Combined with the 3× base walk
// (60 mph in uqrcPhysics.ts), tangential velocity tops out at 6× the
// original 20 mph baseline ≈ 120 mph — well under the 𝒞_light closure
// ceiling. See `walkCap` in uqrcPhysics.ts where the cap widens by the
// same intent magnitude.
const RUN_MULTIPLIER = 2.0;

/** What one presence says about a remote peer's avatar. */
interface RemotePeerPose {
  peerId: string;
  username: string;
  avatarId?: string;
  position?: [number, number, number];
  local?: [number, number, number];
  presenceTs?: number;
  boat?: unknown;
}

/**
 * Place (or create) a remote peer's avatar body from their latest
 * presence. The body is kinematic: the peer's own device solves its
 * physics, so here it only holds the received transform. A presence
 * already applied (same send time) leaves position and boat alone.
 */
function syncRemotePeerBody(
  physics: ReturnType<typeof getBrainPhysics>,
  applied: Map<string, number>,
  p: RemotePeerPose,
  pose: ReturnType<typeof getEarthPose>,
  fleet: ReturnType<typeof getFleet>,
): void {
  const id = `peer-${p.peerId}`;
  const fresh = p.presenceTs === undefined || applied.get(p.peerId) !== p.presenceTs;
  // Accept the peer's broadcast position verbatim: their physics already
  // solved the surface. Earth-local points are turned into world space
  // with OUR Earth pose, so the avatar sits on the same patch of ground
  // it does for them. Peers with no position yet cluster near the shared
  // village so late joiners stay in view.
  const broadcastPos = resolvePeerWorldPosition(p, pose);
  // Boats: this peer's own boat, and where on a deck they stand. A peer
  // on a deck is drawn on that deck spot (deck lock), so they ride a
  // moving boat instead of trailing its 1.5 s-old position.
  let deckPos: [number, number, number] | null = null;
  if (fresh) {
    const boatInfo = decodeBoatPresence(p.boat);
    fleet.applyRemote(p.peerId, boatInfo?.v);
    // One stroke per presence.
    if (boatInfo?.r && p.presenceTs !== undefined) fleet.remoteRow(p.peerId, boatInfo.r, undefined, p.presenceTs);
    const deckBoat = boatInfo?.d ? fleet.resolveDeck(boatInfo.d) : undefined;
    deckPos = deckBoat && boatInfo?.d ? deckPointOn(deckBoat, boatInfo.d.x, boatInfo.d.z) : null;
  }
  const meta = { username: p.username, peerId: p.peerId, avatarId: p.avatarId };
  const existing = physics.getBody(id);
  if (existing) {
    existing.mass = 0;
    existing.kinematic = true;
    existing.vel = [0, 0, 0];
    if (deckPos) existing.pos = deckPos;
    else if (broadcastPos && fresh) existing.pos = broadcastPos;
    const old = existing.meta ?? {};
    if (old.username !== meta.username || old.peerId !== meta.peerId || old.avatarId !== meta.avatarId) {
      existing.meta = { ...old, ...meta };
    }
  } else {
    physics.addBody({
      id, kind: 'avatar',
      pos: deckPos ?? broadcastPos ?? spawnNearSharedVillage(p.peerId, pose, 10, 22),
      vel: [0, 0, 0],
      mass: 0, trust: 0.5,
      kinematic: true,
      meta: { attachedTo: 'earth-surface' as const, ...meta },
    });
  }
  if (p.presenceTs !== undefined) applied.set(p.peerId, p.presenceTs);
}

function tryStartRun(now: number): boolean {
  if (runState.active) return false;
  if (now < runState.cooldownUntil) return false;
  runState.active = true;
  runState.until = now + RUN_DURATION_MS;
  runState.cooldownUntil = now + RUN_DURATION_MS + RUN_COOLDOWN_MS;
  return true;
}
const SHARED_VILLAGE_ANCHOR_ID = 'swarm-shared-village';
/**
 * Spawn near the shared village in the live Earth frame, on the body
 * shell. Uses `anchorOnEarth` so the spawn rotates *with* the planet
 * instead of sliding underneath it as Earth spins.
 */
function spawnNearSharedVillage(
  peerId: string,
  pose = getEarthPose(),
  minRadius = 0,
  maxRadius = 6,
): [number, number, number] {
  let h = 5381 >>> 0;
  for (let i = 0; i < peerId.length; i++) h = (((h << 5) + h) ^ peerId.charCodeAt(i)) >>> 0;
  const angle = (h / 0x100000000) * Math.PI * 2;
  const radius = minRadius + ((h >>> 16) / 0x10000) * (maxRadius - minRadius);
  const tx = Math.cos(angle) * radius;
  const tz = Math.sin(angle) * radius;
  const { worldPos } = anchorOnEarth(SHARED_VILLAGE_ANCHOR_ID, tx, tz, BODY_SHELL_RADIUS, pose);
  // Lift onto the rendered ground (land lift + volcano, exactly as drawn)
  // so the avatar's first frame already stands on the surface physics
  // will hold it to.
  const dx = worldPos[0] - pose.center[0];
  const dy = worldPos[1] - pose.center[1];
  const dz = worldPos[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  const localUnit: [number, number, number] = [dx / r, dy / r, dz / r];
  // Earth-local normal (un-spin) so we sample the noise on the planet
  // frame, matching shader and physics samplers.
  const localN = quatRotate(pose.invSpinQuat, localUnit);
  const lift = supportElevationAt(localN);
  const k = (r + lift) / r;
  return [
    pose.center[0] + dx * k,
    pose.center[1] + dy * k,
    pose.center[2] + dz * k,
  ];
}

/**
 * Reads keyboard / joystick into intent vectors that the physics engine
 * applies to the local body. No direct camera translation — the camera
 * follows the body whose position is integrated from field gradients.
 */
function PhysicsCameraRig({ selfId, fallbackId }: { selfId: string; fallbackId: string }) {
  // Builder "Top view" boom, in metres. The height adapts to the land the
  // player owns so a whole holding fits in frame.
  const TOP_VIEW_UP_MIN_M = 14;
  const TOP_VIEW_UP_MAX_M = 120;
  const TOP_VIEW_BACK_M = 10;
  const topUpRef = useRef(TOP_VIEW_UP_MIN_M);
  useEffect(() => {
    const recompute = () => {
      const span = ownedFootprintSpanM(selfId);
      // Fit the span vertically for a ~60° FOV, plus margin.
      const fit = span > 0 ? span * 0.95 + 8 : 0;
      topUpRef.current = Math.max(
        TOP_VIEW_UP_MIN_M,
        Math.min(TOP_VIEW_UP_MAX_M, fit),
      );
    };
    recompute();
    return subscribeLandPlots(recompute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId]);
  const { camera } = useThree();
  const physics = getBrainPhysics();
  const keys = useRef<Record<string, boolean>>({});
  // Persistent look state — accumulated drag deltas live here, not on the
  // camera, so the next frame doesn't wipe them with lookAt().
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  /** Scratch buffer for the interpolated body position (no per-frame alloc). */
  const renderPos = useRef<[number, number, number]>([0, 0, 0]);

  const prevTopView = useRef(false);
  // Eased 0..1 blend into the overhead boom so entering/leaving Top view
  // glides instead of snapping the whole world.
  const boomBlend = useRef(0);
  // Eased 0..1 blend into the over-the-shoulder boom. Default view in the
  // Brain, so it starts fully engaged rather than swinging out on entry.
  const thirdBlend = useRef(getCameraView() === 'third' ? 1 : 0);
  const pitchTarget = useRef(0);
  // True only while easing toward a fresh mode target (top view, seat,
  // spectator). Once reached, or once the player looks around, the glide
  // releases so a free look up at the sky stays put instead of being
  // dragged back to the horizon every frame.
  const pitchGliding = useRef(false);
  // Seated eye offset, eased so sitting/standing glides.
  const seatLift = useRef(0);
  const prevSeatNonce = useRef(0);
  // Overhead spectator blend (pub QA view): booms the eye up and back
  // without touching the body, so seating and physics are unaffected.
  const specBlend = useRef(0);
  const prevSpec = useRef(false);

  useEffect(() => {
    // Map both physical code and typed key so WASD / arrows work on any
    // keyboard layout, browser, or when e.code is empty.
    const KEY_MAP: Record<string, string> = {
      w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD',
      arrowup: 'KeyW', arrowleft: 'KeyA', arrowdown: 'KeyS', arrowright: 'KeyD',
    };
    const CODE_MAP: Record<string, string> = {
      KeyW: 'KeyW', KeyA: 'KeyA', KeyS: 'KeyS', KeyD: 'KeyD',
      ArrowUp: 'KeyW', ArrowLeft: 'KeyA', ArrowDown: 'KeyS', ArrowRight: 'KeyD',
    };
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    const resolve = (e: KeyboardEvent) =>
      CODE_MAP[e.code] ?? KEY_MAP[(e.key || '').toLowerCase()];
    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = resolve(e);
      if (k) {
        keys.current[k] = true;
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift') {
        if (!e.repeat) tryStartRun(performance.now());
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = resolve(e);
      if (k) keys.current[k] = false;
    };
    const clearAll = () => { keys.current = {}; };
    const onVis = () => { if (document.hidden) clearAll(); };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', clearAll);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', clearAll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useFrame(() => {
    // 1. Drain drag deltas into persistent yaw/pitch state.
    const topView = getBuilderTopView();
    if (topView !== prevTopView.current) {
      prevTopView.current = topView;
      // Ease toward a steep downward tilt on entering top view, level on exit.
      pitchTarget.current = topView ? -1.0 : 0;
      pitchGliding.current = true;
    }
    // Sitting down at pub furniture nudges the view onto the tabletop.
    const seat = getSeatPose();
    if (seat.nonce !== prevSeatNonce.current) {
      prevSeatNonce.current = seat.nonce;
      if (!topView) {
        pitchTarget.current = seat.pitch ?? 0;
        pitchGliding.current = true;
      }
    }
    seatLift.current += (seat.lift - seatLift.current) * 0.12;
    const overhead = isOverheadView();
    if (overhead !== prevSpec.current) {
      prevSpec.current = overhead;
      pitchTarget.current = overhead ? -1.1 : (seat.pitch ?? 0);
      pitchGliding.current = true;
    }
    specBlend.current += ((overhead ? 1 : 0) - specBlend.current) * 0.1;
    if (specBlend.current < 0.001) specBlend.current = 0;
    // Glide pitch toward a freshly set mode target, then hand control
    // back to the player. Any look input cancels the glide immediately.
    if (lookInput.pitch !== 0) pitchGliding.current = false;
    if (pitchGliding.current) {
      if (Math.abs(pitchRef.current - pitchTarget.current) > 0.002) {
        pitchRef.current += (pitchTarget.current - pitchRef.current) * 0.12;
      } else {
        pitchRef.current = pitchTarget.current;
        pitchGliding.current = false;
      }
    }
    boomBlend.current += ((topView ? 1 : 0) - boomBlend.current) * 0.1;
    if (boomBlend.current < 0.001) boomBlend.current = 0;
    // Over-the-shoulder boom: only on the ground, and never fighting the
    // overhead builder view or the spectator boom for the same axis.
    const thirdOn = getCameraView() === 'third' && !topView && !overhead;
    thirdBlend.current += ((thirdOn ? 1 : 0) - thirdBlend.current) * 0.12;
    if (thirdBlend.current < 0.001) thirdBlend.current = 0;
    if (lookInput.yaw !== 0 || lookInput.pitch !== 0) {
      yawRef.current -= lookInput.yaw;
      pitchRef.current -= lookInput.pitch;
      // Top view widens the downward clamp so the user can look straight
      // down at the build grid. Upward the clamp stays generous so players
      // can tilt high enough to take in the constellations overhead.
      const deg = Math.PI / 180;
      const upLim = 85 * deg;
      const downLim = (topView ? 89 : 70) * deg;
      if (pitchRef.current > upLim) pitchRef.current = upLim;
      if (pitchRef.current < -downLim) pitchRef.current = -downLim;
      lookInput.yaw = 0;
      lookInput.pitch = 0;
    }

    // 2. Compute the local surface basis (smoothed) for the body.
    const pose = getEarthPose();
    const body = physics.getBody(selfId);
    // Physics owns body grounding — the camera rig is a read-only consumer.
    // (Removed render-layer body.pos mutation that was fighting the sim.)
    // Read the INTERPOLATED pose: the sim advances in fixed steps and this
    // frame lands between two of them, so sampling `body.pos` raw aliased
    // the step cadence into visible vertical jitter of the ground.
    const source = body
      ? (physics.getBodyRenderPos(selfId, performance.now(), renderPos.current) ?? body.pos)
      : spawnNearSharedVillage(fallbackId, pose);

    // Use the SHARED village's live site frame instead of recomputing a
    // basis from `source` every frame. The site frame is frozen in
    // Earth-local coords and only rotated by the smooth spin quaternion,
    // so `forward/right` cannot flip when the body's latitude crosses a
    // ref-axis threshold. The camera's `up` is still the live radial
    // outward vector at the body, but tangent axes are continuous.
    const siteLive = getLiveSiteFrame(SHARED_VILLAGE_ANCHOR_ID, pose);
    const radialDx = source[0] - pose.center[0];
    const radialDy = source[1] - pose.center[1];
    const radialDz = source[2] - pose.center[2];
    const radialLen = Math.hypot(radialDx, radialDy, radialDz) || 1;
    const liveUp: [number, number, number] = [
      radialDx / radialLen,
      radialDy / radialLen,
      radialDz / radialLen,
    ];
    // Project the village forward into the plane orthogonal to the body's
    // local up so the basis stays orthonormal even when the body is far
    // from the village anchor (curved surface).
    const fdot = siteLive.forward[0] * liveUp[0] + siteLive.forward[1] * liveUp[1] + siteLive.forward[2] * liveUp[2];
    let liveFwd: [number, number, number] = [
      siteLive.forward[0] - liveUp[0] * fdot,
      siteLive.forward[1] - liveUp[1] * fdot,
      siteLive.forward[2] - liveUp[2] * fdot,
    ];
    const fwdLen = Math.hypot(liveFwd[0], liveFwd[1], liveFwd[2]) || 1;
    liveFwd = [liveFwd[0] / fwdLen, liveFwd[1] / fwdLen, liveFwd[2] / fwdLen];
    // The interpolated body and frozen village frame already provide smooth
    // motion. World-space damping here trails Earth's spin and drags the eye.
    const upN = liveUp;
    const fwdN = liveFwd;
    // right = forward × up
    // Using up × forward creates a reflected basis (determinant < 0), which
    // makes the camera quaternion solve against an invalid frame and can roll
    // the whole horizon sideways even when the body is correctly surface-pinned.
    const rightN: [number, number, number] = [
      fwdN[1] * upN[2] - fwdN[2] * upN[1],
      fwdN[2] * upN[0] - fwdN[0] * upN[2],
      fwdN[0] * upN[1] - fwdN[1] * upN[0],
    ];

    // 3. Build the camera quaternion = basis × yaw × pitch (no lookAt).
    // Basis matrix columns: right, up, -forward (THREE looks down -Z).
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(rightN[0], rightN[1], rightN[2]),
      new THREE.Vector3(upN[0], upN[1], upN[2]),
      new THREE.Vector3(-fwdN[0], -fwdN[1], -fwdN[2]),
    );
    const basisQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    const viewEuler = new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ');
    const viewQuat = new THREE.Quaternion().setFromEuler(viewEuler);
    camera.quaternion.copy(basisQuat).multiply(viewQuat);
    // Share which way you face (against true north) with the compass and map.
    try {
      const vf = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const vu = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      setViewHeading(headingFromCamera([vf.x, vf.y, vf.z], [vu.x, vu.y, vu.z], source as [number, number, number], pose));
    } catch { /* heading is best-effort */ }

    // 4. Position camera at eye height above the body. Single source of
    // truth: EYE_LIFT (earth.ts). Phase 4C — no radial eye rescue. The
    // eye is computed strictly from the solved body position + local
    // outward normal. If the camera ever clips into the core, the bug
    // is in the body integrator (or a missing surface support band) —
    // patching it here would only mask the real failure.
    // Builder "Top view": boom the eye up and back along the view forward
    // so the avatar plus a wide patch of build grid stay in frame.
    const boomAmt = boomBlend.current;
    const specAmt = specBlend.current;
    const thirdAmt = thirdBlend.current;
    const eyeLift =
      EYE_LIFT
      + topUpRef.current * boomAmt
      + SPECTATOR_UP_M * specAmt
      + THIRD_PERSON_UP_M * thirdAmt
      + seatLift.current;
    let boomX = 0, boomY = 0, boomZ = 0;
    if (needsBoomClearance(boomAmt, specAmt, thirdAmt)) {
      const viewFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      // Strip the radial component so the boom pulls back along the ground.
      const vdot = viewFwd.x * upN[0] + viewFwd.y * upN[1] + viewFwd.z * upN[2];
      let bx = viewFwd.x - upN[0] * vdot;
      let by = viewFwd.y - upN[1] * vdot;
      let bz = viewFwd.z - upN[2] * vdot;
      const bn = Math.hypot(bx, by, bz) || 1;
      bx /= bn; by /= bn; bz /= bn;
      const back =
        TOP_VIEW_BACK_M * boomAmt
        + SPECTATOR_BACK_M * specAmt
        + THIRD_PERSON_BACK_M * thirdAmt;
      boomX = -bx * back;
      boomY = -by * back;
      boomZ = -bz * back;
    }
    let eyeX = source[0] + upN[0] * eyeLift + boomX;
    let eyeY = source[1] + upN[1] * eyeLift + boomY;
    let eyeZ = source[2] + upN[2] * eyeLift + boomZ;
    // Terrain pull-in: swinging the boom backwards over rising ground can
    // bury the eye. Keep it a clear margin above the local surface by
    // shortening the boom radially — never by moving the body.
    if (needsBoomClearance(boomAmt, specAmt, thirdAmt)) {
      const ex = eyeX - pose.center[0];
      const ey = eyeY - pose.center[1];
      const ez = eyeZ - pose.center[2];
      const eyeR = Math.hypot(ex, ey, ez) || 1;
      const bodyR = Math.hypot(radialDx, radialDy, radialDz);
      // Also sample the real terrain (volcano cone + land lift) under the
      // eye so a boom swung over a slope never ends up inside the crust.
      let terrainR = 0;
      try {
        const eyeLocalN = worldPosToLocalNormal([eyeX, eyeY, eyeZ], pose);
        terrainR = feetRadiusAt(eyeLocalN) + 1.2;
      } catch { /* organ unavailable — fall back to body-relative floor */ }
      const minR = Math.max(bodyR + 0.9, terrainR);
      if (eyeR < minR) {
        const k = minR / eyeR;
        eyeX = pose.center[0] + ex * k;
        eyeY = pose.center[1] + ey * k;
        eyeZ = pose.center[2] + ez * k;
      }
    }
    camera.position.set(eyeX, eyeY, eyeZ);
    camera.up.set(upN[0], upN[1], upN[2]);

    // 5. Push intent — yaw is local within the surface basis. Pass the
    // basis so physics moves us along the tangent plane, not world XZ.
    const kFwd = (keys.current['KeyW'] ? 1 : 0) - (keys.current['KeyS'] ? 1 : 0);
    const kRight = (keys.current['KeyD'] ? 1 : 0) - (keys.current['KeyA'] ? 1 : 0);
    let fwd = kFwd + moveInput.fwd;
    let right = kRight + moveInput.right;
    // At the helm or the oars the same keys and joystick work the boat
    // (ShipWheel.tsx); the body stays at its station.
    const crewing = getCrewRole() !== null;
    if (crewing) { fwd = 0; right = 0; }
    // Run / Flash: Shift (desktop) or HUD pill multiplies intent magnitude.
    const now = performance.now();
    if (runState.active && now > runState.until) runState.active = false;
    if (runState.active && !crewing) {
      // Auto-forward: tapping the bolt with no joystick/WASD input sprints
      // straight ahead. Active input takes over and is multiplied as usual.
      if (Math.abs(fwd) + Math.abs(right) < 0.05) {
        fwd = 1;
      }
      fwd *= RUN_MULTIPLIER;
      right *= RUN_MULTIPLIER;
    }
    // Single source of truth for movement direction:
    //   - send the *unrotated* tangent basis (village forward/right) plus
    //     the live camera yaw.
    //   - physics rotates fwd/right by `intent.yaw` exactly once.
    // Pre-rotating the basis here AND letting physics rotate again was the
    // double-yaw bug that flipped controls after spinning past 90°.
    physics.setIntent(selfId, {
      fwd,
      right,
      yaw: yawRef.current,
      basis: { up: upN, forward: fwdN, right: rightN },
    });
  }, -1); // Read the shared frame before avatar render callbacks.

  return null;
}

/**
 * Drives Earth's pose clock and re-writes the co-moving Earth pin into the
 * field every animation tick. Without this, Earth's basin desyncs from the
 * visible planet the moment Earth orbits/rotates.
 */
function EarthPoseTicker() {
  // Earth pose is derived from the shared epoch (earth.ts), so every
  // client sees the same Sun/Moon/orbit. Physics owns mantle writes; this
  // ticker exists only to keep pose-driven visuals live. A previous call
  // to `updateLavaMantlePin` here raced the physics tick and produced a
  // second unsynchronised pin re-stamp path — visible as surface tremor.
  // `beginEarthFrame` re-pins the shared per-frame pose so the camera,
  // the ground and every world layer agree on where Earth is this frame.
  useFrame(() => {
    try {
      beginEarthFrame();
    } catch {
      /* best-effort */
    }
  }, -2); // Pin the clock before any camera, ground or avatar reads it.
  return null;
}


/**
 * Per-frame binding loop: writes Infinity's basin into pinTemplate from the
 * neural projection, then samples the field back into the neural engine and
 * caches the snapshot for EntityVoice / debug overlay. One organism, two faces.
 */
// ── Memoized world layers ───────────────────────────────────────────
// BrainUniverseScene re-renders whenever mesh state changes: every peer's
// position/presence broadcast, call participant refreshes and HUD readouts.
// Without these boundaries each of those re-rendered the whole world
// (every nature piece, bar block, element pin, sea and hen layer), which is
// why the Brain ran slower the more connected it was. These layers take no
// props that change with mesh traffic, so memo keeps them out of it; each
// still updates itself from its own stores and frame loop.
const WorldBackdrop = memo(function WorldBackdrop({ selfId }: { selfId: string | null }) {
  return (
    <>
  <StarField />
  {/* Cat, Dragon, Pirate Ship and Flask: fixed sky, shared Earth clock. */}
  <Constellations />
  <AtmosphereSky />
  {/* Real point-light "Sun" — placed off the galactic plane, casts on
      Earth and standard materials. No abstract sky dome, no painted
      sun: the planet is lit by an actual light source in the scene. */}
  <SunLight />
  {/* Soft hemisphere fill so the night side / underside isn't pitch black */}
  <hemisphereLight args={['hsl(210, 70%, 55%)', 'hsl(30, 30%, 25%)', 0.45]} />
  <ambientLight intensity={0.25} color="hsl(220, 40%, 60%)" />

  <GalaxyVisual />
  <ElementsVisual />
  <EarthBody />
  <AssetCaster selfId={selfId || undefined} />
  <PendingBuildsLayer selfId={selfId || undefined} />
  <WorldDropsLayer selfId={selfId || undefined} />
  <WorldToolTargetsLayer />
  <ToolSwingFX />
  <CarvedCellsLayer />
  <WeatherLayer />
  <HeldToolMesh selfId={selfId || undefined} />
  <BoundaryMarkerLayer selfId={selfId || undefined} />
    </>
  );
});

const VillageProps = memo(function VillageProps({ selfId }: { selfId: string | null }) {
  return (
    <>
  <SurfaceBar anchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />
  {/* Village jetty + moored boat (procedural, Earth-local). The
      planks register as a deck surface, so they are walkable. */}
  <DockLayer />
  {/* Schools of fish and sharks in the open sea, on the shared clock. */}
  <SeaLifeLayer selfId={selfId} />
  {/* Free-range hens on the land, on the shared clock. A Stone Knife catches one. */}
  <ChickenLayer />
  <PubDrinkProps />
    </>
  );
});

const VillageLife = memo(function VillageLife() {
  return (
    <>
  <SurfaceTree anchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />
  {/* Phase 2 — static nature biome (pond, grass, flowers, trees, fish, hive, bees). */}
  <NatureLayer anchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />
  {/* Phase 7 — live NPC roster + deterministic resource clusters. */}
  <NpcSwarmLayer anchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />
    </>
  );
});

function InfinityBindingTicker() {
  const physics = useMemo(() => getBrainPhysics(), []);
  const engine = useMemo(() => getSharedNeuralEngine(), []);
  const lastFeedRef = useRef(0);
  useFrame(() => {
    if (!getFeatureFlags().infinityFieldBinding) return;
    // The shared 3D field only steps at FIELD_HZ (4 Hz), so pinning
    // Infinity's basin and sampling the lattice any faster just repeats
    // the same work on an unchanged field. Run the whole binding on the
    // field's own clock instead of every render frame.
    const now = performance.now();
    if (now - lastFeedRef.current < 1000 / FIELD_HZ) return;
    lastFeedRef.current = now;
    try {
      const field = physics.getField();
      const projection = getInfinityProjection(engine);
      pinInfinityIntoField(field, projection);
      const snap = sampleFieldForInfinity(field);
      setLastInfinitySnapshot(snap);
      feedFieldIntoNeural(snap, engine);
    } catch {
      /* binding is best-effort */
    }
  });
  return null;
}

/**
 * Renders all non-self, non-portal bodies (pieces + remote avatars).
 * Reads transforms straight from physics on each render frame.
 */
function BodyLayer({
  selfId,
  onPortalEnter,
  portals,
}: {
  selfId: string;
  onPortalEnter: (portalId: string) => void;
  portals: BrainPortal[];
}) {
  const physics = getBrainPhysics();
  const groupRef = useRef<THREE.Group>(null);
  const meshes = useRef<Map<string, THREE.Object3D>>(new Map());
  const portalDwell = useRef<Map<string, number>>(new Map());

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    const bodies = physics.getBodies();
    const seen = new Set<string>();
    for (const b of bodies) {
      seen.add(b.id);
      let mesh = meshes.current.get(b.id);
      if (!mesh) {
        if (b.kind === 'piece') {
          const geo = new THREE.BoxGeometry(1, 2, 1);
          const mat = new THREE.MeshStandardMaterial({
            color: 'hsl(265, 60%, 45%)',
            emissive: 'hsl(265, 70%, 30%)',
            emissiveIntensity: 0.4,
          });
          mesh = new THREE.Mesh(geo, mat);
        } else {
          // skip — handled by react components (incl. remote avatars)
          continue;
        }
        groupRef.current.add(mesh);
        meshes.current.set(b.id, mesh);
      }
      // Frame-interpolated read: drawing from the raw tick stamp put
      // these meshes one step behind the smoothed camera (lateral jitter).
      const rp = physics.getBodyRenderPos(b.id) ?? b.pos;
      mesh.position.set(rp[0], b.kind === 'piece' ? 1 : 0, rp[2]);

    }
    // Remove stale
    for (const [id, mesh] of meshes.current.entries()) {
      if (!seen.has(id)) {
        groupRef.current.remove(mesh);
        meshes.current.delete(id);
      }
    }

    // Portal capture: portals co-rotate with the planet (their visible
    // doorway is recomputed each frame from `localPos`), so we must
    // resolve their live world position the same way before measuring
    // distance. Using the static body.pos drifts away from the visible
    // door as Earth spins → walking through never triggered.
    const self = physics.getBody(selfId);
    if (self && portals.length > 0) {
      const pose = getEarthPose();
      for (const p of portals) {
        let wx: number, wy: number, wz: number;
        if (p.localPos) {
          const w = quatRotate(pose.spinQuat, p.localPos);
          wx = pose.center[0] + w[0];
          wy = pose.center[1] + w[1];
          wz = pose.center[2] + w[2];
        } else {
          wx = p.pos[0]; wy = p.pos[1]; wz = p.pos[2];
        }
        const d = Math.hypot(self.pos[0] - wx, self.pos[1] - wy, self.pos[2] - wz);
        const bodyId = `portal-${p.id}`;
        if (d < 1.6) {
          const t = (portalDwell.current.get(bodyId) ?? 0) + dt;
          portalDwell.current.set(bodyId, t);
          if (t >= 0.3) {
            portalDwell.current.delete(bodyId);
            onPortalEnter(bodyId);
          }
        } else {
          portalDwell.current.delete(bodyId);
        }
      }
    }
  });

  return <group ref={groupRef} />;
}

/**
 * SelfAvatarBody — your own character, drawn from behind.
 *
 * Uses the same avatar mesh everyone else sees you as, driven by the local
 * physics body, so over-the-shoulder view and remote views agree. Hidden
 * in first person (you would be looking at the inside of your own head).
 */
function SelfAvatarBody({ selfId, username }: { selfId: string; username: string }) {
  const physics = getBrainPhysics();
  const [view, setView] = useState<CameraView>(() => getCameraView());
  useEffect(() => subscribeCameraView(setView), []);
  const renderPos = useRef<[number, number, number]>([0, 0, 0]);
  // Live avatar id — follows runtime switches made in the builder Options
  // tab, so your form changes in-place without re-entering the Brain.
  const [avatarId, setAvatarId] = useState<string | undefined>(() => {
    try { return loadHubPrefs()?.avatarId; } catch { return undefined; }
  });
  useEffect(() => subscribeAvatarChange(setAvatarId), []);
  useEffect(() => {
    // Mass follows the chosen form — heavier avatars drift more slowly.
    const b = physics.getBody(selfId);
    if (b) b.mass = getAvatarMassFromId(avatarId);
  }, [avatarId, physics, selfId]);


  const samplePose = useCallback(() => {
    const body = physics.getBody(selfId);
    const intent = physics.getIntent(selfId);
    const seat = seatedTransform(selfId);
    if (!body && !seat) return undefined;
    const pos = seat ?? physics.getBodyRenderPos(selfId, performance.now(), renderPos.current);
    if (!pos) return undefined;
    let movementDirection: [number, number, number] | undefined;
    if (!seat && intent && intent.basis && Math.hypot(intent.fwd, intent.right) > 0.05) {
      const { forward, right } = intent.basis;
      const cy = Math.cos(intent.yaw);
      const sy = Math.sin(intent.yaw);
      const pushForward: [number, number, number] = [
        cy * forward[0] - sy * right[0],
        cy * forward[1] - sy * right[1],
        cy * forward[2] - sy * right[2],
      ];
      const pushRight: [number, number, number] = [
        cy * right[0] + sy * forward[0],
        cy * right[1] + sy * forward[1],
        cy * right[2] + sy * forward[2],
      ];
      movementDirection = [
        pushForward[0] * intent.fwd + pushRight[0] * intent.right,
        pushForward[1] * intent.fwd + pushRight[1] * intent.right,
        pushForward[2] * intent.fwd + pushRight[2] * intent.right,
      ];
    }
    return { position: pos, pinned: !!seat, movementDirection };
  }, [physics, selfId]);
  if (view === 'first') return null;
  return (
    <RemoteAvatarBody
      position={renderPos.current}
      samplePose={samplePose}
      intentDriven
      trust={0.6}
      label={username}
      avatarId={avatarId}
      peerPv={BRAIN_PHYSICS_VERSION}
    />
  );
}

/**
 * Renders one RemoteAvatarBody per remote voice peer, reading the live
 * body position from physics each frame so the avatar tracks the
 * Earth-clamped capsule. Avatar mesh = the dragon/rabbit/etc. each peer
 * chose at the entry gate, broadcast via room presence.
 */
function RemoteAvatarLayer({ peers }: { peers: { peerId: string; username: string; avatarId?: string; pv?: number }[] }) {
  const physics = getBrainPhysics();
  const [, force] = useState(0);
  // Tick the layer at ~10 Hz so React reconciles new position props
  // periodically. Individual RemoteAvatarBody children already lerp
  // toward their target every frame, so re-rendering the whole layer
  // at 60 fps (previous useFrame) was burning a full render pass per
  // frame and was a large idle-CPU regression on mobile.
  useEffect(() => {
    const id = window.setInterval(() => force((n) => (n + 1) & 0xfff), 100);
    return () => window.clearInterval(id);
  }, []);
  return (
    <>
      {peers.map((p) => {
        const id = `peer-${p.peerId}`;
        const body = physics.getBody(id);
        // Seat lock wins over the broadcast body: if the shared table
        // state says this peer holds a stool, render them exactly on it.
        const seat = seatedTransform(p.peerId) ?? seatedTransform(id);
        if (!body && !seat) return null;
        const pos = seat ?? physics.getBodyRenderPos(id);
        if (!pos) return null;
        return (
          <RemoteAvatarBody
            key={id}
            position={pos}
            pinned={!!seat}
            trust={body?.trust ?? 0.5}
            label={p.username}
            avatarId={p.avatarId}
            peerPv={p.pv}
          />
        );
      })}
    </>
  );
}

/**
 * On-screen Run / Flash pill. Tap → start sprint (×2.2 for 4 s, 6 s
 * cooldown). Polls `runState` so the visual stays in sync regardless of
 * what triggered the sprint (Shift, gamepad RT, or this button).
 */
function RunPill({ onPress, mobile }: { onPress: () => void; mobile: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => (n + 1) & 0xfff), 100);
    return () => clearInterval(id);
  }, []);
  const now = performance.now();
  const active = runState.active && now < runState.until;
  const cooling = !active && now < runState.cooldownUntil;
  let pct = 100;
  if (active) pct = Math.max(0, ((runState.until - now) / RUN_DURATION_MS) * 100);
  else if (cooling) pct = Math.max(0, 100 - ((runState.cooldownUntil - now) / RUN_COOLDOWN_MS) * 100);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onPress}
      disabled={cooling}
      aria-label="Run / Flash"
      title={active ? 'Sprinting' : cooling ? 'Cooling down' : 'Run / Flash (Shift)'}
      className={
        'absolute z-[70] h-14 w-14 overflow-hidden rounded-full border-2 ' +
        (active
          ? 'border-amber-400 bg-amber-500/40'
          : cooling
            ? 'border-foreground/20 bg-[hsla(265,70%,8%,0.5)] opacity-60'
            : 'border-[hsla(180,80%,60%,0.4)] bg-[hsla(265,70%,8%,0.7)]')
      }
      // Mobile parks the bolt on the left so the right-thumb joystick stays clear.
      style={
        mobile
          ? { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8rem)', left: '1rem' }
          : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14rem)', right: '1rem' }
      }
    >
      <span className="relative z-10"><Zap className="h-5 w-5" /></span>
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-amber-400/30"
        style={{ height: `${pct}%`, transition: 'height 100ms linear' }}
      />
    </Button>
  );
}

function MobileJoystick() {
  const role = useCrewRole();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = false;
    const onStart = (e: TouchEvent) => { active = true; e.preventDefault(); update(e); };
    const onMove = (e: TouchEvent) => { if (active) update(e); };
    const onEnd = () => { active = false; moveInput.fwd = 0; moveInput.right = 0; };
    const update = (e: TouchEvent) => {
      const t = e.touches[0]; if (!t) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (t.clientX - cx) / (r.width / 2);
      const dy = (t.clientY - cy) / (r.height / 2);
      moveInput.right = Math.max(-1, Math.min(1, dx));
      moveInput.fwd = -Math.max(-1, Math.min(1, dy));
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, []);
  return (
    <div
      ref={ref}
      // z-[90] sits above the live-chat tray (z-50); 8rem clears the chat dock.
      className={`absolute z-[90] flex h-24 w-24 items-center justify-center rounded-full border-2 border-accent/40 bg-background/80 ${role ? 'right-6' : 'right-4'}`}
      data-no-look="true"
      style={{ bottom: role ? 'calc(env(safe-area-inset-bottom, 0px) + 9.5rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 8rem)' }}
    >
      <div className="h-10 w-10 rounded-full bg-[hsla(180,90%,60%,0.5)]" />
      <CrewJoystickSkin />
    </div>
  );
}

function TouchLookOverlay({ inert = false }: { inert?: boolean }) {
  useEffect(() => {
    if (inert) return;
    let lastX = 0, lastY = 0, active = false;
    const isInteractiveUi = (target: EventTarget | null) => {
      const node = target instanceof Element ? target : null;
      return !!node?.closest('button, a, input, textarea, select, [role="button"], [data-no-look="true"]');
    };
    const onStart = (e: TouchEvent) => {
      if (isInteractiveUi(e.target)) return;
      const t = e.touches[0]; if (!t) return;
      lastX = t.clientX; lastY = t.clientY; active = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0]; if (!t) return;
      const s = 0.005 * getBuilderLookScale();
      lookInput.yaw += (t.clientX - lastX) * s;
      lookInput.pitch += (t.clientY - lastY) * s;
      lastX = t.clientX; lastY = t.clientY;
    };
    const onEnd = () => { active = false; };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [inert]);
  return <div className="pointer-events-none absolute inset-0 z-10" />;
}

/**
 * Desktop drag-to-look overlay. No pointer lock — cursor stays visible so
 * HUD buttons remain clickable without an Esc-to-release dance.
 */
function DesktopLookOverlay({ inert = false }: { inert?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [grabbing, setGrabbing] = useState(false);
  useEffect(() => {
    if (inert) return;
    let lastX = 0, lastY = 0, active = false;
    const isInteractiveUi = (target: EventTarget | null) => {
      const node = target instanceof Element ? target : null;
      return !!node?.closest('button, a, input, textarea, select, [role="button"], [data-no-look="true"]');
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (isInteractiveUi(e.target)) return;
      active = true;
      lastX = e.clientX; lastY = e.clientY;
      setGrabbing(true);
    };
    const onMove = (e: MouseEvent) => {
      if (!active) return;
      const s = 0.005 * getBuilderLookScale();
      lookInput.yaw += (e.clientX - lastX) * s;
      lookInput.pitch += (e.clientY - lastY) * s;
      lastX = e.clientX; lastY = e.clientY;
    };
    const onUp = () => { active = false; setGrabbing(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, [inert]);
  return (
    <div
      ref={ref}
      // Pointer-events stay OFF so in-Canvas placement clicks reach the
      // AssetCaster; look-drag is driven by window listeners instead.
      className={`pointer-events-none absolute inset-0 z-10 ${grabbing ? 'cursor-grabbing' : 'cursor-grab'}`}
    />
  );
}

/**
 * Desktop mouse joystick — mirrors the MobileJoystick but driven by mouse
 * drag. Updates the same `moveInput` globals as WASD so both work in parallel.
 */
function DesktopJoystick() {
  const role = useCrewRole();
  const ref = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const knob = knobRef.current;
    if (!el || !knob) return;
    let active = false;
    const reset = () => {
      moveInput.fwd = 0;
      moveInput.right = 0;
      knob.style.transform = 'translate(0px, 0px)';
    };
    const update = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const half = r.width / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      const max = half * 0.7;
      if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
      moveInput.right = Math.max(-1, Math.min(1, dx / max));
      moveInput.fwd = -Math.max(-1, Math.min(1, dy / max));
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      active = true;
      update(e.clientX, e.clientY);
    };
    const onMove = (e: MouseEvent) => { if (active) update(e.clientX, e.clientY); };
    const onUp = () => { if (!active) return; active = false; reset(); };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={`absolute z-[70] flex h-24 w-24 cursor-pointer items-center justify-center rounded-full border-2 border-accent/40 bg-background/80 ${role ? 'right-6 bottom-[calc(env(safe-area-inset-bottom,0px)+9.5rem)]' : 'bottom-4 left-4'}`}
      data-no-look="true"
      title={role ? undefined : 'Drag to move'}
    >
      <div ref={knobRef} className="pointer-events-none h-10 w-10 rounded-full bg-[hsla(180,90%,60%,0.5)] transition-transform duration-75" />
      <CrewJoystickSkin />
    </div>
  );
}

export interface BrainUniverseSceneProps {
  /** Declarative descriptor of which Brain we're rendering. Built by
   *  the wrapper page (lobby / project / liveChat factory in
   *  `@/lib/brain/variants`). */
  variant: BrainVariant;
}

const BrainUniverseScene = ({ variant }: BrainUniverseSceneProps) => {
  const { roomId, universeKey, onLeave, leaveLabel, title, capabilities, projectId } = variant;
  // Scope the placements store BEFORE any child layer reads it during the
  // first render. A post-mount useEffect would briefly flash the previous
  // universe's walls in the new Brain.
  if (typeof window !== 'undefined') {
    // setActiveUniverse is a no-op when the scope is already current,
    // so running it during render is safe and idempotent.
    setActiveUniverse(universeKey);
  }
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const physics = useMemo(() => getBrainPhysics(), []);
  const guestCandidateId = useMemo(() => `guest-${Math.random().toString(36).slice(2, 8)}`, []);
  const [selfId, setSelfId] = useState<string>('');
  const [chatOpen, setChatOpen] = useState(() => window.location.pathname === '/brain/join');
  const [chatLines, setChatLines] = useState<BrainChatLine[]>([]);
  const appUpdateLine = useBrainAppUpdate(user, roomId);
  const visibleChatLines = useMemo(() => appUpdateLine ? [...chatLines, appUpdateLine] : chatLines, [chatLines, appUpdateLine]);
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const crewRole = useCrewRole();
  const [boatReadoutTarget, setBoatReadoutTarget] = useState<HTMLDivElement | null>(null);
  // Live pending-cast state — drives overlay inertness so pointer events
  // can reach the in-Canvas AssetCaster while a cast is armed.
  const [pendingCast, setPendingCastState] = useState<PendingCast | null>(null);
  useEffect(() => subscribeCast(setPendingCastState), []);
  const builder = useBrainBuilder();
  const castArmed = !!pendingCast;
  const prefabPlacementArmed = builder.mode === 'build' && !!builder.selectedPrefabId;
  const scenePlacementArmed = castArmed || prefabPlacementArmed;
  const editingPlacementRef = useRef<PlacementRecord | null>(null);
  const decoratingPlacementRef = useRef<PlacementRecord | null>(null);
  const [, forceRunRender] = useState(0);
  const isBuilding = builder.mode === 'build';
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [cameraView, setCameraViewState] = useState<CameraView>(() => getCameraView());
  useEffect(() => subscribeCameraView(setCameraViewState), []);
  // Keyboard: V flips over-the-shoulder / close-up, B opens the inventory,
  // Escape closes it. Typing in chat or any input never triggers these.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'v') { toggleShoulderView(); return; }
      if (k === 'b') { setInventoryOpen((v) => !v); return; }
      if (e.key === 'Escape') setInventoryOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const isPlotting = isBuilding && builder.plotting;
  // SWARM balance for the plot Confirm panel — refreshed when the
  // pending plot appears (so the user sees the live amount).
  const [swarmBalance, setSwarmBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!builder.pendingPlot || !selfId) return;
    let cancelled = false;
    (async () => {
      try {
        const bal = await getSwarmBalance(selfId);
        if (!cancelled) setSwarmBalance(bal);
      } catch {
        if (!cancelled) setSwarmBalance(null);
      }
    })();
    return () => { cancelled = true; };
  }, [builder.pendingPlot, selfId]);

  const handleConfirmPlot = useCallback(async () => {
    const pending = builder.pendingPlot;
    if (!pending || !selfId) return;
    const commons = builder.plotMode === 'commons';
    if (!commons) {
      // Private land is claimed block by block with the Boundary marker.
      toast.message('Use the Boundary Marker to claim land, one block at a time.');
      builder.setPendingPlot(null);
      builder.setPlotting(false);
      return;
    }
    if (commons && !isDev(selfId)) {
      toast.error('Only maintainers can lay communal land.');
      return;
    }
    if (!commons) try {
      await burnSwarm({
        from: selfId,
        amount: pending.priceSwarm,
        reason: 'land-plot-claim',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not charge SWARM');
      return;
    }
    let plot;
    try {
      plot = claimLandPlot({
      ownerId: selfId,
      cellRect: pending.rect,
      anchorId: WORLD_GRID_ORIGIN_ANCHOR,
      priceSwarm: commons ? 0 : pending.priceSwarm,
      kind: commons ? 'commons' : 'private',
      label: commons ? 'Public land' : undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not claim that land');
      return;
    }
    toast.success(
      commons
        ? `Laid communal land · ${pending.boxes} boxes`
        : `Claimed plot · ${pending.boxes} boxes · ${pending.priceSwarm} SWARM`,
    );
    builder.setPendingPlot(null);
    builder.setPlotting(false);
    // refresh balance
    try { setSwarmBalance(await getSwarmBalance(selfId)); } catch { /* ignore */ }
    return plot;
  }, [builder, selfId]);

  // Carry this member's old walk-claimed plots into signed block claims
  // so they sync to peers. Retries on login (the key may be locked now).
  // When an earlier owner's claim displaces one of ours (they were
  // offline, or their old plot only now synced), move our paid block to
  // the nearest free land block.
  useEffect(() => {
    if (!selfId) return;
    installLandClaimRules();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      void reconcileDeeds(selfId).then(({ moved }) => {
        if (moved > 0) {
          toast.message(
            moved === 1
              ? 'Someone held one of your blocks first. It was moved to the nearest free block.'
              : `Someone held ${moved} of your blocks first. They were moved to the nearest free blocks.`,
          );
        }
      }).catch(() => undefined);
    };
    const run = () => { void migrateLegacyPlots(selfId).catch(() => 0).then(reconcile); };
    run();
    window.addEventListener('user-login', run);
    const off = subscribeLandClaims(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(reconcile, 1500);
    });
    return () => {
      window.removeEventListener('user-login', run);
      off();
      if (timer) clearTimeout(timer);
    };
  }, [selfId]);

  const handlePlotSurveyClose = useCallback((next: PendingPlot) => {
    builder.setPendingPlot(next);
    builder.setSurveyProgress(null);
  }, [builder]);
  const handlePlotSurveyProgress = useCallback(
    (next: PendingPlot | null) => builder.setSurveyProgress(next),
    [builder],
  );
  const [portals, setPortals] = useState<BrainPortal[]>([]);
  const [cameraOn, setCameraOn] = useState(() =>
    user ? getWebRTCManager(user.id, user.username).isCameraOn() : false,
  );
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const canvasDpr = useAdaptiveDpr();
  // A share started earlier keeps running while Brain-synced on other pages,
  // so coming back picks the live capture up again.
  const [screenStream, setScreenStream] = useState<MediaStream | null>(() =>
    user ? getWebRTCManager(user.id, user.username).getScreenStream() : null,
  );
  const [rtcParticipants, setRtcParticipants] = useState<import('@/lib/webrtc/types').VideoParticipant[]>([]);

  // ── Entry gate: avatar + optional mic test before spawn ───────────
  // If the user has already completed the Brain entry gate (avatar, with
  // or without a mic) in this browser, skip the modal on later visits.
  // Without this, the modal flashes for one frame every time you re-enter
  // /brain (or when an outer wizard navigates here right after collecting
  // the same info), because `entryOpen` defaulted to `true` unconditionally.
  const entryAlreadyComplete = (() => {
    if (isGuestUser(user) && !user.guestName?.trim()) return false;
    return isBrainEntryComplete();
  })();
  const [ready, setReady] = useState<boolean>(entryAlreadyComplete);
  const [entryOpen, setEntryOpen] = useState<boolean>(!entryAlreadyComplete);
  // Gamepad → existing intent globals. No-op on mobile / Safari iOS.
  useGamepadIntent({
    moveInput,
    lookInput,
    onRunPress: () => { tryStartRun(performance.now()); forceRunRender((n) => (n + 1) & 0xfff); },
  });
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try { return loadHubPrefs().infinityVoice !== false; } catch { return true; }
  });
  // Mirror voiceEnabled into a ref so the chat handler never has to depend on
  // it. This guarantees that toggling mute can NEVER affect text emission —
  // the speak() call simply reads the latest value at fire time.
  const voiceEnabledRef = useRef<boolean>(voiceEnabled);
  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);
  const [infinityChatMode, setInfinityChatMode] = useState<InfinityChatMode>(() =>
    isGuestUser(user) ? resolveGuestInfinityChatMode(loadHubPrefs().guestInfinityChatMode) : resolveInfinityChatMode(loadHubPrefs().infinityChatMode),
  );
  const { stats: meshStats } = useP2PContext();
  const [guestConnectionOffered, setGuestConnectionOffered] = useState(false);
  const guestConnectionOfferedRef = useRef(false);
  useEffect(() => {
    guestConnectionOfferedRef.current = false;
    setGuestConnectionOffered(false);
  }, [roomId, user?.id]);
  const infinityChatModeRef = useRef(infinityChatMode);
  const infinityReplyEpochRef = useRef(0);
  useEffect(() => {
    const prefs = loadHubPrefs();
    const mode = isGuestUser(user) ? resolveGuestInfinityChatMode(prefs.guestInfinityChatMode) : resolveInfinityChatMode(prefs.infinityChatMode);
    infinityChatModeRef.current = mode;
    setInfinityChatMode(mode);
    infinityReplyEpochRef.current++;
    cancelInfinity();
  }, [user?.id]);
  const roomConsent = useMemo(() => new InfinityRoomConsent<BrainChatLine>(), [roomId]);
  const [infinitySyncRequested, setInfinitySyncRequested] = useState(false);
  useEffect(() => { setInfinitySyncRequested(false); }, [roomId]);
  const chooseInfinitySync = useCallback((accept: boolean) => {
    const accepted = roomConsent.choose(accept);
    if (accepted.length) setChatLines((prev) => [...prev, ...accepted].sort((a, b) => a.ts - b.ts).slice(-100));
    setInfinitySyncRequested(false);
  }, [roomConsent]);
  useEffect(() => () => {
    infinityReplyEpochRef.current += 1;
    cancelInfinity();
  }, [roomId]);

  // ── P2P voice chat (joined only after gate passes) ────────────────
  // Users who entered without a mic join listen-only: they hear everyone
  // and the mic is only requested when they press the mic button.
  const micOn = useBrainMicChoice();
  const {
    participants: voicePeers,
    isMuted,
    toggleMute,
    enableMic,
    sendChatLine,
    onChatLine,
    broadcastSelfPosition,
    getPeerPresence,
    onPeerPresence,
  } = useBrainVoice(ready, roomId, { audio: micOn });
  const onMicButton = useCallback(() => {
    if (micOn) { toggleMute(); return; }
    void enableMic().then((ok) => {
      if (ok) setBrainMic(true);
      else toast.error("Couldn't turn on your mic. Check the browser's microphone permission.");
    });
  }, [micOn, toggleMute, enableMic]);
  // People chatting from the main menu share this room's chat (lobby only);
  // list them beside the people in the Brain.
  const chatPeers = useNetworkChatPeers(ready, roomId);

  // Muted peers vanish from the scene entirely on this device — no avatar,
  // no camera tile, no audio (audio is muted in PersistentAudioLayer).
  // Blocked peers also carry a mute entry, so one store covers both.
  const mutedPeers = useMutedPeers();
  const visibleVoicePeers = useMemo(
    () => voicePeers.filter((p) => !isPeerMuted(p.peerId)),
    [voicePeers, mutedPeers],
  );
  const visibleRtcParticipants = useMemo(
    () => rtcParticipants.filter((p) => !isPeerMuted(p.peerId)),
    [rtcParticipants, mutedPeers],
  );

  // Entering the Brain marks this room as synced: leaving the page keeps
  // the conversation going until the user presses Disconnect.
  useEffect(() => {
    if (ready) syncBrainRoom(roomId);
  }, [ready, roomId]);

  // Names from Brain presence, so every video box and screen share is
  // labelled with the person's username instead of a placeholder.
  const voiceNameByPeerId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of voicePeers) {
      if (p.username) map[p.peerId] = p.username;
    }
    return map;
  }, [voicePeers]);

  // Subscribe to raw WebRTC participants (with media streams) for the video grid.
  useEffect(() => {
    if (!ready || !user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const refresh = () => {
      const next = manager.getParticipants();
      setRtcParticipants((prev) => (sameParticipants(prev, next) ? prev : next));
    };
    refresh();
    const unsub = manager.onMessage((m) => {
      if (m.type === 'peer-joined' || m.type === 'peer-left' || m.type === 'room-updated'
        || m.type === 'peer-media-state'
        || m.type === 'screen-share-started' || m.type === 'screen-share-stopped') {
        refresh();
      }
    });
    const poll = window.setInterval(refresh, 1500);
    return () => { unsub(); window.clearInterval(poll); };
  }, [ready, user]);

  const toggleCamera = useCallback(async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    if (!cameraOn) {
      try {
        // Use refreshLocalStream when the existing stream has any dead
        // tracks (warm re-entry to /brain or a project universe). This
        // guarantees fresh getUserMedia + full renegotiation so peers
        // actually receive the new video SSRC.
        const existing = manager.getLocalStream();
        const hasDeadTrack = !!existing && existing.getTracks().some(t => t.readyState === 'ended');
        // Listen-only users keep their mic off when turning the camera on.
        const stream = hasDeadTrack
          ? await manager.refreshLocalStream(micOn, true)
          : await manager.startLocalStream(micOn, true);
        manager.toggleVideo(true);
        setLocalStream(stream);
        setCameraOn(true);
      } catch (err) {
        console.warn('[Brain] camera enable failed', err);
      }
    } else {
      try {
        manager.toggleVideo(false);
        const local = manager.getLocalStream();
        if (local) {
          for (const t of local.getVideoTracks()) {
            t.stop();
            local.removeTrack(t);
          }
        }
      } catch { /* ignore */ }
      setCameraOn(false);
    }
  }, [cameraOn, user, micOn]);

  // ── Screen share ──────────────────────────────────────────────────
  // Independent of camera and mic: sharing never touches the voice track.
  // Capture runs FIRST and synchronously from the click so the browser keeps
  // its transient-activation grant (Firefox rejects getDisplayMedia that is
  // detached from the gesture) — publishing to peers happens after.
  const toggleScreenShare = useCallback(async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    if (!screenStream) {
      if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
        toast.error('This browser cannot share a screen; try a desktop browser.');
        return;
      }
      const embedded = window.self !== window.top;
      let stream: MediaStream;
      try {
        // The native picker is the very first operation — before any await —
        // so the request still carries the trusted click activation.
        stream = await navigator.mediaDevices.getDisplayMedia(SCREEN_CAPTURE_CONSTRAINTS);
      } catch (error) {
        const err = error as DOMException;
        // Keep the real error visible for diagnosis instead of guessing.
        console.warn('[ScreenShare] Capture rejected:', {
          name: err?.name,
          message: err?.message,
          secureContext: window.isSecureContext,
          embedded,
          hasApi: typeof navigator.mediaDevices?.getDisplayMedia,
        });
        if (err?.name === 'AbortError') {
          // The user closed the picker themselves; nothing to report.
        } else if (embedded && err?.name === 'NotAllowedError') {
          toast.error("Screen sharing isn't allowed inside the embedded preview window.", {
            action: { label: 'Open in new tab', onClick: () => window.open(window.location.href, '_blank', 'noopener') },
          });
        } else if (err?.name === 'NotAllowedError') {
          toast.error('Firefox or the system blocked screen capture. Check your screen-recording permission, then try again.');
        } else if (err?.name === 'InvalidStateError') {
          toast.error('Screen sharing needs a fresh click — press the share button again.');
        } else if (err?.name === 'NotSupportedError' || err?.name === 'NotFoundError') {
          toast.error('This browser cannot share a screen; try a desktop browser.');
        } else {
          toast.error(`Screen share failed: ${err?.message ?? err?.name ?? 'unknown error'}`);
        }
        setScreenStream(null);
        return;
      }
      try {
        await manager.publishScreenStream(stream);
      } catch (error) {
        console.error('[ScreenShare] Publishing failed:', error);
        stream.getTracks().forEach(t => t.stop());
        toast.error('Screen captured, but sharing it to the room failed. Voice is unaffected.');
        setScreenStream(null);
        return;
      }
      setScreenStream(stream);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => setScreenStream(null));
    } else {
      try { manager.stopScreenShare(); } catch { /* ignore */ }
      setScreenStream(null);
    }
  }, [screenStream, user]);

  // Follow the call layer's share state: the share can also end from the
  // Brain sync bar, the browser's own "Stop sharing" button, or a room leave.
  useEffect(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const syncShare = () => setScreenStream(manager.getScreenStream());
    syncShare();
    return manager.onMessage((m) => {
      if (m.type === 'screen-share-started' || m.type === 'screen-share-stopped') syncShare();
    });
  }, [user]);

  // Leaving the page while Brain-synced keeps the share live for viewers;
  // the sync bar shows it and lets the host end it. Otherwise release it.
  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => () => {
    if (!user) return;
    if (isBrainSynced(roomIdRef.current)) return;
    try { getWebRTCManager(user.id, user.username).stopScreenShare(); } catch { /* ignore */ }
  }, [user]);


  // Pre-warm Web Speech voice list as soon as gate clears.
  useEffect(() => { if (ready) primeInfinityVoice(); }, [ready]);

  // ── Gesture fallback for browser auto-muted mic on warm re-entry ──
  // Some browsers (Brave/Firefox/Safari) mute a re-acquired mic track
  // when the call wasn't tied to a fresh user gesture. If we detect that
  // state, show a tap-to-enable toast that triggers refreshLocalStream()
  // from inside the resulting click event (which IS a valid gesture).
  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    let toastShown = false;
    const manager = getWebRTCManager(user.id, user.username);
    const check = () => {
      if (cancelled || toastShown) return;
      const stream = manager.getLocalStream();
      const audio = stream?.getAudioTracks()[0];
      // muted === browser auto-suppressed (no input). Distinct from .enabled.
      if (audio && audio.muted) {
        toastShown = true;
        toast('Tap anywhere to enable your mic', {
          duration: 8000,
          action: {
            label: 'Enable',
            onClick: () => {
              void manager.refreshLocalStream(true, false).catch(() => {});
            },
          },
        });
        const onceClick = () => {
          window.removeEventListener('click', onceClick);
          void manager.refreshLocalStream(true, false).catch(() => {});
        };
        window.addEventListener('click', onceClick, { once: true });
      }
    };
    // First check after the voice hook has had time to acquire/unmute.
    const t1 = window.setTimeout(check, 1500);
    const t2 = window.setTimeout(check, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [ready, user]);

  const toggleInfinityVoice = useCallback(() => {
    voiceEnabledRef.current = !voiceEnabledRef.current;
    setVoiceEnabled((prev) => {
      const next = !prev;
      try {
        const cur = loadHubPrefs();
        saveHubPrefs({ ...cur, infinityVoice: next });
      } catch { /* ignore */ }
      if (!next) cancelInfinity();
      return next;
    });
  }, []);

  const changeInfinityChatMode = useCallback((mode: InfinityChatMode) => {
    infinityChatModeRef.current = mode;
    setInfinityChatMode(mode);
    if (mode === 'off') infinityReplyEpochRef.current += 1;
    if (mode !== 'audio') cancelInfinity();
    // Selecting audio explicitly re-enables sound; header mute stays separate.
    if (mode === 'audio') {
      voiceEnabledRef.current = true;
      setVoiceEnabled(true);
    }
    const prefs = loadHubPrefs();
    saveHubPrefs(isGuestUser(user)
      ? { guestInfinityChatMode: mode }
      : { ...prefs, infinityChatMode: mode, infinityVoice: voiceEnabledRef.current });
  }, [user]);

  // ── Bootstrap: load user, restore field, create self body ─────────
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let bodyId = '';
    void (async () => {
      try {
        const snap = await loadBrainField(universeKey);
        if (snap) physics.restore(snap);
      } catch { /* ignore */ }

      // Round-universe + galaxy curvature (deterministic, no network sync)
      try {
        const field = physics.getField();
        applyRoundCurvature(field, 1.0);
        applyGalaxyToField(field, getGalaxy());
        applyElementsToField(field, getElements());
        // Spawn Coherence: immediately rewrite the live Earth pin so the
        // restored field and the visible Earth shell agree from boot,
        // even when an older saved snapshot is loaded.
        // Single-writer boot path: the mantle owns the full radial pin
        // from core to crust, so do not seed legacy surface/core writers.
        initLavaMantle(field);
      } catch (err) {
        console.warn('[Brain] galaxy apply failed', err);
      }

      const user = await getCurrentUser();
      if (cancelled) return;
      const id = user?.id ?? guestCandidateId;
      bodyId = id;
      setSelfId(id);
      // Use the live Earth pose so spawn lands on the *current* surface,
      // not the t=0 surface — important if boot happens after Earth has
      // already rotated/orbited.
      const livePose = getEarthPose();
       // Spawn on the OUTSIDE of Earth, on the visible procedural surface.
       // Feet rest on EARTH_RADIUS, body centre sits BODY_CENTER_HEIGHT above.
      const spawnPos = spawnNearSharedVillage(id, livePose);
      // Spawn-bug telemetry: log the deterministic spawn point so we can
      // diff it against the live body position after physics settles. If
      // the radius differs from EARTH_RADIUS+HUMAN_HEIGHT/2 by more than a
      // few cm here, the bug is in earth.spawnOnEarth, not the integrator.
      // Diagnostic spawn log removed — was firing on every physics tick
      // and dominating the main thread. Re-enable behind a debug flag if
      // you need to inspect spawn geometry.
      const spawnInit = {
        pos: spawnPos,
        vel: [0, 0, 0] as [number, number, number],
        meta: { attachedTo: 'earth-surface' as const },
      };
      // Mass driven by the avatar the user picked at the entry gate.
      const prefs = (() => { try { return loadHubPrefs(); } catch { return null; } })();
      const selfMass = prefs ? getAvatarMassFromId(prefs.avatarId) : getAvatarMass('human');
      physics.addBody({
        id, kind: 'self',
        pos: spawnInit.pos, vel: spawnInit.vel,
        mass: selfMass, trust: 0.6,
        meta: spawnInit.meta,
      });
      // Wire core-escape rescue: if the body falls through the volcano and
      // dwells inside the inner core, respawn it at the shared village.
      physics.setCoreRescue((rescuedId: string, reason: RescueReason) => {
        if (rescuedId !== id) return;
        const livePoseRescue = getEarthPose();
        const respawn = spawnNearSharedVillage(rescuedId, livePoseRescue);
        const body = physics.getBody(rescuedId);
        if (body) {
          body.pos[0] = respawn[0];
          body.pos[1] = respawn[1];
          body.pos[2] = respawn[2];
          body.vel[0] = 0; body.vel[1] = 0; body.vel[2] = 0;
        }
        const message = reason === 'lava'
          ? 'You fell into the volcano\'s lava — respawned at the village'
          : 'You fell through the volcano — respawned at the village';
        try { toast.info(message); } catch { /* ignore */ }
      });
      // Surface support is owned by the Earth field (lava-mantle basin)
      // and the per-block volumetric basins written by the
      // BuilderBlockEngine. We no longer reproject `self` onto a shell
      // post-spawn — the integrator settles it into the field, which is
       // the same physics path that holds remote avatars and structures.
      // Infinity body — mass tied to qScore (updated each frame below)
      physics.addBody({
        id: ENTITY_USER_ID, kind: 'infinity',
        pos: [EARTH_POSITION[0], 1.4, EARTH_POSITION[2] - 6], vel: [0, 0, 0],
        mass: 2.5, trust: 1.0,
      });

      // Restore portals & pieces
      const storedPortals = loadPortals(universeKey);
      setPortals(storedPortals);
      for (const p of storedPortals) {
        physics.addBody({
          id: `portal-${p.id}`, kind: 'portal',
          pos: p.pos, vel: [0, 0, 0],
          mass: 0, trust: 0,
          meta: { projectId: p.projectId, projectName: p.projectName },
        });
        physics.pinPortal(p.pos);
      }
      // Stored builder pieces — go through the engine so each one gets a
      // volumetric Earth-local support basin instead of a single-cell
      // pin. Any piece without an explicit anchorPeerId falls back to
      // the local user's spawn site so it co-moves with the planet.
      try {
        const engine = getBuilderBlockEngine();
        const storedPieces = loadPieces(universeKey);
        for (const piece of storedPieces) {
          const meta = (piece as { meta?: Record<string, unknown> }).meta ?? {};
          const anchorId = String(meta.anchorPeerId ?? id);
          engine.placeBlock({
            id: piece.id,
            kind: String(meta.structure ?? 'piece'),
            anchorPeerId: anchorId,
            rightOffset: Number(meta.rightOffset ?? 0),
            forwardOffset: Number(meta.forwardOffset ?? 0),
            mass: Number(meta.mass ?? 8),
            basin: Number(meta.basin ?? 0.6),
            meta,
          });
        }
      } catch (err) {
        console.warn('[Brain] stored pieces load failed', err);
      }

      // Restore user-placed prefabs (walls, furniture, tools) + their
      // wall decorations. Mirrors the portals/pieces hydration above so
      // a refresh brings the placed world back exactly as it was.
      try {
        await hydrateWorldPlacements();
      } catch (err) {
        console.warn('[Brain] world placements hydrate failed', err);
      }

      // Phase 4A — no recurring anchor timer. The single spawn projection
      // above (post-addBody) is enough; from this point on the field
      // alone owns radial placement. A boot-time anchor loop would
      // suppress the very curvature response we want bodies to feel.

      console.log('[Brain] mounted, qScore primer:', physics.getQScore());
    })();
    return () => {
      cancelled = true;
      try {
        if (bodyId) physics.removeBody(bodyId);
        physics.removeBody(ENTITY_USER_ID);
        physics.setCoreRescue(null);
      } catch { /* ignore */ }
      cancelInfinity();
    };
  }, [guestCandidateId, physics, ready]);

  // ── Periodic field snapshot save (no per-tick scene state) ─────────
  // Throttled to the project's 2.5 min write cadence: serialising three
  // dense Float32Array grids into IndexedDB every few seconds made Firefox's
  // structured clone and disk IPC stall the main thread. Leaving the scene or
  // hiding the tab still captures the latest field.
  useEffect(() => {
    const save = () => {
      try { void saveBrainField(physics.snapshot(), universeKey); } catch { /* ignore */ }
    };
    const saveTimer = setInterval(save, BRAIN_FIELD_SAVE_MS);
    const onVisibility = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(saveTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [physics, universeKey]);

  // ── Scope user placements (walls, decorations, tools) to this universe ──
  // Without this the BuilderBlockEngine would replay every record across
  // every Brain and main-Brain walls would visibly leak into project hubs.
  useEffect(() => {
    setActiveUniverse(universeKey);
    // Re-hydrate so anything persisted for this universe materializes,
    // and out-of-scope blocks are torn down.
    void hydrateWorldPlacements();
  }, [universeKey]);

  // ── Remote voice peers ⇒ physics bodies on Earth's surface ────────
  // Presence send time last applied per peer. Re-applying an old presence
  // snapped every avatar back to where it was when its last update was
  // sent, and restarted remote boats' hand-over ease.
  const appliedPresenceTsRef = useRef(new Map<string, number>());

  // Roster pass: runs only when someone joins, leaves or changes name or
  // avatar (`voicePeers` keeps its identity while people walk). Adds and
  // removes bodies; positions arrive per packet in the effect below.
  useEffect(() => {
    if (!ready) return;
    const applied = appliedPresenceTsRef.current;
    const seen = new Set(voicePeers.map((p) => `peer-${p.peerId}`));
    const pose = getEarthPose();
    const fleet = getFleet();
    for (const p of voicePeers) {
      const live = getPeerPresence(p.peerId);
      syncRemotePeerBody(physics, applied, {
        peerId: p.peerId,
        username: p.username,
        avatarId: p.avatarId,
        position: live?.position ?? p.position,
        local: live?.local ?? p.local,
        presenceTs: live?.ts ?? p.presenceTs,
        boat: live ? live.boat : p.boat,
      }, pose, fleet);
    }
    for (const peerId of Array.from(applied.keys())) {
      if (!seen.has(`peer-${peerId}`)) applied.delete(peerId);
    }
    // Boats of peers who left go with them (anyone aboard drops in).
    fleet.retainPeers(new Set(voicePeers.map((p) => p.peerId)));
    // Remove peers that left
    const all = physics.getBodies();
    for (const b of all) {
      if (!b.id.startsWith('peer-')) continue;
      if (!seen.has(b.id)) {
        try { physics.removeBody(b.id); } catch { /* ignore */ }
      }
    }
  }, [guestCandidateId, physics, ready, selfId, voicePeers, getPeerPresence]);

  // Pose pass: each presence packet moves only its own peer's body,
  // outside React. Peers not on the roster yet are added by the pass above.
  useEffect(() => {
    if (!ready) return;
    const applied = appliedPresenceTsRef.current;
    return onPeerPresence((p) => {
      const id = `peer-${p.peerId}`;
      const existing = physics.getBody(id);
      if (!existing) return;
      const meta = existing.meta ?? {};
      syncRemotePeerBody(physics, applied, {
        peerId: p.peerId,
        username: typeof meta.username === 'string' ? meta.username : (p.username ?? p.peerId.slice(0, 8)),
        avatarId: typeof meta.avatarId === 'string' ? meta.avatarId : p.avatarId,
        position: p.position,
        local: p.local,
        presenceTs: p.ts,
        boat: p.boat,
      }, getEarthPose(), getFleet());
    });
  }, [physics, ready, onPeerPresence]);

  // ── Broadcast our world-space position to the room ────────────────
  // Throttled to 1.5 s. Phase 4A — we send the *solved* body position
  // straight from physics. We no longer overwrite body.pos with a
  // shell-projected copy; that re-projection was the exact "sideways
  // pressure across the ground" the user reported.
  useEffect(() => {
    if (!ready || !selfId) return;
    const fleet = getFleet();
    // Boats are keyed by mesh peer id, the id other players see us by.
    fleet.setSelfPeer(() => getLocalMeshPeerId() ?? selfId);
    let lastLocal: [number, number, number] | null = null;
    let lastAt = 0;
    let hadBoat = false;
    const tick = () => {
      const body = physics.getBody(selfId);
      if (!body) return;
      const world: [number, number, number] = [body.pos[0], body.pos[1], body.pos[2]];
      const now = Date.now();
      const boat = fleet.presenceFor(world);
      // Boats go out at 3 Hz while moving, crewed, rowing or stood on;
      // 1 Hz for an owned boat at anchor. Walking stays at 1.5 s.
      const mine = fleet.mine();
      const busy = !!boat && (!!boat.d || !!boat.r || (mine ? Math.hypot(...mine.vessel.motion.vel) > 0.05 : false));
      const period = busy ? 333 : boat ? 1000 : 1500;
      if (now - lastAt < period - 5) return;
      // Measured on the ground (Earth-local), not in world space: Earth's
      // own motion no longer counts as walking. Idle players still refresh
      // every ~6 s so late joiners and dropped packets catch up. A boat
      // going away is always sent, so it disappears for the room too.
      const { position, local } = encodeSelfPosition(world, getEarthPose());
      const moved = !lastLocal || localDistance(local, lastLocal) >= 0.05;
      if (!moved && !boat && !hadBoat && now - lastAt < 6000) return;
      lastLocal = local;
      lastAt = now;
      hadBoat = !!boat;
      broadcastSelfPosition(position, local, boat);
    };
    // Send once immediately so peers learn our spawn point right away.
    tick();
    const id = window.setInterval(tick, 333);
    return () => window.clearInterval(id);
  }, [ready, selfId, physics, broadcastSelfPosition]);

  // ── Subscribe to remote chat lines ────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    armChatChirpAudio();
    const eng = getSharedFieldEngine();
    const unsub = onChatLine((remote) => {
      if (remote.infinityReplyTo) {
        const delivery = roomConsent.receive({ ...remote }, infinityChatModeRef.current);
        if (delivery.ask) setInfinitySyncRequested(true);
        if (delivery.visible.length) {
          setChatLines((prev) => [...prev, ...delivery.visible].slice(-100));
          if (canInfinitySpeak(infinityChatModeRef.current, voiceEnabledRef.current)) speakInfinity(remote.text);
        }
        return; // No second generation or learning from the broadcast reply.
      }
      chirpForRemoteLine(remote);
      setChatLines((prev) => {
        if (prev.some((l) => l.id === remote.id)) return prev;
        const line: BrainChatLine = {
          id: remote.id,
          author: remote.author,
          text: remote.text,
          ts: remote.ts,
          authorId: remote.authorId,
          peerId: remote.peerId,
        };
        return [...prev, line].slice(-100);
      });
      // Shy authors (and lines from older clients) are never learned.
      const learnable = remote.infinityLearn === true;
      if (learnable) enqueueMemory({ id: `chat:${remote.id}`, kind: 'chat', text: remote.text, author: remote.authorId || remote.peerId || remote.author || remote.id, learned: true, consented: true });
      // Record the remote turn into the conversation ring + apply attraction.
      try {
        const cur = recordTurn(eng, remote.author || remote.id, remote.text, remote.ts);
        const prev = getPrevTurn(cur.speakerId, remote.ts);
        if (prev) attractToPrev(eng, cur, prev, remote.ts);
      } catch { /* attraction is best-effort */ }
      // Feed the partner's text into the learner so Infinity can echo /
      // bridge their actual words on the next turn (A↔B learning).
      if (learnable) try {
        const fusion = getSharedNeuralEngine().getDualLearning();
        fusion.ingestContentEvent({ text: remote.text, reactions: 0, comments: 1, shares: 0, trustScore: 90, peerId: remote.peerId || remote.author || remote.id, timestamp: remote.ts });
      } catch { /* learner optional */ }
    });
    return () => unsub();
  }, [ready, onChatLine, roomConsent]);

  // ── Pub events (drinks) drop a line into Brain chat ───────────────
  useEffect(() => {
    const onPubLine = (e: Event) => {
      const d = (e as CustomEvent).detail as BrainChatLine | undefined;
      if (!d?.text) return;
      setChatLines((prev) => (prev.some((l) => l.id === d.id) ? prev : [...prev, d].slice(-100)));
    };
    window.addEventListener('pub:chat-line', onPubLine);
    // Infinity's own unprompted lines, sent from this device by the agent.
    window.addEventListener('infinity:chat-line', onPubLine);
    return () => {
      window.removeEventListener('pub:chat-line', onPubLine);
      window.removeEventListener('infinity:chat-line', onPubLine);
    };
  }, []);

  // ── Chat send: feed field, optionally call Infinity ───────────────
  const handleSend = useCallback((text: string) => {
    if (shouldOfferGuestConnection(isGuestUser(user), meshStats.connectedPeers, guestConnectionOfferedRef.current, voicePeers.length + chatPeers.length)) {
      guestConnectionOfferedRef.current = true;
      setGuestConnectionOffered(true);
    }
    const line: BrainChatLine = {
      id: crypto.randomUUID(),
      author: user ? brainDisplayName(user) : 'You',
      text, ts: causalNow(),
      authorId: user?.id,
      avatarRef: user?.profile?.avatarRef,
    };
    setChatLines((prev) => [...prev, line].slice(-100));
    const selfLearn = selfLearnable();
    if (selfLearn) enqueueMemory({ id: `chat:${line.id}`, kind: 'chat', text, author: user?.id || selfId, learned: true, consented: true });
    // Broadcast to every other peer in the brain room.
    try { sendChatLine(text, line.id); } catch { /* ignore */ }

    // Inject into the brain field at the speaker's position
    const self = physics.getBody(selfId);
    if (self) physics.injectAt(self.pos, 0.4, 0);

    // ── Conversation attraction: tie this turn to the previous speaker ──
    const eng = getSharedFieldEngine();
    eng.inject(text, { amplitude: 0.4 });
    const cur = recordTurn(eng, selfId, text, line.ts);
    const prev = getPrevTurn(selfId, line.ts);
    let bridgeMeta: { dq: number; bridgeSite: number } | null = null;
    if (prev) {
      try { bridgeMeta = attractToPrev(eng, cur, prev, line.ts); } catch { /* ignore */ }
    }
    // NOTE: language-learner ingestion of this turn is DEFERRED until after
    // Infinity's reply is generated below. Ingesting before sampling would
    // memorize the user's exact bigrams and the very next sample step would
    // replay them — the prompt-echo bug. We ingest after the reply collapses.

    const trimmed = text.trim();
    const isPublicLobby = capabilities.infinityAlwaysReplies;
    const callsInfinity =
      isPublicLobby ||
      /infinity|imagination|orb|brain/i.test(text) ||
      /^@(infinity|imagination)\b/i.test(trimmed) ||
      trimmed.endsWith('?');
    if (canInfinityReply(infinityChatModeRef.current) && callsInfinity) {
      const replyEpoch = infinityReplyEpochRef.current;
      // The scene owns consent and delivery only. Personality and Dual
      // learning share one realization path with post/comment replies.
      let picked = '';
      try {
        picked = getEntityVoice().generateText(text, getSharedNeuralEngine()) ?? '';
      } catch { /* silence on unavailable learning */ }
      // Silence beats filler: nothing learned to say, no reply.
      const tag = bridgeMeta
        ? `[Δq=${bridgeMeta.dq >= 0 ? '+' : ''}${bridgeMeta.dq.toFixed(3)} · q=${eng.getQScore().toFixed(2)} · ↔@s${bridgeMeta.bridgeSite}] `
        : `[q=${eng.getQScore().toFixed(2)}] `;
      const pick = `${tag}${picked}`;
      if (picked) setTimeout(() => {
        if (replyEpoch !== infinityReplyEpochRef.current || !canInfinityReply(infinityChatModeRef.current)) return;
        const reply: BrainChatLine = {
          id: `infinity:${line.id}`,
          author: ENTITY_DISPLAY_NAME,
          authorId: ENTITY_USER_ID,
          infinityReplyTo: line.id,
          text: pick, ts: networkNow(),
        };
        setChatLines((prev) => [...prev, reply].slice(-100));
        // The originating opted-in client generates; peers only consume it.
        sendChatLine(pick, reply.id, line.id);
        // Speech is fire-and-forget and fully decoupled from text emission.
        // Read the latest mute state via ref so toggling never rebuilds this
        // handler or affects the text reply that already rendered above.
        try { if (canInfinitySpeak(infinityChatModeRef.current, voiceEnabledRef.current)) speakInfinity(pick); } catch { /* ignore */ }
        // Infinity's reply also perturbs the field at the orb
        physics.injectAt([0, 0, 0], 0.5, 1);
      }, 600 + Math.random() * 800);
    }

    // ── Deferred ingestion ────────────────────────────────────────────
    // Now that the reply has been queued (or skipped), feed the user's
    // turn into the learner so future replies can build on it — without
    // contaminating the sample step that just ran.
    if (selfLearn) try {
      const fusion = getSharedNeuralEngine().getDualLearning();
      fusion.ingestContentEvent({ text, reactions: 0, comments: 1, shares: 0, trustScore: 95, peerId: selfId, timestamp: line.ts });
    } catch { /* learner optional */ }
  }, [physics, roomId, selfId, capabilities.infinityAlwaysReplies, sendChatLine, user, meshStats.connectedPeers, voicePeers.length, chatPeers.length]);

  // ── Drop a portal at the player's current position ────────────────
  // If `hitPoint` is provided (raycast cast from AssetCaster), the portal
  // is planted exactly at that world-space point on the planet. Otherwise
  // it falls back to the legacy "2.5 m in front of the camera" behavior
  // so existing keyboard/joystick flows still work.
  const handleDropPortal = useCallback((projectId: string, projectName: string, hitPoint?: [number, number, number]) => {
    const self = physics.getBody(selfId);
    if (!self) return;
    // One per project: if a portal for this project already exists, remove
    // the old body + entry so the new drop replaces it in place.
    const existing = portals.find((p) => p.projectId === projectId);
    if (existing) {
      try { physics.removeBody(`portal-${existing.id}`); } catch { /* noop */ }
    }
    // Resolve the drop target. Raycast cast wins; otherwise place the
    // portal 2.5 m in front of the player along the camera's forward.
    const livePose = getEarthPose();
    let ahead: [number, number, number];
    if (hitPoint) {
      ahead = [hitPoint[0], hitPoint[1], hitPoint[2]];
    } else {
      const intent = physics.getIntent?.(selfId);
      ahead = [self.pos[0], self.pos[1], self.pos[2]];
      const FORWARD_DIST = 2.5;
      if (intent?.basis) {
        const { forward: fwdAxis, right: rightAxis } = intent.basis;
        const cy = Math.cos(intent.yaw), sy = Math.sin(intent.yaw);
        const fx = cy * fwdAxis[0] - sy * rightAxis[0];
        const fy = cy * fwdAxis[1] - sy * rightAxis[1];
        const fz = cy * fwdAxis[2] - sy * rightAxis[2];
        ahead[0] += fx * FORWARD_DIST;
        ahead[1] += fy * FORWARD_DIST;
        ahead[2] += fz * FORWARD_DIST;
      } else {
        const ang = Math.atan2(self.pos[2] - livePose.center[2], self.pos[0] - livePose.center[0]);
        ahead[0] += Math.cos(ang) * FORWARD_DIST;
        ahead[2] += Math.sin(ang) * FORWARD_DIST;
      }
    }
    // Snap radially to EARTH_RADIUS + 0.05 m (door base sits on the ground;
    // the door geometry itself is ~2 m tall above this point).
    const rx = ahead[0] - livePose.center[0];
    const ry = ahead[1] - livePose.center[1];
    const rz = ahead[2] - livePose.center[2];
    const r = Math.hypot(rx, ry, rz) || 1;
    const surfaceR = EARTH_RADIUS + 0.05;
    const dropPos: [number, number, number] = [
      livePose.center[0] + (rx / r) * surfaceR,
      livePose.center[1] + (ry / r) * surfaceR,
      livePose.center[2] + (rz / r) * surfaceR,
    ];
    // Earth-local coords so the portal travels with the spinning planet.
    const localPosVec = quatRotate(livePose.invSpinQuat, [
      dropPos[0] - livePose.center[0],
      dropPos[1] - livePose.center[1],
      dropPos[2] - livePose.center[2],
    ]);
    const localPos: [number, number, number] = [localPosVec[0], localPosVec[1], localPosVec[2]];
    const portal: BrainPortal = {
      id: crypto.randomUUID(),
      ownerId: selfId,
      projectId, projectName,
      pos: dropPos,
      localPos,
      placedAt: Date.now(),
    };
    physics.addBody({
      id: `portal-${portal.id}`, kind: 'portal',
      pos: portal.pos, vel: [0, 0, 0],
      mass: 0, trust: 0,
      meta: { projectId, projectName },
    });
    physics.pinPortal(portal.pos);
    setPortals((prev) => {
      const filtered = prev.filter((p) => p.projectId !== projectId);
      const next = [...filtered, portal];
      savePortals(next, universeKey);
      return next;
    });
  }, [physics, selfId, universeKey, portals]);

  const handleDeletePortal = useCallback((projectId: string) => {
    const existing = portals.find((p) => p.projectId === projectId);
    if (!existing) return;
    try { physics.removeBody(`portal-${existing.id}`); } catch { /* noop */ }
    setPortals((prev) => {
      const next = prev.filter((p) => p.projectId !== projectId);
      savePortals(next, universeKey);
      return next;
    });
  }, [physics, portals, universeKey]);

  const handlePortalEnter = useCallback((bodyId: string) => {
    const id = bodyId.replace(/^portal-/, '');
    const portal = portals.find((p) => p.id === id);
    if (!portal) return;
    navigate(`/projects/${portal.projectId}/hub`);
  }, [navigate, portals]);

  // ── Begin a portal cast: arm the in-Canvas AssetCaster surface so the
  // next click on the planet drops the portal at the actual hit point.
  // Falls back gracefully if the user dismisses casting.
  const handleBeginPortalCast = useCallback((projectId: string, projectName: string) => {
    toast(`Tap the planet to drop "${projectName}" portal.`);
    setPendingCast({
      kind: 'portal',
      label: `Drop portal: ${projectName}`,
      payload: { projectId, projectName },
      ghost: { kind: 'ring', color: '#a78bfa' },
      hitPoint: null,
      onConfirm: (hit) => {
        handleDropPortal(projectId, projectName, hit);
      },
    });
  }, [handleDropPortal]);

  const handleDeleteWorldPlacement = useCallback(async (record: PlacementRecord) => {
    if (!ownsPlacement(record, selfId)) return;
    const perm = canBuildAtWorldPoint(record.hitPoint, selfId);
    if (!perm.ok) {
      toast.error(perm.reason ?? 'You cannot alter buildings here.');
      return;
    }
    await removeLocalPlacement(record.placementId);
    if (builder.selectedBlockId === record.placementId) builder.selectBlock(null);
    if (editingPlacementRef.current?.placementId === record.placementId) editingPlacementRef.current = null;
  }, [builder, selfId]);

  const handleEditWorldPlacement = useCallback((record: PlacementRecord) => {
    if (!ownsPlacement(record, selfId)) return;
    const prefab = getPrefab(record.prefabId);
    if (!prefab) return;
    const entryPerm = canBuildAtWorldPoint(record.hitPoint, selfId);
    if (!entryPerm.ok) {
      toast.error(entryPerm.reason ?? 'You cannot alter buildings here.');
      return;
    }
    setDecorateTarget(null);
    decoratingPlacementRef.current = null;
    editingPlacementRef.current = record;
    builder.selectBlock(record.placementId);
    builder.selectPrefab(null);
    setPendingCast({
      kind: 'prefab',
      label: `Adjust ${prefab.label}`,
      payload: { prefabId: record.prefabId, placementId: record.placementId },
      ghost: {
        kind: 'box',
        w: prefab.width,
        h: prefab.height,
        d: prefab.depth,
        color: prefab.color,
      },
      hitPoint: record.hitPoint,
      yaw: record.yaw,
      upOffset: record.upOffset ?? 0,
      onConfirm: async (hit, yaw, _payload, upOffset) => {
        // Land gate — one shared permission check for every mutation.
        {
          const perm = canBuildAtWorldPoint(hit, selfId);
          if (!perm.ok) {
            toast.error(perm.reason ?? 'You cannot build here.');
            return;
          }
        }
        const updated = {
          ...record,
          hitPoint: hit,
          yaw,
          upOffset: upOffset ?? record.upOffset ?? 0,
        };
        const saved = await updateLocalPlacement(updated);
        if (!saved) return;
        editingPlacementRef.current = null;
        decoratingPlacementRef.current = null;
        builder.selectBlock(record.placementId);
      },
      onCancel: () => {
        editingPlacementRef.current = null;
        decoratingPlacementRef.current = null;
        builder.selectBlock(record.placementId);
      },
    });
  }, [builder, selfId]);

  // Decorate: open the in-world post composer for a placed wall. The
  // composer pins the new post to the wall + routes it to the project /
  // Explore feed via the standard PostComposer pipeline.
  const [decorateTarget, setDecorateTarget] = useState<PlacementRecord | null>(null);
  const handleDecorateWorldPlacement = useCallback((record: PlacementRecord) => {
    if (!ownsPlacement(record, selfId)) return;
    const perm = canBuildAtWorldPoint(record.hitPoint, selfId);
    if (!perm.ok) {
      toast.error(perm.reason ?? 'You cannot decorate on this land.');
      return;
    }
    editingPlacementRef.current = null;
    decoratingPlacementRef.current = record;
    builder.selectBlock(record.placementId);
    setDecorateTarget(record);
  }, [builder, selfId]);

  // Clear any pending cast when the scene unmounts so stale cast state
  // doesn't leak across navigations.
  useEffect(() => () => clearPendingCast(), []);

  // ── Prefab placement: when the builder selects a prefab, arm a
  // placement session so the in-Canvas AssetCaster spawns a draggable
  // ghost. Confirm commits via placePrefabAtHit + recordLocalPlacement;
  // Cancel clears the selection.
  useEffect(() => {
    const id = builder.selectedPrefabId;
    if (!id || !selfId) {
      if (!editingPlacementRef.current) {
        const cur = getPendingCast();
        if (cur?.kind === 'prefab') clearPendingCast();
      }
      return;
    }
    const prefab = getPrefab(id);
    if (!prefab) return;
    setPendingCast({
      kind: 'prefab',
      label: `Place ${prefab.label}`,
      payload: { prefabId: id },
      ghost: {
        kind: 'box',
        w: prefab.width,
        h: prefab.height,
        d: prefab.depth,
        color: prefab.color,
      },
      hitPoint: null,
      // The ghost rides in front of the avatar until it is placed.
      follow: true,
      onConfirm: async (hit, yaw, _payload, upOffset) => {
        // Land gate — one shared permission check for every mutation.
        {
          const perm = canBuildAtWorldPoint(hit, selfId);
          if (!perm.ok) {
            toast.error(perm.reason ?? 'You cannot build here.');
            return;
          }
        }
        // Placing does not raise the piece — it stages a private ghost the
        // owner then builds by press-and-hold. Materials are spent, and
        // the lattice written, only at the end of that hold.
        const pose = getEarthPose();
        const dx = hit[0] - pose.center[0];
        const dy = hit[1] - pose.center[1];
        const dz = hit[2] - pose.center[2];
        const r = Math.hypot(dx, dy, dz) || 1;
        const localDir = quatRotate(pose.invSpinQuat, [dx / r, dy / r, dz / r]);
        stagePendingBuild({
          ownerId: selfId,
          universeKey,
          prefabId: id,
          localDir,
          yaw,
          upOffset: upOffset ?? 0,
        });
        toast(`${prefab.label} ready — walk over and hold to build.`);
        builder.selectPrefab(null);
        // The item is down — drop out of Builder Mode so the grid goes
        // with the ghost instead of lingering over the world.
        builder.exitBuild();
      },
      onCancel: () => {
        // Avoid recursive clear when Cancel was triggered by deselect.
        if (builder.selectedPrefabId === id) builder.selectPrefab(null);
      },
    });
  }, [builder.selectedPrefabId, selfId, universeKey, builder.selectPrefab, builder.selectBlock, builder.exitBuild]);

  // Spawn Coherence: shared boot transform (position + orientation) used by
  // the Canvas camera so the first painted frame already matches the live
  // Earth surface frame and the PhysicsCameraRig takeover is seamless.
  const initialBootTransform = useMemo(() => {
    try {
      return getEarthSpawnTransform(guestCandidateId, getEarthPose());
    } catch {
      return null;
    }
  }, [guestCandidateId]);
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    if (initialBootTransform) return initialBootTransform.eyePos;
    return [EARTH_POSITION[0], EARTH_POSITION[1] + EARTH_RADIUS + HUMAN_HEIGHT, EARTH_POSITION[2]];
  }, [initialBootTransform]);
  const handleCanvasCreated = useCallback(
    ({ camera }: { camera: THREE.Camera }) => {
      if (!initialBootTransform) return;
      const { up, forward, right } = initialBootTransform;
      // Build the same surface-frame basis the rig uses on tick 1 so
      // there is no visible quaternion/up snap between frame 0 and 1.
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(right[0], right[1], right[2]),
        new THREE.Vector3(up[0], up[1], up[2]),
        new THREE.Vector3(-forward[0], -forward[1], -forward[2]),
      );
      camera.quaternion.setFromRotationMatrix(m);
      camera.up.set(up[0], up[1], up[2]);
      camera.updateMatrixWorld();
    },
    [initialBootTransform],
  );

  return (
    <div className="fixed inset-0 bg-black">
      {/* Entry gate — avatar + mic test */}
      <BrainEntryModal
        open={entryOpen}
        onOpenChange={(o) => {
          setEntryOpen(o);
          if (!o && !ready) navigate(-1);
        }}
        onConfirm={() => { setReady(true); setEntryOpen(false); }}
      />

      {/* Remote voice <audio> is rendered globally by <PersistentAudioLayer/> mounted in App.tsx. */}

      {/* HUD top bar */}
      <div className="absolute left-0 right-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 p-2 sm:p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => (onLeave ? onLeave() : navigate(-1))}
          className="bg-[hsla(265,70%,8%,0.7)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> {leaveLabel}
        </Button>
        <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleScreenShare}
            className={
              screenStream
                ? 'bg-[hsla(185,80%,14%,0.75)] text-cyan-300 ring-1 ring-cyan-400/50'
                : 'bg-[hsla(265,70%,8%,0.7)]'
            }
            aria-label={screenStream ? 'Stop sharing screen' : 'Share your screen'}
            title={screenStream ? 'Stop sharing screen' : 'Share your screen'}
          >
            {screenStream ? <MonitorOff className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleCamera}
            className="bg-[hsla(265,70%,8%,0.7)]"
            aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          >
            {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onMicButton}
            className={
              !micOn || isMuted
                ? 'bg-[hsla(0,70%,18%,0.7)] text-destructive ring-1 ring-destructive/40'
                : 'bg-[hsla(265,70%,8%,0.7)]'
            }
            aria-label={!micOn ? 'Turn on microphone' : isMuted ? 'Unmute microphone' : 'Mute microphone'}
            title={!micOn ? 'Mic off (listening only). Tap to turn on' : isMuted ? 'Self mic muted' : 'Mute self mic'}
          >
            {!micOn || isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          {infinityChatMode === 'audio' && <Button
            type="button"
            variant={voiceEnabled ? 'outline' : 'secondary'}
            size="sm"
            onClick={toggleInfinityVoice}
            className={
              voiceEnabled
                ? 'bg-[hsla(265,70%,8%,0.7)] ring-1 ring-[hsla(180,80%,60%,0.4)]'
                : 'bg-[hsla(38,80%,16%,0.85)] text-amber-400 ring-1 ring-amber-500/40'
            }
            aria-label={voiceEnabled ? 'Mute Infinity voice' : 'Unmute Infinity voice'}
            title={voiceEnabled ? "Silence Infinity" : "Infinity silenced"}
          >
            {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setChatOpen((v) => !v)}
            className="bg-[hsla(265,70%,8%,0.7)]"
            aria-label="Toggle chat"
          >
            <MessageSquare className="h-4 w-4" />
            <span className="ml-1 hidden sm:inline">Chat</span>
          </Button>
          <BuilderActivator
            mode={builder.mode}
            onToggle={() => {
              // One tap in, one tap out — panel state follows the mode
              // instead of flipping independently of it.
              const entering = builder.mode !== 'build';
              builder.toggleMode();
              setInventoryOpen(entering);
            }}
          />
          <button
            type="button"
            onClick={() => toggleShoulderView()}
            aria-label={cameraView === 'first' ? 'Switch to over-the-shoulder view' : 'Switch to close-up view'}
            title="View (V)"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-[hsla(265,70%,8%,0.6)] text-foreground/80 transition-colors hover:text-foreground"
          >
            {cameraView === 'first' ? <User className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          {capabilities.portals && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPortalModalOpen(true)}
              className="bg-[hsla(265,70%,8%,0.7)]"
              aria-label="Drop a portal"
            >
              <Compass className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Portal</span>
            </Button>
          )}
          {/* Boat readings share the compact Brain display, never a separate panel. */}
          <div className="flex w-full justify-end">
            <div className="pointer-events-none max-w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-accent/25 bg-background/70 px-2 py-1 text-[9px] leading-3 font-mono tracking-normal text-foreground/80 [&_span]:tracking-normal">
              <div className="flex flex-wrap justify-end gap-x-1">
                <BrainStatusReadout title={title} selfId={selfId} voiceCount={voicePeers.length + 1} compact />
              </div>
              <div ref={setBoatReadoutTarget} className={crewRole ? 'mt-0.5' : 'hidden'} />
            </div>
          </div>
        </div>
      </div>

      {/* 3-D scene */}
      {ready && <Canvas
        // The world keeps running behind a full-size screen share. Pausing
        // and resuming it on every open and close stalled the browser.
        dpr={canvasDpr}
        camera={{ position: initialCameraPosition, fov: 60, near: 0.1, far: 50000 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={handleCanvasCreated}
      >
        {/* Anything in the 3D scene that waits on a download must wait
            here, inside the Canvas. Without this boundary the Canvas hands
            the wait to the page around it, and every timed HUD update (the
            "hold to sit at cards" prompt, chat lines, the altitude readout)
            is held back until the next click, such as toggling Builder Mode. */}
        <Suspense fallback={null}>
        {/* Deep space background — dark navy, not pure black, so silhouettes read */}
        <color attach="background" args={['#05060f']} />
        {/* Long, soft fog so distant galaxy fades but nearby ground reads crisp */}
        <fog attach="fog" args={['#05060f', 80, WORLD_SIZE * 1.5]} />
        <WorldBackdrop selfId={selfId} />
        <UserPlacementsLayer
          selfId={selfId}
          selectedPlacementId={builder.selectedBlockId}
          onSelectPlacement={(placementId) => builder.selectBlock(placementId)}
          onEditPlacement={handleEditWorldPlacement}
          onDeletePlacement={handleDeleteWorldPlacement}
          onDecoratePlacement={handleDecorateWorldPlacement}
          suppressActionChip={!!decorateTarget || !!editingPlacementRef.current}
        />
        {/* Landmarks + apartment use a *shared* anchor seed so every
            viewer sees them at the same world-space spot on Earth.
            Anchoring to `selfId` made each peer render their own private
            village on their own hemisphere — from a remote viewer's frame
            that village then sat on the far side of the planet, sinking
            into the ground or floating in the sky. One shared seed = one
            shared village everyone meets at. */}
        {/* Decorative landmark pillars + legacy SurfaceApartment retired —
            both were presentation-only reference props with no wet-work /
            field backing. Wet-work IS the world: the WetWorkHabitat
            (trunk + roots + ribs + chambers) is now the sole surface
            structure. */}
        {/* Walkable bar prefab — replaces the WetWorkHabitat "town". Four
            walls + roof + open south doorway. Each wall segment is a real
            BuilderBlock with a curvature basin, so the avatar collides
            via 𝒞_collide(u) instead of phasing through decorative mesh. */}
        <VillageProps selfId={selfId} />
        {isBuilding && (
          <BuildGridOverlay
            selfId={selfId}
            fallbackAnchorPeerId={WORLD_GRID_ORIGIN_ANCHOR}
          />
        )}
        {selfId && <LandPlotsOverlay selfId={selfId} emphasized={isBuilding} />}
        {isPlotting && selfId && !builder.pendingPlot && (
          <PlotSurveyOverlay
            selfId={selfId}
            ownerId={selfId}
            onClose={handlePlotSurveyClose}
            onProgress={handlePlotSurveyProgress}
          />
        )}
        {/* Building Blocks Engine test piece — simple UQRC tree beside the apartment. */}
        <VillageLife />
        <InfinityBody position={getInfinityPosition()} />
        <InfinityBindingTicker />
        <EarthPoseTicker />

        {portals.map((p) => (
          <PortalDefect
            key={p.id}
            localPos={p.localPos}
            worldPos={p.localPos ? undefined : p.pos}
            label={p.projectName}
          />
        ))}

        <PhysicsCameraRig selfId={selfId} fallbackId={guestCandidateId} />
        {selfId && <BodyLayer selfId={selfId} onPortalEnter={handlePortalEnter} portals={portals} />}
        {selfId && <RemoteAvatarLayer peers={visibleVoicePeers} />}
        <AvatarShaderWarmup />
        {selfId && <SelfAvatarBody selfId={selfId} username={user ? brainDisplayName(user) : 'You'} />}
        </Suspense>
        <RenderGovernorProbe />
      </Canvas>}

      {/* Video grid — pops down beneath the camera button */}
      {ready && (
        <BrainVideoGrid
          participants={visibleRtcParticipants}
          localStream={localStream}
          localUsername={user?.username ?? 'You'}
          localMuted={isMuted}
          cameraOn={cameraOn}
          localScreenStream={screenStream}
          nameByPeerId={voiceNameByPeerId}
        />
      )}

      {/* Desktop look + move controls (no pointer lock).
          While plotting, re-enable joystick + look so the user can walk. */}
      {ready && !isMobile && (
        <>
          {/* Look-drag and movement stay live in Builder Mode — the ghost
              rides in front of you while you walk it into place. */}
          <DesktopLookOverlay />
          {!builder.pendingPlot && <DesktopJoystick />}
        </>
      )}

      {/* Mobile controls */}
      {isMobile && (
        <>
          {/* Only a pointer-positioned ghost needs the look layer inert; a
              following ghost tracks the avatar, so looking stays free. */}
          <TouchLookOverlay inert={scenePlacementArmed && !pendingCast?.follow} />
          {!builder.pendingPlot && <MobileJoystick />}
        </>
      )}

      {/* Chat panel */}
      {chatOpen && (
        <BrainChatPanel
          lines={visibleChatLines}
          onSend={handleSend}
          onClose={() => setChatOpen(false)}
          voicePeers={voicePeers}
          rtcParticipants={rtcParticipants}
          chatPeers={chatPeers}
          voiceOn={!isMuted}
          roomId={roomId}
          variantCapabilities={capabilities}
          variant="floating"
          infinityVoiceEnabled={voiceEnabled}
          onToggleInfinityVoice={toggleInfinityVoice}
          infinityChatMode={infinityChatMode}
          onInfinityChatModeChange={changeInfinityChatMode}
          infinitySyncRequested={infinitySyncRequested}
          onInfinitySyncChoice={chooseInfinitySync}
          guestConnectionOffered={guestConnectionOffered && meshStats.connectedPeers === 0 && voicePeers.length === 0 && chatPeers.length === 0}
        />
      )}

      {/* Portal placement modal */}
      <DropPortalModal
        open={portalModalOpen}
        onClose={() => setPortalModalOpen(false)}
        onConfirm={handleBeginPortalCast}
        existingPortalsByProject={new Map(portals.map((p) => [p.projectId, p.id]))}
        onDeletePortal={handleDeletePortal}
      />

      {/* In-world wall post composer */}
      {decorateTarget && (
        <WallDecorateComposer
          placementId={decorateTarget.placementId}
          projectId={projectId}
          wallLabel={getPrefab(decorateTarget.prefabId)?.label}
          onDecorated={() => builder.selectBlock(null)}
          onClose={() => {
            decoratingPlacementRef.current = null;
            setDecorateTarget(null);
          }}
        />
      )}

      {/* Cast-armed HUD pill — selection first, click/tap drop second,
          confirm only after a real positioned ghost exists. */}
      {castArmed && pendingCast?.kind !== 'prefab' && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-3">
          <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-2xl border-2 border-primary/60 bg-[hsla(265,70%,8%,0.92)] px-4 py-3 text-sm text-foreground shadow-[0_0_24px_hsla(265,70%,55%,0.45)]">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
              <span className="truncate max-w-[70vw] font-medium">
                {pendingCast?.isPositioned
                  ? (pendingCast?.label ?? 'Rotate, then Confirm')
                  : 'Click the grid to drop placement'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => clearPendingCast()}
                className="rounded-full border border-foreground/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-foreground/80 hover:bg-foreground/10"
              >
                Cancel
              </button>
              {pendingCast?.isPositioned && (
                <button
                  type="button"
                  onClick={() => confirmCast()}
                  className="rounded-full border border-primary/60 bg-primary px-5 py-2 text-xs font-bold uppercase tracking-wide text-primary-foreground shadow-lg hover:bg-primary/90"
                >
                  Confirm
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Walk-and-place strip — a prefab ghost rides in front of you while
          you move; turn it and drop it without stopping. Small on purpose. */}
      {castArmed && pendingCast?.kind === 'prefab' && pendingCast?.follow && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-40 -translate-x-1/2 px-3">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-primary/50 bg-[hsla(265,70%,8%,0.85)] px-1.5 py-1 text-xs text-foreground shadow-md backdrop-blur">
            <button
              type="button"
              onClick={() => rotateCast(-Math.PI / 12)}
              aria-label="Rotate left"
              className="h-7 w-7 rounded-full hover:bg-foreground/10"
            >
              ⟲
            </button>
            <button
              type="button"
              onClick={() => rotateCast(Math.PI / 12)}
              aria-label="Rotate right"
              className="h-7 w-7 rounded-full hover:bg-foreground/10"
            >
              ⟳
            </button>
            <button
              type="button"
              onClick={() => confirmCast()}
              className="h-7 rounded-full bg-primary px-3 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Place
            </button>
            <button
              type="button"
              onClick={() => clearPendingCast()}
              aria-label="Cancel placement"
              className="h-7 w-7 rounded-full text-rose-300 hover:bg-foreground/10"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Pub games — walk up to the dartboard, press E, play or watch. */}
      {ready && selfId && !isBuilding && (
        <PubGameLayer selfId={selfId} username={user ? brainDisplayName(user) : 'Player'} mobile={isMobile} />
      )}

      {/* Compass + Mini-Map (always available once spawned) */}
      {ready && selfId && !isBuilding && (
        <>
          <CompassHUD selfId={selfId} atWheel={!!crewRole} onOpenMap={() => setMapOpen((v) => !v)} />
          {mapOpen && <MiniMapHUD selfId={selfId} onClose={() => setMapOpen(false)} />}
          {/* Run / Flash pill — taps trigger sprint, also reflects Shift / RT. */}
          {!crewRole && <RunPill
            mobile={isMobile}
            onPress={() => { tryStartRun(performance.now()); forceRunRender((n) => (n + 1) & 0xfff); }}
          />}
          {/* Jump (Space) and the boat's hold-to-board / climb-aboard ring. */}
          {!crewRole && <JumpButton selfId={selfId} mobile={isMobile} />}
          <BoatHoldButton selfId={selfId} mobile={isMobile} />
          {!crewRole && <TradingStandPrompt selfId={selfId} mobile={isMobile} />}
          <ShipControls mobile={isMobile} readoutTarget={boatReadoutTarget} />
        </>
      )}

      {/* Plot survey / confirm strip only — all other builder controls now
          live in the Options tab of the inventory panel, so no bottom bar
          sits over the world during normal building. */}
      {ready && isBuilding && (builder.plotting || builder.pendingPlot) && (
        <BrainBuilderBar
          builder={builder}
          projectId={projectId ?? null}
          onConfirmPlot={handleConfirmPlot}
          swarmBalance={swarmBalance}
          selfId={selfId || undefined}
          hideCatalog
        />
      )}

      {/* Inventory panel — the place you choose what to make */}
      {ready && (
        <BuilderInventory
          open={inventoryOpen}
          builder={builder}
          selfId={selfId || undefined}
          projectId={projectId ?? null}
          projectName={projectId ? title : undefined}
          onClose={() => setInventoryOpen(false)}
          onExit={() => {
            // X fully leaves Builder Mode — same as tapping the hammer —
            // so the build grid doesn't linger after the panel closes.
            builder.exitBuild();
            setInventoryOpen(false);
          }}
          onEquipTool={(prefabId) => {
            equipCatalogTool(prefabId, selfId || 'local');
            // Stone hand tools go straight into the hand — nothing is left
            // to place, so the build grid closes with the selection.
            if (isStoneHandTool(prefabId) || prefabId.startsWith('forge:')) builder.exitBuild();
          }}
        />
      )}

      {/* Held tool HUD — bottom-right chip with Use / Drop */}
      {ready && <HeldToolHUD selectedPlacementId={builder.selectedBlockId} selfId={selfId} />}

      {/* Hint */}
      {!chatOpen && !isMobile && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[hsla(265,70%,8%,0.6)] px-4 py-1.5 text-xs text-foreground/60">
          Drag to look · WASD or joystick to move
        </div>
      )}

      {/* UQRC physics debug overlay — read-only, gated by ?debug=physics */}
      <PhysicsDebugOverlay selfId={selfId} />
    </div>
  );
};

export default BrainUniverseScene;
export { BrainUniverseScene };

function PhysicsDebugOverlay({ selfId }: { selfId: string }) {
  const physics = useMemo(() => getBrainPhysics(), []);
  const [enabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === 'physics';
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [enabled]);
  if (!enabled || !selfId) return null;
  const field = physics.getField();
  const body = physics.getBody(selfId);
  const fNorm = commutatorNorm3D(field);
  const sNorm = entropyHessianNorm3D(field);
  const pose = getEarthPose();
  const r = body ? radiusFromEarth(body.pos, pose) : 0;
  const altitude = body ? r - BODY_SHELL_RADIUS : 0;
  const feetRadius = body ? r - BODY_CENTER_HEIGHT : 0;
  const floorRadius = apartmentTrackerState.apartmentRadius;
  const floorVsFeet = floorRadius && feetRadius ? floorRadius - feetRadius : 0;
  const q = physics.getQScore();
  const causal = physics.getLastCausalProbe();
  const inf = getLastInfinitySnapshot();
  const engine = getSharedNeuralEngine();
  let coherenceHealth = 0;
  try {
    const layers = engine.getNetworkSnapshot().instinct?.layers ?? [];
    coherenceHealth = layers.find((l) => l.layer === 'coherence')?.health ?? 0;
  } catch { /* ignore */ }
  const elCounts = countByShell();
  const totalEl = Object.values(elCounts).reduce((s, n) => s + n, 0);
  let stageLabel = '—';
  let creativityHealth = 0;
  try {
    const ev = (window as any).__entityVoice;
    const v = ev ?? null;
    const layers = engine.getNetworkSnapshot().instinct?.layers ?? [];
    creativityHealth = layers.find((l) => l.layer === 'creativity')?.health ?? 0;
    if (v && typeof v.getSnapshot === 'function') {
      const s = v.getSnapshot(engine);
      stageLabel = `${s.brainStage} (${s.stageName})`;
    }
  } catch { /* ignore */ }
  return (
    <div
      key={tick}
      className="absolute bottom-4 left-4 z-30 rounded-md border border-[hsla(180,80%,60%,0.3)] bg-[hsla(265,70%,8%,0.85)] p-3 font-mono text-[11px] text-foreground/80"
    >
      <div className="mb-1 text-[hsl(180,80%,70%)]">|Ψ_Brain⟩ debug</div>
      <div>Q_Score        : {q.toFixed(4)}</div>
      <div>‖F_μν‖         : {fNorm.toFixed(4)}</div>
      <div>‖∇∇S(u)‖       : {sNorm.toFixed(4)}</div>
      <div>λ(ε₀)          : {FIELD3D_LAMBDA.toExponential(0)}</div>
      <div>r from Earth   : {r.toFixed(3)} m</div>
      <div>altitude       : {altitude.toFixed(2)} m</div>
      <div className="mt-1 text-[hsl(180,80%,70%)]">|Ψ_Ground⟩ contract</div>
      <div>visible ground : {VISIBLE_GROUND_RADIUS.toFixed(3)} m</div>
      <div>feet shell     : {FEET_SHELL_RADIUS.toFixed(3)} m</div>
      <div>player feet    : {feetRadius.toFixed(3)} m</div>
      <div>apartment      : {floorRadius ? floorRadius.toFixed(3) : '—'} m (reference, no collision)</div>
      <div>floor − feet   : {floorVsFeet.toFixed(4)} m</div>
      <div className="mt-1 text-[hsl(265,80%,75%)]">|Ψ_Infinity⟩</div>
      <div>Q_Score(∞)     : {inf ? inf.qScore.toFixed(4) : '—'}</div>
      <div>basin depth    : {inf ? inf.basinDepth.toFixed(4) : '—'}</div>
      <div>brain stage    : {stageLabel}</div>
      <div>L9 coherence   : {coherenceHealth.toFixed(3)}</div>
      <div>L8 creativity  : {creativityHealth.toFixed(3)}</div>
      <div>elements pinned: {totalEl} (n0:{elCounts[0] ?? 0} n1:{elCounts[1] ?? 0} n2:{elCounts[2] ?? 0} n3:{elCounts[3] ?? 0} n4+:{elCounts[4] ?? 0})</div>
      <div>ticks          : {field.ticks}</div>
      <div className="mt-1 text-[hsl(180,80%,70%)]">𝒞_light  Sun↔Earth</div>
      <div>c (sim)        : {C_LIGHT.toExponential(3)} m/s</div>
      {causal ? (
        <>
          <div>flat Δt        : {causal.flatDt.toExponential(3)} s</div>
          <div>actual Δt      : {causal.actualDt.toExponential(3)} s</div>
          <div>Δ (delay)      : {causal.delay.toExponential(3)} s</div>
          <div>n_surf         : {causal.surfaceN.toFixed(4)}</div>
          <div>‖∇u‖_surf      : {causal.surfaceGradMag.toExponential(3)}</div>
        </>
      ) : (
        <div>probe          : —</div>
      )}
    </div>
  );
}