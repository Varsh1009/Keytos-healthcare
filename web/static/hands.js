// ✋ Hand check: hold still (tremor), fists, finger taps: 10 seconds each.
// The browser tracks 21 points on the hand (MediaPipe Hand Landmarker, on this device) and sends only
// those points to the server, which does the analysis (neurotrail/handcheck.py). Video never leaves the device.
const X = () => window.NTX;
const $ = (s, r = document) => r.querySelector(s);
const me = () => X().getME();
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Model files are served by our own server (cached on disk, see web/server.py /mp/); the CDN is the fallback.
const SRC = [{ base: '/mp', model: '/mp/hand_landmarker.task' },
  { base: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14', model: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' }];
const SECS = 10;
// Same lines the server uses (3D, palm lengths), for live coaching only. The server's analysis is what's saved.
const LINES = { fist: { closed: 1.3, open: 1.5 }, tap: { closed: 0.4, open: 0.6 } };
const STEPS = [
  { id: 'steady', label: 'Hold still', say: 'Hold your hand up, fingers spread. Keep it still.', a: '🖐', b: '🖐', still: true },
  { id: 'fist', label: 'Make fists', say: 'Tight fist, then wide open. Fast!', a: '🖐', b: '✊' },
  { id: 'tap', label: 'Tap fingers', say: 'Tap index finger on thumb. Fast and wide!', a: '🖐', b: '👌' },
];
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

let LM = null, CAM = null, RUN = 0, AUDIO = null;

