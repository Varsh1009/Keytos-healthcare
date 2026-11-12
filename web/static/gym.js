// Brain Gym (7 games) + MRI page. Uses helpers exposed by app.js on window.NTX.
const X = () => window.NTX;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let CAT = null, STATS = {}, RUN = 0;   // RUN increments to cancel a game when you leave the page
const me = () => X().getME();
const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(v => v[1]);

async function catalog() { CAT ||= (await X().api('/api/games')).games; return CAT; }

// ============================================================ GYM HUB
export async function pageGym() {
  RUN++;
  const games = await catalog();
  STATS = await X().api(`/api/me/games`);
  const played = Object.values(STATS).filter(s => s.played_today).length;
  $('#p-gym').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">🧩 Brain Gym</div>
    <div class="sub">Seven games, each a digital version of a real neuropsychological test. ${played}/7 played today · +15 ⚡ for each game's first play of the day.
      <br><b>Honest note:</b> only Speed Sprint has trial evidence linked to dementia. The others track your abilities over time; brain-training reviews find little transfer to everyday life (Simons 2016).</div>
    <div class="gymgrid">${games.map(g => { const s = STATS[g.id] || {}; return `
      <a class="gcard glass" href="${g.id === 'speed' ? '#/sprint' : '#/check/' + g.id}" style="--c:${g.color}">
        <div class="gtop"><div class="gicon">${g.icon}</div>${s.played_today ? '<span class="badge b-rct">✓ today</span>' : '<span class="badge b-weak">+15 ⚡</span>'}</div>
        <div class="gtitle">${g.title}</div><div class="gdom">${g.domain}</div>
        <div class="gtest">${g.test}</div>
        <div class="gstats"><div><b>${s.best ?? '–'}</b><span>best</span></div><div><b>${s.plays ?? 0}</b><span>plays</span></div><div><b>${s.last ?? '–'}</b><span>last</span></div></div>
        <svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none">${spark(s.history || [], g.better)}</svg>
        <div class="gev">${g.norm ? '📊 NHANES norms available' : g.id === 'speed' ? '🧪 trial-backed' : '📈 personal tracking'}</div>
      </a>`; }).join('')}</div></div></div>`;
}
function spark(h, better) {
  if (h.length < 2) return '<text x="50" y="16" text-anchor="middle" font-size="8" fill="#9AA3C7">play twice to see a trend</text>';
  const mn = Math.min(...h), mx = Math.max(...h), r = mx - mn || 1;
  const pts = h.map((v, i) => `${i / (h.length - 1) * 100},${22 - (better === 'higher' ? (v - mn) : (mx - v)) / r * 20}`).join(' ');
  return `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}

