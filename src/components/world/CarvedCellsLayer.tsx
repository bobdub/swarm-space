/**
 * CarvedCellsLayer — renders every dug pit on the planet.
 *
 * A pit is drawn as an open shaft: coloured wall bands for each Earth
 * shell the hole has passed through, plus a floor disc tinted with the
 * current shell. That IS the verification of the stratigraphy — the
 * player sees Grass → Soil → Dirt → Mixed Earth as they dig.
 */
import { useEffect, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  DIG_CELL_M,
  listCarvedCells,
  hydrateCarvedCells,
  subscribeCarvedCells,
  type CarvedCell,
} from '@/lib/world/carvedCellsStore';
import { EARTH_SHELLS } from '@/lib/brain/earthShells';
import { EARTH_RADIUS, earthLocalToWorld, getEarthPose, quatRotate } from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { HORIZON_FADE_OUTER } from '@/lib/brain/horizonFade';

const PIT_RADIUS = DIG_CELL_M * 0.45;

/** Element-derived wall tint per shell id. */
export const SHELL_COLORS: Record<string, string> = {
  grass: '#5f9e4a',
  soil: '#7b5a34',
  dirt: '#5d422a',
  mixed_earth: '#6a5847',
  bedrock: '#8b8f99',
  coal: '#2b2b30',
  oil: '#241d16',
  mixed_minerals: '#7e6f8a',
  gold: '#d4a72c',
  platinum: '#cfd6df',
  diamond_upper: '#a8e6ef',
  aquifer: '#3f8fd0',
  obsidian: '#1b1622',
  lava: '#ff5a1f',
};

export function shellColor(shellId: string): string {
  return SHELL_COLORS[shellId] ?? '#6a5847';
}

export function CarvedCellsLayer() {
  const [cells, setCells] = useState<CarvedCell[]>([]);

  useEffect(() => {
    hydrateCarvedCells();
    setCells(listCarvedCells());
    return subscribeCarvedCells(() => setCells(listCarvedCells()));
  }, []);

  if (cells.length === 0) return null;
  return (
    <>
      {cells.map((cell) => <Pit key={cell.cellKey} cell={cell} />)}
    </>
  );
}

function Pit({ cell }: { cell: CarvedCell }) {
  const { camera } = useThree();
  const groupRef = useMemo(() => ({ current: null as THREE.Group | null }), []);
  const [visible, setVisible] = useState(true);

  // Wall bands: one segment per shell crossed by the pit.
  const bands = useMemo(() => {
    const out: { color: string; top: number; bottom: number; label: string }[] = [];
    for (const shell of EARTH_SHELLS) {
      if (shell.side !== 'outer' || shell.n === 0) continue;
      const top = (1 - shell.rOuterFrac) * EARTH_RADIUS;
      const bottom = (1 - shell.rInnerFrac) * EARTH_RADIUS;
      if (bottom <= 0 || top >= cell.depth) continue;
      out.push({
        color: shellColor(shell.id),
        top: Math.max(0, top),
        bottom: Math.min(cell.depth, bottom),
        label: shell.label,
      });
      if (bottom >= cell.depth) break;
    }
    return out;
  }, [cell.depth]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const pose = getEarthPose();
    const lift = sampleSurfaceLift(cell.normal);
    const r = EARTH_RADIUS + lift;
    const world = earthLocalToWorld(
      [cell.normal[0] * r, cell.normal[1] * r, cell.normal[2] * r],
      pose,
    );
    g.position.set(world[0], world[1], world[2]);
    const worldN = quatRotate(pose.spinQuat, cell.normal);
    g.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(worldN[0], worldN[1], worldN[2]).normalize(),
    );
    const dist = camera.position.distanceTo(g.position);
    const shouldShow = dist < HORIZON_FADE_OUTER;
    if (shouldShow !== visible) setVisible(shouldShow);
  });

  return (
    <group ref={(node) => { groupRef.current = node; }} visible={visible}>
      {/* Rim so the hole reads against the ground plane. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[PIT_RADIUS, PIT_RADIUS * 1.22, 20]} />
        <meshStandardMaterial color="#4a3520" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* Stratigraphy wall bands. */}
      {bands.map((band, i) => {
        const h = Math.max(0.05, band.bottom - band.top);
        return (
          <mesh key={`${band.label}-${i}`} position={[0, -(band.top + h / 2), 0]}>
            <cylinderGeometry args={[PIT_RADIUS, PIT_RADIUS, h, 20, 1, true]} />
            <meshStandardMaterial color={band.color} roughness={0.95} side={THREE.BackSide} />
          </mesh>
        );
      })}
      {/* Pit floor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -cell.depth, 0]}>
        <circleGeometry args={[PIT_RADIUS, 20]} />
        <meshStandardMaterial color={shellColor(cell.shellId)} roughness={1} />
      </mesh>
    </group>
  );
}

export default CarvedCellsLayer;
