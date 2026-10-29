// Pure three.js geometry for the dimensional NoExcuse emblem (shared by native + web renderers).
import * as THREE from 'three';

export function tileGeometry(size = 2, r = 0.55, depth = 0.34): THREE.ExtrudeGeometry {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 6, curveSegments: 16 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** The summit stroke from the 56-unit logo grid, mapped onto the tile face. */
export function summitGeometry(size = 2, z = 0.26): THREE.TubeGeometry {
  const pts: [number, number][] = [[11, 39], [23.5, 18], [30.5, 29.5], [34.5, 24], [45, 39]];
  const k = size / 56;
  const path = new THREE.CurvePath<THREE.Vector3>();
  const v = pts.map(([x, y]) => new THREE.Vector3((x - 28) * k, (28 - y) * k, z));
  for (let i = 0; i < v.length - 1; i++) path.add(new THREE.LineCurve3(v[i], v[i + 1]));
  return new THREE.TubeGeometry(path, 120, 0.075, 12, false);
}

export const EMBLEM_COLORS = { tile: '#151517', tileEdge: '#FFFFFF', stroke: '#FFFFFF', rim: '#C9C9CE' } as const;
