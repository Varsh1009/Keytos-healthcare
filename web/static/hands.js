// ✋ Hand check: hold still (tremor), open-close fist, finger taps. Three 10-second tasks from the
// neurologist's movement exam (MDS-UPDRS 3.15, 3.5, 3.4).
// The browser only tracks 21 points on your hand (MediaPipe Hand Landmarker, on this device) and
// sends those points to the server, which does all the analysis (neurotrail/handcheck.py).
// The video itself never leaves the device.
const X = () => window.NTX;
const $ = (s, r = document) => r.querySelector(s);
const me = () => X().getME();
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const SECS = 10;
const TASKS = [
  { id: 'steady', icon: '🖐', title: 'Hold your hand still', how: 'Arm out in front of you, palm facing the camera, fingers spread. Keep it as still as you can.', live: 'Hold still…' },
  { id: 'fist', icon: '✊', title: 'Open and close your fist', how: 'Make a tight fist, then open your hand wide. As fast and as fully as you can.', live: 'fists' },
  { id: 'tap', icon: '👌', title: 'Tap your index finger on your thumb', how: 'As fast and as wide as you can. Touch, then open wide, again and again.', live: 'taps' },
];
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

let LM = null, CAM = null, RUN = 0, AUDIO = null;

function landmarker() {
  LM ||= (async () => {
    const { FilesetResolver, HandLandmarker } = await import(`${MP}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const make = delegate => HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    let l; try { l = await make('GPU'); l.delegate = 'GPU'; } catch { l = await make('CPU'); l.delegate = 'CPU'; }
    // warm up so the first real frames aren't slow (the GPU compiles its shaders on first use)
    const c = document.createElement('canvas'); c.width = 320; c.height = 240; c.getContext('2d').fillRect(0, 0, 320, 240);
    for (let i = 0; i < 3; i++) try { l.detectForVideo(c, performance.now()); } catch { }
    return l;
  })();
  return LM.catch(e => { LM = null; throw e; });
}
function stopCamera() {
  if (!CAM) return;
  CAM.stopped = true; cancelAnimationFrame(CAM.raf);
  CAM.stream?.getTracks().forEach(t => t.stop());
  CAM = null;
}
addEventListener('hashchange', () => { if (!location.hash.startsWith('#/hands')) { RUN++; stopCamera(); } });

function beep(freq = 880, ms = 90, vol = 0.08) {
  try {
    AUDIO ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = AUDIO.createOscillator(), g = AUDIO.createGain();
    o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(AUDIO.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, AUDIO.currentTime + ms / 1000); o.stop(AUDIO.currentTime + ms / 1000);
  } catch { }
}

// ------------------------------------------------------------------ page
export async function pageHands() {
  RUN++; stopCamera();
  landmarker().catch(() => { });                     // start loading the model while you read
  const H = await X().api(`/api/player/${enc(me().name)}/hands`).catch(() => ({ history: [] }));
  $('#p-hands').innerHTML = `<div class="scrollpage"><div class="wrap" style="max-width:980px">
    <div class="h1">✋ Hand check</div>
    <div class="sub">Three 10-second tasks a neurologist uses to check movement. The camera follows 21 points on your hand; our server
      measures <b>shaking (tremor)</b>, whether each fist and finger tap was <b>done fully</b>, and whether you <b>slow down or fade</b>.
      The video never leaves this device. Only the hand points are sent.</div>
    <div class="glass card hc-start">
      <div class="hc-tasks">${TASKS.map((t, i) => `<div class="hc-task"><div class="hc-ico">${t.icon}</div><b>${i + 1}. ${t.title}</b><span class="muted">${t.how}</span></div>`).join('')}</div>
      <div class="hc-pick"><span class="muted">Which hand?</span>
        <button class="cta" data-hand="right">Right hand ▶</button><button class="cta alt" data-hand="left">Left hand ▶</button></div>
      <p class="muted tiny-note">About 40 seconds per hand. Do both hands: a difference between your two hands is one of the things doctors look at.</p>
    </div>
    <div id="hcBox"></div>
    ${historyHTML(H.history)}
    <p class="muted tiny-note">Based on: the MDS-UPDRS motor exam (Goetz 2008, <a href="https://doi.org/10.1002/mds.22340" target="_blank">source ↗</a>);
      webcam finger tapping rated Parkinson's severity about as well as trained non-specialists (Islam 2023, <a href="https://doi.org/10.1038/s41746-023-00905-9" target="_blank">source ↗</a>);
      video hand tracking measured tremor frequency in line with lab equipment (Friedrich 2024, <a href="https://doi.org/10.1038/s41746-024-01153-1" target="_blank">source ↗</a>);
      tremor that starts after 65 went with about twice the risk of dementia in one study (Bermejo-Pareja 2007, <a href="https://doi.org/10.1002/mds.21553" target="_blank">source ↗</a>).
      This is a check, not a diagnosis.</p>
  </div></div>`;
  document.querySelectorAll('[data-hand]').forEach(b => b.onclick = () => runCheck(b.dataset.hand));
}

function historyHTML(h) {
  if (!h?.length) return '';
  const rows = h.slice(-8).reverse().map(r => {
    const st = r.results.steady, tp = r.results.tap, fs = r.results.fist;
    return `<tr><td>${esc(r.date)}</td><td>${r.hand === 'left' ? 'Left' : 'Right'}</td>
      <td>${st ? (st.tremor ? `<span class="hc-warn">${st.frequency_hz} Hz · ${st.amplitude_mm} mm</span>` : 'none seen') : '–'}</td>
      <td>${fs ? `${fs.complete}/${fs.count} full` : '–'}</td><td>${tp ? `${tp.rate_hz}/s · ${tp.complete}/${tp.count} full` : '–'}</td></tr>`;
  }).join('');
  return `<div class="glass card" style="margin-top:16px"><div class="eyebrow">YOUR CHECKS</div>
    <table class="hc-table"><tr><th>Date</th><th>Hand</th><th>Tremor</th><th>Fists</th><th>Taps</th></tr>${rows}</table></div>`;
}

// ------------------------------------------------------------------ the check (3 tasks)
async function runCheck(hand) {
  RUN++; stopCamera();
  const run = RUN, alive = () => run === RUN;
  beep(1, 1, 0.0001);                                // unlock audio inside the click
  const box = $('#hcBox');
  $('.hc-start').hidden = true;
  box.innerHTML = `<div class="glass card mv-load"><div class="spinner"></div><p class="muted">Starting the camera and hand tracker…</p></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let stream, lm;
  try {
    [stream, lm] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } }),
      landmarker()]);
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop());
    const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
    box.innerHTML = `<div class="glass card mv-load"><h3>${denied ? 'Camera access is off' : 'Couldn\'t start the camera'}</h3>
      <p class="muted">${denied ? 'Allow the camera for this site (camera icon in the address bar), then try again.' : 'Check that a camera is connected and that you\'re online (the hand model loads once, ~8 MB).'}</p>
      <button class="cta" id="hcRetry">Try again</button></div>`;
    $('#hcRetry').onclick = () => runCheck(hand);
    return;
  }
  if (!alive()) { stream.getTracks().forEach(t => t.stop()); return; }

  box.innerHTML = `<div class="glass card"><div class="mv">
    <div class="hc-steps">${TASKS.map((t, i) => `<span data-step="${i}">${t.icon} ${t.title.split(' ').slice(0, 3).join(' ')}</span>`).join('')}</div>
    <div class="mv-stage"><video playsinline muted></video><canvas></canvas>
      <div class="mv-top"><span class="mv-pill" id="hcStatus">Show your ${hand} hand</span><span class="mv-pill ghost" id="hcFps"></span></div>
      <div class="hc-card" id="hcCard"></div>
      <div class="mv-big" id="hcBig"></div><div class="mv-sub" id="hcSub"></div>
      <div class="mv-bar"><i id="hcBar"></i></div></div>
    <button class="ghost" id="hcStop">Stop</button></div></div>`;
  const video = $('video', box), canvas = $('canvas', box), ctx = canvas.getContext('2d');
  const ui = { status: $('#hcStatus'), fps: $('#hcFps'), card: $('#hcCard'), big: $('#hcBig'), sub: $('#hcSub'), bar: $('#hcBar') };
  const set = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  video.srcObject = stream;
  await video.play().catch(() => { });
  await new Promise(r => video.readyState >= 2 ? r() : video.onloadeddata = r);
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const aspect = video.videoWidth / video.videoHeight;
  const cam = CAM = { stream, raf: 0, stopped: false };
  $('#hcStop').onclick = () => { RUN++; stopCamera(); pageHands(); };

  const rec = {};
  let k = 0, phase = 'show', since = null, lostAt = null, wrongHand = 0, t0 = 0, lastVT = -1, frames = 0, fpsT = performance.now(), live = null;
  const showTask = () => {
    const T = TASKS[k];
    document.querySelectorAll('[data-step]').forEach(s => s.className = +s.dataset.step < k ? 'done' : +s.dataset.step === k ? 'on' : '');
    ui.card.innerHTML = `<div class="hc-big-ico">${T.icon}</div><b>${T.title}</b><span>${T.how}</span>`;
    ui.card.hidden = false; set(ui.big, ''); set(ui.sub, ''); ui.big.classList.remove('play'); ui.bar.style.width = '0%';
    phase = 'show'; since = null;
  };
  showTask();

  const loop = () => {
    if (cam.stopped || !alive()) { if (CAM === cam) stopCamera(); return; }
    cam.raf = requestAnimationFrame(loop);
    if (video.currentTime === lastVT) return;        // no new camera frame yet
    lastVT = video.currentTime;
    const now = performance.now();
    let res; try { res = lm.detectForVideo(video, now); } catch { return; }
    frames++; if (now - fpsT > 1000) { set(ui.fps, `${Math.round(frames * 1000 / (now - fpsT))} fps`); frames = 0; fpsT = now; }
    const pts = res.landmarks?.[0] || null;
    // MediaPipe labels hands as if the image were mirrored; our frames aren't, so flip the label.
    const seenHand = res.handedness?.[0]?.[0] ? (res.handedness[0][0].categoryName === 'Left' ? 'right' : 'left') : null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts) drawHand(ctx, pts, canvas.width, canvas.height);
    const T = TASKS[k];

    if (phase === 'show') {                          // instructions on screen; start once the hand has been in view for 3 s
      if (pts) lostAt = null; else lostAt ??= now;
      wrongHand = pts && seenHand && seenHand !== hand ? wrongHand + 1 : 0;
      if (pts || now - lostAt < 500) {               // a brief tracking dropout doesn't restart the countdown
        since ??= now;
        const left = 3 - Math.floor((now - since) / 1000);
        set(ui.status, wrongHand > 20 ? `That looks like your ${seenHand} hand: use your ${hand}` : left > 0 ? `Starting in ${left}…` : 'Go!');
        ui.bar.style.width = `${Math.min(100, (now - since) / 30)}%`;
        if (left !== ui._c && left > 0) { ui._c = left; beep(660, 70); }
        if (now - since > 3000) {
          phase = 'rec'; t0 = now; rec[T.id] = { t: [], lm: [] }; live = liveCounter(T.id);
          ui.card.hidden = true; ui.big.classList.add('play'); beep(1200, 150);
        }
      } else { since = null; ui._c = null; set(ui.status, `Show your ${hand} hand to the camera`); ui.bar.style.width = '0%'; }
    } else if (phase === 'rec') {
      const R = rec[T.id];
      R.t.push(Math.round((now - t0) * 10) / 10);
      R.lm.push(pts ? pts.map(p => [Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4]) : null);
      const left = Math.max(0, SECS * 1000 - (now - t0));
      const n = pts ? live.push(pts, aspect) : live.n;
      if (T.id === 'steady') { set(ui.big, `${Math.ceil(left / 1000)}`); set(ui.sub, pts ? 'Hold still…' : 'Keep your hand in view'); }
      else { set(ui.big, String(n)); set(ui.sub, `${T.live} · ${Math.ceil(left / 1000)} s left`); }
      set(ui.status, pts ? T.title : 'Can\'t see your hand');
      ui.bar.style.width = `${100 * (1 - left / (SECS * 1000))}%`;
      if (left <= 0) {
        beep(990, 120);
        if (++k < TASKS.length) showTask();
        else { phase = 'done'; stopCamera(); analyze(hand, aspect, rec, lm.delegate); }
      }
    }
  };
  cam.raf = requestAnimationFrame(loop);
}