// ============================================================ GAME SHELL
export async function pageGame(id) {
  RUN++;
  const games = await catalog(), g = games.find(x => x.id === id);
  if (!g || id === 'speed') { location.hash = id === 'speed' ? '#/sprint' : '#/checks'; return; }
  $('#p-game').innerHTML = `<div class="sprint-wrap"><div class="arcade gamebox" style="--c:${g.color}">
    <a class="close" href="#/checks" style="text-decoration:none;display:grid;place-items:center">✕</a>
    <div id="gb"></div></div></div>`;
  intro(g);
}
function intro(g) {
  const s = STATS[g.id] || {};
  $('#gb').innerHTML = `<div class="eyebrow">${g.domain.toUpperCase()} · ${g.test}</div>
    <h2 style="font:700 40px 'Space Grotesk';margin:10px 0">${g.icon} ${g.title}</h2>
    <p class="muted" style="max-width:600px;margin:0 auto">${g.how}</p>
    <div class="a-big">${s.best ?? '–'}</div><div class="muted">your best · ${g.unit}</div>
    <p class="muted" style="max-width:600px;margin:12px auto">${g.evidence} <a href="${g.url}" target="_blank">source ↗</a></p>
    <div class="row" style="justify-content:center" id="startRow"><button class="cta" id="go">▶ Start</button></div>`;
  $('#go').onclick = () => ({ recall: recall, fluency: fluency, trails: trails, stroop: stroop, corsi: corsi, reaction: reaction })[g.id](g);
  if (g.id === 'recall') recallDelayedButton(g);
}
async function finish(g, score, detail, lines = []) {
  const r = await X().api(`/api/me/game`, { game: g.id, score, detail });
  X().setME(r.player); STATS[g.id] = r.stats;
  const prevBest = r.stats.history.length > 1 ? (g.better === 'higher' ? Math.max(...r.stats.history.slice(0, -1)) : Math.min(...r.stats.history.slice(0, -1))) : null;
  const pb = prevBest == null || (g.better === 'higher' ? score > prevBest : score < prevBest);
  
  $('#gb').innerHTML = `<div class="eyebrow">${g.title.toUpperCase()} · RESULT</div><div class="a-big">${score}</div><div class="muted">${g.unit}</div>
    ${pb ? '<div style="margin-top:10px"><span class="pb">NEW PERSONAL BEST</span></div>' : ''}
    ${r.sparks_gained ? `<div class="reward" style="text-align:center;margin-top:8px">+${r.sparks_gained} ⚡</div>` : '<div class="muted" style="margin-top:8px">Already earned today\'s sparks for this game. Practice still counts in your history.</div>'}
    ${lines.map(l => `<p class="muted">${l}</p>`).join('')}
    <p class="muted">Compared only with you: your first try was ${r.stats.history[0]}. ${r.stats.plays < 3 ? 'Learning your baseline: play on 3 different days to see a trend.' : ''}</p>
    ${r.stats.history.length > 1 ? `<div style="max-width:560px;height:160px;margin:16px auto"><canvas id="gh"></canvas></div>` : ''}
    <div class="row" style="justify-content:center"><button class="cta" id="again">↻ Play again</button><a class="ghost" href="#/checks">Back to Checks</a></div>`;
  if (r.stats.history.length > 1) X().chart('gh', { type: 'line', data: { labels: r.stats.history.map((_, i) => i + 1), datasets: [{ data: r.stats.history, borderColor: g.color, backgroundColor: 'rgba(255,255,255,.05)', fill: true, tension: .3 }] }, options: X().chartOpts({ plugins: { legend: { display: false } } }) });
  $('#again').onclick = () => intro(g);
  X().renderHUD();
}

