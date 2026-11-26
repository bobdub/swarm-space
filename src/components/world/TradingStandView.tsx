/**
 * TradingStandView — a market booth: a fieldstone footing, four timber
 * posts, a counter with crates of goods, a striped fibre awning and a sign
 * board reading "Trading Stand". Drawn in the placement's local frame
 * (y is up, origin at the base), sized to the prefab's bounding box.
 */
import { useMemo } from 'react';
import { Html } from '@react-three/drei';

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
}: {
  width: number;
  depth: number;
  height: number;
  highlight?: boolean;
}) {
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
        <boxGeometry args={[Math.min(width - 0.4, 1.7), 0.42, 0.05]} />
        <meshStandardMaterial color={TIMBER_DARK} roughness={0.8} />
      </mesh>
      <Html position={[0, awningY + 0.32, depth / 2 + 0.16]} center transform distanceFactor={4} occlude
        style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div style={{ color: '#fde68a', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', letterSpacing: 0.5 }}>
          Trading Stand
        </div>
      </Html>
    </group>
  );
}
