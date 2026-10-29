/* eslint-disable react/no-unknown-property -- React Three Fiber props are three.js object properties */
import { useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { EMBLEM_COLORS, summitGeometry, tileGeometry } from './geometry';

type UseFrame = (cb: (state: { clock: { elapsedTime: number } }) => void) => void;

/** Scene graph only; the renderer-specific Canvas + useFrame are injected by the platform file. */
export function EmblemScene({ useFrame, still }: { useFrame: UseFrame; still: boolean }) {
  const group = useRef<THREE.Group>(null);
  const tile = useMemo(() => tileGeometry(), []);
  const summit = useMemo(() => summitGeometry(), []);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = still ? 1.1 : clock.elapsedTime;
    g.rotation.y = Math.sin(t * 0.6) * 0.38;
    g.rotation.x = -0.12 + Math.sin(t * 0.45) * 0.06;
    g.position.y = still ? 0 : Math.sin(t * 0.9) * 0.06;
  });
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={2.4} />
      <pointLight position={[-3, -2, 2.5]} intensity={18} color={EMBLEM_COLORS.tileEdge} />
      <pointLight position={[2.5, 1.5, -2]} intensity={10} color={EMBLEM_COLORS.rim} />
      <group ref={group}>
        <mesh geometry={tile}>
          <meshPhysicalMaterial color={EMBLEM_COLORS.tile} metalness={0.35} roughness={0.28} clearcoat={1} clearcoatRoughness={0.15} />
        </mesh>
        <mesh geometry={summit}>
          <meshStandardMaterial color={EMBLEM_COLORS.stroke} emissive={EMBLEM_COLORS.stroke} emissiveIntensity={0.55} roughness={0.3} />
        </mesh>
      </group>
    </>
  );
}
