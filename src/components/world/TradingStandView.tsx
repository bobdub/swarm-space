/**
 * TradingStandView — a market booth: a fieldstone footing, four timber
 * posts, a counter with crates of goods, a striped fibre awning and a sign
 * board across the awning with the builder's name ("<name>'s Trading
 * Stand"), painted as 3D text so every player sees it. Drawn in the placement's local frame
 * (y is up, origin at the base), sized to the prefab's bounding box.
 */
import { useEffect, useMemo, useState } from 'react';
import { Text } from '@/components/brain/SafeText';

const TIMBER = '#8a5a35';
const TIMBER_DARK = '#5e3b22';
const STONE = '#8f9296';
const AWNING_A = '#e0b04a';
const AWNING_B = '#f4ead2';
const GOODS = ['#7c4a24', '#4aa3d8', '#9aa0a6', '#7dd3fc', '#d9485f', '#e6a11a', '#d8c27a'];

export function TradingStandView({
  width,
  depth,
  height,
  highlight = false,
  ownerName,
  ownerId,
}: {
  width: number;
  depth: number;
  height: number;
  highlight?: boolean;
  /** The builder's display name, painted on the sign. */
  ownerName?: string;
  /** The builder's id: their name is looked up when the record carries none. */
  ownerId?: string;
}) {
  const name = useBuilderName(ownerName, ownerId);
  const footH = 0.18;
  const counterH = 1.0;
  const postR = 0.06;
  const awningY = height - 0.12;
  const stripes = 6;
  const stripeW = width / stripes;
  const posts = useMemo(() => {
    const x = width / 2 - postR * 1.5;
    const z = depth / 2 - postR * 1.5;
    return [[-x, -z], [x, -z], [-x, z], [x, z]] as const;
  }, [width, depth]);
  const emissive = highlight ? '#f59e0b' : '#000000';
  const signW = Math.min(width - 0.4, 1.7);

  return (
    <group>
      {/* Stone footing */}
      <mesh position={[0, footH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, footH, depth]} />
        <meshStandardMaterial color={STONE} roughness={0.95} emissive={emissive} emissiveIntensity={highlight ? 0.15 : 0} />
      </mesh>
      {/* Posts */}
      {posts.map(([x, z], i) => (
        <mesh key={i} position={[x, footH + (awningY - footH) / 2, z]} castShadow>
          <cylinderGeometry args={[postR, postR, awningY - footH, 8]} />
          <meshStandardMaterial color={TIMBER_DARK} roughness={0.85} />
        </mesh>
      ))}
      {/* Counter across the front */}
      <mesh position={[0, footH + counterH / 2, depth / 2 - 0.3]} castShadow receiveShadow>
        <boxGeometry args={[width - 0.2, counterH, 0.5]} />
        <meshStandardMaterial color={TIMBER} roughness={0.8} emissive={emissive} emissiveIntensity={highlight ? 0.2 : 0} />
      </mesh>
      {/* Counter top */}
      <mesh position={[0, footH + counterH + 0.03, depth / 2 - 0.3]}>
        <boxGeometry args={[width - 0.1, 0.06, 0.6]} />
        <meshStandardMaterial color={TIMBER_DARK} roughness={0.7} />
      </mesh>
      {/* Goods crates on the counter, one per good */}
      {GOODS.map((c, i) => {
        const span = width - 0.5;
        const x = -span / 2 + (span * (i + 0.5)) / GOODS.length;
        return (
          <mesh key={c} position={[x, footH + counterH + 0.15, depth / 2 - 0.3]} castShadow>
            <boxGeometry args={[0.22, 0.18, 0.26]} />
            <meshStandardMaterial color={c} roughness={0.7} />
          </mesh>
        );
      })}
      {/* Back shelf */}
      <mesh position={[0, footH + 0.9, -depth / 2 + 0.2]} castShadow>
        <boxGeometry args={[width - 0.2, 0.06, 0.32]} />
        <meshStandardMaterial color={TIMBER} roughness={0.8} />
      </mesh>
      {/* Striped awning, tilted down toward the front */}
      <group position={[0, awningY, 0.08]} rotation={[0.18, 0, 0]}>
        {Array.from({ length: stripes }, (_, i) => (
          <mesh key={i} position={[-width / 2 + stripeW * (i + 0.5), 0, 0]} castShadow>
            <boxGeometry args={[stripeW, 0.05, depth + 0.4]} />
            <meshStandardMaterial color={i % 2 === 0 ? AWNING_A : AWNING_B} roughness={0.9} side={2} />
          </mesh>
        ))}
      </group>
      {/* Sign board on the awning's front edge */}
      <mesh position={[0, awningY + 0.32, depth / 2 + 0.12]}>
        <boxGeometry args={[signW, 0.42, 0.05]} />
        <meshStandardMaterial color={TIMBER_DARK} roughness={0.8} />
      </mesh>
      {/* Painted in the scene (not a DOM overlay), so every player sees the
          builder's name on the sign from any angle the board faces. */}
      <group position={[0, awningY + 0.32, depth / 2 + 0.15]}>
        {name ? (
          <>
            <Text position={[0, 0.07, 0]} fontSize={0.13} maxWidth={signW - 0.08} color="#fde68a"
              anchorX="center" anchorY="middle" outlineWidth={0.006} outlineColor="#3b2412">
              {`${name}'s`}
            </Text>
            <Text position={[0, -0.09, 0]} fontSize={0.1} color="#fde68a" anchorX="center" anchorY="middle">
              Trading Stand
            </Text>
          </>
        ) : (
          <Text fontSize={0.13} color="#fde68a" anchorX="center" anchorY="middle">Trading Stand</Text>
        )}
      </group>
    </group>
  );
}

/**
 * The name for the sign: the one stamped on the stand when it was built,
 * else the builder's profile name from this device's user records (a stand
 * built before names were stamped, or a peer's that arrived without one).
 */
export function useBuilderName(stamped?: string, ownerId?: string): string | undefined {
  const clean = (v?: string) => (v ?? '').trim().slice(0, 32) || undefined;
  const [looked, setLooked] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (clean(stamped) || !ownerId) return;
    let live = true;
    void import('@/lib/store')
      .then(({ get }) => get<{ displayName?: string; username?: string }>('users', ownerId))
      .then((u) => { if (live) setLooked(clean(u?.displayName || u?.username)); })
      .catch(() => { /* no record: the sign reads "Trading Stand" */ });
    return () => { live = false; };
  }, [stamped, ownerId]);
  return clean(stamped) ?? looked;
}
