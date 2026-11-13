// NeuroTrail front end. Every number shown comes from the Python API (models + SQLite + AI coach).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { pageGym, pageGame, pageMRI } from './gym.js?v=4';
import { pageHome as pageHome2, pageVoice, pageData, plainLever, plainAmount, buddy } from './ui2.js?v=1';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = async (path, body) => {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || r.statusText);
  return j;
};
const fmt = (x, d = 1) => (x > 0 ? '+' : '') + Number(x).toFixed(d);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TIER = { 'Randomized trial': 'b-rct', 'Large cohort': 'b-cohort', 'Mixed / weak': 'b-weak' };
const enc = encodeURIComponent;

let QUESTS = [], QMAP = {}, ME = null, SEL = null, META = null, ROUTE = 'home';
const inputs = {};
const charts = {};
const toast = (m, ms = 2800) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); };
const chartOpts = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#C9D0EE' } } },
  scales: { x: { ticks: { color: '#9AA3C7', maxRotation: 0, autoSkip: true }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#9AA3C7' }, grid: { color: 'rgba(255,255,255,.06)' } } }, ...extra });
const chart = (id, cfg) => { charts[id]?.destroy(); const el = document.getElementById(id); if (el) charts[id] = new Chart(el, cfg); };

// ================================================================ 3D BRAIN
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 1, 5000);
const HOME_CAM = new THREE.Vector3(-380, 70, 50);
camera.position.copy(HOME_CAM);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .06; controls.enablePan = false;
controls.minDistance = 180; controls.maxDistance = 640; controls.autoRotate = true; controls.autoRotateSpeed = .45;
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a1530, 1.1));
const key = new THREE.DirectionalLight(0xfff1e6, 2.2); key.position.set(-300, 400, 300); scene.add(key);
const rim1 = new THREE.DirectionalLight(0x59f0ff, 1.6); rim1.position.set(300, 100, -400); scene.add(rim1);
const rim2 = new THREE.DirectionalLight(0x9b7bff, 1.2); rim2.position.set(200, -300, 300); scene.add(rim2);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.82);
composer.addPass(bloom); composer.addPass(new OutputPass());
{ // starfield
  const n = 2500, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 900 + Math.random() * 1600, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    p.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
    const t = Math.random(); c.set(t < .5 ? [.6, .8, 1] : t < .8 ? [.75, .6, 1] : [1, 1, 1], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: .8, depthWrite: false })));
}
const spriteTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
const brain = new THREE.Group(); scene.add(brain);
const hemis = {}; const uTime = { value: 0 };
const toWorld = (x, y, z) => new THREE.Vector3(x, z, -y);

function brainMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: .5, metalness: 0, clearcoat: .35, clearcoatRoughness: .45, sheen: .4, sheenColor: new THREE.Color(0xffc2c2) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aGlow; attribute vec4 aTint; attribute float aPulse;\nvarying vec3 vGlow; varying vec4 vTint; varying float vPulse;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vTint = aTint; vPulse = aPulse;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vGlow; varying vec4 vTint; varying float vPulse;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vTint.rgb, vTint.a);
        totalEmissiveRadiance += vGlow * (1.0 + vPulse * 0.6 * sin(uTime * 3.2));`);
  };
  return m;
}
async function loadBrain() {
  META = await (await fetch('/static/brain/meta.json')).json();
  for (const h of ['left', 'right']) {
    const buf = await (await fetch(`/static/brain/${h}.bin`)).arrayBuffer();
    const nv = META.hemis[h].n_vertices, nf = META.hemis[h].n_faces; let o = 0;
    const raw = new Float32Array(buf, o, nv * 3); o += nv * 12;
    const idx = new Uint16Array(buf, o, nf * 3); o += nf * 6;
    const sulc = new Uint8Array(buf, o, nv); o += nv;
    const region = new Uint8Array(buf, o, nv);
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { const v = toWorld(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]); pos.set([v.x, v.y, v.z], i * 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1)); g.computeVertexNormals();
    const col = new Float32Array(nv * 3), gyr = new THREE.Color('#E9C3BB'), sul = new THREE.Color('#9C5F63'), tmp = new THREE.Color();
    for (let i = 0; i < nv; i++) { tmp.copy(gyr).lerp(sul, Math.pow(sulc[i] / 255, 1.25)); col.set([tmp.r, tmp.g, tmp.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const glow = new THREE.BufferAttribute(new Float32Array(nv * 3), 3), tint = new THREE.BufferAttribute(new Float32Array(nv * 4), 4), pulse = new THREE.BufferAttribute(new Float32Array(nv), 1);
    g.setAttribute('aGlow', glow); g.setAttribute('aTint', tint); g.setAttribute('aPulse', pulse);
    const mesh = new THREE.Mesh(g, brainMaterial()); brain.add(mesh);
    hemis[h] = { mesh, region, glow, tint, pulse, sulc, home: new THREE.Vector3() };
  }
  const c = new THREE.Box3().setFromObject(brain).getCenter(new THREE.Vector3());
  for (const h of Object.values(hemis)) h.mesh.position.sub(c);
  hemis.left.mesh.position.x -= 3; hemis.right.mesh.position.x += 3;
  for (const h of Object.values(hemis)) h.home.copy(h.mesh.position);
  brain.userData.center = c;
  buildSparkles(); paintRegions();
}
let sparkles;
function buildSparkles() {
  const n = 700, p = new Float32Array(n * 3), col = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = i % 2 ? hemis.left : hemis.right, a = h.mesh.geometry.attributes.position, nrm = h.mesh.geometry.attributes.normal;
    let k; do { k = Math.floor(Math.random() * a.count); } while (h.sulc[k] > 90);
    const v = new THREE.Vector3().fromBufferAttribute(a, k).addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, k), 1.2).add(h.mesh.position);
    p.set([v.x, v.y, v.z], i * 3); ph[i] = Math.random() * 10;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sparkles = new THREE.Points(g, new THREE.PointsMaterial({ size: 4, map: spriteTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparkles.userData = { ph }; brain.add(sparkles);
}
function paintRegions(hover) {
  if (!ME || !META || !hemis.left) return;
  const st = ME.trail || {}, focus = hover || SEL;
  const byIdx = Object.fromEntries(Object.entries(META.groups).map(([k, v]) => [v, k]));
  for (const h of Object.values(hemis)) {
    const G = h.glow.array, T = h.tint.array, P = h.pulse.array; G.fill(0); T.fill(0); P.fill(0);
    for (let i = 0; i < h.region.length; i++) {
      const qid = byIdx[h.region[i]]; if (!qid) continue;
      const q = QMAP[qid], s = st[qid]; if (!q || !s) continue;
      const c = new THREE.Color(q.color); let gi = 0, ta = .16, pu = 0;
      if (s === 'done') { gi = .32; ta = .62; }
      if (s === 'next') { gi = .2; ta = .45; pu = 1; }
      if (focus === qid) { gi = Math.max(gi, .3) + .14; ta = .72; pu = s === 'done' ? 0 : 1; }
      G.set([c.r * gi, c.g * gi, c.b * gi], i * 3); T.set([c.r, c.g, c.b, ta], i * 4); P[i] = pu;
    }
    h.glow.needsUpdate = h.tint.needsUpdate = h.pulse.needsUpdate = true;
  }
}
let flight = null, SPLIT = 0, VIEW_X = 0, VIEW_TARGET = 0;
function regionPoint(qid, h = 'left') { return toWorld(...META.centroids[qid][h]).sub(brain.userData.center).add(new THREE.Vector3(h === 'left' ? -3 : 3, 0, 0)); }
function flyTo(qid) {
  if (!META?.centroids?.[qid]) return;
  const pL = regionPoint(qid), medial = Math.abs(pL.x) < 22;
  let dir = pL.clone().normalize();
  if (medial) dir = new THREE.Vector3(1, pL.y > 0 ? .25 : -.15, pL.z * .004).normalize();
  flight = { t: 0, from: camera.position.clone(), to: dir.multiplyScalar(370), split: medial ? 1 : 0, splitFrom: SPLIT };
  controls.autoRotate = false;
}
function goHomeCam() { flight = { t: 0, from: camera.position.clone(), to: HOME_CAM.clone(), split: 0, splitFrom: SPLIT }; controls.autoRotate = true; }
const parts = [];
function sparkStream(qid, n = 60, burst = false) {
  if (!META?.centroids?.[qid]) return;
  const target = regionPoint(qid), c = new THREE.Color(QMAP[qid].color);
  const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), vel = [], start = [];
  for (let i = 0; i < n; i++) {
    let s;
    if (burst) { s = target.clone(); vel.push(new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 140)); }
    else { s = camera.position.clone().lerp(target, .35).add(new THREE.Vector3().randomDirection().multiplyScalar(80 + Math.random() * 60)); vel.push(null); }
    start.push(s.clone()); pos.set([s.x, s.y, s.z], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: burst ? 9 : 7, map: spriteTex, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(pts); parts.push({ pts, start, vel, target, t: 0, life: burst ? 1.6 : 1.1, burst, delay: Array.from({ length: n }, () => Math.random() * .35) });
}
const clock = new THREE.Clock();
function update(dt) {
  uTime.value += dt;
  if (flight) {
    flight.t = Math.min(1, flight.t + dt / 1.3);
    const e = flight.t < .5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
    const p = flight.from.clone().lerp(flight.to, e); p.setLength(THREE.MathUtils.lerp(flight.from.length(), flight.to.length(), e));
    camera.position.copy(p);
    SPLIT = THREE.MathUtils.lerp(flight.splitFrom, flight.split, e);
    if (hemis.right) { hemis.right.mesh.position.copy(hemis.right.home).add(new THREE.Vector3(70 * SPLIT, 260 * SPLIT, 0)); hemis.right.mesh.rotation.z = -.5 * SPLIT; }
    if (flight.t >= 1) flight = null;
  }
  // shift the brain sideways on the Play page (view offset keeps the orbit centered on it)
  VIEW_X += (VIEW_TARGET - VIEW_X) * Math.min(1, dt * 4);
  camera.setViewOffset(innerWidth, innerHeight, VIEW_X * innerWidth, 0, innerWidth, innerHeight);
  if (sparkles) {
    const col = sparkles.geometry.attributes.color.array, ph = sparkles.userData.ph, t = uTime.value;
    for (let i = 0; i < ph.length; i++) { const v = Math.max(0, Math.sin(t * 1.7 + ph[i] * 7.3)) ** 18; col[i * 3] = .55 * v; col[i * 3 + 1] = .95 * v; col[i * 3 + 2] = v; }
    sparkles.geometry.attributes.color.needsUpdate = true;
  }
  for (let k = parts.length - 1; k >= 0; k--) {
    const P = parts[k]; P.t += dt; const a = P.pts.geometry.attributes.position.array;
    for (let i = 0; i < P.start.length; i++) {
      const tt = Math.max(0, Math.min(1, (P.t - P.delay[i]) / P.life));
      const v = P.burst ? P.start[i].clone().addScaledVector(P.vel[i], tt * (1 - tt * .5)) : P.start[i].clone().lerp(P.target, tt * tt);
      a.set([v.x, v.y, v.z], i * 3);
    }
    P.pts.material.opacity = P.burst ? Math.max(0, 1 - P.t / (P.life + .3)) : (P.t < P.life ? 1 : 0);
    P.pts.geometry.attributes.position.needsUpdate = true;
    if (P.t > P.life + .5) { scene.remove(P.pts); P.pts.geometry.dispose(); parts.splice(k, 1); }
  }
  controls.update();
}
function frame() { update(Math.min(clock.getDelta(), .05)); composer.render(); requestAnimationFrame(frame); }
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// ================================================================ HUD
function countUp(el, to) { const from = +el.dataset.v || 0; el.dataset.v = to; const t0 = performance.now();
  const step = (now) => { const e = Math.min(1, (now - t0) / 900); el.textContent = Math.round(from + (to - from) * (1 - (1 - e) ** 3)).toLocaleString(); if (e < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
function renderHUD() {
  if (!ME) return;
  countUp($('#sparks'), ME.sparks); $('#streak').textContent = ME.streak; $('#days').textContent = ME.streak === 1 ? 'day' : 'days';
  $('#flame').classList.toggle('on', ME.streak > 0);
  const L = ME.level; $('#levelNum').textContent = L.index; $('#levelName').textContent = L.name;
  $('#levelRing').style.strokeDashoffset = 100.5 * (1 - (L.next_at ? (ME.sparks - L.floor) / (L.next_at - L.floor) : 1));
  $('#playerName').textContent = ME.name;
}
function caption(id) {
  if (!id || !QMAP[id]) { $('#capTitle').textContent = ''; $('#capFact').textContent = ''; return; }
  const q = QMAP[id]; $('#capTitle').innerHTML = `<span style="color:${q.color}">●</span> ${q.stop} · ${q.region_name}`; $('#capFact').textContent = q.region_fact;
}

// ================================================================ ROUTER
const homeRoute = () => { SEL = null; paintRegions(); caption(null); goHomeCam(); return pageHome2(); };
const routes = { home: homeRoute, play: pagePlay, gym: pageGym, game: pageGame, sprint: pageSprint, voice: pageVoice, data: pageData, mri: pageMRI, progress: pageProgress, coach: pageCoach, levers: pageLevers, science: pageScience };
async function route() {
  if (!ME?.onboarded) return;
  const [, r = 'home', arg] = (location.hash || '#/').split('/');
  ROUTE = routes[r] ? r : 'home';
  document.body.className = 'r-' + ROUTE;
  const tab = { game: 'gym', sprint: 'gym', mri: 'data', levers: 'data' }[ROUTE] || ROUTE;
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.r === tab));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + ROUTE));
  stage.classList.toggle('dim', !['home', 'play'].includes(ROUTE) || (ROUTE === 'home' && innerWidth < 1150));
  stage.classList.toggle('side', ROUTE === 'home');
  VIEW_TARGET = ROUTE === 'play' ? -0.2 : ROUTE === 'home' ? -0.22 : 0;
  if (ROUTE !== 'sprint') G = null;
  await routes[ROUTE](arg);
}
addEventListener('hashchange', route);

// ================================================================ HOME
function pageHome() {
  SEL = null; paintRegions(); caption(null); goHomeCam();
  const ids = Object.keys(ME.trail), done = ids.filter(i => ME.trail[i] === 'done').length, next = ids.find(i => ME.trail[i] === 'next');
  const C = 2 * Math.PI * 40, L = ME.lever;
  $('#p-home').innerHTML = `<div class="home">
    <div class="col"><div class="glass panel">
      <div class="eyebrow">TODAY</div>
      <div class="today-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" stroke="rgba(255,255,255,.08)" stroke-width="10" fill="none"/>
        <circle cx="50" cy="50" r="40" stroke="url(#tr)" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - done / ids.length)}" style="transition:1s;filter:drop-shadow(0 0 6px #59F0FF)"/>
        <defs><linearGradient id="tr"><stop offset="0" stop-color="#59F0FF"/><stop offset="1" stop-color="#9B7BFF"/></linearGradient></defs></svg>
        <div><div class="big">${done}/${ids.length}</div><div class="muted">brain regions lit today</div></div></div>
      ${next ? `<a class="bigbtn" href="#/play/${next}" style="margin-top:14px">${QMAP[next].icon} Play next: ${QMAP[next].title} →</a>` : '<div class="bigbtn" style="margin-top:14px">🏆 Whole brain lit today</div>'}
    </div>
    <div class="glass panel"><div class="eyebrow">QUESTS · ANY ORDER</div>
      ${ids.map(id => { const q = QMAP[id], s = ME.trail[id]; return `<a class="qtile ${s}" href="#/play/${id}" data-q="${id}" style="--c:${q.color}">
        <div class="orb" style="width:40px;height:40px;font-size:18px">${q.icon}</div>
        <div class="tmeta"><div class="tt">${q.title}</div><div class="ts">${q.stop}</div></div>
        <div class="go">${s === 'done' ? '✓ lit' : `+${q.sparks} ⚡`}</div></a>`; }).join('')}
    </div></div>
    <div class="mid"></div>
    <div class="col">
      <div class="glass panel coachcard"><div class="eyebrow">🤖 YOUR COACH</div><div class="bubble" id="homeCoach"><span class="muted">Loading…</span></div>
        <a class="bigbtn" href="#/coach" style="margin-top:12px;background:linear-gradient(90deg,#9B7BFF,#59F0FF)">Talk to your coach →</a></div>
      <div class="glass panel"><div class="eyebrow">YOUR LEVERS</div>
        <div style="font:700 34px 'Space Grotesk';margin:6px 0;color:${L.years > 1 ? '#FF8A7A' : L.years > 0 ? '#FFC83D' : '#3DDC97'}">${Math.abs(L.years).toFixed(1)} yrs ${L.years >= 0 ? 'older' : 'younger'}</div>
        <div class="muted">processing speed linked to your significant factors vs healthy targets (NHANES, 95% CI ${fmt(L.ci[0])} to ${fmt(L.ci[1])})</div>
        <a href="#/levers" class="muted" style="color:#59F0FF">Open the control room →</a></div>
      <div class="glass panel"><div class="eyebrow">THIS WEEK</div>
        <div class="mini-bars">${ME.week.map(d => `<div style="height:${Math.max(6, d.quests / 9 * 100)}%" title="${d.date}: ${d.quests}"></div>`).join('')}</div>
        <div style="display:flex">${ME.week.map(d => `<span style="flex:1;text-align:center;font-size:10px;color:#9AA3C7">${d.dow}</span>`).join('')}</div>
        <a href="#/progress" class="muted" style="color:#59F0FF">See full progress →</a></div>
    </div></div>`;
  $$('#p-home .qtile').forEach(t => { t.onmouseenter = () => { paintRegions(t.dataset.q); caption(t.dataset.q); }; t.onmouseleave = () => { paintRegions(); caption(null); }; });
  api(`/api/player/${enc(ME.name)}/coach`).then(h => {
    const last = [...h.messages].reverse().find(m => m.role === 'assistant');
    $('#homeCoach').innerHTML = last ? esc(last.content.slice(0, 320)) + (last.content.length > 320 ? '…' : '') : `Hi ${esc(ME.name)}! I read your logs and run the real models. Ask me what your biggest lever is, or to build your week.`;
  }).catch(() => {});
}

// ================================================================ PLAY
function pagePlay(id) {
  if (!id || !QMAP[id]) { const n = Object.keys(ME.trail).find(k => ME.trail[k] === 'next') || Object.keys(ME.trail)[0]; location.hash = `#/play/${n}`; return; }
  SEL = id; paintRegions(); caption(id); flyTo(id); renderPlay();
}
function renderPlay() {
  const q = QMAP[SEL], s = ME.trail[q.id], steps = ME.steps[q.id] || [], nDone = steps.filter(Boolean).length;
  const ids = Object.keys(ME.trail), i = ids.indexOf(q.id), prev = ids[(i - 1 + ids.length) % ids.length], nxt = ids[(i + 1) % ids.length];
  const nh = q.nhanes ? `<p class="ours"><b>Our NHANES model</b> (n=2,597, survey-weighted): ${q.nhanes.label} ↔ ${fmt(q.nhanes.dsst_points)} DSST points (95% CI ${fmt(q.nhanes.dsst_ci[0])} to ${fmt(q.nhanes.dsst_ci[1])}) ≈ ${fmt(q.nhanes.years)} yrs, ${q.nhanes.p_value < .05 ? '<span class="sig">significant</span>' : '<span class="nsig">not significant</span>'} (p=${q.nhanes.p_value.toPrecision(2)}). Association, not cause.</p>` : '';
  const ev = `<details class="ev"><summary>Why this quest? The evidence</summary><div class="evb">${q.evidence.map(e => `<p>• ${e.claim} <a href="${e.url}" target="_blank" rel="noopener">source ↗</a></p>`).join('')}${nh}${q.caveat ? `<p class="caveat">⚠ ${q.caveat}</p>` : ''}<p class="formula">sparks = ${q.sparks_formula}</p></div></details>`;
  const picker = `<div class="qpicker">${ids.map(k => `<a href="#/play/${k}" class="${k === q.id ? 'on' : ''} ${ME.trail[k] === 'done' ? 'done' : ''}" style="--c:${QMAP[k].color}" title="${QMAP[k].title}">${QMAP[k].icon}</a>`).join('')}</div>`;
  let body;
  if (s === 'done') body = `<div class="done-card"><div class="big">Neuron fired 🔥</div><p class="muted">${q.region_name} stays lit for today. Come back tomorrow to keep your streak.</p><a class="cta" href="#/play/${nxt}" style="text-decoration:none;display:inline-block">Next quest →</a></div>`;
  else body = `<div class="progress-strip"><i style="width:${nDone / steps.length * 100}%"></i></div><div class="muted" id="stepCount">${nDone} of ${steps.length} steps done · tap a step when you've done it</div>
    <div class="steps">${q.steps.map((t, k) => `<div class="stp ${steps[k] ? 'on' : ''} ${q.log.kind === 'speed' && k > 0 ? 'auto' : ''}" data-i="${k}"><div class="box">✓</div><div><div class="num">STEP ${k + 1}${q.log.kind === 'speed' && k > 0 ? ' · ticks itself when you play' : ''}</div><div class="txt">${t}</div></div></div>`).join('')}</div>
    ${q.log.kind === 'speed' ? `<a class="fire" href="#/sprint" style="display:block;text-align:center;text-decoration:none">🎮 Play Speed Sprint ${ME.rounds_today ? `(round ${ME.rounds_today + 1} = booster)` : ''}</a>` : inputUI(q)}
    <button class="fire" id="fireBtn" disabled>🔥 Fire this neuron · +${q.sparks} ⚡</button>
    <div class="muted" id="fireHint" style="text-align:center;margin-top:6px"></div>
    ${ME.support && q.id === 'joy' ? `<div class="support">Your check-in suggests things may be hard right now. In the US, call or text <b>988</b> any time. NeuroTrail is not treatment.</div>` : ''}`;
  $('#p-play').innerHTML = `<div class="play"><div class="left glass" style="--c:${q.color}">
    ${picker}
    <div class="q-top"><div class="q-icon">${q.icon}</div><div class="reward">${s === 'done' ? '✓' : `+${q.sparks} ⚡`}<small>${s === 'done' ? 'LIT TODAY' : 'REWARD'}</small></div></div>
    <div class="eyebrow" style="margin-top:8px">MISSION ${i + 1} OF ${ids.length}</div>
    <div class="q-title">${q.title}</div><div class="q-region">Lights up: ${q.region_name} (${q.stop})</div>
    <span class="badge ${TIER[q.tier]}">${q.tier}</span>${q.lancet_paf ? `<span class="badge b-cohort">${q.lancet_paf}% of dementia cases linked</span>` : ''}
    ${body}${ev}
    <div class="navrow"><a href="#/play/${prev}">← ${QMAP[prev].title}</a><a href="#/">Home</a><a href="#/play/${nxt}">${QMAP[nxt].title} →</a></div>
  </div><div></div></div>`;
  if (s === 'done') return;
  const panel = $('#p-play');
  $$('.stp', panel).forEach(el => el.onclick = async () => {
    if (el.classList.contains('auto')) return toast('This step ticks itself when you play Speed Sprint.');
    const k = +el.dataset.i, on = !el.classList.contains('on');
    el.classList.toggle('on', on); if (on) sparkStream(q.id, 40);
    try { ME = await api(`/api/player/${enc(ME.name)}/step`, { quest: q.id, index: k, done: on }); } catch (e) { toast(e.message); }
    const sd = ME.steps[q.id].filter(Boolean).length; $('.progress-strip i', panel).style.width = sd / steps.length * 100 + '%';
    $('#stepCount').textContent = `${sd} of ${steps.length} steps done${sd === steps.length ? ' · all done!' : ''}`; refreshFire(q);
  });
  const setV = (k, val, unit) => { inputs[q.id][k] = val; const b = $('#lv_' + k); if (b) { b.textContent = val + (unit || ''); b.style.opacity = 1; }
    const r = $(`input[data-k="${k}"]`, panel); if (r) r.value = val;
    if (q.log.kind === 'steps') { const v = inputs[q.id], g = v.goal || 3826; $('.meter i', panel).style.width = Math.min(100, v.n / g * 100) + '%'; }
    refreshFire(q); };
  $$('input[type=range]', panel).forEach(el => el.oninput = () => setV(el.dataset.k, +el.value, el.dataset.unit));
  $$('[data-up],[data-dn]', panel).forEach(b => b.onclick = () => { const k = b.dataset.up || b.dataset.dn, st = +b.dataset.st, cur = inputs[q.id][k] ?? +b.dataset.def;
    const unit = $(`input[data-k="${k}"]`, panel)?.dataset.unit; setV(k, +(b.dataset.up ? Math.min(+b.dataset.max, cur + st) : Math.max(+b.dataset.min, cur - st)).toFixed(2), unit); });
  $$('[data-goal]', panel).forEach(b => b.onclick = () => { inputs[q.id].goal = +b.dataset.goal; renderPlay(); });
  $$('[data-pick]', panel).forEach(b => b.onclick = () => { inputs[q.id][b.dataset.pick] = b.dataset.val; renderPlay(); });
  $('#fireBtn').onclick = () => fire(q);
  refreshFire(q);
}
// Tap-only controls (no keyboard needed). A value counts only after you move it.
function ctl(q, k, label, min, max, step, def, unit = '') {
  const v = inputs[q.id] ||= {}, val = v[k] ?? def, set = v[k] != null;
  return `<div class="sl"><div class="lbl">${label}<b id="lv_${k}" style="${set ? '' : 'opacity:.45'}">${val}${unit}${set ? '' : ' (set me)'}</b></div>
    <div style="display:flex;gap:8px;align-items:center"><button class="chip" data-dn="${k}" data-st="${step}" data-min="${min}" data-def="${def}">−</button>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-k="${k}" data-unit="${unit}" style="flex:1">
    <button class="chip" data-up="${k}" data-st="${step}" data-max="${max}" data-def="${def}">+</button></div></div>`;
}
function chips(q, k, opts) { const v = inputs[q.id] ||= {}; return `<div class="chips">${opts.map(o => `<button class="chip ${v[k] === o ? 'on' : ''}" data-pick="${k}" data-val="${esc(o)}">${esc(o)}</button>`).join('')}</div>`; }
function inputUI(q) {
  const v = inputs[q.id] ||= {}, k = q.log.kind;
  if (k === 'bp') return `<div class="inputs"><label>Reading 1</label>${ctl(q, 's1', 'Systolic (top)', 80, 220, 1, 125, ' mmHg')}${ctl(q, 'd1', 'Diastolic (bottom)', 40, 130, 1, 80, ' mmHg')}
    <label>Reading 2 (one minute later)</label>${ctl(q, 's2', 'Systolic (top)', 80, 220, 1, 125, ' mmHg')}${ctl(q, 'd2', 'Diastolic (bottom)', 40, 130, 1, 80, ' mmHg')}</div>`;
  if (k === 'steps') { const goal = v.goal || 3826, n = +v.n || 0; return `<div class="inputs"><label>Today's target</label><div class="chips">${[3826, 9826].map(g => `<button class="chip ${goal === g ? 'on' : ''}" data-goal="${g}">${g.toLocaleString()} · ${g === 3826 ? 'minimum dose' : 'optimal dose'}</button>`).join('')}</div>
      ${ctl(q, 'n', 'Steps today (from your phone or watch)', 0, 25000, 100, 5000)}<div class="meter"><i style="width:${Math.min(100, n / goal * 100)}%"></i></div></div>`; }
  if (k === 'connect') return `<div class="inputs"><label>Who did you talk to?</label>${chips(q, 'who', ['Family', 'Partner', 'Friend', 'Neighbor', 'Colleague', 'Someone new'])}${ctl(q, 'mins', 'Minutes', 0, 120, 5, 15, ' min')}</div>`;
  if (k === 'hearing') return `<div class="inputs"><label>Your path today</label>${chips(q, 'path', ['Wore my hearing aids all day', 'Took a hearing screening', 'Booked an audiologist'])}</div>`;
  if (k === 'joy') return `<div class="inputs"><label>Pick your activity</label>${chips(q, 'act', q.log.menu)}
      <label>Scheduled for</label>${chips(q, 'at', ['Morning', 'Midday', 'Afternoon', 'Evening'])}
      ${ctl(q, 'before', 'Mood before', 0, 10, 1, 5, '/10')}${ctl(q, 'after', 'Mood after', 0, 10, 1, 5, '/10')}</div>`;
  if (k === 'sleep') return `<div class="inputs">${ctl(q, 'h', 'Hours slept last night', 2, 12, .25, 7, ' h')}</div>`;
  if (k === 'labs') return `<div class="inputs"><div class="muted">Optional: set them only if you found your numbers.</div>${ctl(q, 'ldl', 'LDL cholesterol', 40, 250, 1, 100, ' mg/dL')}${ctl(q, 'a1c', 'HbA1c', 4, 12, .1, 5.6, '%')}</div>`;
  if (k === 'check') return `<div class="inputs"><label>Today's trigger</label>${chips(q, 'trigger', ['Morning coffee', 'After meals', 'Stress', 'With friends', 'Driving', 'Alcohol'])}
      <label>Your substitute</label>${chips(q, 'sub', ['5-minute walk', 'Glass of water', 'Gum', 'Deep breaths', 'Call someone'])}</div>`;
  return '';
}
function missing(q) {
  const v = inputs[q.id] || {}, k = q.log.kind;
  if (k === 'bp' && ['s1', 'd1', 's2', 'd2'].some(x => v[x] == null)) return 'set both readings (top and bottom)';
  if (k === 'steps' && !(v.n > 0)) return 'set your step count';
  if (k === 'connect' && !(v.who && v.mins >= 10)) return 'pick who, and 10+ minutes';
  if (k === 'hearing' && !v.path) return 'pick your path';
  if (k === 'joy' && !v.act) return 'pick an activity';
  return '';
}
function refreshFire(q) {
  const b = $('#fireBtn'); if (!b) return;
  const left = (ME.steps[q.id] || []).filter(x => !x).length, m = missing(q);
  b.disabled = left > 0 || !!m;
  $('#fireHint').textContent = left ? `${left} step${left > 1 ? 's' : ''} to go` : m ? `Almost: ${m}` : 'Ready. Fire it!';
}
async function fire(q) {
  const v = inputs[q.id] || {}, k = q.log.kind; let value = null, extra = {};
  if (k === 'bp') { value = (v.s1 + v.s2) / 2; extra = { readings: [[v.s1, v.d1], [v.s2, v.d2]] }; }
  if (k === 'steps') { value = v.n; extra = { goal: v.goal || 3826 }; }
  if (k === 'connect') { value = v.mins; extra = { who: v.who }; }
  if (k === 'hearing') extra = { path: v.path };
  if (k === 'joy') { value = (v.after ?? 5) - (v.before ?? 5); extra = { activity: v.act, at: v.at, before: v.before ?? 5, after: v.after ?? 5 }; }
  if (k === 'sleep') value = v.h ?? 7;
  if (k === 'labs') extra = { ldl: v.ldl ?? null, a1c: v.a1c ?? null };
  if (k === 'check') extra = { trigger: v.trigger, substitute: v.sub };
  if (k === 'speed') value = ME.best_speed;
  try {
    const r = await api(`/api/player/${enc(ME.name)}/complete`, { quest: q.id, value, extra }); ME = r;
    sparkStream(q.id, 220, true); sparkStream(q.id, 90); bloom.strength = 2.2; setTimeout(() => (bloom.strength = .55), 700);
    const fl = document.createElement('div'); fl.className = 'float-gain'; fl.textContent = `+${r.gained} ⚡`; fl.style.left = '30%'; fl.style.top = '45%'; document.body.appendChild(fl); setTimeout(() => fl.remove(), 1700);
    if (k === 'bp' && value >= 180) toast('⚠ 180+ is very high. If readings stay this high, contact a clinician promptly.', 6000);
    else if (k === 'steps') toast(value >= 9826 ? '🏅 Optimal dose reached (UK Biobank HR 0.49)' : value >= 3826 ? '✅ Minimum dose reached. Next: 9,826' : `${(3826 - value).toLocaleString()} more steps to the minimum dose`, 4000);
    else if (k === 'joy' && extra.after > extra.before) toast(`Mood ${extra.before} → ${extra.after}. That's behavioural activation working.`, 4000);
    renderHUD(); paintRegions(); renderPlay();
    if (r.leveled_up) setTimeout(() => { $('#luName').textContent = `Level ${r.level.index} · ${r.level.name}`; $('#luText').textContent = `${r.sparks.toLocaleString()} sparks banked.`; openOv('levelup'); }, 1300);
  } catch (e) { toast(e.message); }
}

