// NeuroTrail front end. Every number shown comes from the Python API (models + SQLite + AI coach).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { pageGym, pageGame, pageMRI, railHTML, boardHTML, startDemo } from './gym.js?v=11';
import { pageHands } from './hands.js?v=6';
import { pageHome as pageHome2, pageVoice, pageData, plainLever, plainAmount, buddy } from './ui2.js?v=4';

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
let GPAINT = null;   // Games page: { state: {area: 'done'|'open'}, color: {area: hex}, focus: area }
function paintRegions(hover) {
  if (!ME || !META || !hemis.left) return;
  const games = ROUTE === 'gym' && GPAINT;   // on the Games page, colour each game's brain area instead of the quests'
  const st = games ? GPAINT.state : ME.trail || {}, focus = games ? GPAINT.focus : hover || SEL;
  const byIdx = Object.fromEntries(Object.entries(META.groups).map(([k, v]) => [v, k]));
  for (const h of Object.values(hemis)) {
    const G = h.glow.array, T = h.tint.array, P = h.pulse.array; G.fill(0); T.fill(0); P.fill(0);
    for (let i = 0; i < h.region.length; i++) {
      const qid = byIdx[h.region[i]]; if (!qid) continue;
      const q = QMAP[qid], s = st[qid]; if (!q || !s) continue;
      const c = new THREE.Color(games ? GPAINT.color[qid] : q.color); let gi = 0, ta = .16, pu = 0;
      if (s === 'done') { gi = .32; ta = .62; }
      if (s === 'next') { gi = .2; ta = .45; pu = 1; }
      if (focus === qid) { gi = Math.max(gi, .3) + .14; ta = .72; pu = s === 'done' ? 0 : 1; }
      G.set([c.r * gi, c.g * gi, c.b * gi], i * 3); T.set([c.r, c.g, c.b, ta], i * 4); P[i] = pu;
    }
    h.glow.needsUpdate = h.tint.needsUpdate = h.pulse.needsUpdate = true;
  }
}
let flight = null, SPLIT = 0, VIEW_X = 0, VIEW_TARGET = 0;
function regionPoint(qid, h = 'left') { if (!META || !brain.userData.center) return new THREE.Vector3(); return toWorld(...META.centroids[qid][h]).sub(brain.userData.center).add(new THREE.Vector3(h === 'left' ? -3 : 3, 0, 0)); }
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
// The 3D brain is decoration: pause it on the hand check so the GPU is free for hand tracking.
function frame() { const dt = Math.min(clock.getDelta(), .05); if (ROUTE !== 'hands' && !document.hidden) { update(dt); composer.render(); } requestAnimationFrame(frame); }
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
function gameBrain(state, color, focus, title, fact) {   // called by the Games page (gym.js)
  GPAINT = { state, color, focus }; paintRegions(); flyTo(focus);
  $('#capTitle').innerHTML = title; $('#capFact').textContent = fact;
}
function caption(id) {
  if (!id || !QMAP[id]) { $('#capTitle').textContent = ''; $('#capFact').textContent = ''; return; }
  const q = QMAP[id]; $('#capTitle').innerHTML = `<span style="color:${q.color}">●</span> ${q.stop} · ${q.region_name}`; $('#capFact').textContent = q.region_fact;
}

// ================================================================ ROUTER
const homeRoute = () => { SEL = null; paintRegions(); caption(null); goHomeCam(); return pageHome2(); };
const routes = { home: homeRoute, gym: pageGym, game: pageGame, sprint: pageSprint, voice: pageVoice, hands: pageHands, data: pageData, mri: pageMRI, progress: pageProgress, coach: pageCoach, levers: pageLevers, science: pageScience };
async function route() {
  if (!ME?.onboarded) return;
  const [, r = 'home', arg] = (location.hash || '#/').split('/');
  ROUTE = routes[r] ? r : 'home';
  document.body.className = 'r-' + ROUTE;
  const tab = { game: 'gym', sprint: 'gym', mri: 'data', levers: 'data' }[ROUTE] || ROUTE;
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.r === tab));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + ROUTE));
  stage.classList.toggle('dim', !['home', 'gym'].includes(ROUTE) || (ROUTE === 'home' && innerWidth < 1150));
  stage.classList.toggle('side', ROUTE === 'home');
  VIEW_TARGET = ROUTE === 'gym' ? -0.2 : ROUTE === 'home' ? -0.22 : 0;
  if (ROUTE !== 'sprint') G = null;
  try { await routes[ROUTE](arg); }
  catch (e) {   // never leave a blank page: say what broke
    console.error(e);
    const el = $('#p-' + ROUTE);
    if (el) el.innerHTML = `<div class="scrollpage"><div class="wrap"><div class="glass card"><b>⚠ This page couldn't load.</b><p class="muted">${esc(e.message)}</p>
      <p class="muted">If the app was just updated, restart the server (<code>python web/server.py</code>) and refresh the page.</p></div></div></div>`;
  }
}
addEventListener('hashchange', route);

