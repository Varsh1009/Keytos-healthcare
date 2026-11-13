// Friendly Home, Voice check and My Data pages. Helpers come from app.js via window.NTX.
const X = () => window.NTX;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const me = () => X().getME();
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------ plain language
export function plainAmount(y) {
  const a = Math.abs(y);
  if (a < 0.1) return null;
  if (a < 1) { const m = Math.max(1, Math.round(a * 12)); return `${m} month${m === 1 ? '' : 's'}`; }
  return `${a.toFixed(1)} years`;
}
export function plainLever(L) {
  const amt = plainAmount(L.years), top = Object.values(L.per_factor).filter(f => f.in_total && f.years > 0.05).sort((a, b) => b.years - a.years)[0];
  const head = !amt ? 'Your habits are right on the healthy targets 🎉'
    : L.years > 0 ? `Your habits look like a brain about ${amt} older than it could be`
      : `Your habits are even better than the healthy targets 🎉`;
  const why = top ? `Biggest reason: <b>${top.label.toLowerCase()}</b> (yours ${Math.round(top.value * 10) / 10}, healthy target ${top.target}).` : '';
  const how = `How we know: in a CDC health survey of ${L.n.toLocaleString()} adults aged 60+, people with habits like yours scored on a thinking-speed test the way people ${amt ? amt + (L.years > 0 ? ' older' : ' younger') : 'your age'} usually do. It's a pattern in real data, not a diagnosis.`;
  return { head, why, how, top };
}
const QUEST_FOR = { 'Blood pressure': 'bp', 'Mood (PHQ-9)': 'joy', 'Sleep (distance from 7 h)': 'sleep', 'Smoking': 'smoke', 'Diabetes': 'labs' };

// ------------------------------------------------------------ cute brain buddy
export const buddy = (mood = 'happy', size = 120) => `<svg class="buddy" width="${size}" height="${size}" viewBox="0 0 120 120">
  <defs><radialGradient id="bg1" cx=".4" cy=".35"><stop offset="0" stop-color="#FFD9E0"/><stop offset="1" stop-color="#F59AB0"/></radialGradient></defs>
  <path d="M60 14c-14 0-22 8-24 14-12 0-22 10-20 22-8 6-8 20 2 26 0 12 12 20 24 18 6 8 22 10 30 2 12 6 28-2 28-16 10-6 10-20 2-26 2-12-8-22-20-22-4-10-12-18-22-18z" fill="url(#bg1)" stroke="#E37A95" stroke-width="2.5"/>
  <path d="M46 34c4 4 4 10 0 14M74 32c-4 6-2 12 4 14M38 64c6-2 10 2 10 8M82 62c-6 0-8 6-6 10" stroke="#E37A95" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>
  <ellipse cx="46" cy="58" rx="6" ry="${mood === 'sleepy' ? 1.5 : 7}" fill="#2B1B3D"/><ellipse cx="76" cy="58" rx="6" ry="${mood === 'sleepy' ? 1.5 : 7}" fill="#2B1B3D"/>
  <circle cx="48" cy="55" r="2" fill="#fff"/><circle cx="78" cy="55" r="2" fill="#fff"/>
  <ellipse cx="38" cy="70" rx="6" ry="3.5" fill="#FF7FA0" opacity=".6"/><ellipse cx="84" cy="70" rx="6" ry="3.5" fill="#FF7FA0" opacity=".6"/>
  <path d="${mood === 'wow' ? 'M56 72 q5 8 10 0 q-5 -4 -10 0' : 'M52 70 q9 9 18 0'}" stroke="#2B1B3D" stroke-width="3" fill="${mood === 'wow' ? '#2B1B3D' : 'none'}" stroke-linecap="round"/>
</svg>`;

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