// ============================================================ WORD RECALL (CERAD-style)
async function recall(g) {
  const run = RUN, { words, distractors } = await X().api('/api/games/recall-words');
  const mode = await chooseMode([['tap', '👆 Tap the words', 'Pick the words from a grid. Works anywhere.'], ['type', '⌨️ Type the words', 'Harder: recall without hints.']]);
  if (run !== RUN) return;
  const trials = [];
  for (let t = 0; t < 3; t++) {
    const order = shuffle(words);
    for (let i = 0; i < order.length; i++) {
      if (run !== RUN) return;
      $('#gb').innerHTML = `<div class="eyebrow">TRIAL ${t + 1} OF 3 · LEARN THE WORDS</div><div class="bigword">${order[i]}</div><div class="muted">${i + 1} / 10</div>`;
      await sleep(2000);
    }
    trials.push(await collectRecall(words, distractors, mode, `TRIAL ${t + 1} OF 3 · RECALL`));
    if (run !== RUN) return;
  }
  const learning = trials.reduce((a, b) => a + b.hits, 0);
  localStorage.setItem('nt_recall', JSON.stringify({ words, distractors, mode, at: Date.now(), player: me().name }));
  finish(g, learning, { trials: trials.map(t => t.hits), false_alarms: trials.map(t => t.fa), mode },
    [`Trials: ${trials.map(t => t.hits).join(' → ')} words. Come back in 5+ minutes for delayed recall (it opens on this game's page).`]);
}
function collectRecall(words, distractors, mode, title) {
  return new Promise(res => {
    if (mode === 'type') {
      $('#gb').innerHTML = `<div class="eyebrow">${title}</div><p class="muted">Type every word you remember, pressing Enter after each. Then tap Done.</p>
        <input id="rin" placeholder="type a word + Enter" autocomplete="off" style="max-width:360px"><div class="chips" id="rgot" style="justify-content:center;margin:14px 0"></div>
        <button class="cta" id="rdone">Done</button>`;
      const got = new Set();
      $('#rin').focus();
      $('#rin').onkeydown = e => { if (e.key === 'Enter') { const w = e.target.value.trim().toLowerCase(); if (w) got.add(w); e.target.value = ''; $('#rgot').innerHTML = [...got].map(x => `<span class="chip ${words.includes(x) ? 'on' : ''}">${x}</span>`).join(''); } };
      $('#rdone').onclick = () => res({ hits: [...got].filter(w => words.includes(w)).length, fa: [...got].filter(w => !words.includes(w)).length });
    } else {
      const grid = shuffle([...words, ...distractors]), picked = new Set();
      $('#gb').innerHTML = `<div class="eyebrow">${title}</div><p class="muted">Tap every word that was on the list, then tap Done.</p>
        <div class="wgrid">${grid.map(w => `<button class="chip" data-w="${w}">${w}</button>`).join('')}</div><button class="cta" id="rdone" style="margin-top:14px">Done</button>`;
      $$('[data-w]').forEach(b => b.onclick = () => { const w = b.dataset.w; picked.has(w) ? picked.delete(w) : picked.add(w); b.classList.toggle('on'); });
      $('#rdone').onclick = () => res({ hits: [...picked].filter(w => words.includes(w)).length, fa: [...picked].filter(w => !words.includes(w)).length });
    }
  });
}
function recallDelayedButton(g) {
  let st = null; try { st = JSON.parse(localStorage.getItem('nt_recall')); } catch { }
  if (!st || st.player !== me().name) return;
  const mins = (Date.now() - st.at) / 60000;
  const row = $('#startRow');
  if (mins < 5) { row.insertAdjacentHTML('beforeend', `<button class="ghost" disabled>⏳ Delayed recall opens in ${Math.ceil(5 - mins)} min</button>`); return; }
  row.insertAdjacentHTML('beforeend', `<button class="cta" id="delayed" style="background:linear-gradient(90deg,#9B7BFF,#59F0FF)">🧠 Delayed recall now</button>`);
  $('#delayed').onclick = async () => {
    const r = await collectRecall(st.words, st.distractors, st.mode, `DELAYED RECALL · ${Math.round(mins)} MIN LATER`);
    localStorage.removeItem('nt_recall');
    finish(g, r.hits, { delayed: true, minutes: Math.round(mins), false_alarms: r.fa, mode: st.mode },
      ['Delayed recall (0–10), compared with your own earlier tries.']);
  };
}
function chooseMode(opts) {
  return new Promise(res => {
    $('#gb').innerHTML = `<div class="eyebrow">CHOOSE A MODE</div><div class="modes">${opts.map(([k, t, d]) => `<button class="mode glass" data-m="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>`;
    $$('[data-m]').forEach(b => b.onclick = () => res(b.dataset.m));
  });
}

// ============================================================ ANIMAL NAMING (fluency)
async function fluency(g) {
  const run = RUN, SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let onDevice = false;
  try { onDevice = !!(SR && 'processLocally' in SR.prototype); } catch { }
  const mode = await chooseMode([...(SR ? [['voice', '🎤 Say them out loud', onDevice ? 'Speech is turned into words on this device.' : 'Heads up: your browser sends the audio to Google to turn it into words. Sound measurements stay here.']] : []), ['type', '⌨️ Type them', 'Nothing leaves this computer.']]);
  if (run !== RUN) return;
  const entries = [];
  $('#gb').innerHTML = `<div class="eyebrow">ANIMAL NAMING · 60 SECONDS</div><div class="timer" style="margin:10px auto"><svg width="120" height="120"><circle cx="60" cy="60" r="52" stroke="rgba(255,255,255,.1)" stroke-width="8" fill="none"/><circle id="ft" cx="60" cy="60" r="52" stroke="#3DDC97" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="326.7"/></svg><div class="t" id="fl">60</div></div>
    ${mode === 'type' ? '<input id="fin" placeholder="type an animal + Enter" autocomplete="off" style="max-width:360px">' : '<div class="muted" id="mic">🎤 Listening… say animals one after another</div>'}
    <div class="chips" id="fgot" style="justify-content:center;margin-top:14px"></div>`;
  const show = () => $('#fgot').innerHTML = entries.map(e => `<span class="chip on">${e}</span>`).join('');
  let rec = null;
  if (mode === 'type') { $('#fin').focus(); $('#fin').onkeydown = e => { if (e.key === 'Enter' && e.target.value.trim()) { entries.push(e.target.value.trim()); e.target.value = ''; show(); } }; }
  else { rec = new SR(); rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US'; if (onDevice) { try { rec.processLocally = true; } catch { } }
    rec.onresult = ev => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) ev.results[i][0].transcript.split(/[\s,]+/).filter(Boolean).forEach(w => entries.push(w)); show(); };
    rec.onerror = e => X().toast('Microphone: ' + e.error); try { rec.start(); } catch { } }
  const t0 = performance.now();
  while (performance.now() - t0 < 60000) { if (run !== RUN) { rec?.stop(); return; } const left = 60 - (performance.now() - t0) / 1000; $('#fl').textContent = Math.ceil(left); $('#ft').style.strokeDashoffset = 326.7 * (1 - left / 60); await sleep(200); }
  rec?.stop(); await sleep(400);
  const sc = await X().api('/api/games/fluency-score', { entries });
  finish(g, sc.score, { mode, valid: sc.valid, unrecognized: sc.unrecognized },
    [sc.valid.length ? `Counted: ${sc.valid.join(', ')}` : 'No animals recognized.', sc.unrecognized.length ? `Not counted (not in our 350-animal list or repeats): ${sc.unrecognized.join(', ')}` : '']);
}

