// Friendly Home, Voice check and My Data pages. Helpers come from app.js via window.NTX.
import * as RA from './readalong.js?v=1';
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
  const [GS, games] = await Promise.all([X().api(`/api/player/${enc(M.name)}/games`), X().api('/api/games')]);
  // Today's plan: 1) Speed Sprint (the one game with trial evidence), 2) Read Aloud, 3) the game you've played least
  const G = Object.fromEntries(games.games.map(x => [x.id, x]));
  const g = games.games.filter(x => x.id !== 'speed' && x.id !== 'readaloud').sort((a, b) => (GS[a.id]?.plays ?? 0) - (GS[b.id]?.plays ?? 0))[0];
  const item = (x, why, time, href) => x && { icon: x.icon, color: x.color, title: x.title, why, time, href, done: GS[x.id]?.played_today };
  const plan = [   // skip any game this server doesn't have (e.g. an older server still running), never crash
    item(G.speed, 'Match symbols to numbers, fast. Play twice for the booster round.', '1 min', '#/sprint'),
    item(G.readaloud, 'Read a short passage out loud. Each word lights up as you say it.', '1 min', '#/game/readaloud'),
    g && item(g, `${g.domain}: ${g.how}`, '2 min', `#/game/${g.id}`),
  ].filter(Boolean).map((p, i) => ({ ...p, n: i + 1 }));
  const done = plan.filter(p => p.done).length, next = plan.find(p => !p.done), N = plan.length;
  const Lv = M.level, frac = Lv.next_at ? (M.sparks - Lv.floor) / (Lv.next_at - Lv.floor) : 1;
  const mood = done === N ? 'wow' : 'happy';
  $('#p-home').innerHTML = `<div class="scrollpage"><div class="home2">
    <section class="hello glass">
      <div class="buddywrap">${buddy(mood, 132)}</div>
      <div><div class="eyebrow">${greeting().toUpperCase()}</div><div class="hi">Hi ${esc(M.name)}!</div>
        <div class="bubble2">${done === N ? "You did everything today. Your brain buddy is proud! 🎉 Come back tomorrow." : done ? `Nice, ${done} of ${N} done! Next: <b>${next.title}</b>.` : `Here's your plan for today: <b>${N} quick games</b>, about 5 minutes. Tap the first one to start.`}</div></div>
    </section>

    <section class="glass plan"><div class="sec-h"><span>📋 Today's plan</span><span class="muted">${done}/${N} done</span></div>
      ${plan.map(p => `<a class="pcard ${p.done ? 'done' : ''} ${next === p ? 'next' : ''}" href="${p.href}" style="--c:${p.color}">
        <div class="pnum">${p.done ? '✓' : p.n}</div><div class="picon">${p.icon}</div>
        <div class="ptxt"><b>${p.title}</b><span>${p.why}</span></div>
        <div class="pgo">${p.done ? 'Done' : `${p.time} →`}</div></a>`).join('')}
    </section>

    <section class="glass insight"><div class="sec-h"><span>🧠 What your habits say</span><a href="#/levers" class="muted">try "what if" →</a></div>
      <div class="ins-head">${P.head}</div>
      ${P.why ? `<div class="ins-why">${P.why} ${P.top ? `<a href="#/levers">See what changes it →</a>` : ''}</div>` : ''}
      <div class="meterbar"><div class="mtrack"><i style="left:${Math.max(2, Math.min(98, 50 + L.years / 4 * 50))}%"></i></div>
        <div class="mlabels"><span>younger</span><span>on target</span><span>older</span></div></div>
      <details class="ev"><summary>What does this mean?</summary><div class="evb"><p>${P.how}</p><p>The range is ${X().fmt(L.ci[0])} to ${X().fmt(L.ci[1])} years (95% confidence). Only habits with a clear link in the data count.</p></div></details>
    </section>

    <section class="stats3">
      <div class="glass st"><div class="stv">🔥 ${M.streak}</div><div class="stl">day streak</div></div>
      <div class="glass st"><div class="stv">⚡ ${M.sparks.toLocaleString()}</div><div class="stl">sparks</div></div>
      <div class="glass st"><div class="stv">Lv ${Lv.index}</div><div class="stl">${Lv.name}${Lv.next_at ? ` · ${Lv.next_at - M.sparks} to go` : ''}</div><div class="lvbar"><i style="width:${frac * 100}%"></i></div></div>
    </section>

    <section class="explore">${[['🧩', 'Games', '#/gym', `${games.games.length} brain games`], ['🎙️', 'Voice', '#/voice', 'How you speak'], ['📱', 'My data', '#/data', 'Watch, MRI, what-ifs'], ['🤖', 'Coach', '#/coach', 'Ask anything'], ['📈', 'Progress', '#/progress', 'Your charts']]
      .map(([i, t, h, s]) => `<a class="tile glass" href="${h}"><span>${i}</span><b>${t}</b><small>${s}</small></a>`).join('')}</section>
  </div></div>`;
}

// ------------------------------------------------------------ VOICE CHECK
let REC = null;
export async function pageVoice() {
  const [T, VH] = await Promise.all([X().api('/api/voice/tasks'), X().api(`/api/player/${enc(me().name)}/voice`)]);
  $('#p-voice').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">🎙️ Voice check</div>
    <div class="sub">Speak for about a minute. We measure <b>how</b> you talk (your pace, pauses and pitch), not what you say. Audio is analyzed and then thrown away; only the numbers are saved.</div>
    <div class="cr-grid">
      <div class="glass card">
        <div class="chips" style="margin-bottom:12px"><button class="chip on" data-t="reading">📖 Read aloud</button><button class="chip" data-t="free">💬 Tell a story</button></div>
        <div class="vprompt" id="vprompt">${RA.spans(T.reading)}</div>
        <div class="recwrap"><button class="recbtn" id="rec"><span>🎙️</span></button><canvas id="wave" width="600" height="80"></canvas><div class="muted" id="rstat">Tap the mic, read the text at your normal pace, then tap again to stop.</div></div>
        <p class="muted">Why: in a 2018 study, people with early memory problems spoke more slowly and paused more than healthy peers (Tóth et al., <a href="${T.evidence}" target="_blank" style="color:var(--cyan)">source ↗</a>). Here you only compare with <b>yourself</b> over time. It's not a diagnosis.</p>
        <p class="muted">While you read, each word lights up as it's heard (your browser's speech recognition; in Chrome that runs on Google's servers). Mic not working in this window? Open <b>http://localhost:8600/#/voice</b> in Chrome.</p>
        <a class="ghost" href="#/game/readaloud" style="text-decoration:none;display:inline-block">📖 Make it a game: Read Aloud levels →</a>
      </div>
      <div class="glass card" id="vout">${VH.history.length ? '' : '<div class="empty">Your results show up here after your first recording.</div>'}</div>
    </div></div></div>`;
  let task = 'reading';
  $$('#p-voice [data-t]').forEach(b => b.onclick = () => { task = b.dataset.t; $$('#p-voice [data-t]').forEach(x => x.classList.toggle('on', x === b)); if (task === 'reading') $('#vprompt').innerHTML = RA.spans(T.reading); else $('#vprompt').textContent = T.free; });
  $('#rec').onclick = () => REC ? stopRec(task) : startRec(task);
  if (VH.history.length) renderVoiceHistory(VH.history.map(v => ({ ts: v.ts, task: v.task, ...v.metrics })));
}
async function startRec(task) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }); }
  catch (e) { X().toast('Microphone blocked: allow mic access (or open the app in Chrome).', 5000); return; }
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), chunks = [];
  // Live transcript: counts words (story mode) and lights up each word of the passage as it's read.
  let words = 0, sr = null;
  if (RA.supported()) {
    const box = $('#vprompt'), passage = task === 'reading' ? RA.wordsOf(box.textContent) : null; let A = null;
    if (passage) { box.innerHTML = RA.spans(box.textContent); A = RA.align(passage, ''); RA.paint(box, A); }
    try { sr = RA.listen(text => { words = RA.wordsOf(text).length; if (passage) { A = RA.align(passage, text, A); RA.paint(box, A); } }); } catch { sr = null; }
  }
  const cv = $('#wave'), g = cv.getContext('2d'), t0 = performance.now();
  proc.onaudioprocess = e => { const d = new Float32Array(e.inputBuffer.getChannelData(0)); chunks.push(d);
    g.fillStyle = 'rgba(10,14,40,.35)'; g.fillRect(0, 0, cv.width, cv.height); g.strokeStyle = '#59F0FF'; g.beginPath();
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
  const r = await fetch(`/api/player/${enc(me().name)}/voice`, { method: 'POST', body: fd }); const j = await r.json();
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
  if (j.history.length > 1) X().chart('vch', { type: 'line', data: { labels: j.history.map(h => h.ts.slice(5, 10)), datasets: [{ label: 'syllables/sec', data: j.history.map(h => h.speech_tempo), borderColor: '#59F0FF', tension: .3, yAxisID: 'y' }, { label: '% pausing', data: j.history.map(h => Math.round(h.silent_pause_ratio * 100)), borderColor: '#FFC83D', tension: .3, yAxisID: 'y1' }] }, options: X().chartOpts({ scales: { y: { ticks: { color: '#9AA3C7' } }, y1: { position: 'right', ticks: { color: '#9AA3C7' }, grid: { display: false } }, x: { ticks: { color: '#9AA3C7' } } } }) });
}
function renderVoiceHistory(h) {
  const last = h[h.length - 1];
  renderVoiceResult({ metrics: last, plain: [`Last check (${last.task === 'reading' ? 'read aloud' : 'story'}): ${last.speech_tempo} syllables/sec, ${last.pauses} pauses.`], baseline: h.length > 1 ? h.find(x => x.task === last.task) : null, history: h.filter(x => x.task === last.task) });
}