// ================================================================ SPRINT
const SYM = ['◆', '▲', '●', '■', '★', '✚', '⬟', '☾', '♥'];
let G = null;
// 15-second rounds with levels. The server (neurotrail/games.py SPEED_LEVELS) decides the level and whether you passed.
const ruleText = L => `${L.symbols} symbols${L.shuffle ? ' · key reshuffles every 4 correct' : ''} · goal ${L.target} correct`;
function pageSprint() {
  const S = ME.speed, L = S.rule, top = S.passed >= S.top;
  $('#p-sprint').innerHTML = `<div class="sprint-wrap"><div class="arcade gamebox" style="--c:#FFC83D"><a class="close" href="#/gym/speed" style="text-decoration:none;display:grid;place-items:center">✕</a>
    <div class="gwrap"><div id="rail">${railHTML(S)}</div><div id="arcadeBody"></div></div></div></div>`;
  $('#arcadeBody').innerHTML = `<div class="eyebrow">SPEED GAME · LEVEL ${S.level} OF ${S.top}</div><h2 class="gh2">⚡ Speed Sprint</h2>
    <div class="demo" id="demo"></div>
    <p class="muted howto">Match each symbol to its number using the key, as many as you can in ${S.seconds} seconds. Tap the keypad (or keys 1–${L.symbols}).</p>
    <div class="goalcard"><small>LEVEL ${S.level} GOAL</small><b>${L.target} correct with ${Math.round(S.pass_accuracy * 100)}%+ right</b><span>${ruleText(L)} · ${top ? 'every level cleared, keep beating your best' : `unlocks level ${S.level + 1}`}</span></div>
    <div class="muted">your best at level ${S.level}: <b>${S.best_here ?? '–'}</b> · ${ME.rounds_today} round${ME.rounds_today === 1 ? '' : 's'} today ${ME.rounds_today >= 2 ? '· booster done ✓' : ''}</div>
    <div class="row" style="justify-content:center"><button class="cta" id="goBtn">▶ Start level ${S.level}${ME.rounds_today === 1 ? ' · booster round' : ''}</button></div>
    <p class="muted" style="max-width:560px;margin:14px auto 0;font-size:12px">Modeled on the Digit Symbol Substitution Test. Speed training with boosters was the only ACTIVE-trial arm linked to fewer dementia diagnoses (HR 0.75).</p>`;
  startDemo($('#demo'), 'speed');
  $('#goBtn').onclick = startGame;
}
function newKey(n) { const d = Array.from({ length: n }, (_, i) => i + 1).sort(() => Math.random() - .5); return Object.fromEntries(SYM.slice(0, n).map((s, i) => [s, d[i]])); }
function nextSym() { const pool = SYM.slice(0, G.L.symbols); let nx; do { nx = pool[Math.floor(Math.random() * pool.length)]; } while (nx === G.tgt); return nx; }
function drawKey() { $('#keyrow').innerHTML = Object.keys(G.key).sort((a, b) => G.key[a] - G.key[b]).map(s => `<div><b>${s}</b><span>${G.key[s]}</span></div>`).join(''); }
function startGame() {
  const L = ME.speed.rule;
  G = { L, T: ME.speed.seconds, bestHere: ME.speed.best_here, key: newKey(L.symbols), t0: performance.now(), ok: 0, bad: 0, combo: 0, best: 0, tgt: null, over: false };
  G.tgt = nextSym();
  $('#arcadeBody').innerHTML = `<div class="eyebrow">LEVEL ${L.level} · ${ruleText(L)}</div>
    <div class="a-top"><div class="a-stat"><small>CORRECT</small><span id="aOk">0</span></div>
      <div class="timer"><svg width="120" height="120"><circle cx="60" cy="60" r="52" stroke="rgba(255,255,255,.1)" stroke-width="8" fill="none"/><circle id="tRing" cx="60" cy="60" r="52" stroke="#59F0FF" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="326.7" style="filter:drop-shadow(0 0 8px #59F0FF)"/></svg><div class="t" id="tLeft">${G.T}</div></div>
      <div class="a-stat"><small>ERRORS</small><span id="aBad">0</span></div></div>
    <div class="goalbar"><i id="gBar"></i><span id="gTxt">0 / ${L.target} to pass</span></div>
    <div class="symbol" id="sym">${G.tgt}</div><div class="combo" id="combo"></div>
    <div class="keyrow" id="keyrow"></div>
    <div class="pad" style="grid-template-columns:repeat(${L.symbols},1fr);max-width:${L.symbols * 90}px;margin:0 auto">${Array.from({ length: L.symbols }, (_, i) => `<button data-n="${i + 1}">${i + 1}</button>`).join('')}</div>`;
  drawKey();
  $$('.pad button').forEach(b => b.onclick = () => answer(+b.dataset.n, b)); tick();
}
function answer(n, btn) {
  if (!G || G.over) return;
  btn = btn || $(`.pad button[data-n="${n}"]`); btn?.classList.add('hit'); setTimeout(() => btn?.classList.remove('hit'), 100);
  const sym = $('#sym'); sym.classList.remove('ok', 'bad'); void sym.offsetWidth;
  let shuffled = false;
  if (G.key[G.tgt] === n) {
    G.ok++; G.combo++; G.best = Math.max(G.best, G.combo); sym.classList.add('ok');
    if (G.L.shuffle && G.ok % 4 === 0) { G.key = newKey(G.L.symbols); drawKey(); shuffled = true; const k = $('#keyrow'); k.classList.remove('shuf'); void k.offsetWidth; k.classList.add('shuf'); }
  } else { G.bad++; G.combo = 0; sym.classList.add('bad'); }
  G.tgt = nextSym(); setTimeout(() => (sym.textContent = G.tgt), 90);
  $('#aOk').textContent = G.ok; $('#aBad').textContent = G.bad;
  $('#combo').textContent = shuffled ? '🔀 KEY SHUFFLED' : G.combo >= 3 ? `×${G.combo} COMBO` : '';
  $('#gBar').style.width = Math.min(100, G.ok / G.L.target * 100) + '%'; $('#gBar').classList.toggle('full', G.ok >= G.L.target);
  $('#gTxt').textContent = G.ok >= G.L.target ? 'goal reached ✓ keep going' : `${G.ok} / ${G.L.target} to pass`;
}
addEventListener('keydown', e => { if (G && !G.over && /^[1-9]$/.test(e.key) && +e.key <= G.L.symbols) answer(+e.key); });
function tick() {
  if (!G || G.over) return;
  const left = Math.max(0, G.T - (performance.now() - G.t0) / 1000);
  $('#tLeft').textContent = Math.ceil(left); $('#tRing').style.strokeDashoffset = 326.7 * (1 - left / G.T); if (left <= 5) $('#tRing').setAttribute('stroke', '#FF5A6E');
  if (left <= 0) return endGame(); requestAnimationFrame(tick);
}
async function endGame() {
  G.over = true;
  const r = await api(`/api/player/${enc(ME.name)}/speed`, { correct: G.ok, wrong: G.bad, best_combo: G.best });
  const R = r.round, acc = G.ok / Math.max(1, G.ok + G.bad), pct = Math.round(r.speed.pass_accuracy * 100); ME = r; renderHUD();
  const why = R.passed ? '' : G.ok < R.target ? `${R.target - G.ok} more correct needed to pass.` : `Goal reached, but accuracy was ${(acc * 100).toFixed(0)}% (needs ${pct}%+). Fewer wrong taps!`;
  const msg = R.unlocked ? `<div class="unlock">🔓 Level ${R.unlocked} unlocked! <b>+${r.level_bonus} ⚡</b></div>` : R.new_clear ? `<div class="unlock">🏆 You cleared the final level! <b>+${r.level_bonus} ⚡</b></div>` : R.passed ? '' : `<p class="why">${why}</p>`;
  const burst = R.new_clear ? `<div class="confetti">${'⚡✨🎉⭐'.repeat(5).split('').filter(c => c.trim()).map((c, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 5) * .08}s">${c}</i>`).join('')}</div>` : '';
  $('#rail').innerHTML = railHTML(r.speed);
  $('#arcadeBody').innerHTML = `${burst}<div class="resbadge ${R.passed ? 'win' : 'lose'}">${R.passed ? `✓ LEVEL ${R.level} PASSED` : `✗ LEVEL ${R.level} · NOT YET`}</div>
    <div class="a-big">${G.ok}</div><div class="muted">correct in ${G.T} seconds · goal ${R.target} · ${(acc * 100).toFixed(0)}% accuracy · best combo ×${G.best} · round ${r.rounds_today} today</div>
    ${msg}${G.bestHere != null && G.ok > G.bestHere ? '<div style="margin-top:8px"><span class="pb">NEW BEST AT THIS LEVEL</span></div>' : ''}
    ${r.rounds_today === 1 ? '<p class="muted">Play one more round today as a booster: in the ACTIVE trial, only speed training with boosters was linked to fewer dementia diagnoses.</p>' : ''}
    ${boardHTML(r.leaderboard, 5)}
    <div class="row" style="justify-content:center"><button class="cta" id="againBtn">${R.unlocked ? `▶ Play level ${R.unlocked}` : '↻ Play again'}</button>
      <a class="ghost" href="#/gym/speed" style="text-decoration:none">Brain Gym</a></div>`;
  $('#againBtn').onclick = startGame; G = null;
}

// ================================================================ PROGRESS (every source, each its own variable)
const PST = { improving: ['🟢', 'Improving', '#3DDC97'], steady: ['🔵', 'Steady', '#59F0FF'], slipping: ['🟠', 'Slipping', '#FF9F43'],
  building: ['⏳', 'Building', '#9AA3C7'], snapshot: ['📸', 'One snapshot', '#9AA3C7'], stale: ['💤', 'Old data', '#9AA3C7'],
  none: ['➕', 'Not started', '#6B7399'], activity: ['✅', 'Activity', '#9B7BFF'] };
function pfmt(v, unit) {
  if (v == null) return '–';
  if (unit === 'steps') return Math.round(v).toLocaleString();
  if (unit === 'share') return Math.round(v * 100) + '%';
  const a = Math.abs(v);
  return (a >= 100 ? Math.round(v) : a >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '')) + '';
}
function pvar(v) {
  const [ic, word, col] = PST[v.status] || PST.none, u = v.unit === 'share' ? '' : ` ${v.unit ?? ''}`;
  const sign = x => (x > 0 ? '+' : x < 0 ? '−' : '±') + pfmt(Math.abs(x), v.unit);
  const change = v.change != null ? `<div class="pv-ch">${sign(v.change)}${u} vs ${v.baseline_label || 'first scan'} <span class="muted">(counts if over ${pfmt(v.threshold, v.unit)}${u})</span></div>` : '';
  const pct = v.vs_others ? `<div class="pv-pct">${esc(v.vs_others.text)} <span class="muted">(NHANES, 60+)</span></div>` : '';
  const err = v.error ? ` <span class="muted">±${v.error}</span>` : '';
  const latest = v.status === 'none' ? `<a class="pv-go" href="${v.link || '#/data'}">Start →</a>` : `<div class="pv-val">${pfmt(v.recent ?? v.latest, v.unit)}<small>${u}${err}</small></div>`;
  return `<div class="pvar glass" style="--c:${col}">
    <div class="pv-top"><b>${v.icon ? v.icon + ' ' : ''}${esc(v.label)}</b><span class="pv-st" title="${word}">${ic} ${word}</span></div>
    <div class="pv-src">${esc(v.source || '')}${v.domain ? ' · ' + esc(v.domain) : ''}${v.n ? ` · ${v.n} ${v.n === 1 ? 'point' : 'points'}` : ''}${v.latest_date ? ` · last ${String(v.latest_date).slice(0, 10)}` : ''}</div>
    ${latest}${v.recent != null && v.recent !== v.latest ? `<div class="muted pv-sub">${v.recent_label}</div>` : ''}
    ${change}${v.need ? `<div class="pv-need">Needs ${esc(v.need)} to show a trend</div>` : ''}${v.stale_days ? `<div class="pv-need">${v.source === 'game' ? 'Last played' : 'No new data for'} ${v.stale_days} days${v.source === 'game' ? ' ago' : ''}</div>` : ''}
    ${v.practice_skipped ? `<div class="muted pv-sub">First ${v.practice_skipped} plays skipped as practice</div>` : ''}${v.format ? `<div class="muted pv-sub">Compared within: ${esc(v.format)}</div>` : ''}${v.level_reached ? `<div class="pv-pct">🏅 Level ${v.level_reached}${v.level_top ? ' of ' + v.level_top : ''} cleared</div>` : ''}${pct}
    ${v.points?.length > 2 ? `<div class="pv-spark"><canvas id="sp_${v.id}"></canvas></div>` : ''}
    ${v.research || v.note ? `<details class="pv-more"><summary>What this means</summary>${v.research ? `<p>${esc(v.research)}</p>` : ''}${v.note ? `<p class="muted">${esc(v.note)}</p>` : ''}</details>` : ''}
  </div>`;
}
async function pageProgress() {
  const [O, P] = await Promise.all([api(`/api/player/${enc(ME.name)}/overview`), api(`/api/player/${enc(ME.name)}/progress?days=30`)]);
  const S = O.summary, short = d => d.slice(5), V = O.variables;
  $('#p-progress').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">Your progress</div>
    <div class="sub">Everything we collect, from your watch, games, voice, hands, hearing and MRI. Each one is shown on its own and compared with <b>your own</b> starting point.</div>
    <div class="pcov">${O.coverage.map(c => `<a class="pchip ${c.ok ? (c.stale ? 'stale' : 'on') : ''}" href="${c.link}" title="${esc(c.detail)}"><span>${c.icon}</span><b>${c.label}</b><small>${c.ok ? esc(c.detail) : 'Add →'}</small></a>`).join('')}</div>
    <div class="psum">${[['improving', 'getting better'], ['steady', 'holding steady'], ['slipping', 'slipping'], ['building', 'still collecting']].map(([k, l]) =>
      `<div class="kpi" style="--c:${PST[k][2]}"><div class="v" style="color:${PST[k][2]}">${S[k] || 0}</div><div class="l">${PST[k][0]} measures ${l}</div></div>`).join('')}</div>
    ${O.links.length ? `<div class="glass chartcard plinks"><h4>🔗 How your data fits together</h4><div class="muted">Patterns in your own data, not proof of cause</div>${O.links.map(l => `<p>${esc(l.text)}</p>`).join('')}</div>` : ''}
    ${O.groups.filter(g => g.n).map(g => `<section class="pgroup"><div class="pg-head"><h3>${g.title}</h3><span class="muted">${g.sub}</span>
        <span class="pg-c">${['improving', 'steady', 'slipping'].filter(k => g.counts[k]).map(k => `${PST[k][0]} ${g.counts[k]}`).join(' ')}</span></div>
      <div class="pgrid">${V.filter(v => v.group === g.id).map(pvar).join('')}</div></section>`).join('')}
    ${O.groups.filter(g => !g.n).length ? `<div class="glass chartcard"><h4>Not connected yet</h4><div class="pmissing">${O.groups.filter(g => !g.n).map(g => `<span>${g.title}: <span class="muted">${g.sub}</span></span>`).join('')}</div></div>` : ''}
    <details class="glass chartcard prules"><summary><b>How we read your data</b> <span class="muted">(the rules)</span></summary><ul>${O.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      ${O.model ? `<p><b>Watch model.</b> ${esc(O.model.text)} Data: <a href="${O.model.sources.physionet_steps}" target="_blank" rel="noopener">PhysioNet NHANES step counts</a> · <a href="${O.model.sources.nhanes_pax}" target="_blank" rel="noopener">CDC NHANES wrist tracker</a>.</p>` : ''}</details>
    <h3 class="pact">📅 Your activity</h3>
    <div class="charts">
      <div class="glass chartcard"><h4>🗓 Consistency</h4><div class="muted">each square is a day; brighter = more check-ins</div>
        <div class="heat">${P.days.map((d, i) => `<div title="${d}: ${P.quests_per_day[i]} check-ins" style="background:${P.quests_per_day[i] ? `rgba(89,240,255,${.2 + P.quests_per_day[i] / 9 * .8})` : 'rgba(255,255,255,.06)'}"></div>`).join('')}</div></div>
      <div class="glass chartcard"><h4>⚡ Sparks per day</h4><div class="muted">last 30 days · ${P.totals.streak}-day streak · ${P.totals.quests} check-ins</div><canvas id="cSparks"></canvas></div>
    </div>
    <details class="glass chartcard" style="margin-top:16px"><summary><b>📜 Activity log</b> <span class="muted">newest first</span></summary>
      ${P.log.length ? `<table class="t"><tr><th>When</th><th>Check-in</th><th>Value</th><th>Sparks</th></tr>${P.log.map(l => `<tr><td>${l.ts.replace('T', ' ')}</td><td>${QMAP[l.quest]?.icon} ${QMAP[l.quest]?.title}</td><td>${l.value ?? ''} ${l.activity ? '· ' + esc(l.activity) : ''}${l.who ? '· ' + esc(l.who) : ''}${l.path ? esc(l.path) : ''}</td><td>+${l.sparks}</td></tr>`).join('')}</table>` : '<div class="empty">Your log is empty.</div>'}</details>
  </div></div>`;
  chart('cSparks', { type: 'bar', data: { labels: P.days.map(short), datasets: [{ label: 'sparks', data: P.sparks_per_day, backgroundColor: 'rgba(255,200,61,.7)', borderRadius: 6 }] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  V.filter(v => v.points?.length > 2).forEach(v => {
    const col = (PST[v.status] || PST.none)[2];
    chart('sp_' + v.id, { type: 'line', data: { labels: v.points.map(p => String(p.date).slice(0, 10)), datasets: [{ data: v.points.map(p => p.value), borderColor: col, backgroundColor: col + '22', fill: true, pointRadius: v.points.length > 30 ? 0 : 2, tension: .3, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${pfmt(c.parsed.y, v.unit)} ${v.unit === 'share' ? '' : v.unit}` } } }, scales: { x: { display: false }, y: { display: false } } } });
  });
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
    ${p.items.map(i => `<div class="pi"><b>${esc(i.day)}</b><span>${QMAP[i.quest_id]?.icon || ''}</span><span style="color:#DDE2FA">${esc(i.action)}</span></div>`).join('')}</div>`).join('')
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
const PHQO = ['Not at all', 'Several days', 'Over half the days', 'Nearly every day'];
const EDU = ['Less than 9th grade', '9–11th grade', 'High school / GED', 'Some college / AA', 'College graduate+'];
let OB = null, obStep = 0;
function openOnboard() { OB = { age: 65, female: true, educ: 4, income_pir: 2.5, sbp: 130, diabetes: false, current_smoker: false, active_min_week: 90, sedentary_min_day: 420, sleep_hours: 7, phq: Array(9).fill(0) }; obStep = 0; openOv('onboard'); renderOb(); }
function stepper(k, min, max, step, unit = '') { return `<div class="toggle" style="align-items:center"><button class="chip" data-dec="${k}" data-st="${step}" data-min="${min}">−</button><b style="font:700 22px 'Space Grotesk';min-width:90px;text-align:center" id="ob_${k}">${OB[k]}${unit}</b><button class="chip" data-inc="${k}" data-st="${step}" data-max="${max}">+</button></div>`; }
function renderOb() {
  const pages = [
    () => `<div class="eyebrow">VIBE CHECK · 1/5</div><h2>About you 👋</h2><p class="muted">30 secs. Stays on this device.</p>
      <div class="q-grid ob"><div><label>Age</label>${stepper('age', 18, 100, 1)}</div>
      <div><label>Sex</label><div class="toggle"><button class="chip ${OB.female ? 'on' : ''}" data-b="female" data-v="1">Female</button><button class="chip ${!OB.female ? 'on' : ''}" data-b="female" data-v="0">Male</button></div></div>
      <div><label>School</label><select data-k="educ">${EDU.map((e, i) => `<option value="${i + 1}" ${OB.educ === i + 1 ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div><label>Income vs poverty line: <b>${OB.income_pir}×</b></label><input type="range" min="0" max="5" step=".1" data-k="income_pir" value="${OB.income_pir}"></div></div>`,
    () => `<div class="eyebrow">VIBE CHECK · 2/5</div><h2>Heart stuff ❤️</h2>
      <div class="q-grid ob"><div><label>Blood pressure (top number)</label>${stepper('sbp', 80, 220, 2, ' mmHg')}</div><div></div>
      <div><label>Diabetes?</label><div class="toggle"><button class="chip ${OB.diabetes ? 'on' : ''}" data-b="diabetes" data-v="1">Yes</button><button class="chip ${!OB.diabetes ? 'on' : ''}" data-b="diabetes" data-v="0">No</button></div></div>
      <div><label>Smoke?</label><div class="toggle"><button class="chip ${OB.current_smoker ? 'on' : ''}" data-b="current_smoker" data-v="1">Yes</button><button class="chip ${!OB.current_smoker ? 'on' : ''}" data-b="current_smoker" data-v="0">No</button></div></div></div>`,
    () => `<div class="eyebrow">VIBE CHECK · 3/5</div><h2>Your days ☀️</h2>
      <div class="q-grid ob"><div><label>Workout mins / week: <b>${OB.active_min_week}</b></label><input type="range" min="0" max="900" step="10" data-k="active_min_week" value="${OB.active_min_week}"></div>
      <div><label>Sitting mins / day: <b>${OB.sedentary_min_day}</b></label><input type="range" min="0" max="1140" step="10" data-k="sedentary_min_day" value="${OB.sedentary_min_day}"></div>
      <div><label>Sleep / night: <b>${OB.sleep_hours} h</b></label><input type="range" min="2" max="12" step=".5" data-k="sleep_hours" value="${OB.sleep_hours}"></div></div>`,
    () => `<div class="eyebrow">VIBE CHECK · 4/5</div><h2>Mood 🫶</h2><p class="muted">Last 2 weeks, how often…</p>
      <div class="phq">${PHQ.map((q, i) => `<div class="pq"><div>${i + 1}. ${q}</div><div class="chips">${PHQO.map((o, j) => `<button class="chip ${OB.phq[i] === j ? 'on' : ''}" data-phq="${i}" data-v="${j}">${o}</button>`).join('')}</div></div>`).join('')}</div>`,
    () => `<div class="reveal"><div class="eyebrow">VIBE CHECK · 5/5</div><h2>Your brain age gap 🧠</h2><div id="revealBody"><p class="muted">Crunching…</p></div></div>`,
  ];
  $('#obDots').innerHTML = pages.map((_, i) => `<i class="${i <= obStep ? 'on' : ''}"></i>`).join('');
  $('#obBody').innerHTML = pages[obStep]();
  $('#obBack').style.visibility = obStep ? 'visible' : 'hidden'; $('#obNext').textContent = obStep === 4 ? 'Let\'s go 🚀' : 'Next →';
  $$('#obBody [data-k]').forEach(el => el.oninput = () => { OB[el.dataset.k] = +el.value; if (el.type === 'range') el.previousElementSibling.querySelector('b').textContent = el.value + (el.dataset.k === 'income_pir' ? '×' : el.dataset.k === 'sleep_hours' ? ' h' : ''); });
  $$('#obBody [data-b]').forEach(el => el.onclick = () => { OB[el.dataset.b] = el.dataset.v === '1'; renderOb(); });
  $$('#obBody [data-inc],[data-dec]').forEach(el => el.onclick = () => { const k = el.dataset.inc || el.dataset.dec, st = +el.dataset.st;
    OB[k] = el.dataset.inc ? Math.min(+el.dataset.max, OB[k] + st) : Math.max(+el.dataset.min, OB[k] - st); $('#ob_' + k).textContent = OB[k] + (k === 'sbp' ? ' mmHg' : ''); });
  $$('#obBody [data-phq]').forEach(el => el.onclick = () => { OB.phq[+el.dataset.phq] = +el.dataset.v; el.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el)); });
  if (obStep === 4) (async () => {
    const r = await api('/api/lever', { ...OB, phq9: OB.phq.reduce((a, b) => a + b, 0) });
    const top = Object.values(r.per_factor).filter(f => f.years > .05 && f.significant).slice(0, 3);
    $('#revealBody').innerHTML = `<div class="yrs grad">${Math.abs(r.years).toFixed(1)} yrs ${r.years >= 0 ? 'older' : 'younger'}</div>
      <p>That's how your habits make your brain speed look. ${r.years > 0.05 ? 'Fixable 💪' : 'Keep it up 🔥'}</p>
      ${top.length ? `<p>Biggest wins: ${top.map(f => `<b style="color:#FFC83D">${f.label}</b>`).join(', ')}</p>` : ''}
      <p class="muted tiny-note">CDC data on ${r.n.toLocaleString()} people. A link, not a diagnosis.</p>`;
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
  let p;
  try { p = await api('/api/players', { name: n }); }
  catch (e) {
    // a network failure is a TypeError; anything else is the server explaining what's wrong with the name
    return toast(e instanceof TypeError ? 'Couldn\'t reach the NeuroTrail server. Start it with: python3 web/server.py' : (typeof e.message === 'string' && !e.message.includes('[object') ? e.message : 'That name didn\'t work. Try another.'), 6000);
  }
  localStorage.setItem('nt_player', p.name); closeOv('welcome');
  if (p.name !== n.trim()) toast(`You're in as ${p.name}`);
  await boot();
}
$('#startBtn').onclick = () => { const n = $('#newName').value.trim(); if (!n) { $('#newName').focus(); return toast('Drop a name first 👆 (or go guest)'); } startAs(n); };
// Braces matter: a handler that returns false cancels the key press, which blocked typing.
$('#newName').onkeydown = e => { if (e.key === 'Enter') $('#startBtn').click(); };
$('#guestBtn').onclick = async () => { const ps = await api('/api/players').catch(() => []); let i = 1; while (ps.some(p => p.name === `Guest ${i}`)) i++; startAs(`Guest ${i}`); };
// The start page always comes first. If you've been here before it's one tap to carry on.
async function showWelcome() {
  openOv('welcome');
  const last = localStorage.getItem('nt_player');
  const ps = await api('/api/players').catch(() => []);
  const mine = last && ps.find(p => p.name === last);
  $('#wlBack').innerHTML = mine ? `<button class="cta wl-continue" id="contBtn">Continue as <b></b> →</button><div class="wl-or">or start fresh</div>` : '';
  if (mine) { $('#contBtn b').textContent = mine.name; $('#contBtn').onclick = () => { closeOv('welcome'); boot(); }; $('#contBtn').focus(); }
  else setTimeout(() => $('#newName').focus(), 50);
  const others = ps.filter(p => p.name !== last);
  $('#wlOthers').hidden = !others.length;
  $('#existing').innerHTML = others.map(p => `<button class="chip" data-p="${esc(p.name)}">${esc(p.name)} · ${p.sparks} ⚡</button>`).join('');
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
  window.NTX = { api, toast, chart, chartOpts, renderHUD, fmt, gameBrain, QMAP: () => QMAP, getME: () => ME, setME: (m) => { ME = m; } };
  // Show the page first; build the 3D brain (2 MB, a few seconds of work) afterwards. It used to block every page.
  frame(); await showWelcome();
  (window.requestIdleCallback || (f => setTimeout(f, 50)))(() => loadBrain().catch(() => { }));
  window.NT = { camera, hemis, step: (dt, n = 1) => { for (let i = 0; i < n; i++) update(dt); composer.render(); }, get me() { return ME; } };
})();