// ============================================================ TRAIL CONNECT (TMT A/B)
async function trails(g) {
  const run = RUN;
  const a = await trailPart('A', Array.from({ length: 15 }, (_, i) => String(i + 1)), run); if (a == null) return;
  const labels = []; for (let i = 0; i < 8; i++) { labels.push(String(i + 1)); if (i < 7) labels.push('ABCDEFG'[i]); }
  const b = await trailPart('B', labels, run); if (b == null) return;
  const diff = +(b.t - a.t).toFixed(1);
  finish(g, diff, { a: a.t, b: b.t, errors_a: a.err, errors_b: b.err }, [`Part A ${a.t.toFixed(1)} s (${a.err} errors) · Part B ${b.t.toFixed(1)} s (${b.err} errors). B − A isolates the cost of switching.`]);
}
function trailPart(part, labels, run) {
  return new Promise(async res => {
    $('#gb').innerHTML = `<div class="eyebrow">PART ${part} · ${part === 'A' ? 'tap 1 → 2 → 3 …' : 'alternate 1 → A → 2 → B …'}</div><div class="muted" id="tinfo">Get ready…</div><div class="tboard" id="tb"></div>`;
    await sleep(900); if (run !== RUN) return res(null);
    const box = $('#tb'), W = box.clientWidth, H = box.clientHeight, pts = [];
    for (const l of labels) { let p, k = 0; do { p = { x: 30 + Math.random() * (W - 60), y: 30 + Math.random() * (H - 60) }; k++; } while (k < 400 && pts.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 62)); pts.push(p); }
    box.innerHTML = `<svg width="${W}" height="${H}" id="tl"></svg>` + labels.map((l, i) => `<button class="tdot" data-i="${i}" style="left:${pts[i].x - 22}px;top:${pts[i].y - 22}px">${l}</button>`).join('');
    let next = 0, err = 0; const t0 = performance.now(); $('#tinfo').textContent = 'Go!';
    $$('.tdot', box).forEach(b => b.onclick = () => {
      const i = +b.dataset.i;
      if (i !== next) { err++; b.classList.add('bad'); setTimeout(() => b.classList.remove('bad'), 300); return; }
      b.classList.add('ok');
      if (i > 0) $('#tl').insertAdjacentHTML('beforeend', `<line x1="${pts[i - 1].x}" y1="${pts[i - 1].y}" x2="${pts[i].x}" y2="${pts[i].y}" stroke="var(--c)" stroke-width="3"/>`);
      next++; if (next === labels.length) res({ t: (performance.now() - t0) / 1000, err });
    });
  });
}