/** Live feedback only (the real scoring is done on the server): counts fists or taps as you go. */
function liveCounter(id) {
  let state = 'open', n = 0;
  const d = (a, b, A) => Math.hypot((a.x - b.x) * A, a.y - b.y);
  return {
    get n() { return n; },
    push(p, A) {
      if (id === 'steady') return 0;
      const palm = d(p[0], p[9], A) || 1e-3;
      const v = id === 'fist' ? [8, 12, 16, 20].reduce((s, i) => s + d(p[i], p[0], A), 0) / 4 / palm : d(p[4], p[8], A) / palm;
      const [lo, hi] = id === 'fist' ? [1.2, 1.5] : [0.35, 0.55];   // same lines as the server
      if (state === 'open' && v < lo) { state = 'closed'; n++; beep(1050, 40, 0.05); }
      else if (state === 'closed' && v > hi) state = 'open';
      return n;
    },
  };
}

function drawHand(ctx, p, W, H) {
  ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, W / 180); ctx.strokeStyle = 'rgba(89,240,255,.9)';
  for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(p[a].x * W, p[a].y * H); ctx.lineTo(p[b].x * W, p[b].y * H); ctx.stroke(); }
  for (let i = 0; i < 21; i++) {
    ctx.fillStyle = [4, 8, 12, 16, 20].includes(i) ? '#FFC83D' : '#fff';
    ctx.beginPath(); ctx.arc(p[i].x * W, p[i].y * H, Math.max(3, W / 170), 0, 7); ctx.fill();
  }
}

