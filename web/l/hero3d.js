// NoExcuse hero: a brushed-silver watch bezel, a luminous arc that fills with today's elapsed time,
// and the NoExcuse summit in lit glass floating in front of it. Vanilla three.js (no build step).
//
// Performance: one draw pass + the glass transmission pass; pixel ratio capped (1.5 phones, 1.75 desktop)
// and dropped to 1 if the first second runs under 30 fps; animation stops if it still can't keep up,
// when the hero is off-screen, or when the tab is hidden. Reduced motion → a single still frame.
// No WebGL → the pre-rendered still (/l/hero-still.webp) set in CSS stays.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const root = document.documentElement;
const stage = document.getElementById('stage');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveal = () => requestAnimationFrame(() => root.classList.add('ready'));
const params = new URLSearchParams(location.search);
const STILL = params.has('still'); // used to render the fallback image

function glowTexture(inner = 0.9, mid = 0.28) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, `rgba(255,255,255,${inner})`); r.addColorStop(0.35, `rgba(255,255,255,${mid})`); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
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

/** Fraction of the visitor's local day that has passed (the arc). */
const dayProgress = () => { const d = new Date(); return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; };

try {
  const canvasTest = document.createElement('canvas');
  if (!(canvasTest.getContext('webgl2') || canvasTest.getContext('webgl'))) throw new Error('no webgl');

  const phone = matchMedia('(max-width: 760px)').matches || /iPhone|iPad|Android/.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: phone ? 'default' : 'high-performance', preserveDrawingBuffer: STILL });
  renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 1);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  const softGlow = glowTexture();
  // Soft spotlight behind everything: gives the glass something bright to bend.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: softGlow, transparent: true, depthWrite: false, toneMapped: false }));
  glow.position.z = -3; scene.add(glow);

  const rig = new THREE.Group(); scene.add(rig);

  // Bezel
  const silver = new THREE.MeshPhysicalMaterial({ color: 0xdedee3, metalness: 1, roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 1.3 });
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.11, 40, 200), silver); rig.add(bezel);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(2.18, 0.018, 12, 200), silver); rig.add(inner);

  // 60 ticks; the ones today has already passed are lit.
  const tickGeo = new THREE.BoxGeometry(1, 1, 1);
  const ticks = new THREE.InstancedMesh(tickGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.22, envMapIntensity: 1.4 }), 60);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0, a = (i / 60) * Math.PI * 2, len = big ? 0.26 : 0.11, r = 2.02 - len / 2;
    p.set(Math.sin(a) * r, Math.cos(a) * r, 0.02);
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a);
    sc.set(big ? 0.045 : 0.02, len, 0.04);
    ticks.setMatrixAt(i, m.compose(p, q, sc));
  }
  const dim = new THREE.Color(0x2c2c30), lit = new THREE.Color(0xffffff);
  const paintTicks = (frac) => { for (let i = 0; i < 60; i++) ticks.setColorAt(i, i / 60 <= frac ? lit : dim); ticks.instanceColor.needsUpdate = true; };
  rig.add(ticks);

  // Progress arc: a thin line of light that has travelled as far as today has.
  const arcMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95 });
  const ARC_R = 2.72;
  const track = new THREE.Mesh(new THREE.TorusGeometry(ARC_R, 0.012, 8, 240), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, toneMapped: false, depthWrite: false }));
  track.position.z = 0.06; rig.add(track);
  const arc = new THREE.Mesh(new THREE.BufferGeometry(), arcMat);
  arc.rotation.z = -Math.PI / 2; arc.scale.x = -1; // (cos,sin) → (sin,cos): start at 12 o'clock, run clockwise
  arc.position.z = 0.06; rig.add(arc);
  const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(1, 0.4), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  head.scale.setScalar(0.9); head.position.z = 0.08; rig.add(head);
  let shownArc = -1;
  function setArc(frac) {
    frac = Math.max(0.002, Math.min(1, frac));
    if (Math.abs(frac - shownArc) < 0.0008) return;
    shownArc = frac;
    arc.geometry.dispose();
    arc.geometry = new THREE.TorusGeometry(ARC_R, 0.03, 10, Math.max(8, Math.round(240 * frac)), frac * Math.PI * 2);
    const a = frac * Math.PI * 2;
    head.position.set(Math.sin(a) * ARC_R, Math.cos(a) * ARC_R, 0.08);
    paintTicks(frac);
  }

  // Second hand: sweeps once a minute, in real time.
  const hand = new THREE.Group();
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 2.05, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  needle.position.y = 0.75; hand.add(needle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 32), silver); hub.rotation.x = Math.PI / 2; hand.add(hub);
  hand.position.z = -0.2; rig.add(hand);

  // Glass summit, with a light behind it and a faint luminous core, so it reads as lit crystal (not a dark cut-out).
  const summitGroup = new THREE.Group(); rig.add(summitGroup);
  // Transmission only refracts opaque objects, so the light the glass bends must be opaque: a pale
  // summit-shaped panel just behind the glass (hidden by it), plus a soft halo for the surroundings.
  const backLight = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: softGlow, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
  backLight.position.z = -0.6; summitGroup.add(backLight);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.06, transmission: 1, thickness: 1.1, ior: 1.5,
    attenuationColor: new THREE.Color(0xf2f2f6), attenuationDistance: 2.5,
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.4, specularIntensity: 1,
  });
  const summitGeo = summitGeometry();
  const summit = new THREE.Mesh(summitGeo, glass);
  summit.scale.setScalar(0.82); summitGroup.add(summit);
  // Light panel: bright at the peaks, falling to dark at the base, so the refraction has depth.
  const panelGeo = summitGeo.clone();
  { const pos = panelGeo.attributes.position, cols = new Float32Array(pos.count * 3);
    panelGeo.computeBoundingBox(); const { min, max } = panelGeo.boundingBox;
    for (let i = 0; i < pos.count; i++) { const k = Math.pow((pos.getY(i) - min.y) / (max.y - min.y), 1.6); const v = 0.06 + 0.8 * k; cols.set([v, v, v * 1.02], i * 3); }
    panelGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); }
  const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  panel.scale.set(0.7, 0.7, 0.04); panel.position.z = -0.42; summitGroup.add(panel);
  const core = new THREE.Mesh(summitGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  core.scale.setScalar(0.62); summitGroup.add(core);
  summitGroup.position.z = 0.9;

  scene.add(new THREE.AmbientLight(0xffffff, 0.22));
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(3, 4, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 3.2); rim.position.set(-4, 2, -3); scene.add(rim);
  const top = new THREE.SpotLight(0xffffff, 40, 30, 0.5, 0.8); top.position.set(0, 9, 5); scene.add(top);

  let baseY = 0, halfHCache = 1, summitY = 0, fitCache = 1, narrow = false;
  function layout() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    narrow = w <= 760;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect; halfHCache = halfH;
    // Desktop/tablet: a large dial rising from the bottom edge like a horizon, clear of the headline.
    // Phones: the stage is its own block between the headline and the copy, so the whole dial is shown,
    // centred, as large as the block allows (arc and its glow included), with the summit in front.
    const fit = narrow ? Math.min(halfW, halfH) / 2.95 : Math.min(halfW * 0.9, halfH * 0.95) / 2.6;
    fitCache = fit;
    baseY = narrow ? -0.04 * halfH : -halfH - fit * 0.78;
    summitY = narrow ? 0.05 : 1.45;
    rig.scale.setScalar(fit);
    rig.position.y = baseY;
    glow.position.y = baseY + summitY * fit; glow.scale.setScalar(fit * (narrow ? 0.95 : 1.1));
    if (reduce || STILL || !running) frame(0);
  }

  // Pointer (mouse) or device tilt → critically damped springs on X and Y.
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { target.x = e.clientX / innerWidth - 0.5; target.y = e.clientY / innerHeight - 0.5; } }, { passive: true });
  const omega = 2 * Math.PI / 1.1;
  const spring = (k, dt) => { const a = omega * omega * (target[k] - cur[k]) - 2 * omega * vel[k]; vel[k] += a * dt; cur[k] += vel[k] * dt; };

  let t = 0;
  const born = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  function frame(dt) {
    t += dt;
    spring('x', dt); spring('y', dt);
    // Wall-clock intro (2.2 s), so a slow device never freezes the arc half-drawn.
    const intro = reduce || STILL || stalled ? 1 : Math.min(1, (performance.now() - born) / 2200);
    setArc(dayProgress() * ease(intro));
    const scroll = Math.min(1, scrollY / innerHeight);
    const now = new Date();
    const secs = now.getSeconds() + now.getMilliseconds() / 1000;
    hand.rotation.z = reduce || STILL ? -Math.PI / 3 : -(secs / 60) * Math.PI * 2;
    const drift = reduce || STILL ? 0 : Math.sin(t * 0.18) * 0.06;
    rig.rotation.x = (narrow ? -0.12 : -0.18) + cur.y * 0.22 + scroll * (narrow ? 0.35 : 0.5);
    rig.rotation.y = cur.x * 0.32 + drift;
    rig.position.y = baseY + (narrow ? 0 : scroll * halfHCache * 0.6) + (reduce || STILL ? 0 : Math.sin(t * 0.5) * 0.03 * fitCache);
    summitGroup.rotation.y = reduce || STILL ? -0.35 : -0.5 + Math.sin(t * 0.22) * 0.55 + cur.x * 0.4;
    summitGroup.rotation.x = 0.1 + (reduce || STILL ? 0 : Math.sin(t * 0.6) * 0.05);
    summitGroup.position.y = summitY + (reduce || STILL ? 0 : Math.sin(t * 0.8) * 0.06);
    backLight.material.opacity = 0.7 + 0.15 * Math.sin(t * 0.7);
    renderer.render(scene, camera);
  }

  // Quality tiers, chosen from the measured frame time (unclamped) over ~60 frames:
  //   0 full → 1 pixel ratio 1× (under 30 fps) → 2 lighter glass, no transmission pass (still under 30 fps)
  //   → 3 a still frame (under ~15 fps even then). The same object at every tier; never hidden.
  let visible = true, running = false, last = performance.now(), samples = 0, slow = 0, stalled = false, tier = 0;
  const setState = (st) => { stage.dataset.state = st; stage.dataset.tier = String(tier); };
  function lighterGlass() {
    // Smoked glass: plain alpha blending over the lit panel instead of a second (transmission) render pass.
    const smoked = new THREE.MeshPhysicalMaterial({ color: 0x3a3a42, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03,
      envMapIntensity: 2.6, specularIntensity: 1, transparent: true, opacity: 0.62, depthWrite: false });
    summit.material = smoked; glass.dispose();
    core.material.opacity = 0.1;
  }
  function loop() {
    if (!visible || document.hidden || reduce || STILL || stalled) { running = false; setState(stalled ? 'still-lowfps' : 'paused'); return; }
    const now = performance.now(), raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
    frame(dt);
    samples++; slow += Math.min(raw, 0.5); // a background-tab gap must not count as slowness
    if (samples === 60) {
      const avg = slow / 60;
      if (avg > 1 / 30 && tier === 0 && renderer.getPixelRatio() > 1) { tier = 1; renderer.setPixelRatio(1); layout(); }
      else if (avg > 1 / 30 && tier <= 1) { tier = 2; lighterGlass(); }
      else if (avg > 1 / 15 && tier === 2) { tier = 3; stalled = true; frame(0); }
      samples = 0; slow = 0;
      setState(stalled ? 'still-lowfps' : 'animating');
    }
    requestAnimationFrame(loop);
  }
  function start() { if (!running && !reduce && !STILL && !stalled) { running = true; last = performance.now(); samples = 0; slow = 0; setState('animating'); requestAnimationFrame(loop); } }

  layout(); new ResizeObserver(layout).observe(stage);
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) start(); }).observe(stage);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  frame(0);
  if (reduce || STILL) setState('still-reduced-motion');
  stage.classList.add('live');
  start();
  reveal();
  if (STILL) root.classList.add('still-ready');
} catch (err) {
  console.warn('hero3d:', err && err.message);
  reveal(); // No WebGL: the pre-rendered still stays.
}
setTimeout(() => root.classList.add('ready'), 2500);
