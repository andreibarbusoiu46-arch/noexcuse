import { Canvas, useFrame } from '@react-three/fiber/native';
import { Component, type ReactNode } from 'react';
import { View } from 'react-native';
import { useReduceMotion } from '@/lib/hooks';
import { Mark } from '../Brand';
import { EmblemScene } from './Scene';

class Fallback extends Component<{ size: number; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Mark size={this.props.size * 0.55} /> : this.props.children; }
}

/** Dimensional emblem (React Three Fiber on expo-gl). Static under Reduce Motion; flat mark if GL fails. */
export function Emblem3D({ size = 168 }: { size?: number }) {
  const still = useReduceMotion();
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="image" accessibilityLabel="NoExcuse emblem">
      <Fallback size={size}>
        <Canvas style={{ width: size, height: size }} camera={{ position: [0, 0, 5.2], fov: 35 }} frameloop={still ? 'demand' : 'always'} gl={{ antialias: true }}>
          <EmblemScene useFrame={useFrame} still={still} />
        </Canvas>
      </Fallback>
    </View>
  );
}