// ============================================================ COLOR CLASH (Stroop)
async function stroop(g) {
  const run = RUN, C = [['RED', '#FF5A6E'], ['GREEN', '#3DDC97'], ['BLUE', '#4FC3F7'], ['YELLOW', '#FFC83D']];
  let ok = 0, bad = 0; const rts = { con: [], inc: [] };
  $('#gb').innerHTML = `<div class="a-top"><div class="a-stat"><small>CORRECT</small><span id="sok">0</span></div><div class="a-stat"><small>TIME</small><span id="stl">45</span></div><div class="a-stat"><small>ERRORS</small><span id="sbad">0</span></div></div>
    <div class="muted">Tap the <b>ink color</b>, not the word.</div><div class="stroopword" id="sw"></div>
    <div class="pad" style="grid-template-columns:repeat(4,1fr)">${C.map(([n, c]) => `<button data-c="${n}" style="background:${c}22;border-color:${c};color:${c}">${n}</button>`).join('')}</div>`;
  let cur, shown; const t0 = performance.now();
  const nextTrial = () => { const word = C[Math.floor(Math.random() * 4)], con = Math.random() < .5; const ink = con ? word : C.filter(c => c !== word)[Math.floor(Math.random() * 3)];
    cur = { ink: ink[0], con }; const w = $('#sw'); w.textContent = word[0]; w.style.color = ink[1]; shown = performance.now(); };
  nextTrial();
  $$('[data-c]').forEach(b => b.onclick = () => { if (run !== RUN) return; const rt = performance.now() - shown;
    if (b.dataset.c === cur.ink) { ok++; rts[cur.con ? 'con' : 'inc'].push(rt); } else bad++;
    $('#sok').textContent = ok; $('#sbad').textContent = bad; nextTrial(); });
  while (performance.now() - t0 < 45000) { if (run !== RUN) return; $('#stl').textContent = Math.ceil(45 - (performance.now() - t0) / 1000); await sleep(200); }
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const interf = med(rts.inc) != null && med(rts.con) != null ? Math.round(med(rts.inc) - med(rts.con)) : null;
  finish(g, ok, { errors: bad, median_rt_congruent: med(rts.con), median_rt_incongruent: med(rts.inc), interference_ms: interf },
    [interf != null ? `Stroop effect: mismatched words took ${interf} ms longer than matched ones (median).` : '']);
}

// ============================================================ MEMORY GRID (Corsi)
async function corsi(g) {
  const run = RUN;
  $('#gb').innerHTML = `<div class="eyebrow">MEMORY GRID</div><div class="muted" id="cinfo">Watch the sequence…</div><div class="cboard" id="cb"></div>`;
  const box = $('#cb'), pos = [[12, 18], [52, 8], [82, 22], [26, 46], [60, 40], [88, 58], [10, 78], [44, 72], [74, 86]];
  box.innerHTML = pos.map(([x, y], i) => `<button class="cblk" data-i="${i}" style="left:${x}%;top:${y}%"></button>`).join('');
  let len = 2, span = 0, fails = 0;
  while (fails < 2 && len <= 9) {
    if (run !== RUN) return;
    const seq = shuffle([...Array(9).keys()]).slice(0, len);
    $('#cinfo').textContent = `Watch: ${len} blocks`; $$('.cblk').forEach(b => b.disabled = true); await sleep(700);
    for (const i of seq) { const b = $(`.cblk[data-i="${i}"]`); b.classList.add('lit'); await sleep(650); b.classList.remove('lit'); await sleep(250); if (run !== RUN) return; }
    $('#cinfo').textContent = 'Your turn: tap them in the same order'; $$('.cblk').forEach(b => b.disabled = false);
    const ok = await new Promise(res => { let k = 0; $$('.cblk').forEach(b => b.onclick = () => { const i = +b.dataset.i; b.classList.add('tap'); setTimeout(() => b.classList.remove('tap'), 200);
      if (i !== seq[k]) return res(false); k++; if (k === seq.length) res(true); }); });
    if (ok) { span = len; fails = 0; len++; $('#cinfo').textContent = '✓ Correct!'; } else { fails++; $('#cinfo').textContent = fails < 2 ? '✗ Missed. One more try at this length.' : '✗ Missed again.'; }
    await sleep(800);
  }
  finish(g, span, { longest_correct: span }, [`Your Corsi span: ${span} blocks in a row.`]);
}