// ------------------------------------------------------------ MY DATA
export async function pageData() {
  const W = await X().api(`/api/player/${enc(me().name)}/wearables`), S = W.summary, days = Object.entries(W.days);
  $('#p-data').innerHTML = `<div class="scrollpage"><div class="wrap">
    <div class="h1">📱 My data</div><div class="sub">Bring in real data from your phone or watch, analyze an MRI scan, or play with "what if" sliders. Everything stays on this computer.</div>
    <div class="cr-grid">
      <div class="glass card"><div class="eyebrow">PHONE & WATCH</div>
        <label class="drop" id="wdrop"><input type="file" id="wfile" accept=".zip,.xml,.csv,.json" hidden><div style="font-size:34px">⌚</div><b>Drop your Apple Health export.zip</b><span class="muted">or a Fitbit Takeout zip, or a CSV / JSON from any app</span></label>
        <p class="muted"><b>Apple Watch / iPhone:</b> Health app → your photo (top right) → <i>Export All Health Data</i> → save the zip, then drop it here. We read steps, sleep, heart, VO₂ max, walking steadiness, blood oxygen, headphone and noise levels, and AirPods hearing tests.<br>
        <b>Fitbit:</b> Google Takeout → Fitbit → drop the zip.<br>
        <b>Garmin, Samsung, Oura…</b> a CSV with a <code>date</code> column and any of <code>steps</code>, <code>sleep_hours</code>, <code>resting_hr</code>, <code>hrv_ms</code>, <code>vo2max</code>, <code>walking_speed</code>.</p>
        ${W.is_sample ? `<p class="caveat">You're looking at <b>made-up sample data</b>, not a real person. <button class="chip" id="wsampleDel">Remove sample</button></p>`
          : S.days_with_data ? '' : `<button class="ghost" id="wsample" style="width:100%">⌚ No watch? Try 90 days of sample Apple Watch data</button>`}
        <div id="wmsg"></div></div>
      <div class="glass card"><div class="eyebrow">LIVE SYNC FROM YOUR IPHONE</div>
        <p class="muted">An Apple Watch can't send data to a website by itself; Apple keeps Health data on your iPhone. To keep this page updated automatically, let the iPhone send it:</p>
        <ol class="plain"><li>Install <b>Health Auto Export</b> (App Store) → <i>Automations</i> → <i>REST API</i>.</li>
          <li>URL: <code id="syncUrl">…</code> · Format: JSON · Aggregate by day</li>
          <li>Add header <code>X-Sync-Token</code> = <code id="syncTok">…</code> <button class="chip" id="syncCopy">Copy</button></li></ol>
        <div id="syncNote" class="muted"></div>
        <p class="muted">Or build an iOS Shortcut that POSTs <code>{"days": {"2026-11-14": {"steps": 8123, "sleep_hours": 7.2}}}</code> to the same URL with the same header. <button class="chip" id="syncRotate">New token</button></p></div>
      <div class="glass card">${S.days_with_data ? `<div class="eyebrow">YOUR LAST ${S.window_days} DAYS (${S.days_with_data} days imported, ${S.from} → ${S.to})</div>
        <div class="vstats">${S.steps != null ? `<div><b>${Math.round(S.steps).toLocaleString()}</b><span>steps / day</span></div>` : ''}${S.sleep_hours != null ? `<div><b>${S.sleep_hours.toFixed(1)} h</b><span>sleep / night</span></div>` : ''}${S.resting_hr != null ? `<div><b>${Math.round(S.resting_hr)}</b><span>resting heart rate</span></div>` : ''}${S.hrv_ms != null ? `<div><b>${Math.round(S.hrv_ms)} ms</b><span>heart-rate variability</span></div>` : ''}${S.vo2max != null ? `<div><b>${S.vo2max.toFixed(1)}</b><span>VO₂ max</span></div>` : ''}${S.walking_speed != null ? `<div><b>${S.walking_speed.toFixed(2)} m/s</b><span>walking speed</span></div>` : ''}${S.hearing_pta_db != null ? `<div><b>${Math.round(S.hearing_pta_db)} dB</b><span>hearing threshold</span></div>` : ''}${S.headphone_db != null ? `<div><b>${Math.round(S.headphone_db)} dBA</b><span>headphone level</span></div>` : ''}</div>
        <ul class="plain">${S.steps != null ? `<li>${S.steps >= 9826 ? '🟢 You average more than 9,826 steps, the "best dose" in a UK study of 78,430 people.' : S.steps >= 3826 ? `🟡 You're above the 3,826-step "minimum dose". ${Math.round(9826 - S.steps).toLocaleString()} more a day reaches the best dose.` : `🟠 ${Math.round(3826 - S.steps).toLocaleString()} more steps a day reaches the 3,826-step minimum dose.`}</li>` : ''}
        ${S.sleep_hours != null ? `<li>Your sleep average (${S.sleep_hours.toFixed(1)} h) now feeds your "What your habits say" score instead of the number you typed at sign-up.</li>` : ''}</ul>
        <div style="height:200px"><canvas id="wch"></canvas></div>` : '<div class="empty">No device data yet. Drop a file on the left to see your real steps and sleep here.</div>'}</div>
    </div>
    <div class="explore" style="margin-top:16px">
      <a class="tile glass" href="#/mri"><span>🧠</span><b>Brain records</b><small>MRI and EEG: upload yours or try a sample</small></a>
      <a class="tile glass" href="#/levers"><span>🎛</span><b>What if…</b><small>Move sliders, see the effect</small></a>
      <a class="tile glass" href="#/progress"><span>📈</span><b>All my charts</b><small>Games, voice, trends</small></a></div>
  </div></div>`;
  if (days.length) X().chart('wch', { type: 'bar', data: { labels: days.map(d => d[0].slice(5)), datasets: [{ label: 'steps', data: days.map(d => d[1].steps ?? null), backgroundColor: 'rgba(61,220,151,.7)', borderRadius: 4, yAxisID: 'y' }, { type: 'line', label: 'sleep (h)', data: days.map(d => d[1].sleep_hours ?? null), borderColor: '#7C8CFF', yAxisID: 'y1', tension: .3, spanGaps: true }] }, options: X().chartOpts({ scales: { y: { ticks: { color: '#9AA3C7' } }, y1: { position: 'right', ticks: { color: '#9AA3C7' }, grid: { display: false } }, x: { ticks: { color: '#9AA3C7' } } } }) });
  const up = async f => { $('#wmsg').innerHTML = '<p class="muted">Reading your file… (big Apple exports can take a minute)</p>';
    const fd = new FormData(); fd.append('file', f); const r = await fetch(`/api/player/${enc(me().name)}/wearables`, { method: 'POST', body: fd }); const j = await r.json();
    if (!r.ok) { $('#wmsg').innerHTML = `<p class="caveat">⚠ ${esc(j.detail)}</p>`; return; } X().setME(j.player); X().toast(`Imported ${j.imported_days} days ✓`); pageData(); };
  $('#wfile').onchange = e => e.target.files[0] && up(e.target.files[0]);
  const sampleCall = async method => { const r = await fetch(`/api/player/${enc(me().name)}/wearables/sample`, { method }); const j = await r.json();
    if (!r.ok) return X().toast(j.detail, 5000); X().setME(j.player); X().toast(method === 'POST' ? `Loaded ${j.imported_days} days of sample data ✓` : 'Sample data removed'); pageData(); };
  $('#wsample') && ($('#wsample').onclick = () => sampleCall('POST'));
  $('#wsampleDel') && ($('#wsampleDel').onclick = () => sampleCall('DELETE'));
  const sync = async (rotate = false) => {
    const t = await X().api(`/api/player/${enc(me().name)}/wearables/sync${rotate ? '?rotate=true' : ''}`);
    $('#syncUrl').textContent = t.url; $('#syncTok').textContent = t.token;
    $('#syncNote').innerHTML = (t.last_sync ? `✓ Last sync ${esc(t.last_sync.replace('T', ' '))}. ` : 'No sync yet. ') +
      (t.reachable_from_phone ? '' : '<span class="caveat">⚠ This server is only on this computer (localhost), so your phone can\'t reach it. Restart it with <code>HOST=0.0.0.0 python web/server.py</code> and use this computer\'s Wi-Fi address instead of localhost, or deploy it.</span>');
  };
  sync(); $('#syncRotate').onclick = () => sync(true).then(() => X().toast('New token made. Update it on your phone.'));
  $('#syncCopy').onclick = () => navigator.clipboard?.writeText($('#syncTok').textContent).then(() => X().toast('Token copied'));
  const d = $('#wdrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over'); d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); e.dataTransfer.files[0] && up(e.dataTransfer.files[0]); };
}
