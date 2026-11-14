// Camera movement games. Pose tracking runs entirely in the browser (MediaPipe Pose Landmarker, lite
// model, GPU when available): the video never leaves the device and nothing is uploaded.
// The test logic lives in movelogic.js so it can be checked without a camera.
import { ChairCounter, BalanceTimer, ReachGame, Smoother, inView, body, BONES } from './movelogic.js?v=3';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const $ = (s, r = document) => r.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let LM = null, CAM = null, AUDIO = null;

function landmarker() {
  LM ||= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(`${MP}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const make = delegate => PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { const l = await make('GPU'); l.delegate = 'GPU'; return l; } catch { const l = await make('CPU'); l.delegate = 'CPU'; return l; }
  })();
  return LM.catch(e => { LM = null; throw e; });
}
// Load the model and run a few blank frames so the GPU compiles its shaders before the game starts
// (the first frames are otherwise 5-10x slower, which shows up as lag).
let WARM = null;
export const warmUp = () => (WARM ||= landmarker().then(l => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 240;
  c.getContext('2d').fillRect(0, 0, 320, 240);
  for (let i = 0; i < 3; i++) try { l.detectForVideo(c, performance.now()); } catch { }
}).catch(() => { WARM = null; }));

export function stopCamera() {
  if (!CAM) return;
  CAM.stopped = true; cancelAnimationFrame(CAM.raf);
  CAM.stream?.getTracks().forEach(t => t.stop());
  CAM = null;
}

function beep(freq = 880, ms = 90, vol = 0.08) {
  try {
    AUDIO ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = AUDIO.createOscillator(), g = AUDIO.createGain();
    o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(AUDIO.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, AUDIO.currentTime + ms / 1000); o.stop(AUDIO.currentTime + ms / 1000);
  } catch { }
}

const NEED = { chair: ['shoulders', 'hips', 'knees'], balance: ['shoulders', 'hips', 'knees', 'feet'], reach: ['head', 'shoulders', 'hips'] };
const SETUP = {
  chair: 'Sit on a sturdy chair (against a wall), feet flat, arms crossed on your chest. Put the camera where it sees you from head to knees.',
  balance: 'Stand near a wall or a sturdy chair you can grab. Step back until the camera sees your feet.',
  reach: 'Stand or sit so your head, arms and hips are in view. Arm\'s length from anything around you.',
};
const PART_NAME = { head: 'head', shoulders: 'shoulders', hips: 'hips', knees: 'knees', feet: 'feet' };

/**
 * Runs one movement game in `box`. `alive()` turns false when the player leaves the page.
 * `done(score, detail, lines)` saves and shows the result.
 */
export async function playMove(g, { box, alive, done }) {
  stopCamera();
  beep(1, 1, 0.0001);   // unlock audio inside the Start click
  box.innerHTML = `<div class="mv-load"><div class="spinner"></div><p class="muted">Starting the camera…</p>
    <p class="tiny"><i class="ti ti-lock" aria-hidden="true"></i> Tracking runs on this device. Video is never uploaded or saved.</p></div>`;
  let stream, lm;
  try {
    [stream, lm] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } }),
      landmarker()]);
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop());
    const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError', none = e?.name === 'NotFoundError';
    box.innerHTML = `<div class="mv-load"><span class="ico lg rose" style="margin:0 auto"><i class="ti ti-camera-off" aria-hidden="true"></i></span>
      <h3>${denied ? 'Camera access is off' : none ? 'No camera found' : 'Couldn\'t start motion tracking'}</h3>
      <p class="muted">${denied ? 'Allow the camera for this site (the camera icon in the address bar), then try again.' : none ? 'Plug in or turn on a camera, then try again.' : 'Check your internet connection (the tracking model loads once, about 5 MB), then try again.'}</p>
      <button class="btn accent" id="mvRetry">Try again</button></div>`;
    $('#mvRetry', box).onclick = () => playMove(g, { box, alive, done });
    return;
  }
  if (!alive()) { stream.getTracks().forEach(t => t.stop()); return; }

  box.innerHTML = `<div class="mv">
    <div class="mv-stage"><video playsinline muted></video><canvas></canvas>
      <div class="mv-top"><span class="mv-pill" id="mvStatus">Getting in position</span><span class="mv-pill ghost" id="mvFps"></span></div>
      <div class="mv-big" id="mvBig"></div><div class="mv-sub" id="mvSub"></div>
      <div class="mv-bar"><i id="mvBar"></i></div></div>
    <p class="mv-tip" id="mvTip">${SETUP[g.id]}</p>
    <button class="btn secondary" id="mvStop">Stop</button></div>`;
  const video = $('video', box), canvas = $('canvas', box), ctx = canvas.getContext('2d');
  const ui = { status: $('#mvStatus', box), fps: $('#mvFps', box), big: $('#mvBig', box), sub: $('#mvSub', box), bar: $('#mvBar', box), tip: $('#mvTip', box) };
  const set = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  video.srcObject = stream;
  await video.play().catch(() => { });
  await new Promise(r => video.readyState >= 2 ? r() : video.onloadeddata = r);
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const A = video.videoWidth / video.videoHeight;

  const cam = CAM = { stream, raf: 0, stopped: false };
  $('#mvStop', box).onclick = () => { stopCamera(); done(null); };   // null = stopped early: nothing saved

  const game = GAMES[g.id](ui, set);
  const sm = new Smoother();
  let lastVT = -1, phase = 'frame', okSince = null, countAt = 0, msEMA = 0, frames = 0, fpsT = performance.now(), fps = 0, lostSince = null;

  const loop = () => {
    if (cam.stopped || !alive()) { if (CAM === cam) stopCamera(); return; }
    cam.raf = requestAnimationFrame(loop);
    if (video.currentTime === lastVT) return;      // no new camera frame yet: skip (keeps the main thread free)
    lastVT = video.currentTime;
    const now = performance.now(), t0 = now;
    let res; try { res = lm.detectForVideo(video, now); } catch { return; }
    msEMA = msEMA ? msEMA * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0;
    frames++; if (now - fpsT > 1000) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; set(ui.fps, `${fps} fps`); }
    const raw = res.landmarks?.[0], pose = raw ? sm.push(raw) : null;
    if (!raw) sm.s = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pose) drawSkeleton(ctx, pose, canvas.width, canvas.height, game.hot);

    if (phase === 'frame') {
      const v = inView(pose, NEED[g.id]);
      const extra = v.ok ? game.ready(pose, A) : { ok: false };
      if (v.ok && extra.ok) {
        okSince ??= now;
        set(ui.status, 'Hold still…'); ui.bar.style.width = `${Math.min(100, (now - okSince) / 8)}%`;
        if (now - okSince > 800) { phase = 'count'; countAt = now; game.calibrate?.(pose, A); }
      } else {
        okSince = null; ui.bar.style.width = '0%';
        set(ui.status, !pose ? 'Can\'t see you yet' : !v.ok ? `Can't see your ${v.missing.map(m => PART_NAME[m]).join(' & ')}` : extra.msg);
      }
    } else if (phase === 'count') {
      const left = 3 - Math.floor((now - countAt) / 1000);
      if (left !== ui._count) { ui._count = left; if (left > 0) beep(660, 80); }
      set(ui.status, 'Get ready'); set(ui.big, left > 0 ? String(left) : 'Go!'); set(ui.sub, game.goText);
      if (left <= 0) { phase = 'go'; beep(1200, 160); game.start(now); ui.big.classList.add('play'); ui.bar.style.width = '0%'; }
    } else if (phase === 'go') {
      if (!pose) { lostSince ??= now; if (now - lostSince > 600) set(ui.status, 'Lost you: stay in view'); }
      else lostSince = null;
      const r = game.update(pose, A, now, ctx, canvas);
      if (r?.done && r.retry) {   // a setup problem, not a result: save nothing
        phase = 'end'; stopCamera();
        box.innerHTML = `<div class="mv-load"><span class="ico lg amber" style="margin:0 auto"><i class="ti ti-eye-question" aria-hidden="true"></i></span>
          <p class="muted" style="max-width:420px">${r.retry}</p><button class="btn accent" id="mvRetry">Try again</button></div>`;
        $('#mvRetry', box).onclick = () => playMove(g, { box, alive, done });
      } else if (r?.done) {
        phase = 'end';
        stopCamera(); beep(990, 120); setTimeout(() => beep(1320, 200), 140);
        done(r.score, { ...r.detail, fps, infer_ms: Math.round(msEMA), delegate: lm.delegate }, r.lines);
      }
    }
  };
  cam.raf = requestAnimationFrame(loop);
}