// ============================================================ REFLEX (simple RT)
async function reaction(g) {
  const run = RUN, rts = []; let early = 0;
  $('#gb').innerHTML = `<div class="eyebrow">REFLEX · 8 TRIALS</div><div class="muted" id="rinfo">Tap the circle as soon as it turns green.</div><button class="rtc" id="rc">wait…</button><div class="muted" id="rlist"></div>`;
  const c = $('#rc');
  for (let t = 0; t < 8; t++) {
    if (run !== RUN) return;
    c.className = 'rtc'; c.textContent = 'wait…';
    let armed = false, go = 0;
    const res = await new Promise(resolve => {
      const timer = setTimeout(() => { armed = true; go = performance.now(); c.className = 'rtc go'; c.textContent = 'TAP!'; }, 1500 + Math.random() * 2500);
      c.onclick = () => {
        if (!armed) { clearTimeout(timer); early++; c.onclick = null; c.className = 'rtc early'; c.textContent = 'too early!'; setTimeout(() => resolve(null), 700); }
        else { const ms = performance.now() - go; c.onclick = null; c.className = 'rtc'; c.textContent = `${Math.round(ms)} ms`; resolve(ms); }
      };
    });
    if (res != null) rts.push(Math.round(res)); else t--;
    $('#rlist').textContent = rts.map(r => r + ' ms').join(' · ');
    await sleep(500);
    if (early > 6) break;
  }
  const med = rts.slice().sort((a, b) => a - b)[Math.floor(rts.length / 2)] ?? 0;
  finish(g, med, { trials: rts, early_taps: early }, [`Median of ${rts.length} trials. ${early} early tap(s) were re-run.`]);
}