// ------------------------------------------------------------ HOME
export async function pageHome() {
  const M = me(), L = M.lever, P = plainLever(L);
  const [GS, games, VH] = await Promise.all([X().api(`/api/me/games`), X().api('/api/games'), X().api(`/api/me/voice`)]);
  // Today's plan: 1) the mission for your biggest lever, 2) voice check, 3) the game you've played least
  const q1 = (P.top && QUEST_FOR[P.top.label]) || Object.keys(M.trail).find(k => M.trail[k] !== 'done') || 'steps';
  const Q = X().QMAP(), q = Q[q1];
  const voiceDone = VH.history.some(v => v.date === new Date().toISOString().slice(0, 10)) || GS.voice?.played_today;
  const g = games.games.filter(x => x.id !== 'speed').sort((a, b) => (GS[a.id]?.plays ?? 0) - (GS[b.id]?.plays ?? 0))[0];
  const plan = [
    { n: 1, icon: q.icon, color: q.color, title: q.title, why: P.top ? `Your biggest lever is ${P.top.label.toLowerCase()}.` : q.steps[0], time: '5 min', href: `#/play/${q.id}`, done: M.trail[q.id] === 'done' },
    { n: 2, icon: '🎙️', color: '#5EEAD4', title: 'Voice check', why: 'Read a short paragraph out loud. We measure your speaking pace and pauses.', time: '1 min', href: '#/voice', done: voiceDone },
    { n: 3, icon: g.icon, color: g.color, title: g.title, why: `${g.domain}: ${g.how}`, time: '2 min', href: `#/game/${g.id}`, done: GS[g.id]?.played_today },
  ];
  const done = plan.filter(p => p.done).length, next = plan.find(p => !p.done);
  const Lv = M.level, frac = Lv.next_at ? (M.sparks - Lv.floor) / (Lv.next_at - Lv.floor) : 1;
  const mood = done === 3 ? 'wow' : 'happy';
  $('#p-home').innerHTML = `<div class="scrollpage"><div class="home2">
    <section class="hello glass">
      <div class="buddywrap">${buddy(mood, 132)}</div>
      <div><div class="eyebrow">${greeting().toUpperCase()}</div><div class="hi">Hi ${esc(M.name)}!</div>
        <div class="bubble2">${done === 3 ? "You did everything today. Your brain buddy is proud! 🎉 Come back tomorrow." : done ? `Nice, ${done} of 3 done! Next: <b>${next.title}</b>.` : `Here's your plan for today: <b>3 small things</b>, about 8 minutes. Tap the first one to start.`}</div></div>
    </section>

    <section class="glass plan"><div class="sec-h"><span>📋 Today's plan</span><span class="muted">${done}/3 done</span></div>
      ${plan.map(p => `<a class="pcard ${p.done ? 'done' : ''} ${next === p ? 'next' : ''}" href="${p.href}" style="--c:${p.color}">
        <div class="pnum">${p.done ? '✓' : p.n}</div><div class="picon">${p.icon}</div>
        <div class="ptxt"><b>${p.title}</b><span>${p.why}</span></div>
        <div class="pgo">${p.done ? 'Done' : `${p.time} →`}</div></a>`).join('')}
    </section>

    <section class="glass insight"><div class="sec-h"><span>🧠 What your habits say</span><a href="#/levers" class="muted">try "what if" →</a></div>
      <div class="ins-head">${P.head}</div>
      ${P.why ? `<div class="ins-why">${P.why} ${P.top ? `<a href="#/play/${QUEST_FOR[P.top.label] || 'bp'}">Work on it →</a>` : ''}</div>` : ''}
      <div class="meterbar"><div class="mtrack"><i style="left:${Math.max(2, Math.min(98, 50 + L.years / 4 * 50))}%"></i></div>
        <div class="mlabels"><span>younger</span><span>on target</span><span>older</span></div></div>
      <details class="ev"><summary>What does this mean?</summary><div class="evb"><p>${P.how}</p><p>The range is ${X().fmt(L.ci[0])} to ${X().fmt(L.ci[1])} years (95% confidence). Only habits with a clear link in the data count.</p></div></details>
    </section>

    <section class="stats3">
      <div class="glass st"><div class="stv">🔥 ${M.streak}</div><div class="stl">day streak</div></div>
      <div class="glass st"><div class="stv">⚡ ${M.sparks.toLocaleString()}</div><div class="stl">sparks</div></div>
      <div class="glass st"><div class="stv">Lv ${Lv.index}</div><div class="stl">${Lv.name}${Lv.next_at ? ` · ${Lv.next_at - M.sparks} to go` : ''}</div><div class="lvbar"><i style="width:${frac * 100}%"></i></div></div>
    </section>

    <section class="explore">${[['🧠', 'Brain Atlas', '#/atlas', 'Diseases on a real brain'], ['🧩', 'Games', '#/gym', '7 brain games'], ['🎙️', 'Voice', '#/voice', 'How you speak'], ['📱', 'My data', '#/data', 'Watch, MRI, what-ifs'], ['🤖', 'Coach', '#/coach', 'Ask anything'], ['✅', 'All missions', '#/play', 'Every daily mission']]
      .map(([i, t, h, s]) => `<a class="tile glass" href="${h}"><span>${i}</span><b>${t}</b><small>${s}</small></a>`).join('')}</section>
  </div></div>`;
}

// ------------------------------------------------------------ VOICE CHECK
let REC = null;
// Leaving the page mid-recording: turn the microphone off and discard the audio (nothing is uploaded).
export function stopVoice() {
  const R = REC; REC = null; if (!R) return;
  try { R.proc.disconnect(); R.stream.getTracks().forEach(t => t.stop()); R.sr?.stop(); R.ctx.close(); } catch { }
}
export async function pageVoice() {
  const [T, VH] = await Promise.all([X().api('/api/voice/tasks'), X().api(`/api/me/voice`)]);
  $('#p-voice').innerHTML = `<div class="scrollpage"><div class="wrap">
    <h1>Voice check</h1>
    <div class="sub">We measure <b>how</b> you talk (pace and pauses), not what you say. Audio never leaves this computer.</div>
    <div class="cr-grid">
      <div class="glass card">
        <div class="chips" style="margin-bottom:12px"><button class="chip on" data-t="reading">Read aloud</button><button class="chip" data-t="free">Tell a story</button></div>
        <div class="vprompt" id="vprompt">${esc(T.reading)}</div>
        <div class="recwrap"><button class="recbtn" id="rec" aria-label="Start or stop recording"><i class="ti ti-microphone" aria-hidden="true"></i></button><canvas id="wave" width="600" height="80"></canvas><div class="muted" id="rstat">Tap the mic, read the text at your normal pace, then tap again to stop.</div></div>
        <p class="tiny">People with early memory problems tend to speak more slowly and pause more (<a href="${T.evidence}" target="_blank" rel="noopener">study</a>). You're only compared with yourself. Not a diagnosis.</p>
      </div>
      <div class="glass card" id="vout">${VH.history.length ? '' : '<div class="empty">Your results show up here after your first recording.</div>'}</div>
    </div></div></div>`;
  let task = 'reading';
  $$('#p-voice [data-t]').forEach(b => b.onclick = () => { task = b.dataset.t; $$('#p-voice [data-t]').forEach(x => x.classList.toggle('on', x === b)); $('#vprompt').textContent = task === 'reading' ? T.reading : T.free; });
  $('#rec').onclick = () => REC ? stopRec(task) : startRec();
  if (VH.history.length) renderVoiceHistory(VH.history.map(v => ({ ts: v.ts, task: v.task, ...v.metrics })));
}
async function startRec() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch (e) { X().toast('Microphone not available. Allow microphone access for this page and try again.', 5000); return; }
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), chunks = [];
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let words = 0, sr = null;
  if (SR) { try { sr = new SR(); sr.continuous = true; sr.onresult = e => { words = 0; for (const r of e.results) words += r[0].transcript.trim().split(/\s+/).filter(Boolean).length; }; sr.start(); } catch { sr = null; } }
  const cv = $('#wave'), g = cv.getContext('2d'), t0 = performance.now();
  proc.onaudioprocess = e => { const d = new Float32Array(e.inputBuffer.getChannelData(0)); chunks.push(d);
    g.fillStyle = 'rgba(6,8,15,.35)'; g.fillRect(0, 0, cv.width, cv.height); g.strokeStyle = '#5EEAD4'; g.beginPath();
    for (let i = 0; i < d.length; i += 32) { const x = i / d.length * cv.width, y = cv.height / 2 + d[i] * cv.height * 1.6; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    const s = (performance.now() - t0) / 1000; $('#rstat').textContent = `Recording… ${s.toFixed(0)} s (tap to stop${s < 10 ? ', at least 10 s' : ''})`; if (s > 90) $('#rec').click(); };
  src.connect(proc); proc.connect(ctx.destination);
  REC = { stream, ctx, proc, chunks, rate: ctx.sampleRate, t0, sr, words: () => words };
  $('#rec').classList.add('on');
}
async function stopRec(task) {
  const R = REC; REC = null; $('#rec').classList.remove('on');
  R.proc.disconnect(); R.stream.getTracks().forEach(t => t.stop()); try { R.sr?.stop(); } catch { }
  await R.ctx.close();
  const secs = (performance.now() - R.t0) / 1000;
  if (secs < 8) { X().toast('Too short. Please speak for at least 10 seconds.'); return; }
  const wav = toWav(R.chunks, R.rate);
  $('#rstat').textContent = 'Analyzing your speech…';
  const fd = new FormData(); fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'voice.wav'); fd.append('task', task);
  if (R.sr && task === 'free' && R.words()) fd.append('words', R.words());
  const r = await fetch(`/api/me/voice`, { method: 'POST', body: fd }); const j = await r.json();
  if (!r.ok) { $('#rstat').textContent = '⚠ ' + (j.detail || 'Could not analyze'); return; }
  X().setME(j.player); X().renderHUD();
  $('#rstat').textContent = j.sparks_gained ? `Done! +${j.sparks_gained} ⚡` : 'Done! (today\'s sparks already earned)';
  renderVoiceResult(j);
}
function toWav(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const step = rate / 16000, len = Math.floor(n / step), pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) { const v = Math.max(-1, Math.min(1, all[Math.floor(i * step)])); pcm[i] = v * 32767; }
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf), w = (p, s) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm); return buf;
}
function cmp(now, base, key, better, unit, label) {
  if (!base || base[key] == null) return '';
  const d = now[key] - base[key]; if (Math.abs(d) < 1e-9) return `<li>${label}: same as your first check.</li>`;
  const good = better === 'higher' ? d > 0 : d < 0;
  return `<li>${label}: ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(unit === '%' ? 0 : 2)}${unit} vs your first check ${good ? '🟢' : '🟡'}</li>`;
}
function renderVoiceResult(j) {
  const m = j.metrics, b = j.baseline;
  $('#vout').innerHTML = `<div class="eyebrow">YOUR VOICE TODAY</div>
    <div class="vstats"><div><b>${m.speech_tempo}</b><span>syllables / sec</span></div><div><b>${m.pauses}</b><span>pauses</span></div><div><b>${Math.round(m.silent_pause_ratio * 100)}%</b><span>time pausing</span></div><div><b>${m.pitch_median_hz ?? '–'}</b><span>pitch (Hz)</span></div></div>
    <ul class="plain">${j.plain.map(l => `<li>${l}</li>`).join('')}</ul>
    ${b ? `<div class="eyebrow" style="margin-top:12px">COMPARED WITH YOUR FIRST CHECK</div><ul class="plain">${cmp(m, b, 'speech_tempo', 'higher', '', 'Speaking pace')}${cmp({ r: m.silent_pause_ratio * 100 }, { r: b.silent_pause_ratio * 100 }, 'r', 'lower', '%', 'Time spent pausing')}</ul>` : '<p class="muted">This is your baseline. Do the same task again on another day to see your trend.</p>'}
    <div style="height:180px;margin-top:10px"><canvas id="vch"></canvas></div>`;
  if (j.history.length > 1) X().chart('vch', { type: 'line', data: { labels: j.history.map(h => h.ts.slice(5, 10)), datasets: [{ label: 'syllables/sec', data: j.history.map(h => h.speech_tempo), borderColor: '#5EEAD4', tension: .3, yAxisID: 'y' }, { label: '% pausing', data: j.history.map(h => Math.round(h.silent_pause_ratio * 100)), borderColor: '#FBBF24', tension: .3, yAxisID: 'y1' }] }, options: X().chartOpts({ scales: { y: { ticks: { color: '#A9B2CA' } }, y1: { position: 'right', ticks: { color: '#A9B2CA' }, grid: { display: false } }, x: { ticks: { color: '#A9B2CA' } } } }) });
}
function renderVoiceHistory(h) {
  const last = h[h.length - 1];
  renderVoiceResult({ metrics: last, plain: [`Last check (${last.task === 'reading' ? 'read aloud' : 'story'}): ${last.speech_tempo} syllables/sec, ${last.pauses} pauses.`], baseline: h.length > 1 ? h.find(x => x.task === last.task) : null, history: h.filter(x => x.task === last.task) });
}

// ------------------------------------------------------------ MY DATA
export async function pageData() {
  const W = await X().api(`/api/me/wearables`), S = W.summary, days = Object.entries(W.days);
  $('#p-data').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">📱 My data</div><div class="sub">Bring in real data from your phone or watch, analyze an MRI scan, or play with "what if" sliders. Everything stays on this computer.</div>
    <div class="cr-grid">
      <div class="glass card"><div class="eyebrow">PHONE & WATCH</div>
        <label class="drop" id="wdrop"><input type="file" id="wfile" accept=".zip,.xml,.csv" hidden><div style="font-size:34px">⌚</div><b>Drop your Apple Health export.zip</b><span class="muted">or a CSV from Fitbit / Google Fit / Garmin</span></label>
        <p class="muted"><b>iPhone:</b> Health app → your photo (top right) → <i>Export All Health Data</i> → save the zip, then drop it here.<br>
        <b>Other apps:</b> a CSV with a <code>date</code> column and any of <code>steps</code>, <code>sleep_hours</code>, <code>resting_hr</code>, <code>hrv_ms</code>, <code>walking_speed</code>.</p>
        <div id="wmsg"></div></div>
      <div class="glass card">${S.days_with_data ? `<div class="eyebrow">YOUR LAST ${S.window_days} DAYS (${S.days_with_data} days imported, ${S.from} → ${S.to})</div>
        <div class="vstats">${S.steps != null ? `<div><b>${Math.round(S.steps).toLocaleString()}</b><span>steps / day</span></div>` : ''}${S.sleep_hours != null ? `<div><b>${S.sleep_hours.toFixed(1)} h</b><span>sleep / night</span></div>` : ''}${S.resting_hr != null ? `<div><b>${Math.round(S.resting_hr)}</b><span>resting heart rate</span></div>` : ''}${S.hrv_ms != null ? `<div><b>${Math.round(S.hrv_ms)} ms</b><span>heart-rate variability</span></div>` : ''}</div>
        <ul class="plain">${S.steps != null ? `<li>${S.steps >= 9826 ? '🟢 You average more than 9,826 steps, the "best dose" in a UK study of 78,430 people.' : S.steps >= 3826 ? `🟡 You're above the 3,826-step "minimum dose". ${Math.round(9826 - S.steps).toLocaleString()} more a day reaches the best dose.` : `🟠 ${Math.round(3826 - S.steps).toLocaleString()} more steps a day reaches the 3,826-step minimum dose.`}</li>` : ''}
        ${S.sleep_hours != null ? `<li>Your sleep average (${S.sleep_hours.toFixed(1)} h) now feeds your "What your habits say" score instead of the number you typed at sign-up.</li>` : ''}</ul>
        <div style="height:200px"><canvas id="wch"></canvas></div>` : '<div class="empty">No device data yet. Drop a file on the left to see your real steps and sleep here.</div>'}</div>
    </div>
    <div class="explore" style="margin-top:16px">
      <a class="tile glass" href="#/mri"><span>🩻</span><b>MRI brain age</b><small>Upload a scan or try a real one</small></a>
      <a class="tile glass" href="#/levers"><span>🎛</span><b>What if…</b><small>Move sliders, see the effect</small></a>
      <a class="tile glass" href="#/progress"><span>📈</span><b>All my charts</b><small>Missions, games, trends</small></a></div>
  </div></div>`;
  if (days.length) X().chart('wch', { type: 'bar', data: { labels: days.map(d => d[0].slice(5)), datasets: [{ label: 'steps', data: days.map(d => d[1].steps ?? null), backgroundColor: 'rgba(61,220,151,.7)', borderRadius: 4, yAxisID: 'y' }, { type: 'line', label: 'sleep (h)', data: days.map(d => d[1].sleep_hours ?? null), borderColor: '#7C8CFF', yAxisID: 'y1', tension: .3, spanGaps: true }] }, options: X().chartOpts({ scales: { y: { ticks: { color: '#A9B2CA' } }, y1: { position: 'right', ticks: { color: '#A9B2CA' }, grid: { display: false } }, x: { ticks: { color: '#A9B2CA' } } } }) });
  const up = async f => { $('#wmsg').innerHTML = '<p class="muted">Reading your file… (big Apple exports can take a minute)</p>';
    const fd = new FormData(); fd.append('file', f); const r = await fetch(`/api/me/wearables`, { method: 'POST', body: fd }); const j = await r.json();
    if (!r.ok) { $('#wmsg').innerHTML = `<p class="caveat">⚠ ${esc(j.detail)}</p>`; return; } X().setME(j.player); X().toast(`Imported ${j.imported_days} days ✓`); pageData(); };
  $('#wfile').onchange = e => e.target.files[0] && up(e.target.files[0]);
  const d = $('#wdrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over'); d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); e.dataTransfer.files[0] && up(e.dataTransfer.files[0]); };
}