function drawSkeleton(ctx, lm, W, H, hot = []) {
  ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, W / 160);
  for (const [a, b] of BONES) {
    const p = lm[a], q = lm[b];
    if ((p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
    ctx.strokeStyle = hot.includes(a) && hot.includes(b) ? 'rgba(250,204,21,.95)' : 'rgba(45,212,191,.85)';
    ctx.beginPath(); ctx.moveTo(p.x * W, p.y * H); ctx.lineTo(q.x * W, q.y * H); ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = lm[i]; if ((p.visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.arc(p.x * W, p.y * H, Math.max(3, W / 200), 0, 7); ctx.fill();
  }
}

const fmt = s => (Math.round(s * 10) / 10).toFixed(1);

const GAMES = {
  // ---------------------------------------------------------------- 30-second chair stand
  chair(ui, set) {
    const c = new ChairCounter(); let t0 = 0; const DUR = 30000;
    return {
      hot: [23, 24, 25, 26],
      goText: 'Stand up fully, sit down fully. Repeat!',
      ready(lm, A) {
        const r = ChairCounter.ratio(lm, A);
        return r < 0.55 ? { ok: true } : { ok: false, msg: 'Sit down to start' };
      },
      calibrate(lm, A) { c.calibrate(ChairCounter.ratio(lm, A), body(lm, A).torso); },
      start(t) { t0 = t; },
      update(lm, A, t) {
        const left = Math.max(0, DUR - (t - t0));
        if (lm) { const r = c.update(lm, A, t); if (r.event === 'rep') beep(1040, 70);
          set(ui.status, r.armsCrossed ? (r.state === 'up' ? 'Standing ✓' : 'Seated') : 'Keep your arms crossed');
        }
        set(ui.big, String(c.reps)); set(ui.sub, `stands · ${Math.ceil(left / 1000)} s left`);
        ui.bar.style.width = `${100 * (1 - left / DUR)}%`;
        if (left > 0) return null;
        const reps = c.reps + c.finalCredit(), arms = c.armsOffShare;
        return { done: true, score: reps, detail: { stands: reps, arms_uncrossed_share: Math.round(arms * 100) / 100 },
          lines: [arms > 0.25 ? 'Your hands left your chest for part of the test. For a fair score, keep them crossed (pushing off your legs makes it easier).' : ''] };
      },
    };
  },

  // ---------------------------------------------------------------- one-leg stand
  balance(ui, set) {
    const b = new BalanceTimer({ max: 30000 }); let t0 = 0;
    return {
      hot: [23, 25, 27, 24, 26, 28],
      goText: 'Lift one foot off the floor and hold. Eyes open.',
      ready(lm, A) {
        const l = lm[27].y, r = lm[28].y, d = Math.abs(l - r) / body(lm, A).torso;
        return d < 0.06 ? { ok: true } : { ok: false, msg: 'Both feet on the floor to start' };
      },
      start(t) { t0 = t; },
      update(lm, A, t) {
        const s = b.update(lm, A, t);
        if (s.state === 'ready') {
          set(ui.status, 'Lift a foot'); set(ui.big, '0.0'); set(ui.sub, 'seconds');
          if (t - t0 > 20000) return { done: true, retry: 'We didn\'t see a foot lift, so nothing was saved. Make sure both feet are in view, then lift one clearly off the floor.' };
          return null;
        }
        if (s.state === 'holding') { set(ui.status, `Holding on your ${s.foot === 'left' ? 'right' : 'left'} leg`); set(ui.big, fmt(s.held)); set(ui.sub, 'seconds (max 30)'); ui.bar.style.width = `${s.held / 30 * 100}%`; return null; }
        const held = Math.round(s.held * 10) / 10;
        return { done: true, score: held, detail: { seconds: held, raised_foot: s.foot, ended: s.reason, sway_pct_torso: Math.round(s.sway * 10) / 10 },
          lines: [s.reason === 'lost' ? 'We lost sight of your feet, so the timer stopped there.' : s.reason === 'time' ? 'You reached the 30-second maximum.' : '',
            s.sway ? `Sideways sway: ${fmt(s.sway)}% of your torso length (lower is steadier). Compare with your own later tries.` : ''] };
      },
    };
  },

  // ---------------------------------------------------------------- reach go / no-go
  reach(ui, set) {
    const r = new ReachGame({ duration: 40000 }); let flash = null;
    return {
      hot: [11, 13, 15, 12, 14, 16],
      goText: 'Touch GREEN with either hand. Leave RED alone.',
      ready: () => ({ ok: true }),
      start(t) { r.start(t); },
      update(lm, A, t, ctx, canvas) {
        const out = r.update(lm, A, t);
        for (const e of out.events) {
          if (e.type === 'hit') { beep(1180, 60); flash = { ...e.target, c: 'rgba(34,197,94,', t }; }
          if (e.type === 'false') { beep(220, 160, 0.1); flash = { ...e.target, c: 'rgba(239,68,68,', t }; }
        }
        const W = canvas.width, H = canvas.height, tg = r.target;
        if (tg) {
          const age = (t - tg.born) / r.life, x = tg.x / A * W, y = tg.y * H, rad = tg.r * H;
          ctx.fillStyle = tg.red ? 'rgba(239,68,68,.55)' : 'rgba(34,197,94,.55)';
          ctx.strokeStyle = tg.red ? '#ef4444' : '#22c55e'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.arc(x, y, rad + 8, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * (1 - age)); ctx.stroke();
          if (tg.red) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; const k = rad * 0.45; ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke(); }
        }
        if (flash && t - flash.t < 250) { const k = (t - flash.t) / 250; ctx.strokeStyle = flash.c + (1 - k) + ')'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(flash.x / A * W, flash.y * H, flash.r * H * (1 + k), 0, 7); ctx.stroke(); }
        set(ui.big, String(r.score)); set(ui.sub, `points · ${Math.ceil((out.left ?? 0) / 1000)} s left`);
        set(ui.status, `${r.hits} hit · ${r.falseTouches} red touched`);
        ui.bar.style.width = `${100 * (1 - (out.left ?? 0) / r.duration)}%`;
        if (!out.done) return null;
        if (r.hits + r.falseTouches === 0) return { done: true, retry: 'We didn\'t see any touches, so nothing was saved. Make sure your hands and arms are in view, then reach right into the circles.' };
        const med = r.medianRt;
        return { done: true, score: r.score, detail: { hits: r.hits, misses: r.misses, red_touched: r.falseTouches, red_avoided: r.avoids, median_reach_ms: med },
          lines: [`${r.hits} green touched, ${r.misses} missed, ${r.falseTouches} red touched${med ? ` · typical reach ${med} ms` : ''}.`] };
      },
    };
  },
};
