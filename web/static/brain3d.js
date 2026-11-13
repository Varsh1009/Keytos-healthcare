// Real 3D brain (fsaverage6 pial surface + Harvard-Oxford deep structures). Loaded only on My Brain.
// No post-processing: solid, readable colors. Renders only while the My Brain page is open.
import * as THREE from 'three';
import { OrbitControls } from 'three/orbit';

const toWorld = (x, y, z) => new THREE.Vector3(x, z, -y);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('calm');

export async function createBrain(stage) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 5000);
  const HOME = new THREE.Vector3(-360, 70, 50); camera.position.copy(HOME);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .08; controls.enablePan = false;
  controls.minDistance = 180; controls.maxDistance = 640; controls.autoRotateSpeed = .5;
  scene.add(new THREE.HemisphereLight(0xeef3ff, 0x4a3a50, 1.6));
  const key = new THREE.DirectionalLight(0xfff1e6, 2.0); key.position.set(-300, 400, 300); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfe9ff, 1.0); fill.position.set(300, 100, -400); scene.add(fill);

  const brain = new THREE.Group(); scene.add(brain);
  const deep = new THREE.Group(); const hemis = {};
  const meta = await (await fetch('/static/brain/meta.json')).json();
  for (const h of ['left', 'right']) {
    const buf = await (await fetch(`/static/brain/${h}.bin`)).arrayBuffer();
    const nv = meta.hemis[h].n_vertices, nf = meta.hemis[h].n_faces; let o = 0;
    const raw = new Float32Array(buf, o, nv * 3); o += nv * 12;
    const idx = new Uint16Array(buf, o, nf * 3); o += nf * 6;
    const sulc = new Uint8Array(buf, o, nv);
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { const v = toWorld(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]); pos.set([v.x, v.y, v.z], i * 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1)); g.computeVertexNormals();
    const base = new Float32Array(nv * 3), gyr = new THREE.Color('#E9C9C2'), sul = new THREE.Color('#A56A6E'), t = new THREE.Color();
    for (let i = 0; i < nv; i++) { t.copy(gyr).lerp(sul, Math.pow(sulc[i] / 255, 1.25)); base.set([t.r, t.g, t.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(base.slice(), 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: 0 });
    const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 2; brain.add(mesh);
    // x-ray: a depth-only pre-pass so only the outermost surface shows (no tangled inner folds)
    const pre = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true }));
    pre.renderOrder = 1; pre.visible = false; mesh.add(pre);
    hemis[h] = { mesh, pre, base, ho: null, home: new THREE.Vector3() };
  }
  const c = new THREE.Box3().setFromObject(brain).getCenter(new THREE.Vector3());
  for (const h of Object.values(hemis)) h.mesh.position.sub(c);
  hemis.left.mesh.position.x -= 3; hemis.right.mesh.position.x += 3;
  for (const h of Object.values(hemis)) h.home.copy(h.mesh.position);
  for (const h of ['left', 'right']) hemis[h].ho = new Uint8Array(await (await fetch(`/static/brain/ho_${h}.bin`)).arrayBuffer());
  const D = await (await fetch('/static/brain/deep.json')).json();
  for (const [k, m] of Object.entries(D)) {
    const p = new Float32Array(m.pos.length);
    for (let i = 0; i < m.pos.length; i += 3) { const v = toWorld(m.pos[i], m.pos[i + 1], m.pos[i + 2]).sub(c); p.set([v.x + (k.endsWith('_L') ? -3 : k.endsWith('_R') ? 3 : 0), v.y, v.z], i); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setIndex(m.idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd9a0a0, roughness: .45, transparent: true, opacity: .95 }));
    mesh.userData = { region: m.region }; mesh.visible = false; deep.add(mesh);
  }
  brain.add(deep);

  let colors = {}, xray = false, flight = null, split = 0, running = false, idleT = 0;
  function paint() {
    for (const h of Object.values(hemis)) {
      const a = h.mesh.geometry.attributes.color, A = a.array; A.set(h.base);
      for (let i = 0; i < h.ho.length; i++) {
        const col = colors['c' + h.ho[i]]; if (!col) continue;
        const w = col[3] ?? .75; A[i * 3] = A[i * 3] * (1 - w) + col[0] * w; A[i * 3 + 1] = A[i * 3 + 1] * (1 - w) + col[1] * w; A[i * 3 + 2] = A[i * 3 + 2] * (1 - w) + col[2] * w;
      }
      a.needsUpdate = true;
      h.pre.visible = xray; h.mesh.material.transparent = xray; h.mesh.material.opacity = xray ? .32 : 1; h.mesh.material.emissive.setHex(xray ? 0x3a3348 : 0x000000); h.mesh.material.depthWrite = !xray; h.mesh.material.needsUpdate = true;
    }
    for (const m of deep.children) {
      m.visible = xray; const col = colors[m.userData.region];
      m.material.color.setRGB(...(col ? col.slice(0, 3) : [.85, .66, .66])); m.material.opacity = col ? .97 : .3;
      m.material.emissive.setRGB(...(col ? col.slice(0, 3).map(v => v * .8) : [.1, .08, .1]));
    }
  }
  function size() { const r = stage.getBoundingClientRect(); if (!r.width) return; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
  new ResizeObserver(size).observe(stage);
  const clock = new THREE.Clock();
  function step(dt) {
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / (reduced() ? .01 : 1.2));
      const e = flight.t < .5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
      const p = flight.from.clone().lerp(flight.to, e); p.setLength(THREE.MathUtils.lerp(flight.from.length(), flight.to.length(), e));
      camera.position.copy(p);
      split = THREE.MathUtils.lerp(flight.splitFrom, flight.split, e);
      hemis.right.mesh.position.copy(hemis.right.home).add(new THREE.Vector3(70 * split, 240 * split, 0)); hemis.right.mesh.rotation.z = -.5 * split;
      if (flight.t >= 1) flight = null;
    }
    idleT += dt; controls.autoRotate = !reduced() && idleT < 5;   // spin for 5 s, then hold still
    controls.update(); renderer.render(scene, camera);
  }
  function loop() { if (!running) return; step(Math.min(clock.getDelta(), .05)); requestAnimationFrame(loop); }
  controls.addEventListener('start', () => { idleT = 99; });
  const ray = new THREE.Raycaster();
  return {
    start() { if (running) return; running = true; size(); clock.getDelta(); loop(); },
    stop() { running = false; },
    set(c, x = false) { colors = c; xray = x; paint(); },
    fly(x, y, z, medial = false) { idleT = 0; flight = { t: 0, from: camera.position.clone(), to: new THREE.Vector3(x, y, z).normalize().multiplyScalar(360), split: medial ? 1 : 0, splitFrom: split }; },
    home() { idleT = 0; flight = { t: 0, from: camera.position.clone(), to: HOME.clone(), split: 0, splitFrom: split }; },
    pick(clientX, clientY) {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects([...(xray ? deep.children.filter(m => m.visible) : []), hemis.left.mesh, hemis.right.mesh], false)[0];
      if (!hit) return null;
      if (hit.object.userData.region) return hit.object.userData.region;
      const h = hit.object === hemis.left.mesh ? hemis.left : hemis.right, lab = h.ho[hit.face.a];
      return lab ? 'c' + lab : null;
    },
    canvas: renderer.domElement, step,
  };
}