// ================================================================ SPRINT
const SYM = ['◆', '▲', '●', '■', '★', '✚', '⬟', '☾', '♥'];
let G = null;
function pageSprint() {
  $('#p-sprint').innerHTML = `<div class="sprint-wrap"><div class="arcade" id="arcadeBody"></div></div>`;
  $('#arcadeBody').innerHTML = `<div class="eyebrow">SPEED SPRINT · 90 SECONDS</div><h2 style="font:700 40px 'Space Grotesk';margin:10px 0">Match the symbol to its number</h2>
    <p class="muted" style="max-width:560px;margin:0 auto">A digital task modeled on the Digit Symbol Substitution Test. Tap the keypad (or keys 1–9).
    Speed training with boosters was the only ACTIVE-trial arm linked to fewer dementia diagnoses (HR 0.75).</p>
    <div class="a-big">${ME.best_speed ?? '–'}</div><div class="muted">personal best · ${ME.rounds_today} round${ME.rounds_today === 1 ? '' : 's'} today ${ME.rounds_today >= 2 ? '· booster done ✓' : ''}</div>
    <div class="row" style="justify-content:center"><button class="cta" id="goBtn">▶ Start ${ME.rounds_today ? 'booster round' : 'sprint'}</button></div>`;
  $('#goBtn').onclick = startGame;
}
function startGame() {
  const d = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - .5);
  G = { key: Object.fromEntries(SYM.map((s, i) => [s, d[i]])), t0: performance.now(), ok: 0, bad: 0, combo: 0, best: 0, tgt: SYM[Math.floor(Math.random() * 9)], over: false };
  $('#arcadeBody').innerHTML = `<div class="a-top"><div class="a-stat"><small>CORRECT</small><span id="aOk">0</span></div>
      <div class="timer"><svg width="120" height="120"><circle cx="60" cy="60" r="52" stroke="rgba(255,255,255,.1)" stroke-width="8" fill="none"/><circle id="tRing" cx="60" cy="60" r="52" stroke="#59F0FF" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="326.7" style="filter:drop-shadow(0 0 8px #59F0FF)"/></svg><div class="t" id="tLeft">90</div></div>
      <div class="a-stat"><small>ERRORS</small><span id="aBad">0</span></div></div>
    <div class="symbol" id="sym">${G.tgt}</div><div class="combo" id="combo"></div>
    <div class="keyrow">${SYM.slice().sort((a, b) => G.key[a] - G.key[b]).map(s => `<div><b>${s}</b><span>${G.key[s]}</span></div>`).join('')}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}</div>`;
  $$('.pad button').forEach(b => b.onclick = () => answer(+b.dataset.n, b)); tick();
}
function answer(n, btn) {
  if (!G || G.over) return;
  btn = btn || $(`.pad button[data-n="${n}"]`); btn?.classList.add('hit'); setTimeout(() => btn?.classList.remove('hit'), 100);
  const sym = $('#sym'); sym.classList.remove('ok', 'bad'); void sym.offsetWidth;
  if (G.key[G.tgt] === n) { G.ok++; G.combo++; G.best = Math.max(G.best, G.combo); sym.classList.add('ok'); } else { G.bad++; G.combo = 0; sym.classList.add('bad'); }
  let nx; do { nx = SYM[Math.floor(Math.random() * 9)]; } while (nx === G.tgt); G.tgt = nx; setTimeout(() => (sym.textContent = G.tgt), 90);
  $('#aOk').textContent = G.ok; $('#aBad').textContent = G.bad; $('#combo').textContent = G.combo >= 3 ? `×${G.combo} COMBO` : '';
}
addEventListener('keydown', e => { if (G && !G.over && /^[1-9]$/.test(e.key)) answer(+e.key); });
function tick() {
  if (!G || G.over) return;
  const left = Math.max(0, 90 - (performance.now() - G.t0) / 1000);
  $('#tLeft').textContent = Math.ceil(left); $('#tRing').style.strokeDashoffset = 326.7 * (1 - left / 90); if (left <= 10) $('#tRing').setAttribute('stroke', '#FF5A6E');
  if (left <= 0) return endGame(); requestAnimationFrame(tick);
}
async function endGame() {
  G.over = true; const prevBest = ME.best_speed ?? -1;
  const r = await api(`/api/player/${enc(ME.name)}/speed`, { correct: G.ok, wrong: G.bad, best_combo: G.best });
  const acc = G.ok / Math.max(1, G.ok + G.bad); ME = r; renderHUD();
  $('#arcadeBody').innerHTML = `<div class="eyebrow">ROUND ${r.rounds_today} COMPLETE</div><div class="a-big">${G.ok}</div><div class="muted">correct in 90 seconds · ${(acc * 100).toFixed(0)}% accuracy · best combo ×${G.best}</div>
    ${G.ok > prevBest ? '<div style="margin-top:10px"><span class="pb">NEW PERSONAL BEST</span></div>' : ''}
    ${r.history.length > 1 ? '<div style="max-width:620px;height:180px;margin:20px auto"><canvas id="hChart"></canvas></div>' : ''}
    <div class="row" style="justify-content:center">${r.rounds_today < 2 ? '<button class="cta" id="againBtn">⚡ Booster round (step 3)</button>' : `<a class="cta" href="#/play/speed" style="text-decoration:none">🔥 Claim your quest →</a>`}<a class="ghost" href="#/gym" style="text-decoration:none">Brain Gym</a></div>`;
  if (r.history.length > 1) chart('hChart', { type: 'line', data: { labels: r.history.map((_, i) => i + 1), datasets: [{ label: 'correct', data: r.history, borderColor: '#59F0FF', backgroundColor: 'rgba(89,240,255,.15)', fill: true, tension: .35 }] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  $('#againBtn') && ($('#againBtn').onclick = startGame); G = null;
}

// ================================================================ PROGRESS
async function pageProgress() {
  const [P, GS, GC] = await Promise.all([api(`/api/player/${enc(ME.name)}/progress?days=30`), api(`/api/player/${enc(ME.name)}/games`), api('/api/games')]), T = P.totals;
  const short = d => d.slice(5);
  const empty = (msg) => `<div class="empty">${msg}</div>`;
  $('#p-progress').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">Your progress</div><div class="sub">Everything you log is stored locally in a SQLite database <span class="dbnote">🗄 data/neurotrail.db</span> and charted here.</div>
    <div class="kpis5">
      <div class="kpi"><div class="v">${T.quests}</div><div class="l">quests completed</div></div>
      <div class="kpi"><div class="v">${T.sparks.toLocaleString()}</div><div class="l">sparks earned</div></div>
      <div class="kpi"><div class="v">${T.streak}</div><div class="l">day streak</div></div>
      <div class="kpi"><div class="v">${T.active_days}</div><div class="l">active days</div></div>
      <div class="kpi"><div class="v">${P.speed.length ? Math.max(...P.speed.map(s => s.correct)) : '–'}</div><div class="l">Speed Sprint best</div></div></div>
    <div class="charts">
      <div class="glass chartcard"><h4>⚡ Sparks per day</h4><div class="muted">last 30 days</div><canvas id="cSparks"></canvas></div>
      <div class="glass chartcard"><h4>🗓 Consistency</h4><div class="muted">each square is a day; brighter = more quests</div>
        <div class="heat">${P.days.map((d, i) => `<div title="${d}: ${P.quests_per_day[i]} quests" style="background:${P.quests_per_day[i] ? `rgba(89,240,255,${.2 + P.quests_per_day[i] / 9 * .8})` : 'rgba(255,255,255,.06)'}"></div>`).join('')}</div></div>
      <div class="glass chartcard"><h4>🩺 Blood pressure</h4><div class="muted">average of your two readings · SPRINT MIND target 120</div>${P.bp.length ? '<canvas id="cBP"></canvas>' : empty('Log Pressure Point to start your BP trend.')}</div>
      <div class="glass chartcard"><h4>👟 Steps</h4><div class="muted">UK Biobank doses: 3,826 (HR 0.75) · 9,826 (HR 0.49)</div>${P.steps.length ? '<canvas id="cSteps"></canvas>' : empty('Log Step Street to start your steps chart.')}</div>
      <div class="glass chartcard"><h4>🌙 Sleep</h4><div class="muted">hours per night · 7–8 h band</div>${P.sleep.length ? '<canvas id="cSleep"></canvas>' : empty('Log Sleep Station to see your sleep.')}</div>
      <div class="glass chartcard"><h4>⚡ Speed Sprint rounds</h4><div class="muted">correct answers in 90 s (your own trend only)</div>${P.speed.length ? '<canvas id="cSpeed"></canvas>' : empty('Play a Speed Sprint round.')}</div>
      <div class="glass chartcard"><h4>🎛 Lever score over time</h4><div class="muted">NHANES model re-run on your rolling 7-day values (lower is better)</div>${P.lever.length ? '<canvas id="cLever"></canvas>' : empty('Complete quests to build this history.')}</div>
      <div class="glass chartcard"><h4>🧠 Quest mix</h4><div class="muted">all-time completions</div>${Object.keys(P.quest_counts).length ? '<canvas id="cMix"></canvas>' : empty('No quests yet.')}</div>
    </div>
    <div class="glass chartcard" style="margin-top:16px"><h4>🧩 Brain Gym</h4><div class="muted">every game you've played (stored in game_results)</div>
      <div class="gymgrid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-top:10px">${GC.games.map(g => { const s = GS[g.id]; return `<a class="qtile" href="${g.id === 'speed' ? '#/sprint' : '#/game/' + g.id}" style="--c:${g.color};display:block">
        <div style="display:flex;gap:10px;align-items:center"><span style="font-size:22px">${g.icon}</span><b>${g.title}</b></div>
        <div class="muted" style="margin-top:6px">${s.plays} plays · best ${s.best ?? '–'} ${g.unit}</div></a>`; }).join('')}</div></div>
    <div class="glass chartcard" style="margin-top:16px"><h4>📜 Activity log</h4><div class="muted">newest first, straight from the database</div>
      ${P.log.length ? `<table class="t"><tr><th>When</th><th>Quest</th><th>Value</th><th>Sparks</th></tr>${P.log.map(l => `<tr><td>${l.ts.replace('T', ' ')}</td><td>${QMAP[l.quest]?.icon} ${QMAP[l.quest]?.title}</td><td>${l.value ?? ''} ${l.activity ? '· ' + esc(l.activity) : ''}${l.who ? '· ' + esc(l.who) : ''}${l.path ? esc(l.path) : ''}</td><td>+${l.sparks}</td></tr>`).join('')}</table>` : empty('Your log is empty. Play a quest!')}</div>
  </div></div>`;
  chart('cSparks', { type: 'bar', data: { labels: P.days.map(short), datasets: [{ label: 'sparks', data: P.sparks_per_day, backgroundColor: 'rgba(255,200,61,.7)', borderRadius: 6 }] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  if (P.bp.length) chart('cBP', { type: 'line', data: { labels: P.bp.map(b => short(b.date)), datasets: [{ label: 'systolic', data: P.bp.map(b => b.value), borderColor: '#FF5A6E', backgroundColor: 'rgba(255,90,110,.15)', fill: true, tension: .3 }, { label: 'target 120', data: P.bp.map(() => 120), borderColor: 'rgba(61,220,151,.8)', borderDash: [6, 6], pointRadius: 0 }] }, options: chartOpts() });
  if (P.steps.length) chart('cSteps', { type: 'bar', data: { labels: P.steps.map(b => short(b.date)), datasets: [{ type: 'bar', label: 'steps', data: P.steps.map(b => b.value), backgroundColor: 'rgba(61,220,151,.7)', borderRadius: 6 }, { type: 'line', label: '3,826', data: P.steps.map(() => 3826), borderColor: '#FFC83D', borderDash: [5, 5], pointRadius: 0 }, { type: 'line', label: '9,826', data: P.steps.map(() => 9826), borderColor: '#59F0FF', borderDash: [5, 5], pointRadius: 0 }] }, options: chartOpts() });
  if (P.sleep.length) chart('cSleep', { type: 'line', data: { labels: P.sleep.map(b => short(b.date)), datasets: [{ label: 'hours', data: P.sleep.map(b => b.value), borderColor: '#7C8CFF', backgroundColor: 'rgba(124,140,255,.15)', fill: true, tension: .3 }, { label: '7 h', data: P.sleep.map(() => 7), borderColor: 'rgba(255,255,255,.3)', borderDash: [4, 4], pointRadius: 0 }, { label: '8 h', data: P.sleep.map(() => 8), borderColor: 'rgba(255,255,255,.3)', borderDash: [4, 4], pointRadius: 0 }] }, options: chartOpts() });
  if (P.speed.length) chart('cSpeed', { type: 'line', data: { labels: P.speed.map((_, i) => `#${i + 1}`), datasets: [{ label: 'correct', data: P.speed.map(s => s.correct), borderColor: '#FFC83D', backgroundColor: 'rgba(255,200,61,.15)', fill: true, tension: .3 }] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  if (P.lever.length) chart('cLever', { type: 'line', data: { labels: P.lever.map(l => short(l.date)), datasets: [{ label: 'years', data: P.lever.map(l => l.years), borderColor: '#9B7BFF', backgroundColor: 'rgba(155,123,255,.15)', fill: true, tension: .3 }] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  if (Object.keys(P.quest_counts).length) chart('cMix', { type: 'doughnut', data: { labels: Object.keys(P.quest_counts), datasets: [{ data: Object.values(P.quest_counts), backgroundColor: Object.keys(P.quest_counts).map(t => QUESTS.find(q => q.title === t)?.color || '#888'), borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#C9D0EE' } } } } });
}

// ================================================================ COACH (AI agent)
const SUGGEST = ["What's my biggest lever right now?", 'Build my weekly plan', 'How did I do this week?', 'Why does blood pressure matter for my brain?', 'What if I walked 150 minutes a week?'];
async function pageCoach() {
  $('#p-coach').innerHTML = `<div class="coach"><div class="glass chat">
      <div class="chat-head"><div><div class="eyebrow">🤖 NEUROCOACH · AI AGENT</div><div class="muted">Claude with 5 tools: your lever model, your activity log, quest evidence, what-if simulation, and plan saving. It only cites numbers its tools return.</div></div></div>
      <div class="msgs" id="msgs"></div>
      <div class="suggest">${SUGGEST.map(s => `<button class="chip" data-s="${esc(s)}">${s}</button>`).join('')}</div>
      <div class="composer"><input id="ask" placeholder="Ask your coach…" autocomplete="off"><button class="cta" id="askBtn">Send</button></div></div>
    <div class="glass panel" style="overflow-y:auto"><div class="eyebrow">📅 SAVED PLANS</div><div id="plans" style="margin-top:10px"></div></div></div>`;
  const [h, cs] = await Promise.all([api(`/api/player/${enc(ME.name)}/coach`), api('/api/coach/status')]);
  $('.chat-head').insertAdjacentHTML('beforeend', cs.claude ? `<span class="dbnote">● Claude Opus 5.5 connected</span>`
    : `<span class="dbnote" style="color:#FFC83D;border-color:rgba(255,200,61,.4);background:rgba(255,200,61,.1)" title="Set ANTHROPIC_API_KEY and restart the server">● Offline coach (Claude not connected)</span>`);
  renderMsgs(h.messages); renderPlans(h.plans);
  $$('#p-coach [data-s]').forEach(b => b.onclick = () => send(b.dataset.s));
  $('#askBtn').onclick = () => { const t = $('#ask').value.trim(); if (t) send(t); };
  $('#ask').onkeydown = e => { if (e.key === 'Enter') $('#askBtn').click(); };
}
function bubble(m) {
  return `<div class="msg ${m.role}">${esc(m.content)}${m.tools?.length ? `<div class="toolchips">${m.tools.map(t => `<span>🔧 ${esc(t.label)}</span>`).join('')}</div>` : ''}
    ${m.role === 'assistant' ? `<div class="src">${m.source === 'claude' ? 'CLAUDE OPUS 5.5 AGENT' : 'OFFLINE COACH (rules, same tools)'}</div>` : ''}</div>`;
}
function renderMsgs(ms) {
  const box = $('#msgs');
  box.innerHTML = ms.length ? ms.map(bubble).join('') : `<div class="msg assistant">Hi ${esc(ME.name)}! I'm your NeuroTrail coach. I read your own logs and run the real NHANES model before I answer. Try a suggestion below.</div>`;
  box.scrollTop = box.scrollHeight;
}
function renderPlans(ps) {
  $('#plans').innerHTML = ps.length ? ps.map(p => `<div class="plan"><b>${esc(p.title)}</b><div class="muted">${p.created_at.replace('T', ' ')} · ${p.source === 'claude' ? 'by Claude agent' : 'offline coach'}</div>
    ${p.items.map(i => `<div class="pi"><b>${esc(i.day)}</b><span>${QMAP[i.quest_id]?.icon || ''}</span><a href="#/play/${i.quest_id}" style="color:#DDE2FA;text-decoration:none">${esc(i.action)}</a></div>`).join('')}</div>`).join('')
    : '<div class="muted">No plans yet. Ask: "Build my weekly plan".</div>';
}
async function send(text) {
  const box = $('#msgs'); $('#ask').value = '';
  box.insertAdjacentHTML('beforeend', bubble({ role: 'user', content: text }) + '<div class="msg assistant typing" id="typing"><span></span><span></span><span></span> thinking & running tools…</div>');
  box.scrollTop = box.scrollHeight;
  try {
    const r = await api(`/api/player/${enc(ME.name)}/coach`, { text });
    $('#typing')?.remove(); box.insertAdjacentHTML('beforeend', bubble({ role: 'assistant', content: r.text, tools: r.tools, source: r.source }));
    if (r.note) toast(r.note, 5000);
    box.scrollTop = box.scrollHeight;
    const h = await api(`/api/player/${enc(ME.name)}/coach`); renderPlans(h.plans);
  } catch (e) { $('#typing')?.remove(); toast(e.message); }
}

// ================================================================ LEVERS
let simT, OASIS = null;
async function pageLevers() {
  const p = ME.profile, L = ME.lever;
  $('#p-levers').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">🎛 What if…</div><div class="sub"><b>Move a slider to see how a habit change would move your score.</b> Survey-weighted regression on real CDC NHANES 2011–2014 data (adults 60+, n=${L.n.toLocaleString()}), adjusted for age, sex, education and income. Outcome: Digit Symbol Substitution Test (processing speed). Years = DSST points ÷ ${Math.abs(L.age_coef).toFixed(2)} points lost per year of age. Associations, not guarantees.</div>
    <div class="cr-grid">
      <div class="glass card"><svg class="gauge" viewBox="0 0 300 170"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#3DDC97"/><stop offset=".5" stop-color="#FFC83D"/><stop offset="1" stop-color="#FF5A6E"/></linearGradient></defs>
        <path d="M30 150 A120 120 0 0 1 270 150" stroke="rgba(255,255,255,.08)" stroke-width="22" fill="none" stroke-linecap="round"/><path d="M30 150 A120 120 0 0 1 270 150" stroke="url(#gg)" stroke-width="22" fill="none" stroke-linecap="round" opacity=".9"/>
        <g id="needle" style="transform-origin:150px 150px;transition:transform 1s cubic-bezier(.2,1.4,.4,1)"><line x1="150" y1="150" x2="150" y2="44" stroke="white" stroke-width="4" stroke-linecap="round"/><circle cx="150" cy="150" r="9" fill="white"/></g>
        <text x="22" y="168" fill="#9AA3C7" font-size="11">−5 yrs</text><text x="244" y="168" fill="#9AA3C7" font-size="11">+5 yrs</text></svg>
        <div class="yrs-big" id="lvY"></div><div class="muted" style="text-align:center" id="lvCI"></div><h3>What if…</h3><div id="sliders"></div></div>
      <div class="glass card"><div class="eyebrow">YEARS LINKED TO EACH FACTOR (vs healthy target, 95% CI)</div><div id="factors" style="margin-top:12px"></div>
        <p class="muted">Colored = significant in NHANES and counted in your total. Grey = can't be told apart from zero, shown but not counted.</p></div></div>
    <h3>🩻 Optional: MRI brain age</h3><p class="muted">Model trained on real OASIS MRI summaries from cognitively normal adults. Try a real public OASIS participant, or enter nWBV and eTIV from a radiology volumetry report.</p>
    <div class="cr-grid"><div class="glass card" id="mriIn"></div><div class="glass card" style="height:340px"><canvas id="mriChart"></canvas></div></div></div></div>`;
  const S = [['sbp', 'Systolic BP', 90, 200, 1, 'mmHg'], ['active_min_week', 'Active minutes / week', 0, 600, 10, 'min'], ['sleep_hours', 'Sleep', 4, 10, .5, 'h'], ['phq9', 'Mood score (PHQ-9, lower = better)', 0, 27, 1, ''], ['sedentary_min_day', 'Sitting / day', 0, 900, 10, 'min']];
  const sim = { sbp: Math.round(p.sbp), active_min_week: Math.min(600, p.active_min_week), sleep_hours: p.sleep_hours, phq9: p.phq9, sedentary_min_day: Math.min(900, p.sedentary_min_day), diabetes: p.diabetes, current_smoker: p.current_smoker };
  $('#sliders').innerHTML = S.map(([k, l, a, b, s, u]) => `<div class="sl"><div class="lbl">${l}<b id="v_${k}">${sim[k]} ${u}</b></div><input type="range" min="${a}" max="${b}" step="${s}" value="${sim[k]}" data-k="${k}"></div>`).join('')
    + `<div class="chips"><button class="chip ${sim.current_smoker ? 'on' : ''}" data-t="current_smoker">Smoker</button><button class="chip ${sim.diabetes ? 'on' : ''}" data-t="diabetes">Diabetes</button></div>`;
  const run = async () => drawLever(await api('/api/lever', sim));
  $$('#sliders input').forEach(el => el.oninput = () => { sim[el.dataset.k] = +el.value; $('#v_' + el.dataset.k).textContent = `${el.value} ${S.find(x => x[0] === el.dataset.k)[5]}`; clearTimeout(simT); simT = setTimeout(run, 120); });
  $$('#sliders [data-t]').forEach(b => b.onclick = () => { sim[b.dataset.t] = !sim[b.dataset.t]; b.classList.toggle('on'); run(); });
  drawLever(L); mriUI();
}
function drawLever(r) {
  const y = r.years, amt = plainAmount(y); $('#lvY').textContent = !amt ? 'On target 🎉' : y > 0 ? `≈ ${amt} older` : 'Better than target'; $('#lvY').style.color = y > 1 ? '#FF8A7A' : y > 0 ? '#FFC83D' : '#3DDC97';
  $('#lvCI').textContent = `how your thinking speed compares with you at every healthy target (range ${fmt(r.ci[0])} to ${fmt(r.ci[1])} yrs)`;
  $('#needle').style.transform = `rotate(${Math.max(-90, Math.min(90, y / 5 * 90))}deg)`;
  const max = Math.max(3, ...Object.values(r.per_factor).map(f => Math.abs(f.ci[1]))) * 1.1, X = v => 50 + v / max * 50;
  $('#factors').innerHTML = Object.values(r.per_factor).map(f => { const col = f.significant ? (f.years > 0 ? '#FF7A6E' : '#3DDC97') : '#5B6390', a = X(Math.min(0, f.years)), b = X(Math.max(0, f.years));
    return `<div class="factor"><div>${f.label}<div class="muted">you ${Math.round(f.value * 10) / 10} · target ${f.target}</div></div><div class="fbar"><div class="zero"></div><div class="bar" style="left:${a}%;width:${b - a}%;background:${col};box-shadow:0 0 12px ${col}"></div><div class="ci" style="left:${X(f.ci[0])}%;width:${X(f.ci[1]) - X(f.ci[0])}%"></div></div><div style="text-align:right;font-weight:700">${fmt(f.years)} yrs</div></div>`; }).join('');
}
async function mriUI() {
  OASIS ||= await api('/api/oasis');
  const dem = OASIS.filter(o => o.status !== 'cognitively normal');
  $('#mriIn').innerHTML = `<div class="chips" style="margin-bottom:10px"><button class="chip on" data-m="oasis">Real OASIS participant</button><button class="chip" data-m="own">My own values</button></div><div id="mriForm"></div><div id="mriOut" style="margin-top:14px"></div>`;
  const form = (m) => {
    $$('#mriIn [data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    $('#mriForm').innerHTML = m === 'oasis' ? `<select id="oSel">${OASIS.map(o => `<option value="${o.ID}" ${o.ID === dem[0].ID ? 'selected' : ''}>${o.ID} · ${o.Age} y · ${o.status}</option>`).join('')}</select>`
      : `<div class="grid2"><div><label class="tiny">nWBV (0.60–0.90)</label><input id="oN" type="number" step=".005" value="0.75"></div><div><label class="tiny">eTIV (cm³)</label><input id="oE" type="number" value="1450"></div></div><p class="muted">Age ${ME.profile.age}, ${ME.profile.female ? 'female' : 'male'} from your profile.</p>`;
    const go = async () => {
      let age, female, nwbv, etiv, label = '';
      if (m === 'oasis') { const o = OASIS.find(x => x.ID === $('#oSel').value); ({ Age: age, nWBV: nwbv, eTIV: etiv } = o); female = !!o.female; label = `Actual OASIS status: <b>${o.status}</b>${o.CDR != null ? ` (CDR ${o.CDR})` : ''}.`; }
      else { age = ME.profile.age; female = ME.profile.female; nwbv = +$('#oN').value; etiv = +$('#oE').value; }
      const r = await api('/api/brainage', { age, female, nwbv, etiv });
      $('#mriOut').innerHTML = `<div class="tiny">MRI BRAIN AGE</div><div style="font:700 56px 'Space Grotesk'">${r.brain_age.toFixed(0)} <span style="font-size:18px;color:#9AA3C7">vs age ${age}</span></div>
        <div>Bias-corrected gap <b style="color:${r.gap > 0 ? '#FF8A7A' : '#3DDC97'}">${fmt(r.gap)} yrs</b></div>
        <p class="muted">Model error (MAE) ${r.mae.toFixed(1)} yrs. Smallest change detectable between two scans: ±${r.sdc.toFixed(1)} yrs (20 real repeat scans). ${Math.abs(r.gap) < r.sdc ? 'This gap is inside the noise band.' : 'This gap is larger than scan-to-scan noise.'} ${label}</p>`;
      const n = OASIS.filter(o => o.status === 'cognitively normal');
      chart('mriChart', { type: 'scatter', data: { datasets: [
        { label: 'cognitively normal', data: n.map(o => ({ x: o.Age, y: o.brain_age })), backgroundColor: 'rgba(89,240,255,.45)', pointRadius: 3 },
        { label: 'dementia (CDR ≥ 0.5)', data: dem.map(o => ({ x: o.Age, y: o.brain_age })), backgroundColor: 'rgba(255,122,110,.6)', pointRadius: 3 },
        { label: 'selected', data: [{ x: age, y: r.brain_age }], backgroundColor: '#FFC83D', pointRadius: 11, pointStyle: 'star', borderColor: '#FFC83D', borderWidth: 2 }] }, options: chartOpts() });
    };
    $$('#mriForm select, #mriForm input').forEach(el => el.onchange = go); go();
  };
  $$('#mriIn [data-m]').forEach(b => b.onclick = () => form(b.dataset.m)); form('oasis');
}

// ================================================================ SCIENCE
async function pageScience() {
  const [S, C] = await Promise.all([api('/api/science'), api('/api/mri/comparison').catch(() => null)]), c = S.cognition, b = S.brainage, a = S.associations, cv = b.clinical_validity, tr = b.test_retest, lo = b.longitudinal, bm = b[b.chosen_model];
  const fair = [...Object.entries(c.fairness.race_eth), ...Object.entries(c.fairness.female)];
  $('#p-science').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">Everything is real. Here's the proof.</div><div class="sub">Computed by <code>models/train_cognition.py</code> and <code>models/train_brainage.py</code> from raw public data. Re-run them to reproduce every number.</div>
    <div class="kpis"><div class="kpi"><div class="v">${c.n.toLocaleString()}</div><div class="l">NHANES adults 60+ with a real DSST score</div></div>
      <div class="kpi"><div class="v">R² ${c.gbm_full.r2_mean.toFixed(3)}</div><div class="l">processing-speed model, repeated 5-fold CV (MAE ${c.gbm_full.mae_mean.toFixed(1)})</div></div>
      <div class="kpi"><div class="v">AUC ${cv.auc.toFixed(2)}</div><div class="l">MRI brain-age gap: dementia vs age-matched normals (95% CI ${cv.auc_ci[0].toFixed(2)}–${cv.auc_ci[1].toFixed(2)})</div></div>
      <div class="kpi"><div class="v">ICC ${tr.icc_1_1.toFixed(3)}</div><div class="l">test-retest on ${tr.n_pairs} real repeat MRIs · SDC ±${tr.smallest_detectable_change_years.toFixed(1)} yrs</div></div></div>
    <h3>1 · Processing-speed model (CDC NHANES 2011–2014)</h3>
    <div class="two"><div class="glass card"><table class="t"><tr><th>Model</th><th>R²</th><th>MAE</th></tr>
      <tr><td>Predict the mean</td><td class="num">0.000</td><td class="num">${c.baseline_predict_mean_mae.toFixed(2)}</td></tr>
      <tr><td>Linear: age, sex, education, income</td><td class="num">${c.linear_demographics.r2_mean.toFixed(3)}</td><td class="num">${c.linear_demographics.mae_mean.toFixed(2)}</td></tr>
      <tr><td>Gradient boosting: demographics</td><td class="num">${c.gbm_demographics.r2_mean.toFixed(3)}</td><td class="num">${c.gbm_demographics.mae_mean.toFixed(2)}</td></tr>
      <tr><td><b>Gradient boosting: + 16 modifiable factors</b></td><td class="num"><b>${c.gbm_full.r2_mean.toFixed(3)}</b></td><td class="num"><b>${c.gbm_full.mae_mean.toFixed(2)}</b></td></tr></table>
      <p class="muted">ΔR² = ${c.delta_r2_full_vs_demographics.mean.toFixed(3)} from modifiable factors (range ${c.delta_r2_full_vs_demographics.min.toFixed(3)}–${c.delta_r2_full_vs_demographics.max.toFixed(3)} over 5 seeds).</p></div>
      <div class="glass card" style="height:320px"><canvas id="oofChart"></canvas></div></div>
    <h3>2 · Factor associations (survey-weighted, cluster-robust SEs)</h3>
    <div class="glass card"><table class="t"><tr><th>Change</th><th>DSST points</th><th>95% CI</th><th>≈ years</th><th>p</th></tr>${a.contrasts.map(x => `<tr><td>${x.label}</td><td class="num">${fmt(x.dsst_points, 2)}</td><td class="num">${fmt(x.dsst_ci[0], 2)} to ${fmt(x.dsst_ci[1], 2)}</td><td class="num">${fmt(x.years)}</td><td class="num ${x.p_value < .05 ? 'sig' : 'nsig'}">${x.p_value.toPrecision(2)}</td></tr>`).join('')}</table>
    <p class="muted">n = ${a.n.toLocaleString()} · R² ${a.r2.toFixed(3)} · age effect ${a.age_coef.toFixed(3)} points/yr. Cross-sectional: reverse causation possible.</p></div>
    <h3>3 · Fairness audit (race was not a model input)</h3>
    <div class="glass card"><table class="t"><tr><th>Group</th><th>n</th><th>MAE</th><th>Mean bias (pred − actual)</th></tr>${fair.map(([g, v]) => `<tr><td>${g}${v.low_n_warning ? ' ⚠ small n' : ''}</td><td class="num">${v.n}</td><td class="num">${v.mae.toFixed(2)}</td><td class="num" style="color:${Math.abs(v.mean_bias) > 2 ? '#FFC83D' : '#C9D0EE'}">${fmt(v.mean_bias, 2)}</td></tr>`).join('')}</table>
    <p class="muted">Error is similar across groups, but predictions run too high for Non-Hispanic Black and Other Hispanic participants and too low for Non-Hispanic White participants. That's why NeuroTrail reports within-person change and factor associations, never a cognitive diagnosis.</p></div>
    <h3>4 · MRI brain-age model (OASIS)</h3>
    <div class="glass card"><p class="muted">Trained on ${b.n_normal} cognitively normal OASIS-1 adults aged 18–96 (normalized brain volume, intracranial volume, sex). MAE ${bm.mae_mean.toFixed(1)} yrs (r = ${bm.r_mean.toFixed(2)}) vs ${b.baseline_mae_predict_mean.toFixed(1)} predicting the mean. Gap ${fmt(cv.mean_gap_dementia)} yrs in dementia (n=${cv.n_dementia}) vs ${fmt(cv.mean_gap_normal)} in age-matched normals (Mann–Whitney p = ${cv.mannwhitney_p.toExponential(1)}). Longitudinal (OASIS-2, ${lo.n_subjects} people, ${lo.n_sessions} scans): brain volume falls ${Math.abs(lo.nondemented_nwbv_pts_per_year).toFixed(2)} nWBV-points/yr in nondemented vs ${Math.abs(lo.demented_nwbv_pts_per_year).toFixed(2)} in dementia (p = ${lo.demented_vs_nd_p.toExponential(1)}). Honest limit: image CNNs reach MAE ≈ 2–4 yrs.</p></div>
    ${C && C.rows.length ? `<h3>4b · MRI image models compared (same 5 folds, scored only by models that never saw the person)</h3>
    <div class="glass card"><table class="t"><tr><th>Model</th><th>MAE (yrs)</th><th>r</th><th>Dementia AUC (95% CI)</th><th>ICC</th><th>Smallest detectable change</th><th>95% interval coverage</th></tr>
      ${C.rows.map(x => `<tr><td>${x.model === C.active_model ? '<b>' + x.label + '</b>' : x.label}</td><td class="num">${x.mae.toFixed(2)}</td><td class="num">${x.r.toFixed(3)}</td><td class="num">${x.auc.toFixed(3)} (${x.auc_ci[0].toFixed(2)}–${x.auc_ci[1].toFixed(2)})</td><td class="num">${x.icc.toFixed(3)}</td><td class="num">±${x.sdc.toFixed(2)}</td><td class="num">${x.coverage != null ? (x.coverage * 100).toFixed(1) + '%' : 'n/a'}</td></tr>`).join('')}</table>
      <p class="muted">Active in the MRI tab: <b>${C.active_model}</b>. Full report: <code>results/comparison.md</code>.</p>
      ${C.rules ? `<p class="muted"><b>Confidence labels.</b> High: 95% interval under ${C.rules.high_width} yrs, models within ${C.rules.max_disagreement} yrs of each other, template similarity ≥ ${C.rules.similarity_comfort.toFixed(2)}, age ${C.rules.age_range[0]}–${C.rules.age_range[1]}. Medium: interval ${C.rules.high_width}–${C.rules.low_width} yrs or similarity between ${C.rules.similarity_cutoff.toFixed(2)} and ${C.rules.similarity_comfort.toFixed(2)}. Low: interval over ${C.rules.low_width} yrs, models disagree by more than ${C.rules.max_disagreement} yrs, age outside the training range, or similarity below ${C.rules.similarity_cutoff.toFixed(2)}. ${C.rules.how}.</p>` : ''}
      <p class="muted"><b>Limits.</b> ${C.limits.join(' ')}</p></div>` : ''}
    <h3>5 · Quest weighting</h3>
    <div class="glass card"><table class="t"><tr><th>Quest</th><th>Evidence tier</th><th>Lancet 2024 PAF</th><th>Sparks</th><th>Key source</th></tr>${QUESTS.map(q => `<tr><td>${q.icon} ${q.title}</td><td>${q.tier}</td><td class="num">${q.lancet_paf ? q.lancet_paf + '%' : '–'}</td><td class="num">${q.sparks}</td><td><a href="${q.evidence[0].url}" target="_blank" style="color:#59F0FF">link ↗</a></td></tr>`).join('')}</table>
    <p class="muted">sparks = 20 + tier bonus (RCT 30 · cohort 15 · mixed 5) + 5 × PAF%. ${S.lancet}</p></div>
    <h3>6 · Architecture</h3>
    <div class="glass card"><p class="muted"><b>Python backend</b> (FastAPI): NHANES/OASIS models (scikit-learn, statsmodels), evidence catalog, game logic, <b>SQLite</b> database (players, quest_logs, step_progress, speed_rounds, coach_messages, plans).
    <b>AI coach</b>: Claude Opus 5.5 agent with 5 tools grounded in your data; falls back to a rule-based offline coach with the same tools. <b>Front end</b>: one HTML/JS page with Three.js (WebGL brain) and Chart.js. Nothing leaves your device except coach messages sent to Claude.</p></div>
  </div></div>`;
  chart('oofChart', { type: 'scatter', data: { datasets: [{ label: 'out-of-fold predictions (800 sample)', data: S.oof.map(([x, y]) => ({ x, y })), backgroundColor: 'rgba(155,123,255,.35)', pointRadius: 2.5 }] }, options: chartOpts() });
}

// ================================================================ ONBOARDING
const PHQ = ['Little interest or pleasure in doing things', 'Feeling down, depressed, or hopeless', 'Trouble falling or staying asleep, or sleeping too much', 'Feeling tired or having little energy', 'Poor appetite or overeating', 'Feeling bad about yourself, or that you are a failure', 'Trouble concentrating on things', 'Moving or speaking slowly, or being fidgety or restless', 'Thoughts that you would be better off dead, or of hurting yourself'];
const PHQO = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];
const EDU = ['Less than 9th grade', '9–11th grade', 'High school / GED', 'Some college / AA', 'College graduate+'];
let OB = null, obStep = 0;
function openOnboard() { OB = { age: 65, female: true, educ: 4, income_pir: 2.5, sbp: 130, diabetes: false, current_smoker: false, active_min_week: 90, sedentary_min_day: 420, sleep_hours: 7, phq: Array(9).fill(0) }; obStep = 0; openOv('onboard'); renderOb(); }
function stepper(k, min, max, step, unit = '') { return `<div class="toggle" style="align-items:center"><button class="chip" data-dec="${k}" data-st="${step}" data-min="${min}">−</button><b style="font:700 22px 'Space Grotesk';min-width:90px;text-align:center" id="ob_${k}">${OB[k]}${unit}</b><button class="chip" data-inc="${k}" data-st="${step}" data-max="${max}">+</button></div>`; }
function renderOb() {
  const pages = [
    () => `<div class="eyebrow">BASE CAMP · 1 OF 5</div><h2>About you</h2><p class="muted">The same questions CDC's NHANES asked 3,014 adults aged 60+. Stored only in your local database.</p>
      <div class="q-grid ob"><div><label>Age</label>${stepper('age', 18, 100, 1)}</div>
      <div><label>Sex</label><div class="toggle"><button class="chip ${OB.female ? 'on' : ''}" data-b="female" data-v="1">Female</button><button class="chip ${!OB.female ? 'on' : ''}" data-b="female" data-v="0">Male</button></div></div>
      <div><label>Education</label><select data-k="educ">${EDU.map((e, i) => `<option value="${i + 1}" ${OB.educ === i + 1 ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div><label>Household income vs poverty line: <b>${OB.income_pir}×</b></label><input type="range" min="0" max="5" step=".1" data-k="income_pir" value="${OB.income_pir}"></div></div>`,
    () => `<div class="eyebrow">BASE CAMP · 2 OF 5</div><h2>Heart & metabolism</h2>
      <div class="q-grid ob"><div><label>Systolic BP (top number)</label>${stepper('sbp', 80, 220, 2, ' mmHg')}</div><div></div>
      <div><label>Diagnosed diabetes?</label><div class="toggle"><button class="chip ${OB.diabetes ? 'on' : ''}" data-b="diabetes" data-v="1">Yes</button><button class="chip ${!OB.diabetes ? 'on' : ''}" data-b="diabetes" data-v="0">No</button></div></div>
      <div><label>Currently smoke?</label><div class="toggle"><button class="chip ${OB.current_smoker ? 'on' : ''}" data-b="current_smoker" data-v="1">Yes</button><button class="chip ${!OB.current_smoker ? 'on' : ''}" data-b="current_smoker" data-v="0">No</button></div></div></div>`,
    () => `<div class="eyebrow">BASE CAMP · 3 OF 5</div><h2>Daily life</h2>
      <div class="q-grid ob"><div><label>Active minutes / week (vigorous ×2): <b>${OB.active_min_week}</b></label><input type="range" min="0" max="900" step="10" data-k="active_min_week" value="${OB.active_min_week}"></div>
      <div><label>Sitting minutes / day: <b>${OB.sedentary_min_day}</b></label><input type="range" min="0" max="1140" step="10" data-k="sedentary_min_day" value="${OB.sedentary_min_day}"></div>
      <div><label>Usual sleep on weeknights: <b>${OB.sleep_hours} h</b></label><input type="range" min="2" max="12" step=".5" data-k="sleep_hours" value="${OB.sleep_hours}"></div></div>`,
    () => `<div class="eyebrow">BASE CAMP · 4 OF 5</div><h2>Mood check (PHQ-9)</h2><p class="muted">Over the last 2 weeks, how often have you been bothered by…</p>
      <div class="phq">${PHQ.map((q, i) => `<div class="pq"><div>${i + 1}. ${q}</div><div class="chips">${PHQO.map((o, j) => `<button class="chip ${OB.phq[i] === j ? 'on' : ''}" data-phq="${i}" data-v="${j}">${o}</button>`).join('')}</div></div>`).join('')}</div>`,
    () => `<div class="reveal"><div class="eyebrow">BASE CAMP · 5 OF 5</div><h2>Your starting levers</h2><div id="revealBody"><p class="muted">Running the NHANES model…</p></div></div>`,
  ];
  $('#obDots').innerHTML = pages.map((_, i) => `<i class="${i <= obStep ? 'on' : ''}"></i>`).join('');
  $('#obBody').innerHTML = pages[obStep]();
  $('#obBack').style.visibility = obStep ? 'visible' : 'hidden'; $('#obNext').textContent = obStep === 4 ? 'Start playing →' : 'Next →';
  $$('#obBody [data-k]').forEach(el => el.oninput = () => { OB[el.dataset.k] = +el.value; if (el.type === 'range') el.previousElementSibling.querySelector('b').textContent = el.value + (el.dataset.k === 'income_pir' ? '×' : el.dataset.k === 'sleep_hours' ? ' h' : ''); });
  $$('#obBody [data-b]').forEach(el => el.onclick = () => { OB[el.dataset.b] = el.dataset.v === '1'; renderOb(); });
  $$('#obBody [data-inc],[data-dec]').forEach(el => el.onclick = () => { const k = el.dataset.inc || el.dataset.dec, st = +el.dataset.st;
    OB[k] = el.dataset.inc ? Math.min(+el.dataset.max, OB[k] + st) : Math.max(+el.dataset.min, OB[k] - st); $('#ob_' + k).textContent = OB[k] + (k === 'sbp' ? ' mmHg' : ''); });
  $$('#obBody [data-phq]').forEach(el => el.onclick = () => { OB.phq[+el.dataset.phq] = +el.dataset.v; el.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el)); });
  if (obStep === 4) (async () => {
    const r = await api('/api/lever', { ...OB, phq9: OB.phq.reduce((a, b) => a + b, 0) });
    const top = Object.values(r.per_factor).filter(f => f.years > .05 && f.significant).slice(0, 3);
    $('#revealBody').innerHTML = `<div class="yrs grad">${Math.abs(r.years).toFixed(1)} yrs</div><p>Your modifiable factors are associated with processing speed like someone <b>${Math.abs(r.years).toFixed(1)} years ${r.years >= 0 ? 'older' : 'younger'}</b> than you'd be at every healthy target (95% CI ${fmt(r.ci[0])} to ${fmt(r.ci[1])}).</p>
      ${top.length ? `<p class="muted">Biggest levers: ${top.map(f => `<b style="color:#FFC83D">${f.label}</b> (${fmt(f.years)} yrs)`).join(', ')}.</p>` : '<p class="muted">You\'re at or near target on the factors with significant associations. Quests keep you there.</p>'}
      <p class="muted">Survey-weighted NHANES model (n=${r.n.toLocaleString()}); counts only factors with a significant association. An association, not a diagnosis.</p>`;
  })();
}
$('#obBack').onclick = () => { obStep = Math.max(0, obStep - 1); renderOb(); };
$('#obNext').onclick = async () => { if (obStep < 4) { obStep++; renderOb(); return; } ME = await api(`/api/player/${enc(ME.name)}/onboard`, OB); closeOv('onboard'); enter(); };

// ================================================================ PLAYERS / BOOT
function openOv(id) { $('#' + id).classList.add('open'); }
function closeOv(id) { $('#' + id).classList.remove('open'); }
$$('[data-close]').forEach(b => b.onclick = () => closeOv(b.dataset.close));
$('#playerBtn').onclick = async (e) => {
  if (e.target.closest('.menu')) return;
  const ps = await api('/api/players');
  $('#playerMenu').innerHTML = `<div class="tiny" style="padding:4px 10px">TEAM BOARD · SPARKS THIS WEEK</div>` + ps.map((p, i) => `<div class="mi" data-p="${esc(p.name)}"><span>${['🥇', '🥈', '🥉'][i] || '·'} ${esc(p.name)}</span><b>${p.week_sparks} ⚡</b></div>`).join('')
    + `<div class="mi" id="addP">+ Add a player</div><p class="muted" style="padding:0 6px">Competition was the only gamified arm in STEP UP whose effect outlasted the game.</p>`;
  $('#playerBtn').classList.toggle('open');
  $$('#playerMenu [data-p]').forEach(m => m.onclick = () => { localStorage.setItem('nt_player', m.dataset.p); $('#playerBtn').classList.remove('open'); boot(); });
  $('#addP').onclick = () => { $('#playerBtn').classList.remove('open'); localStorage.removeItem('nt_player'); showWelcome(); };
};
async function startAs(n) {
  try { const p = await api('/api/players', { name: n }); localStorage.setItem('nt_player', p.name); closeOv('welcome'); await boot(); }
  catch (e) { toast(`Couldn't reach the NeuroTrail server (${e.message}). Start it with: python3 web/server.py`, 6000); }
}
$('#startBtn').onclick = () => { const n = $('#newName').value.trim(); if (!n) { $('#newName').focus(); return toast('Type your name, or use Play as Guest'); } startAs(n); };
$('#newName').onkeydown = e => e.key === 'Enter' && $('#startBtn').click();
$('#guestBtn').onclick = async () => { const ps = await api('/api/players').catch(() => []); let i = 1; while (ps.some(p => p.name === `Guest ${i}`)) i++; startAs(`Guest ${i}`); };
$('#promptBtn').onclick = () => { const n = (prompt('Your name') || '').trim().slice(0, 24); if (n) startAs(n); };
async function showWelcome() {
  openOv('welcome'); setTimeout(() => $('#newName').focus(), 50);
  const ps = await api('/api/players').catch(() => []);
  $('#existing').innerHTML = ps.length ? `<div class="tiny" style="width:100%">OR CONTINUE AS</div>` + ps.map(p => `<button class="chip" data-p="${esc(p.name)}">${esc(p.name)} · ${p.sparks} ⚡</button>`).join('') : '';
  $$('#existing [data-p]').forEach(b => b.onclick = () => { localStorage.setItem('nt_player', b.dataset.p); closeOv('welcome'); boot(); });
}
function enter() { renderHUD(); paintRegions(); if (!location.hash || location.hash === '#') location.hash = '#/'; route(); }
async function boot() {
  const name = localStorage.getItem('nt_player');
  if (!name) return showWelcome();
  try { ME = await api(`/api/player/${enc(name)}`); } catch { localStorage.removeItem('nt_player'); return showWelcome(); }
  if (!ME.onboarded) return openOnboard();
  enter();
}

(async () => {
  if (location.protocol === 'file:') { document.body.insertAdjacentHTML('beforeend', '<div class="overlay open"><div class="modal"><h2>Open the app through its server</h2><p>Run <code>python3 web/server.py</code>, then open <b>http://localhost:8600</b>.</p></div></div>'); return; }
  try { QUESTS = await api('/api/quests'); } catch { toast('NeuroTrail server not reachable. Start it with: python3 web/server.py', 10000); return; }
  QMAP = Object.fromEntries(QUESTS.map(q => [q.id, q]));
  window.NTX = { api, toast, chart, chartOpts, renderHUD, fmt, QMAP: () => QMAP, getME: () => ME, setME: (m) => { ME = m; } };
  frame(); await loadBrain(); await boot();
  window.NT = { camera, hemis, step: (dt, n = 1) => { for (let i = 0; i < n; i++) update(dt); composer.render(); }, get me() { return ME; } };
})();
