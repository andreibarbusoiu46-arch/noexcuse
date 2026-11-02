// NoExcuse hero: a brushed-silver watch bezel with a sweeping second hand,
// and the NoExcuse summit in glass floating in front of it. Vanilla three.js.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const root = document.documentElement;
const stage = document.getElementById('stage');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveal = () => requestAnimationFrame(() => root.classList.add('ready'));

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(.35, 'rgba(255,255,255,.28)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function summitGeometry() {
  // The outline of the app icon's summit, filled and bevelled.
  const pts = [[11, 39], [23.5, 18], [30.5, 29.5], [34.5, 24], [45, 39]];
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => { const px = (x - 28) / 10, py = -(y - 30) / 10; if (i) s.lineTo(px, py); else s.moveTo(px, py); });
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.14, bevelSegments: 10, curveSegments: 4 });
  geo.center(); geo.computeVertexNormals(); return geo;
}

try {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 1);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  // Soft spotlight behind everything: gives the glass something bright to bend.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, toneMapped: false }));
  glow.position.z = -3; scene.add(glow);

  const rig = new THREE.Group(); scene.add(rig);

  // Bezel
  const silver = new THREE.MeshPhysicalMaterial({ color: 0xdedee3, metalness: 1, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.2 });
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.11, 48, 220), silver); rig.add(bezel);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(2.18, 0.018, 16, 220), silver); rig.add(inner);

  // 60 ticks, hour ticks longer
  const tickGeo = new THREE.BoxGeometry(1, 1, 1);
  const ticks = new THREE.InstancedMesh(tickGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.2, envMapIntensity: 1.4 }), 60);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0, a = (i / 60) * Math.PI * 2, len = big ? 0.26 : 0.11, r = 2.02 - len / 2;
    p.set(Math.sin(a) * r, Math.cos(a) * r, 0.02);
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a);
    sc.set(big ? 0.045 : 0.02, len, 0.04);
    ticks.setMatrixAt(i, m.compose(p, q, sc));
  }
  rig.add(ticks);

  // Second hand: sweeps once a minute, in real time.
  const hand = new THREE.Group();
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 2.05, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  needle.position.y = 0.75; hand.add(needle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 32), silver); hub.rotation.x = Math.PI / 2; hand.add(hub);
  hand.position.z = -0.2; rig.add(hand);

  // Glass summit in front of the dial
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.9, ior: 1.45, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8, specularIntensity: 1 });
  const summit = new THREE.Mesh(summitGeometry(), glass);
  summit.position.z = 0.9; summit.scale.setScalar(0.82);
  rig.add(summit);

  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 4, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 3); rim.position.set(-4, 2, -3); scene.add(rim);

  let mobile = false, baseY = 0, halfHCache = 1, summitY = 0;
  function layout() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    mobile = w <= 760;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect; halfHCache = halfH;
    // Desktop: the dial sits in the lower half, under the headline. Mobile: it fills its own block.
    // Desktop: a large dial rising from the bottom edge like a horizon, clear of the headline.
    const fit = mobile ? Math.min(halfW, halfH) / 2.75 : Math.min(halfW * 0.9, halfH * 0.95) / 2.6;
    baseY = mobile ? 0 : -halfH - fit * 0.78;
    summitY = mobile ? 0 : 1.45;
    rig.scale.setScalar(fit);
    rig.position.y = baseY;
    glow.position.y = baseY + summitY * fit; glow.scale.setScalar(fit * 1.1);
    if (reduce) frame(0);
  }

  // Pointer → critically damped springs on X and Y
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { target.x = e.clientX / innerWidth - 0.5; target.y = e.clientY / innerHeight - 0.5; } }, { passive: true });
  const omega = 2 * Math.PI / 1.0;
  const spring = (k, dt) => { const a = omega * omega * (target[k] - cur[k]) - 2 * omega * vel[k]; vel[k] += a * dt; cur[k] += vel[k] * dt; };

  let t = 0;
  function frame(dt) {
    t += dt;
    spring('x', dt); spring('y', dt);
    const scroll = Math.min(1, scrollY / innerHeight);
    const now = new Date();
    const secs = now.getSeconds() + now.getMilliseconds() / 1000;
    hand.rotation.z = reduce ? -Math.PI / 3 : -(secs / 60) * Math.PI * 2;
    rig.rotation.x = -0.18 + cur.y * 0.25 + scroll * 0.5;
    rig.rotation.y = cur.x * 0.35;
    rig.position.y = baseY + scroll * (mobile ? 0.6 : halfHCache * 0.7);
    summit.rotation.y = -0.5 + t * 0.25 + cur.x * 0.4;
    summit.rotation.x = 0.1 + Math.sin(t * 0.6) * 0.05;
    summit.position.y = summitY + Math.sin(t * 0.8) * 0.05;
    renderer.render(scene, camera);
  }

  let visible = true, running = false, last = performance.now(), samples = 0, slow = 0;
  function loop() {
    if (!visible || reduce) { running = false; return; }
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    frame(dt);
    if (++samples <= 90) { slow += dt; if (samples === 90 && slow / 90 > 1 / 30 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); layout(); } }
    requestAnimationFrame(loop);
  }
  function start() { if (!running && !reduce) { running = true; last = performance.now(); requestAnimationFrame(loop); } }

  layout(); new ResizeObserver(layout).observe(stage);
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) start(); }).observe(stage);
  stage.querySelector('.stage-fallback')?.remove();
  frame(0); start();
  reveal();
} catch (err) {
  reveal(); // No WebGL: the CSS spotlight fallback stays.
}
setTimeout(() => root.classList.add('ready'), 2500);