function landmarker() {
  LM ||= (async () => {
    let err;
    for (const src of SRC) {
      try {
        const { FilesetResolver, HandLandmarker } = await import(`${src.base}/vision_bundle.mjs`);
        const files = await FilesetResolver.forVisionTasks(`${src.base}/wasm`);
        const make = delegate => HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: src.model, delegate }, runningMode: 'VIDEO', numHands: 1,
          minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
        let l; try { l = await make('GPU'); l.delegate = 'GPU'; } catch { l = await make('CPU'); l.delegate = 'CPU'; }
        // warm-up: the GPU compiles its shaders on first use, which would otherwise stall the first seconds
        const c = document.createElement('canvas'); c.width = 320; c.height = 240; c.getContext('2d').fillRect(0, 0, 320, 240);
        for (let i = 0; i < 3; i++) try { l.detectForVideo(c, performance.now()); } catch { }
        return l;
      } catch (e) { err = e; }
    }
    throw err;
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

function beep(freq = 880, ms = 90, vol = 0.07) {
  try {
    AUDIO ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = AUDIO.createOscillator(), g = AUDIO.createGain();
    o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(AUDIO.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, AUDIO.currentTime + ms / 1000); o.stop(AUDIO.currentTime + ms / 1000);
  } catch { }
}
const demo = s => `<span class="hx-demo${s.still ? ' still' : ''}"><i>${s.a}</i><i>${s.b}</i></span>`;
// rows carry a local date (YYYY-MM-DD)
const ago = date => { const [y, m, d] = String(date).split('-').map(Number), t = new Date(), days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(y, m - 1, d)) / 864e5);
  return !(days >= 0) ? String(date) : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`; };

// ------------------------------------------------------------------ start screen
export async function pageHands() {
  RUN++; stopCamera();
  landmarker().catch(() => { });                     // load the tracker while you read
  const P = $('#p-hands');
  P.innerHTML = `<div class="scrollpage"><div class="wrap hx">
    <h1 class="hx-title">✋ Hand check</h1>
    <p class="hx-lead">3 moves · 10 seconds each</p>
    <div class="hx-moves">${STEPS.map((s, i) => `<div class="hx-move">${demo(s)}<b>${i + 1}. ${s.label}</b></div>`).join('')}</div>
    <div class="hx-go"><button class="cta big" data-hand="right">Start · right hand</button><button class="ghost" data-hand="left">Left hand</button></div>
    <p class="hx-lock">🔒 Your video stays on this device</p>
    <div id="hxLast"></div>
    <details class="hx-more"><summary>Why these 3 moves?</summary>
      <p>They're the hand checks in the standard movement exam neurologists use (MDS-UPDRS). Shaking, slowing and movements
        that get smaller can be early signs of brain changes. A webcam version of the tapping test rated Parkinson's
        severity about as well as trained non-specialists.</p>
      <p class="hx-src"><a href="https://doi.org/10.1002/mds.22340" target="_blank">Goetz 2008</a> · <a href="https://doi.org/10.1038/s41746-023-00905-9" target="_blank">Islam 2023</a> ·
        <a href="https://doi.org/10.1038/s41746-024-01153-1" target="_blank">Friedrich 2024</a> · <a href="https://doi.org/10.1002/mds.21553" target="_blank">Bermejo-Pareja 2007</a></p>
      <p>A check, not a diagnosis.</p></details>
  </div></div>`;
  P.querySelectorAll('[data-hand]').forEach(b => b.onclick = () => runCheck(b.dataset.hand));
  const H = await X().api(`/api/player/${enc(me().name)}/hands`).catch(() => ({ history: [] }));
  const last = H.history.at(-1);
  if (last && $('#hxLast')) {
    const ok = !last.flags.some(f => f.level === 'watch');
    $('#hxLast').innerHTML = `<div class="hx-last ${ok ? 'ok' : 'watch'}">Last check: ${last.hand} hand, ${ago(last.date)}: <b>${ok ? 'all good' : 'worth a second look'}</b></div>
      <details class="hx-more"><summary>Past checks</summary>${historyTable(H.history)}</details>`;
  }
}
function historyTable(h) {
  return `<table class="hc-table"><tr><th>When</th><th>Hand</th><th>Shaking</th><th>Fists</th><th>Taps</th></tr>${h.slice(-10).reverse().map(r => {
    const st = r.results.steady, fs = r.results.fist, tp = r.results.tap;
    return `<tr><td>${ago(r.date)}</td><td>${esc(r.hand)}</td><td>${st ? (st.tremor ? `⚠ ${st.frequency_hz} Hz` : '✓ none') : '–'}</td>
      <td>${fs ? `${fs.complete}/${fs.count} full` : '–'}</td><td>${tp ? `${tp.rate_hz}/s` : '–'}</td></tr>`; }).join('')}</table>`;
}

// ------------------------------------------------------------------ the check
async function runCheck(hand) {
  RUN++; stopCamera();
  const run = RUN, alive = () => run === RUN;
  beep(1, 1, 0.0001);                                // unlock audio inside the click
  const P = $('#p-hands');
  P.innerHTML = `<div class="scrollpage"><div class="wrap hx"><div class="hx-run">
    <div class="hx-steps">${STEPS.map((s, i) => `<span data-step="${i}">${s.b} ${s.label}</span>`).join('')}</div>
    <div class="mv-stage hx-stage"><video playsinline muted></video><canvas></canvas>
      <button class="hx-x" id="hxStop" aria-label="Stop">✕</button>
      <div class="hx-count" id="hxCount"></div><div class="hx-time" id="hxTime"></div>
      <div class="hx-card" id="hxCard"><div class="spinner"></div><b>Starting camera…</b></div>
      <div class="hx-coach" id="hxCoach"></div>
      <div class="mv-bar"><i id="hxBar"></i></div></div>
  </div></div></div>`;
  $('#hxStop').onclick = () => { RUN++; stopCamera(); pageHands(); };
  const ui = { card: $('#hxCard'), count: $('#hxCount'), time: $('#hxTime'), coach: $('#hxCoach'), bar: $('#hxBar') };
  const set = (el, v) => { if (el._v !== v) { el._v = v; el.innerHTML = v; } };
  let stream, lm;
  try {
    [stream, lm] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } }),
      landmarker()]);
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop());
    const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
    ui.card.innerHTML = `<b>${denied ? '📷 Camera blocked' : '📷 Camera didn\'t start'}</b><span>${denied ? 'Click the camera icon in the address bar, allow it, then try again.' : 'Check your camera is connected.'}</span><button class="cta" id="hxRetry">Try again</button>`;
    $('#hxRetry').onclick = () => runCheck(hand);
    return;
  }
  if (!alive()) { stream.getTracks().forEach(t => t.stop()); return; }
  const video = $('video', P), canvas = $('canvas', P), ctx = canvas.getContext('2d');
  video.srcObject = stream;
  await video.play().catch(() => { });
  await new Promise(r => video.readyState >= 2 ? r() : video.onloadeddata = r);
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const aspect = video.videoWidth / video.videoHeight;
  const cam = CAM = { stream, raf: 0, stopped: false };

  const rec = {}, perf = window.__hxPerf = { ms: 0, frames: 0, start: performance.now(), delegate: lm.delegate };
  let k = 0, phase = 'show', since = null, lostAt = null, wrongHand = 0, t0 = 0, coach = null, coachAt = 0;
  const showStep = () => {
    const S = STEPS[k];
    P.querySelectorAll('[data-step]').forEach(s => s.className = +s.dataset.step < k ? 'done' : +s.dataset.step === k ? 'on' : '');
    ui.card.innerHTML = `${demo(S)}<b>${S.label}</b><span>${S.say}</span><div class="hx-ring" id="hxRing">✋</div>`;
    ui.card.hidden = false; set(ui.count, ''); set(ui.time, ''); ui.coach.className = 'hx-coach'; ui.bar.style.width = '0%';
    phase = 'show'; since = null;
  };
  const say = (text, cls = '') => { ui.coach.className = 'hx-coach show ' + cls; ui.coach.innerHTML = text; coachAt = performance.now(); };
  showStep();

  // One detection per real camera frame. requestVideoFrameCallback gives each frame's capture time,
  // which is what the tremor analysis needs (detection delays would otherwise add timing jitter).
  let lastVT = -1;
  const next = () => { if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame); else cam.raf = requestAnimationFrame(t => onFrame(t, null)); };
  const onFrame = (now, meta) => {
    if (cam.stopped || !alive()) { if (CAM === cam) stopCamera(); return; }
    next();
    if (!meta && video.currentTime === lastVT) return;
    lastVT = video.currentTime;
    const t = meta?.captureTime ?? (meta ? meta.mediaTime * 1000 : performance.now());
    const d0 = performance.now();
    let res; try { res = lm.detectForVideo(video, d0); } catch { return; }
    perf.ms = perf.ms ? perf.ms * 0.9 + (performance.now() - d0) * 0.1 : performance.now() - d0; perf.frames++;
    const pts = res.landmarks?.[0] || null, w3 = res.worldLandmarks?.[0] || null;
    // MediaPipe labels hands as if the image were mirrored; camera frames aren't, so flip the label.
    const seenHand = res.handedness?.[0]?.[0] ? (res.handedness[0][0].categoryName === 'Left' ? 'right' : 'left') : null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts) drawHand(ctx, pts, canvas.width, canvas.height);
    const wall = performance.now();
    if (coachAt && wall - coachAt > 900) { ui.coach.className = 'hx-coach'; coachAt = 0; }
    const S = STEPS[k];

    if (phase === 'show') {                          // start once the hand is in view for 3 s (brief dropouts are fine)
      if (pts) lostAt = null; else lostAt ??= wall;
      wrongHand = pts && seenHand && seenHand !== hand ? wrongHand + 1 : 0;
      const ring = $('#hxRing');
      if (pts || wall - lostAt < 500) {
        since ??= wall;
        const left = 3 - Math.floor((wall - since) / 1000);
        if (ring) { ring.textContent = wrongHand > 20 ? `Use your ${hand} hand` : left > 0 ? left : 'Go'; ring.className = 'hx-ring on'; }
        if (left !== ui._c && left > 0) { ui._c = left; beep(660, 70); }
        if (wall - since > 3000) {
          phase = 'rec'; t0 = wall; rec[S.id] = { t: [], lm: [], wl: [] }; coach = coachFor(S.id);
          ui.card.hidden = true; beep(1200, 150);
        }
      } else { since = null; ui._c = null; if (ring) { ring.textContent = `Show your ${hand} hand ✋`; ring.className = 'hx-ring'; } }
    } else if (phase === 'rec') {
      const R = rec[S.id];
      R.t.push(Math.round(t * 10) / 10);
      R.lm.push(pts ? pts.map(p => [+p.x.toFixed(4), +p.y.toFixed(4)]) : null);
      R.wl.push(pts && w3 ? w3.map(p => [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]) : null);
      const left = Math.max(0, SECS * 1000 - (wall - t0));
      if (pts && w3) { const ev = coach.push(w3); if (ev) { say(ev.text, ev.cls); if (ev.cls === 'good') beep(1050, 40, 0.05); } }
      else if (!pts) say('Show your hand ✋', 'warn');
      if (S.id === 'steady' && pts && !coachAt) { ui.coach.className = 'hx-coach show'; ui.coach.innerHTML = 'Hold still…'; }
      set(ui.count, S.id === 'steady' ? '' : `${coach.n}<small>${S.id === 'fist' ? 'fists' : 'taps'}</small>`);
      set(ui.time, `${Math.ceil(left / 1000)}`);
      ui.bar.style.width = `${100 * (1 - left / (SECS * 1000))}%`;
      if (left <= 0) {
        beep(990, 120);
        if (++k < STEPS.length) showStep();
        else { phase = 'done'; stopCamera(); analyze(hand, aspect, rec); }
      }
    }
  };
  next();
}

/** Live coaching on each repetition (3D, palm lengths). The saved result comes from the server. */
function coachFor(id) {
  let n = 0, state = 'open', lo = 9, hi = -9;
  const L = LINES[id];
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return {
    get n() { return n; },
    push(w) {
      if (id === 'steady') return null;
      const palm = d(w[0], w[9]) || 1e-3;
      const v = id === 'fist' ? [8, 12, 16, 20].reduce((s, i) => s + d(w[i], w[0]), 0) / 4 / palm : d(w[4], w[8]) / palm;
      if (state === 'open') {
        lo = Math.min(lo, v);
        if (v <= L.closed) { state = 'closed'; hi = v; n++; return { text: '✓', cls: 'good' }; }
        if (lo < L.open - 0.15 && v > lo + 0.2) { lo = v; return { text: id === 'fist' ? 'Close tighter ✊' : 'Touch your thumb 👌', cls: 'warn' }; }
      } else {
        hi = Math.max(hi, v);
        if (v >= L.open) { state = 'open'; lo = v; return null; }
        if (hi > L.closed + 0.1 && v < hi - 0.2) { hi = v; return { text: 'Open wider 🖐', cls: 'warn' }; }
      }
      return null;
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

// ------------------------------------------------------------------ results
async function analyze(hand, aspect, tasks) {
  const P = $('#p-hands');
  P.innerHTML = `<div class="scrollpage"><div class="wrap hx"><div class="hx-wait"><div class="spinner"></div><b>Checking your movements…</b></div></div></div>`;
  let r;
  const pf = window.__hxPerf || {};
  try { r = await X().api(`/api/player/${enc(me().name)}/hands`, { hand, aspect, tasks, fps: pf.frames ? Math.round(pf.frames * 1000 / (performance.now() - pf.start)) : null }); }
  catch (e) {
    P.innerHTML = `<div class="scrollpage"><div class="wrap hx"><div class="hx-wait"><b>We couldn't read that</b><span>${esc(typeof e.message === 'string' && !e.message.includes('[object') ? e.message : 'Keep your hand in view and try again.')}</span>
      <button class="cta big" id="hxAgain">Try again</button></div></div></div>`;
    $('#hxAgain').onclick = () => runCheck(hand);
    return;
  }
  X().setME(r.player); X().renderHUD();
  const R = r.results, st = R.steady, fs = R.fist, tp = R.tap, other = hand === 'right' ? 'left' : 'right';
  const watch = r.flags.filter(f => f.level === 'watch');
  const good = x => x && x.count >= 3 && x.complete >= 0.7 * x.count && (x.decrement_pct ?? 0) < 30 && (x.hesitations ?? 0) < 3;
  const note = x => !x ? 'not measured' : x.count < 3 ? 'too few seen' : x.complete < 0.7 * x.count ? `${x.count - x.complete} not full` :
    (x.decrement_pct ?? 0) >= 30 ? `got ${Math.round(x.decrement_pct)}% smaller` : (x.hesitations ?? 0) >= 3 ? `${x.hesitations} pauses` : 'all full, steady';
  const tile = (icon, label, big, sub, ok) => `<div class="hx-tile ${ok ? 'ok' : 'watch'}"><div class="hx-ti">${icon}</div><span>${label}</span><b>${big}</b><em>${ok ? '✓' : '⚠'} ${sub}</em></div>`;
  P.innerHTML = `<div class="scrollpage"><div class="wrap hx">
    <div class="hx-verdict ${watch.length ? 'watch' : 'ok'}"><span>${watch.length ? '⚠' : '✓'}</span><div><b>${watch.length ? 'Worth a second look' : 'All good'}</b><small>${hand} hand${r.sparks_gained ? ` · +${r.sparks_gained} ⚡` : ''}</small></div></div>
    <div class="hx-tiles">
      ${tile('🖐', 'Shaking', st ? (st.tremor ? `${st.frequency_hz}<small> Hz</small>` : 'None') : '–', st ? (st.tremor ? `about ${Math.round(st.amplitude_mm)} mm` : 'steady hand') : 'not measured', st && !st.tremor)}
      ${tile('✊', 'Fists', fs ? fs.count : '–', note(fs), good(fs))}
      ${tile('👌', 'Taps', tp ? `${tp.rate_hz}<small>/s</small>` : '–', note(tp), good(tp))}
    </div>
    ${watch.length ? `<ul class="hx-flags">${watch.map(f => `<li>${esc(f.text)}</li>`).join('')}</ul>` : ''}
    ${r.flags.filter(f => f.level === 'info').map(f => `<p class="hx-info">ℹ️ ${esc(f.text)}</p>`).join('')}
    ${compare(r, hand)}
    <div class="hx-go"><button class="cta big" id="hxOther">Now your ${other} hand ▶</button><button class="ghost" id="hxAgain">Redo</button></div>
    <p class="hx-note">${watch.length ? 'Not a diagnosis. If ⚠ shows up again on another day, show your doctor.' : 'Not a diagnosis. Check both hands now and then to spot changes.'}</p>
    <details class="hx-more" id="hxDetails"><summary>See the measurements</summary>${details(st, fs, tp)}</details>
  </div></div>`;
  $('#hxOther').onclick = () => runCheck(other);
  $('#hxAgain').onclick = () => runCheck(hand);
  $('#hxDetails').addEventListener('toggle', () => charts(st, fs, tp), { once: true });
}
function compare(r, hand) {
  const now = r.results.tap?.rate_hz, rows = [];
  if (r.other_hand?.tap_rate && now) {
    const o = r.other_hand.tap_rate, diff = Math.abs(now - o) / Math.max(now, o);
    rows.push(diff >= 0.25 ? `⚠ Your ${hand} hand taps ${Math.round(diff * 100)}% ${now < o ? 'slower' : 'faster'} than your ${esc(r.other_hand.hand)} hand (${now} vs ${o}/s).`
      : `✓ Both hands tap at a similar speed (${now} and ${o}/s).`);
  }
  if (r.previous?.tap_rate && now) rows.push(`Last time: ${r.previous.tap_rate} taps/s → now ${now}/s.`);
  return rows.length ? `<div class="hx-compare">${rows.map(x => `<p>${x}</p>`).join('')}</div>` : '';
}
const pct = v => `${v > 0 ? '−' : '+'}${Math.abs(Math.round(v))}%`;
function details(st, fs, tp) {
  return `<div class="hx-detail">
    ${st ? `<div><b>🖐 Shaking</b><p>${st.tremor ? `Rhythmic shaking ${st.frequency_hz} times a second, about ${st.amplitude_mm} mm (${st.updrs_amplitude} on the MDS-UPDRS scale).` : `No rhythm above camera noise (biggest: ${st.amplitude_mm} mm at ${st.peak_hz} Hz; we flag 2 mm and up).`}</p>
      <div class="hc-chart"><canvas id="hxSpec"></canvas></div><small>Movement at each speed. A tall, narrow peak = tremor. Camera ${st.fps} fps (sees up to ${st.max_hz} Hz). Your palm: ${st.palm_mm} mm.</small></div>` : ''}
    ${fs ? `<div><b>✊ Fists</b><p>${fs.count} in 10 s · ${fs.complete} full · ${fs.not_closed} not closed · ${fs.not_opened} not opened${fs.decrement_pct != null ? ` · size ${pct(fs.decrement_pct)} by the end · ${fs.hesitations} pauses` : ''}</p>
      <div class="hc-chart"><canvas id="hxFist"></canvas></div><small>Fingertips to wrist, in palm lengths. Each dip below the dashed line = a full fist.</small></div>` : ''}
    ${tp ? `<div><b>👌 Taps</b><p>${tp.count} taps · ${tp.complete} full${tp.opening_mm ? ` · opening ${tp.opening_mm} mm` : ''}${tp.decrement_pct != null ? ` · size ${pct(tp.decrement_pct)} by the end · ${tp.hesitations} pauses · rhythm varies ${tp.rhythm_cv_pct}%` : ''}</p>
      <div class="hc-chart"><canvas id="hxTap"></canvas></div><small>Thumb-to-index gap, in palm lengths. Each dip below the dashed line = they touched.</small></div>` : ''}
  </div>`;
}
function charts(st, fs, tp) {
  const opts = X().chartOpts({ animation: false, plugins: { legend: { display: false } }, elements: { point: { radius: 0 } } });
  if (st) X().chart('hxSpec', { type: 'line', data: { labels: st.spectrum.hz, datasets: [{ data: st.spectrum.power, borderColor: st.tremor ? '#FFC83D' : '#59F0FF', fill: true, backgroundColor: 'rgba(89,240,255,.08)', tension: .3 }] }, options: opts });
  const sig = (id, s) => X().chart(id, { type: 'line', data: { labels: s.signal.t.map(x => x.toFixed(1)), datasets: [
    { data: s.signal.v, borderColor: '#59F0FF', borderWidth: 2, tension: .2 },
    { data: s.signal.t.map(() => s.closed_line), borderColor: 'rgba(255,200,61,.7)', borderDash: [5, 5], borderWidth: 1 }] }, options: opts });
  if (fs) sig('hxFist', fs);
  if (tp) sig('hxTap', tp);
}