// ------------------------------------------------------------------ server analysis + results
async function analyze(hand, aspect, tasks, delegate) {
  const box = $('#hcBox');
  box.innerHTML = `<div class="glass card mv-load"><div class="spinner"></div><p class="muted">Analyzing your hand movements…</p></div>`;
  let r;
  try { r = await X().api(`/api/player/${enc(me().name)}/hands`, { hand, aspect, tasks }); }
  catch (e) {
    box.innerHTML = `<div class="glass card mv-load"><h3>We couldn't analyze that</h3><p class="muted">${esc(e.message || e)}</p><button class="cta" id="hcRetry">Try again</button></div>`;
    $('#hcRetry').onclick = () => runCheck(hand);
    return;
  }
  X().setME(r.player); X().renderHUD();
  const R = r.results, st = R.steady, fs = R.fist, tp = R.tap, other = hand === 'right' ? 'left' : 'right';
  const watch = r.flags.some(f => f.level === 'watch');
  const errs = Object.entries(r.errors || {}).map(([k, v]) => `<p class="hc-warn">${esc(TASKS.find(t => t.id === k).title)}: ${esc(v)}</p>`).join('');
  box.innerHTML = `<div class="glass card hc-result">
    <div class="eyebrow">${hand.toUpperCase()} HAND · RESULT${r.sparks_gained ? ` · +${r.sparks_gained} ⚡` : ''}</div>
    <h2 class="hc-verdict">${watch ? 'A few things worth watching' : 'Looks steady and complete'}</h2>
    <ul class="hc-flags">${r.flags.map(f => `<li class="${f.level}">${f.level === 'ok' ? '✓' : '!'} ${esc(f.text)}</li>`).join('')}</ul>${errs}
    <div class="hc-grid">
      ${st ? `<div class="card"><div class="eyebrow">🖐 TREMOR</div>
        <div class="hc-num">${st.tremor ? `${st.frequency_hz} Hz` : 'None seen'}</div>
        <div class="muted">${st.tremor ? `about ${st.amplitude_mm} mm · ${st.updrs_amplitude} (MDS-UPDRS size scale)` : `largest rhythm ${st.amplitude_mm} mm at ${st.peak_hz} Hz: within camera noise`}</div>
        <div class="hc-chart"><canvas id="hcSpec"></canvas></div><div class="muted tiny-note">How much the hand moved at each speed (times per second). A tall, narrow peak between 4 and 12 Hz is a tremor. Camera at ${st.fps} fps sees up to ${st.max_hz} Hz.</div></div>` : ''}
      ${fs ? `<div class="card"><div class="eyebrow">✊ FIST OPEN–CLOSE</div>
        <div class="hc-num">${fs.count} <small>in 10 s</small></div>
        <div class="muted">${fs.complete} full · ${fs.not_closed} not closed · ${fs.not_opened} not opened${fs.decrement_pct != null ? ` · size change ${fmtPct(-fs.decrement_pct)} · ${fs.hesitations} pauses` : ''}</div>
        <div class="hc-chart"><canvas id="hcFist"></canvas></div><div class="muted tiny-note">Fingertips to wrist, in palm lengths. Each dip is a fist (below the dashed line = fully closed).</div></div>` : ''}
      ${tp ? `<div class="card"><div class="eyebrow">👌 FINGER TAPS</div>
        <div class="hc-num">${tp.rate_hz}<small>/s</small></div>
        <div class="muted">${tp.count} taps · ${tp.complete} full${tp.opening_mm ? ` · opening ~${tp.opening_mm} mm` : ''}${tp.decrement_pct != null ? ` · size change ${fmtPct(-tp.decrement_pct)} · ${tp.hesitations} pauses · rhythm varies ${tp.rhythm_cv_pct}%` : ''}</div>
        <div class="hc-chart"><canvas id="hcTap"></canvas></div><div class="muted tiny-note">Gap between thumb and index tips, in palm lengths. Each dip is a tap (below the dashed line = they touched).</div></div>` : ''}
    </div>
    ${compareHTML(r, hand)}
    <p class="muted tiny-note">The camera can't diagnose anything. If shaking, fading or pauses show up on several days, show these results to a doctor. Tracking ran on your ${delegate}.</p>
    <div class="row" style="justify-content:center;gap:10px;margin-top:10px"><button class="cta" id="hcOther">Check your ${other} hand ▶</button><button class="ghost" id="hcAgain">Redo ${hand} hand</button></div>
  </div>`;
  $('#hcOther').onclick = () => runCheck(other);
  $('#hcAgain').onclick = () => runCheck(hand);
  const opts = (extra = {}) => X().chartOpts({ animation: false, plugins: { legend: { display: false } }, elements: { point: { radius: 0 } }, ...extra });
  if (st) X().chart('hcSpec', { type: 'line', data: { labels: st.spectrum.hz, datasets: [{ data: st.spectrum.power, borderColor: st.tremor ? '#FFC83D' : '#59F0FF', fill: true, backgroundColor: 'rgba(89,240,255,.08)', tension: .3 }] }, options: opts() });
  const sig = (id, s, line) => X().chart(id, { type: 'line', data: { labels: s.signal.t.map(x => x.toFixed(1)), datasets: [
    { data: s.signal.v, borderColor: '#59F0FF', borderWidth: 2, tension: .2 },
    { data: s.signal.t.map(() => line), borderColor: 'rgba(255,200,61,.7)', borderDash: [5, 5], borderWidth: 1 }] }, options: opts() });
  if (fs) sig('hcFist', fs, 1.2);
  if (tp) sig('hcTap', tp, 0.35);
}
const fmtPct = v => `${v > 0 ? '+' : ''}${Math.round(v)}%`;

function compareHTML(r, hand) {
  const rows = [];
  const tapNow = r.results.tap?.rate_hz;
  if (r.previous && tapNow != null && r.previous.tap_rate) {
    const ch = 100 * (tapNow - r.previous.tap_rate) / r.previous.tap_rate;
    rows.push(`Since your last ${hand}-hand check (${esc(r.previous.date)}): taps ${r.previous.tap_rate} → ${tapNow}/s (${fmtPct(ch)}).`);
  }
  if (r.other_hand && tapNow != null && r.other_hand.tap_rate) {
    const o = r.other_hand.tap_rate, diff = 100 * Math.abs(tapNow - o) / Math.max(tapNow, o);
    rows.push(`Compared with your ${r.other_hand.hand} hand: ${tapNow} vs ${o} taps/s${diff >= 25 ? ` (<b>${Math.round(diff)}% apart</b>: a clear one-sided difference is worth mentioning to a doctor)` : ' (similar)'}.`);
  }
  return rows.length ? `<div class="hc-compare">${rows.map(x => `<p>${x}</p>`).join('')}</div>` : '';
}
