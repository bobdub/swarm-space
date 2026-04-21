import { useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { HubPiece } from "@/types";
import { getBuilderItem } from "@/lib/virtualHub/builderCatalog";
import { getCompound } from "@/lib/virtualHub/compoundCatalog";
import type { BuildController } from "./useBuildController";

function PieceMesh({
  piece,
  selected,
  controller,
}: {
  piece: HubPiece;
  selected: boolean;
  controller: BuildController;
}) {
  const item = getBuilderItem(piece.kind);
  const groupRef = useRef<THREE.Group>(null);
  const dragging = useRef(false);
  const dragOffset = useRef<{ x: number; z: number }>({ x: 0, z: 0 });

  if (!item) return null;

  const compound = getCompound(piece.kind);
  const color = compound?.color ?? "#8a98b4";
  const buildMode = controller.mode === "build";

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!buildMode) return;
    e.stopPropagation();
    controller.setSelectedId(piece.id);
    dragging.current = true;
    dragOffset.current = {
      x: piece.position[0] - e.point.x,
      z: piece.position[2] - e.point.z,
    };
    (e.target as Element)?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current || !buildMode) return;
    e.stopPropagation();
    controller.movePiece(piece.id, {
      x: e.point.x + dragOffset.current.x,
      z: e.point.z + dragOffset.current.z,
    });
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
  };

  // Doors render as frame + cut-out (two side posts + lintel).
  const isDoor = piece.section === "doors";
  const isWindow = piece.section === "windows";

  return (
    <group
      ref={groupRef}
      position={piece.position}
      rotation={[0, piece.rotationY, 0]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {isDoor ? (
        <>
          {/* Lintel */}
          <mesh position={[0, item.height / 2 - 0.2, 0]} castShadow receiveShadow>
            <boxGeometry args={[item.width, 0.4, item.depth]} />
            <meshStandardMaterial
              color={color}
              emissive={selected ? color : "#000"}
              emissiveIntensity={selected ? 0.3 : 0}
            />
          </mesh>
          {/* Side posts */}
          <mesh position={[-item.width / 2 + 0.2, -0.2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.4, item.height - 0.4, item.depth]} />
            <meshStandardMaterial
              color={color}
              emissive={selected ? color : "#000"}
              emissiveIntensity={selected ? 0.3 : 0}
            />
          </mesh>
          <mesh position={[item.width / 2 - 0.2, -0.2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.4, item.height - 0.4, item.depth]} />
            <meshStandardMaterial
              color={color}
              emissive={selected ? color : "#000"}
              emissiveIntensity={selected ? 0.3 : 0}
            />
          </mesh>
        </>
      ) : isWindow ? (
        <>
          {/* Frame */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[item.width, item.height, item.depth]} />
            <meshStandardMaterial
              color={color}
              transparent
              opacity={0.35}
              emissive={selected ? color : "#000"}
              emissiveIntensity={selected ? 0.3 : 0}
            />
          </mesh>
        </>
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[item.width, item.height, item.depth]} />
          <meshStandardMaterial
            color={color}
            emissive={selected ? color : "#000"}
            emissiveIntensity={selected ? 0.3 : 0}
          />
        </mesh>
      )}
      {/* Selection outline (slightly larger transparent box) */}
      {selected && (
        <mesh>
          <boxGeometry args={[item.width + 0.08, item.height + 0.08, item.depth + 0.08]} />
          <meshBasicMaterial color="#2dd4bf" wireframe />
        </mesh>
      )}
      {selected && compound && (
        <Html
          position={[0, item.height / 2 + 0.5, 0]}
          center
          distanceFactor={8}
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div className="rounded-md border border-border/60 bg-background/90 px-2 py-1 text-center shadow-md">
            <div className="text-[10px] font-medium text-foreground whitespace-nowrap">
              {compound.name}
            </div>
            <div className="font-mono text-[9px] text-muted-foreground whitespace-nowrap">
              {compound.formula}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * Invisible floor plane that catches background clicks to deselect
 * and provides world-space coordinates for piece placement.
 */
function BuildFloorCatcher({ controller }: { controller: BuildController }) {
  if (controller.mode !== "build") return null;
  return (
    <mesh
      position={[0, 0.01, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(e) => {
        // Background click → deselect.
        if (e.button === 0) controller.setSelectedId(null);
      }}
    >
      <circleGeometry args={[20, 32]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Updates a ref every frame with the camera's forward XZ vector. */
function CameraTracker({ targetRef }: { targetRef: React.MutableRefObject<{ x: number; z: number; fx: number; fz: number }> }) {
  const { camera } = useThree();
  useFrame(() => {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    targetRef.current.x = camera.position.x;
    targetRef.current.z = camera.position.z;
    targetRef.current.fx = fwd.x;
    targetRef.current.fz = fwd.z;
  });
  return null;
}

export function HubBuildLayer({
  controller,
  cameraRef,
}: {
  controller: BuildController;
  cameraRef: React.MutableRefObject<{ x: number; z: number; fx: number; fz: number }>;
}) {
  const items = useMemo(() => controller.pieces, [controller.pieces]);
  return (
    <>
      <CameraTracker targetRef={cameraRef} />
      <BuildFloorCatcher controller={controller} />
      {items.map((piece) => (
        <PieceMesh
          key={piece.id}
          piece={piece}
          selected={controller.selectedId === piece.id}
          controller={controller}
        />
      ))}
    </>
  );
}