// ============================================================ MRI PAGE (real 3D CNN)
export async function pageMRI() {
  RUN++;
  const [m, samples] = await Promise.all([X().api('/api/mri/metrics'), X().api('/api/mri/samples')]);
  const cv = m.clinical_validity, tr = m.test_retest;
  $('#p-mri').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">🩻 MRI brain age</div>
    <div class="sub">A 3D convolutional neural network trained on <b>${m.n_volumes} real MRI scans</b> from Kaggle (OASIS-1, ${m.data.split(':')[0]}), joined to each person's real age and dementia rating.</div>
    <div class="kpis"><div class="kpi"><div class="v">${m.mae.toFixed(1)} yrs</div><div class="l">MAE on ${m.n_normal} cognitively normal people, 5-fold CV split by subject (r = ${m.r.toFixed(2)}). Volume-only model: ${m.nwbv_model_mae.toFixed(1)}.</div></div>
      <div class="kpi"><div class="v">AUC ${cv.auc.toFixed(2)}</div><div class="l">brain-age gap separates dementia (n=${m.n_dementia}) from age-matched normals · 95% CI ${cv.auc_ci[0].toFixed(2)}–${cv.auc_ci[1].toFixed(2)}</div></div>
      <div class="kpi"><div class="v">ICC ${tr.icc.toFixed(2)}</div><div class="l">${tr.n_pairs} people scanned twice: mean difference ${tr.mean_abs_diff.toFixed(1)} yrs</div></div>
      <div class="kpi"><div class="v">±${tr.smallest_detectable_change.toFixed(1)} yrs</div><div class="l">smallest change detectable between two scans of one person</div></div></div>
    <div class="cr-grid" style="margin-top:16px">
      <div class="glass card">
        <div class="eyebrow">1 · TRY A REAL OASIS SCAN</div>
        <select id="msel" style="margin:10px 0">${samples.map(s => `<option value="${s.file}">${s.ID} · ${s.Age} y · ${s.female ? 'F' : 'M'} · ${s.status}${s.CDR != null ? ` (CDR ${s.CDR})` : ''}</option>`).join('')}</select>
        <button class="cta" id="mrun" style="width:100%">🧠 Analyze this scan</button>
        <div class="eyebrow" style="margin-top:22px">2 · OR UPLOAD YOUR OWN</div>
        <label class="drop" id="drop"><input type="file" id="mfile" accept=".nii,.gz" hidden>
          <div style="font-size:34px">⬆</div><b>Drop a .nii / .nii.gz T1 scan</b><span class="muted">or click to choose a file</span></label>
        <p class="muted"><b>What works:</b> a T1-weighted MRI that is <b>skull-stripped and registered to the 2 mm MNI grid (91×109×91)</b>, the format the model was trained on. Raw scanner files (DICOM, or scans with the skull still on) need preprocessing first, e.g. FSL <code>bet</code> + <code>flirt</code> to MNI152 2 mm. The app checks the format and tells you if it doesn't match, rather than guessing.</p>
        <p class="muted">Your scan is analyzed in memory and never saved; only the result is stored in your local database.</p>
      </div>
      <div class="glass card" id="mout"><div class="empty">Pick a scan or upload one to see its brain age and a heatmap of the regions that drove the prediction.</div></div>
    </div></div></div>`;
  const show = async (promise) => { $('#mout').innerHTML = '<div class="empty"><div class="typing"><span></span><span></span><span></span></div> Running the 5-model 3D CNN ensemble + Grad-CAM…</div>';
    try { renderMRI(await promise); } catch (e) { $('#mout').innerHTML = `<div class="empty">⚠ ${e.message}</div>`; } };
  $('#mrun').onclick = () => { const fd = new FormData(); fd.append('file', $('#msel').value); show(fetchForm(`/api/me/mri/sample`, fd)); };
  const up = f => { const fd = new FormData(); fd.append('file', f); fd.append('age', me().profile.age); show(fetchForm(`/api/me/mri/upload`, fd)); };
  $('#mfile').onchange = e => e.target.files[0] && up(e.target.files[0]);
  const d = $('#drop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
  d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); e.dataTransfer.files[0] && up(e.dataTransfer.files[0]); };
}
async function fetchForm(url, fd) { const r = await fetch(url, { method: 'POST', body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.detail || r.statusText); return j; }
function renderMRI(r) {
  const f = r.format;
  if (r.brain_age == null) { $('#mout').innerHTML = `<div class="eyebrow">FORMAT CHECK</div><h2>This scan can't be scored</h2>${f.issues.map(i => `<p class="caveat">⚠ ${i}</p>`).join('')}<p class="muted">Preprocess it to skull-stripped MNI 2 mm space and try again.</p>`; return; }
  const gap = r.gap, inside = gap != null && Math.abs(gap) < r.sdc, t = r.truth;
  $('#mout').innerHTML = `<div class="eyebrow">RESULT</div>
    ${f.ok ? '' : f.issues.map(i => `<p class="caveat">⚠ ${i}</p>`).join('')}
    <div style="display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap"><div><div class="tiny">MRI BRAIN AGE</div><div style="font:700 64px/1 'Space Grotesk'">${r.brain_age.toFixed(0)}</div></div>
      ${r.age != null ? `<div><div class="tiny">ACTUAL AGE</div><div style="font:700 40px/1 'Space Grotesk';color:#9AA3C7">${Math.round(r.age)}</div></div>
      <div><div class="tiny">BIAS-CORRECTED GAP</div><div style="font:700 40px/1 'Space Grotesk';color:${gap > 0 ? '#FF8A7A' : '#3DDC97'}">${gap > 0 ? '+' : ''}${gap.toFixed(1)}</div></div>` : ''}</div>
    <p class="muted">5 models: ${r.fold_preds.map(p => p.toFixed(0)).join(' · ')} yrs. Model error ±${r.mae.toFixed(1)} yrs (MAE). ${gap != null ? (inside ? `The gap is inside the ±${r.sdc.toFixed(1)}-yr scan-to-scan noise band.` : `The gap is larger than the ±${r.sdc.toFixed(1)}-yr scan-to-scan noise band.`) : ''} Template similarity r = ${f.similarity?.toFixed(2)}.</p>
    ${t ? `<div class="ours"><b>Ground truth (OASIS):</b> ${t.id}, age ${t.age}, ${t.status}${t.cdr != null ? `, CDR ${t.cdr}` : ''}. Honest out-of-fold brain age: <b>${t.oof_brain_age.toFixed(1)}</b>. ${t.note}</div>` : ''}
    <div class="eyebrow" style="margin-top:16px">WHERE THE MODEL LOOKED (Grad-CAM, orange = pushed the age estimate up)</div>
    <div class="mslices">${['axial', 'coronal', 'sagittal'].map(k => `<figure><img src="${r.images[k]}" alt="${k} slice"><figcaption>${k}</figcaption></figure>`).join('')}</div>
    <p class="muted">Heatmaps show which areas influenced this prediction, not a diagnosis. In aging brains models typically focus on enlarged ventricles and widened sulci (cerebrospinal fluid spaces).</p>`;
}
