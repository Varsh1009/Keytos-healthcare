// Brain Gym (8 games) + MRI page. Uses helpers exposed by app.js on window.NTX.
import { recordsTabs } from './records.js?v=5';
const X = () => window.NTX;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let CAT = null, STATS = {}, RUN = 0;   // RUN increments to cancel a game when you leave the page
const me = () => X().getME();
const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(v => v[1]);

let BONUS = 10;   // sparks for each newly cleared level (from the server)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
async function catalog() { if (!CAT) { const c = await X().api('/api/games'); CAT = c.games; BONUS = c.level_up_sparks ?? 10; } return CAT; }

// ============================================================ GAMES HUB: live "Up next", a skills radar, big cards by skill
const KIND_ICON = { Memory: '🧠', Speed: '⚡', Attention: '🎯', Language: '💬', 'Self-control': '🛑', Reflexes: '👆' };
const playHref = g => g.id === 'speed' ? '#/sprint' : '#/game/' + g.id;
const TAG = { speed: 'Match symbols', recall: 'Remember words', fluency: 'Name animals', trails: 'Connect the dots', stroop: 'Tap the ink color',
  corsi: 'Repeat the pattern', reaction: 'Tap on green', readaloud: 'Read out loud', voice: 'Just talk' };
const GROUPS = [['⚡', 'Speed', 'Speed & reflexes', ['speed', 'reaction'], '#FFC83D'], ['🧠', 'Memory', 'Memory', ['recall', 'corsi'], '#B388FF'],
  ['🎯', 'Focus', 'Focus', ['trails', 'stroop'], '#59F0FF'], ['💬', 'Language', 'Language & voice', ['fluency', 'readaloud', 'voice'], '#3DDC97']];
const CHECKS = [{ href: '#/hands', icon: '✋', title: 'Hand check', tag: 'Tremor & taps', color: '#FF8FB1', meta: 'camera · 30 s' },
  { href: '#/voice', icon: '🎙️', title: 'Pace & pauses', tag: 'How you speak', color: '#8FD3FF', meta: 'mic · 1 min' }];
let SKILL_CHART = null;

export async function pageGym(id) {
  RUN++;
  const games = await catalog();
  STATS = await X().api(`/api/player/${encodeURIComponent(me().name)}/games`);
  const byId = Object.fromEntries(games.map(g => [g.id, g]));
  const played = games.filter(x => STATS[x.id]?.played_today).length;
  const next = games.find(x => !STATS[x.id]?.played_today);
  const focus = byId[id] || next || games[0];
  const Q = X().QMAP();
  // the 3D brain: every game's area lit (brighter if played today), the focused one up front
  const light = g => g && Q[g.region] && X().gameBrain(Object.fromEntries(games.map(x => [x.region, STATS[x.id]?.played_today ? 'done' : 'open'])),
    Object.fromEntries(games.map(x => [x.region, x.color])), g.region, `<span style="color:${g.color}">●</span> ${g.title} · ${Q[g.region].region_name}`, g.region_why);
  light(focus);

  const L = g => STATS[g.id]?.levels || { level: 1, top: 8, passed: 0 };
  const prog = g => Math.round(L(g).passed / L(g).top * 100);
  // skill score = share of levels cleared across that skill's games
  const skills = GROUPS.map(([ic, short, , ids, col]) => { const gs = ids.filter(i => byId[i]).map(i => byId[i]);
    return { ic, short, col, pct: gs.length ? Math.round(gs.reduce((n, g) => n + prog(g), 0) / gs.length) : 0, today: gs.filter(g => STATS[g.id]?.played_today).length, n: gs.length }; });
  let k = 0;
  const card = g => { const s = STATS[g.id] || {}, lv = L(g); return `<a class="gc ${s.played_today ? 'done' : ''} ${g.id === focus.id ? 'focus' : ''}" href="${playHref(g)}" data-id="${g.id}" style="--c:${g.color};--i:${k++}">
      <span class="gc-ico">${g.icon}</span><b>${esc(g.title)}</b><small>${TAG[g.id] || esc(g.domain)}</small>
      <div class="gc-lv"><span>Lv ${lv.level}<i>/${lv.top}</i></span><div class="gc-bar"><i style="width:${prog(g)}%"></i></div></div>
      <span class="gc-badge">${s.played_today ? '✓' : '+15⚡'}</span></a>`; };
  const pct = Math.round(played / games.length * 100);
  const anyProgress = skills.some(s => s.pct > 0);
  $('#p-gym').innerHTML = `<div class="play gh-wide"><div class="left glass gh">
    <div class="gh-top"><div><h1>🎮 Games</h1><small>Tap a game · about 1 minute each</small></div>
      <div class="gh-ring" style="--p:${pct}"><b>${played}/${games.length}</b><small>today</small></div></div>
    ${next ? `<a class="gh-next" href="${playHref(next)}" style="--c:${next.color}" data-id="${next.id}">
      <div class="gh-next-info"><small>UP NEXT</small><b>${next.icon} ${esc(next.title)}</b><span>${TAG[next.id] || ''} · Level ${L(next).level}</span>
        <span class="gh-play">▶ Play</span></div>
      <div class="demo gh-demo" id="ghDemo"></div></a>`
      : `<div class="gh-done">🎉 All ${games.length} played today. Replay any game to beat your best.</div>`}
    <div class="gh-skills glass-in"><div class="gh-radar"><canvas id="skillRadar"></canvas>${anyProgress ? '' : '<span class="gh-radar-empty">Play to grow<br>your radar</span>'}</div>
      <div class="gh-skill-list"><h3>Your brain skills</h3>${skills.map(s => `<div class="gh-skill" style="--c:${s.col}"><span>${s.ic} ${s.short}</span>
        <div class="gc-bar"><i style="width:${s.pct}%"></i></div><b>${s.pct}%</b></div>`).join('')}<small>levels cleared in each skill</small></div></div>
    ${GROUPS.map(([ic, , name, ids], gi) => `<div class="gh-sec"><h3>${ic} ${name}<span>${skills[gi].today}/${skills[gi].n} today</span></h3>
      <div class="gh-grid">${ids.filter(i => byId[i]).map(i => card(byId[i])).join('')}</div></div>`).join('')}
    <div class="gh-sec"><h3>🩺 Health checks</h3><div class="gh-grid">${CHECKS.map(c => `<a class="gc" href="${c.href}" style="--c:${c.color};--i:${k++}">
      <span class="gc-ico">${c.icon}</span><b>${c.title}</b><small>${c.tag}</small><span class="gc-meta">${c.meta}</span></a>`).join('')}</div></div>
  </div><div></div></div>`;
  if (next) startDemo($('#ghDemo'), next.id);
  drawSkills(skills);
  // hover or focus a card → the brain shows the area that game trains
  let t = null, shown = focus.id;
  $$('#p-gym [data-id]').forEach(a => {
    const show = () => { clearTimeout(t); t = setTimeout(() => { if (shown !== a.dataset.id) { shown = a.dataset.id; light(byId[shown]); } }, 180); };
    a.addEventListener('mouseenter', show); a.addEventListener('focus', show);
  });
}
function drawSkills(skills) {
  const el = $('#skillRadar'); if (!el || !window.Chart) return;
  SKILL_CHART?.destroy();
  SKILL_CHART = new Chart(el, {
    type: 'radar',
    data: { labels: skills.map(s => s.short), datasets: [{ data: skills.map(s => s.pct), borderColor: '#59F0FF', borderWidth: 2,
      pointBackgroundColor: skills.map(s => s.col), pointBorderColor: '#fff', pointRadius: 4,
      backgroundColor: c => { const { ctx, chartArea: A } = c.chart; if (!A) return 'rgba(89,240,255,.2)';
        const g = ctx.createRadialGradient((A.left + A.right) / 2, (A.top + A.bottom) / 2, 0, (A.left + A.right) / 2, (A.top + A.bottom) / 2, (A.right - A.left) / 2);
        g.addColorStop(0, 'rgba(155,123,255,.15)'); g.addColorStop(1, 'rgba(89,240,255,.45)'); return g; } }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 900, easing: 'easeOutBack' }, layout: { padding: 4 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: it => `${skills[it.dataIndex].pct}% of levels cleared` } } },
      scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: 'rgba(255,255,255,.08)' }, angleLines: { color: 'rgba(255,255,255,.08)' },
        pointLabels: { color: skills.map(s => s.col), font: { size: 11, weight: '700' }, padding: 4 } } } },
  });
}
function spark(h, better) {
  if (h.length < 2) return '<text x="50" y="16" text-anchor="middle" font-size="8" fill="#9AA3C7">play twice to see a trend</text>';
  const mn = Math.min(...h), mx = Math.max(...h), r = mx - mn || 1;
  const pts = h.map((v, i) => `${i / (h.length - 1) * 100},${22 - (better === 'higher' ? (v - mn) : (mx - v)) / r * 20}`).join(' ');
  return `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}

// ============================================================ GAME SHELL
// Every game: levels on the side, a looping how-to demo, a 15-20 s round with a goal bar, then a clear
// PASSED / NOT YET screen with rewards and a leaderboard. The server picks the level and judges the round.
const lvState = (S, L) => L.level <= S.passed ? 'won' : L.level === S.level ? 'cur' : 'lock';
export function levelDots(S) {
  return `<div class="lvpath">${S.levels.map(L => { const st = lvState(S, L); return `<div class="${st}" title="Level ${L.level}: ${esc(L.goal)}">${st === 'won' ? '✓' : st === 'cur' ? L.level : '🔒'}</div>`; }).join('')}</div>`;
}
export function railHTML(S) {
  return `<aside class="lvrail"><div class="eyebrow">YOUR LEVELS</div>${S.levels.map(L => { const st = lvState(S, L);
    return `<div class="lvrow ${st}"><span class="lvb">${st === 'won' ? '✓' : st === 'cur' ? '▶' : '🔒'}</span><div><b>Level ${L.level}${st === 'cur' ? ' · now' : ''}</b><small>${esc(L.goal)}</small></div></div>`; }).join('')}
    <div class="lvfoot">${S.passed}/${S.top} cleared<br>+${BONUS} ⚡ for each new level</div></aside>`;
}
export function boardHTML(lb, limit = 10) {
  if (!lb || !lb.n) return '<div class="lboard"><div class="eyebrow">🏆 LEADERBOARD</div><div class="muted">Play a round to get on the board.</div></div>';
  const rows = lb.rows.slice(0, limit), you = lb.you;
  const row = r => `<div class="lbrow ${r.you ? 'you' : ''}"><span class="lbr">${['🥇', '🥈', '🥉'][r.rank - 1] || '#' + r.rank}</span><b>${esc(r.name)}${r.you ? ' (you)' : ''}</b><span>Lv ${r.level}</span><span title="best score at level ${r.best_level}">${r.best ?? '–'} <small class="muted">@${r.best_level}</small></span></div>`;
  return `<div class="lboard"><div class="eyebrow">🏆 LEADERBOARD · players on this device</div>
    <div class="lbrow head"><span></span><span>player</span><span>level</span><span>best @lv</span></div>
    ${rows.map(row).join('')}${you && !rows.some(r => r.you) ? row(you) : ''}
    ${you ? `<div class="muted" style="margin-top:6px">You're <b>#${you.rank}</b> of ${lb.n}${you.rank > 1 ? ' · clear more levels to climb' : ' · top of the board!'}</div>` : ''}</div>`;
}

// Tiny looping "how to play" animations (frames of HTML).
const KEYS = `<div class="dm-key"><span>◆<i>1</i></span><span>▲<i>2</i></span><span>●<i>3</i></span></div>`;
const DOTS = (n, cls = []) => `<svg class="dm-svg" viewBox="0 0 220 110">${[[30, 70], [90, 30], [150, 75], [200, 30]].slice(0, n).map((p, i, a) => i ? `<line x1="${a[i - 1][0]}" y1="${a[i - 1][1]}" x2="${p[0]}" y2="${p[1]}" class="dm-line"/>` : '').join('')}${[[30, 70, '1'], [90, 30, 'A'], [150, 75, '2'], [200, 30, 'B']].map(([x, y, t], i) => `<g class="${i < n ? 'on' : ''} ${cls[i] || ''}"><circle cx="${x}" cy="${y}" r="15"/><text x="${x}" y="${y + 5}">${t}</text></g>`).join('')}</svg>`;
const BLK = on => `<div class="dm-grid">${[...Array(9).keys()].map(i => `<span class="${on.includes(i) ? 'on' : ''}"></span>`).join('')}</div>`;
const STB = (word, ink, hit) => `<div class="dm-big" style="color:${ink}">${word}</div><div class="dm-pad">${[['RED', '#FF5A6E'], ['GREEN', '#3DDC97'], ['BLUE', '#4FC3F7'], ['YELLOW', '#FFC83D']].map(([n, c]) => `<b style="color:${c};border-color:${c}" class="${n === hit ? 'hit' : ''}">${n}</b>`).join('')}</div>`;
const DEMOS = {
  speed: [[`${KEYS}<div class="dm-big">▲</div><div class="dm-cap">1 · find the symbol in the key</div>`, 1100], [`${KEYS}<div class="dm-big">▲</div><div class="dm-pad"><b>1</b><b class="hit">2</b><b>3</b></div><div class="dm-cap">2 · tap its number</div>`, 900],
    [`${KEYS}<div class="dm-big ok">✓</div><div class="dm-cap">+1 correct · the next symbol comes right away</div>`, 800], [`${KEYS}<div class="dm-big">●</div><div class="dm-pad"><b>1</b><b>2</b><b class="hit">3</b></div><div class="dm-cap">as many as you can in 15 s</div>`, 1000]],
  recall: [[`<div class="dm-word">candle</div><div class="dm-cap">1 · words flash one by one: remember them</div>`, 900], [`<div class="dm-word">river</div><div class="dm-cap">1 · words flash one by one: remember them</div>`, 900], [`<div class="dm-word">garden</div><div class="dm-cap">1 · words flash one by one: remember them</div>`, 900],
    [`<div class="dm-chips"><b>spoon</b><b>garden</b><b>valley</b><b>candle</b><b>jacket</b><b>river</b></div><div class="dm-cap">2 · then tap every word you saw</div>`, 1000], [`<div class="dm-chips"><b>spoon</b><b class="ok">garden ✓</b><b>valley</b><b class="ok">candle ✓</b><b>jacket</b><b class="ok">river ✓</b></div><div class="dm-cap">found all 3 → level passed!</div>`, 1300]],
  fluency: [[`<div class="dm-big">🎤</div><div class="dm-cap">say animals out loud, one after another</div>`, 900], [`<div class="dm-big">🎤</div><div class="dm-chips"><b class="ok">dog</b></div><div class="dm-cap">"dog…"</div>`, 700], [`<div class="dm-big">🎤</div><div class="dm-chips"><b class="ok">dog</b><b class="ok">cat</b></div><div class="dm-cap">"…cat…"</div>`, 700],
    [`<div class="dm-big">🎤</div><div class="dm-chips"><b class="ok">dog</b><b class="ok">cat</b><b class="ok">horse</b></div><div class="dm-cap">"…horse" · repeats don't count</div>`, 1300]],
  trails: [[`${DOTS(0, ['pulse'])}<div class="dm-cap">1 · start at 1</div>`, 900], [`${DOTS(1, ['', 'pulse'])}<div class="dm-cap">2 · tap the next one: NEXT is always shown on top</div>`, 900], [`${DOTS(2, ['', '', 'pulse'])}<div class="dm-cap">harder levels switch: number → letter → number</div>`, 900],
    [`${DOTS(3, ['', '', '', 'pulse'])}<div class="dm-cap">1 → A → 2 → B …</div>`, 900], [`${DOTS(4)}<div class="dm-cap">finish before the timer runs out!</div>`, 1200]],
  stroop: [[`${STB('RED', '#4FC3F7', '')}<div class="dm-cap">the word says RED, but the ink is blue…</div>`, 1300], [`${STB('RED', '#4FC3F7', 'BLUE')}<div class="dm-cap">…so tap BLUE: always the INK color</div>`, 1000], [`${STB('GREEN', '#FFC83D', 'YELLOW')}<div class="dm-cap">GREEN in yellow ink → tap YELLOW</div>`, 1200]],
  corsi: [[`${BLK([1])}<div class="dm-cap">1 · watch the blocks light up</div>`, 650], [`${BLK([6])}<div class="dm-cap">1 · watch the blocks light up</div>`, 650], [`${BLK([5])}<div class="dm-cap">1 · watch the blocks light up</div>`, 650],
    [`${BLK([])}<div class="dm-cap">2 · your turn: tap them in the same order</div>`, 700], [`${BLK([1, 6, 5])}<div class="dm-cap">✓ same order → that try counts</div>`, 1100]],
  reaction: [[`<div class="dm-circle">wait…</div><div class="dm-cap">wait for green…</div>`, 1100], [`<div class="dm-circle go">TAP!</div><div class="dm-cap">tap as fast as you can</div>`, 600], [`<div class="dm-circle">248 ms</div><div class="dm-cap">your reaction time</div>`, 900],
    [`<div class="dm-circle red">✋</div><div class="dm-cap">from level 5: red means DON'T tap</div>`, 1200]],
  readaloud: [0, 1, 2, 3, 4, 5, 6].map(n => [`<div class="dm-read">${'The sun came up over the hill.'.split(' ').map((w, i) => `<span class="rw ${i < n ? 'on' : i === n ? 'cur' : ''}">${w}</span>`).join(' ')}</div>
    <div class="dm-cap">${n === 0 ? '🎤 read the words out loud' : n < 6 ? 'each word lights up as we hear it' : 'whole passage before the timer ends → passed!'}</div>`, n === 6 ? 1400 : 520]),
  voice: [[`<div class="dm-word" style="font-size:22px">“Describe your perfect weekend”</div><div class="dm-cap">1 · a topic appears</div>`, 1300],
    [`<div class="dm-big">🎙️</div><div class="miclvl" style="width:220px"><i style="width:70%"></i></div><div class="dm-cap">2 · talk about it 🟢 talking…</div>`, 1000],
    [`<div class="dm-big">🎙️</div><div class="miclvl" style="width:220px"><i style="width:8%"></i></div><div class="dm-cap">⏸ long pauses lower your flow</div>`, 1000],
    [`<div class="dm-big ok">78%</div><div class="dm-cap">flow = time talking vs pausing · keep going until the timer ends</div>`, 1500]],
};
export function startDemo(el, id) {
  const frames = DEMOS[id]; if (!el || !frames) return; let i = 0;
  const step = () => { if (!el.isConnected) return; const [html, ms] = frames[i++ % frames.length]; el.innerHTML = html; setTimeout(step, ms); };
  step();
}

export async function pageGame(id) {
  RUN++;
  const games = await catalog(), g = games.find(x => x.id === id);
  if (!g || id === 'speed') { location.hash = id === 'speed' ? '#/sprint' : '#/gym'; return; }
  STATS = await X().api(`/api/player/${encodeURIComponent(me().name)}/games`);
  $('#p-game').innerHTML = `<div class="sprint-wrap"><div class="arcade gamebox" style="--c:${g.color}">
    <a class="close" href="#/gym/${g.id}" style="text-decoration:none;display:grid;place-items:center">✕</a>
    <div class="gwrap"><div id="rail">${railHTML(STATS[g.id].levels)}</div><div id="gb"></div></div></div></div>`;
  intro(g);
}
const PLAY = { recall: (g, L) => recall(g, L), fluency: (g, L) => fluency(g, L), trails: (g, L) => trails(g, L), stroop: (g, L) => stroop(g, L), corsi: (g, L) => corsi(g, L), reaction: (g, L) => reaction(g, L), readaloud: (g, L) => readaloud(g, L), voice: (g, L) => voiceGame(g, L) };
function intro(g) {
  const S = STATS[g.id].levels, L = S.rule, classic = g.id === 'recall' || g.id === 'fluency';
  $('#gb').innerHTML = `<div class="eyebrow">${g.kind.toUpperCase()} GAME · LEVEL ${S.level} OF ${S.top}</div>
    <h2 class="gh2">${g.icon} ${g.title}</h2>
    <div class="demo" id="demo"></div>
    <p class="muted howto">${g.how}</p>
    <div class="goalcard"><small>LEVEL ${S.level} GOAL</small><b>${cap(L.goal)}</b>${L.seconds ? `<span>${L.seconds}-second round</span>` : ''}</div>
    <div class="muted">your best at level ${S.level}: <b>${S.best_here ?? '–'}</b> ${g.unit}</div>
    <div class="row" style="justify-content:center" id="startRow"><button class="cta" id="go">▶ Start level ${S.level}</button></div>
    <details class="ev gwhy-d"><summary>Why this game?</summary><div class="evb"><p>${g.region_why}</p>
      <p>${g.evidence} <a href="${g.url}" target="_blank" rel="noopener">source ↗</a></p>
      ${g.id === 'speed' ? '' : '<p class="caveat">This is a measurement game: brain-training reviews find gains on the trained task but little carry-over to everyday life (Simons 2016).</p>'}</div></details>
    ${classic ? `<button class="linkbtn" id="classic">🩺 Clinical version (${g.id === 'recall' ? '3 trials of 10 words' : '60 seconds'}, compare with NHANES adults)</button>` : ''}`;
  startDemo($('#demo'), g.id);
  $('#go').onclick = () => PLAY[g.id](g, L);
  if (classic) $('#classic').onclick = () => (g.id === 'recall' ? recallClassic(g) : fluencyClassic(g));
  if (g.id === 'recall') recallDelayedButton(g);
}
// In-round header: level + goal, goal bar, time bar.
const hudHTML = (L, timed = true) => `<div class="ghud"><div class="eyebrow">LEVEL ${L.level} · ${esc(L.goal)}</div>
  <div class="goalbar"><i id="gBar"></i><span id="gTxt"></span></div>
  ${timed ? `<div class="gtime"><i id="gTime"></i><b id="gSec">${L.seconds}</b></div>` : ''}</div>`;
function goal(n, target, word) {
  const b = $('#gBar'), t = $('#gTxt'); if (!b) return;
  b.style.width = Math.min(100, n / target * 100) + '%'; b.classList.toggle('full', n >= target);
  t.textContent = n >= target ? `goal reached ✓ ${word === 'dots' ? '' : 'keep going'}` : `${n} / ${target} ${word}`;
}
function countdown(sec, run, stop) {
  return new Promise(res => { const t0 = performance.now();
    const f = () => { if (run !== RUN) return res('quit'); if (stop.done) return res('done');
      const left = Math.max(0, sec - (performance.now() - t0) / 1000), el = $('#gTime'), n = $('#gSec');
      if (el) { el.style.width = left / sec * 100 + '%'; el.classList.toggle('low', left <= 5); } if (n) n.textContent = Math.ceil(left);
      if (left <= 0) return res('time'); requestAnimationFrame(f); }; f(); });
}
function whyNot(g, R, score, detail) {
  const L = R.rule, e = detail.errors || 0;
  if (detail.finished === false && g.id === 'voice') return `You stopped talking after about ${Math.round(detail.span || 0)} s. Keep going until the timer ends (at least ${Math.ceil(L.seconds * 0.75)} s).`;
  if (detail.finished === false) return `Time ran out with ${L.count - (detail.connected || 0)} dot(s) to go.`;
  const hi = g.better === 'higher';
  if (hi ? score < L.target : score > L.target) return hi ? `${+(L.target - score).toFixed(1)} more needed (you got ${score}, goal ${L.target}).` : `Needed ${L.target} ${g.unit} or less; you got ${score}.`;
  if (L.max_errors != null && e > L.max_errors) return `Too many mistakes: ${e} (only ${L.max_errors} allowed).`;
  if (L.min_accuracy) return `Accuracy ${Math.round(score / Math.max(1, score + e) * 100)}% (needs ${Math.round(L.min_accuracy * 100)}%). Fewer wrong taps!`;
  return 'Not passed yet.';
}
async function finish(g, score, detail, lines = []) {
  const r = await X().api(`/api/player/${encodeURIComponent(me().name)}/game`, { game: g.id, score, detail });
  X().setME(r.player); STATS[g.id] = r.stats; X().renderHUD();
  if (!r.round) return classicResult(g, score, r, lines);
  const R = r.round, S = r.stats.levels; $('#rail').innerHTML = railHTML(S);
  const burst = R.new_clear ? `<div class="confetti">${'⚡✨🎉⭐'.repeat(5).split('').filter(c => c.trim()).map((c, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 5) * .08}s">${c}</i>`).join('')}</div>` : '';
  $('#gb').innerHTML = `${burst}<div class="resbadge ${R.passed ? 'win' : 'lose'}">${R.passed ? `✓ LEVEL ${R.level} PASSED` : `✗ LEVEL ${R.level} · NOT YET`}</div>
    <div class="a-big">${score}</div><div class="muted">${g.unit} · goal: ${esc(R.rule.goal)}</div>
    ${R.unlocked ? `<div class="unlock">🔓 Level ${R.unlocked} unlocked! <b>+${r.level_bonus} ⚡</b></div>` : R.new_clear ? `<div class="unlock">🏆 You cleared the final level! <b>+${r.level_bonus} ⚡</b></div>` : ''}
    ${!R.passed ? `<p class="why">${whyNot(g, R, score, detail)}</p>` : ''}
    <div class="muted">${r.sparks_gained ? `+${r.sparks_gained} ⚡ for your first play today` : 'Daily sparks for this game already earned · practice still counts'}</div>
    ${lines.filter(Boolean).map(l => `<p class="muted">${l}</p>`).join('')}
    ${boardHTML(r.leaderboard, 5)}
    <div class="row" style="justify-content:center"><button class="cta" id="again">${R.unlocked ? `▶ Play level ${R.unlocked}` : '↻ Try again'}</button><a class="ghost" href="#/gym/${g.id}" style="text-decoration:none">Back to Games</a></div>`;
  $('#again').onclick = () => PLAY[g.id](g, S.rule);
}
function classicResult(g, score, r, lines) {   // clinical versions: NHANES percentile, no levels
  const nh = r.nhanes;
  $('#gb').innerHTML = `<div class="eyebrow">${g.title.toUpperCase()} · CLINICAL VERSION · RESULT</div><div class="a-big">${score}</div><div class="muted">${g.id === 'recall' ? 'words (of 30)' : 'animals in 60 s'}</div>
    ${r.sparks_gained ? `<div class="reward" style="text-align:center;margin-top:8px">+${r.sparks_gained} ⚡</div>` : ''}
    ${lines.filter(Boolean).map(l => `<p class="muted">${l}</p>`).join('')}
    ${nh ? `<div class="card" style="max-width:560px;margin:14px auto;text-align:left"><div class="eyebrow">VS REAL NHANES ADULTS (${me().profile.female ? 'women' : 'men'} ${nh.age_band[0]}–${nh.age_band[1]}, n=${nh.n})</div>
      <div style="font:700 30px 'Space Grotesk';margin:6px 0">${Math.round(nh.percentile)}th percentile</div>
      <div class="pctbar"><i style="left:${nh.percentile}%"></i><span style="left:25%"></span><span style="left:50%"></span><span style="left:75%"></span></div>
      <div class="muted">NHANES median ${nh.median} (middle half ${nh.p25}–${nh.p75}). Approximate: the digital format and word list differ from the NHANES interview.</div></div>`
      : '<p class="muted">No NHANES percentile for this mode: it isn\'t comparable to the interview format.</p>'}
    <div class="row" style="justify-content:center"><button class="cta" id="again">Back to levels</button><a class="ghost" href="#/gym/${g.id}" style="text-decoration:none">Back to Games</a></div>`;
  $('#again').onclick = () => intro(g);
}

// ============================================================ WORD RECALL (levels: flash N words, 15 s to tap them)
async function recall(g, L) {
  const run = RUN, { words, distractors } = await X().api(`/api/games/recall-words?n=${L.words}`);
  for (let i = 0; i < words.length; i++) {
    if (run !== RUN) return;
    $('#gb').innerHTML = `${hudHTML(L, false)}<div class="eyebrow" style="margin-top:18px">MEMORIZE · WORD ${i + 1} OF ${words.length}</div><div class="bigword">${words[i]}</div>`;
    goal(0, L.target, 'found');
    await sleep(1100);
  }
  const grid = shuffle([...words, ...distractors]), found = new Set(), stop = {}; let errors = 0;
  $('#gb').innerHTML = `${hudHTML(L)}<p class="muted">Tap every word you just saw. <b id="rErr">${errors}</b> wrong tap(s) · ${L.max_errors} allowed</p>
    <div class="wgrid" style="grid-template-columns:repeat(${Math.min(5, Math.ceil(grid.length / 2))},1fr)">${grid.map(w => `<button class="chip big" data-w="${w}">${w}</button>`).join('')}</div>`;
  goal(0, L.target, 'found');
  $$('[data-w]').forEach(b => b.onclick = () => {
    const w = b.dataset.w; b.disabled = true;
    if (words.includes(w)) { found.add(w); b.classList.add('ok'); b.textContent = w + ' ✓'; goal(found.size, L.target, 'found'); if (found.size === words.length) stop.done = true; }
    else { errors++; b.classList.add('bad'); b.textContent = w + ' ✗'; $('#rErr').textContent = errors; }
  });
  if (await countdown(L.seconds, run, stop) === 'quit') return;
  const missed = words.filter(w => !found.has(w));
  finish(g, found.size, { errors, missed, finished: true }, [missed.length ? `Missed: ${missed.join(', ')}` : 'You found every word!']);
}

// ============================================================ READ ALOUD (levels: read N words aloud before time runs out)
async function readaloud(g, L) {
  const run = RUN, RA = await import('./readalong.js?v=1');
  const back = `<div class="row" style="justify-content:center"><button class="cta" id="again">↻ Try again</button><a class="ghost" href="#/gym/${g.id}" style="text-decoration:none">Back to Games</a></div>`;
  if (!RA.supported()) {
    $('#gb').innerHTML = `<div class="empty" style="margin-top:40px">📖 Live word tracking needs <b>Chrome</b> or <b>Edge</b>.<br>Open <b>http://localhost:8600/#/game/readaloud</b> there.</div>
      <div class="row" style="justify-content:center"><a class="ghost" href="#/gym/${g.id}" style="text-decoration:none">Back to Games</a></div>`;
    return;
  }
  const P = await X().api(`/api/games/read-passage?level=${L.level}`); if (run !== RUN) return;
  const words = RA.wordsOf(P.text);
  $('#gb').innerHTML = `${hudHTML(L)}<div class="readbox" id="rbox">${RA.spans(P.text)}</div><div class="muted" id="rmsg"></div>`;
  goal(0, L.target, 'words');
  for (const n of [3, 2, 1]) { $('#rmsg').textContent = `Look over the text… start reading in ${n}`; await sleep(800); if (run !== RUN) return; }
  let A = { pos: 0, hit: words.map(() => false), count: 0 }, err = null, tDone = null; const stop = {}, t0 = performance.now();
  const update = text => { A = RA.align(words, text, A); RA.paint($('#rbox'), A); goal(A.count, L.target, 'words');
    if (A.pos >= words.length && !stop.done) { stop.done = true; tDone = performance.now(); } };
  const mic = RA.listen(update, m => { err = m; stop.done = true; });
  RA.paint($('#rbox'), A);
  $('#rmsg').textContent = '🎤 Go! Read out loud at your normal pace.';
  const how = await countdown(L.seconds, run, stop);
  if (how !== 'quit') $('#rmsg').textContent = 'Catching your last words…';
  const heard = await mic.stop();
  if (how === 'quit' || run !== RUN) return;
  if (err && !A.count) { $('#gb').innerHTML = `<div class="empty" style="margin-top:40px">⚠ ${esc(err)}</div>${back}`; $('#again').onclick = () => readaloud(g, L); return; }
  update(heard);
  const secs = Math.min(L.seconds, ((tDone ?? performance.now()) - t0) / 1000), wpm = Math.round(A.count / Math.max(1, secs) * 60);
  const missed = words.filter((_, i) => i < A.pos && !A.hit[i]).map(w => w.replace(/[^\w'’-]/g, ''));
  finish(g, A.count, { finished: true, words_total: words.length, seconds: +secs.toFixed(1), wpm, heard: heard.trim().slice(0, 600) },
    [`You read ${A.count} of ${words.length} words in ${secs.toFixed(1)} s (about ${wpm} words a minute).`,
      missed.length ? `Not heard: ${esc(missed.join(', '))}` : '', 'Word tracking uses your browser\'s speech recognition, so a mumbled or misheard word may not light up.']);
}

// ============================================================ VOICE CHECK (levels: talk on a topic, score = flow %)
const VOICE_TOPICS = ['Describe your perfect weekend.', 'Tell me about your favorite meal and how it is made.', 'Describe a place you love to visit.',
  'Walk me through your morning routine.', 'Talk about a book, show or movie you enjoyed.', 'Describe the street or house you grew up in.',
  'Tell me about a hobby and how you got into it.', 'Explain how you would plan a birthday party.', 'Describe a memorable trip.', 'Tell me about a friend and how you met.'];
async function voiceGame(g, L) {
  const run = RUN, topic = VOICE_TOPICS[Math.floor(Math.random() * VOICE_TOPICS.length)];
  const retry = msg => { $('#gb').innerHTML = `<div class="empty" style="margin-top:40px">⚠ ${esc(msg)}</div><div class="row" style="justify-content:center"><button class="cta" id="again">↻ Try again</button><a class="ghost" href="#/gym/${g.id}" style="text-decoration:none">Back to Games</a></div>`; $('#again').onclick = () => voiceGame(g, L); };
  let rec, talking = 0, ticks = 0;
  const onLevel = v => { const el = $('#micLvl'), st = $('#vstate'); if (el) el.style.width = Math.min(100, v * 300) + '%';
    const on = v > 0.06; if (st) { st.textContent = on ? '🟢 talking' : '⏸ pause'; st.classList.toggle('on', on); } if (live) { ticks++; if (on) talking++; } };
  let live = false;
  try { const m = await import('./recorder.js?v=1'); rec = await m.startRecording({ onLevel }); }
  catch (e) { return retry(e.message); }
  if (run !== RUN) { rec.stop().catch(() => {}); return; }
  $('#gb').innerHTML = `${hudHTML(L)}<div class="eyebrow" style="margin-top:14px">YOUR TOPIC</div><div class="vtopic">“${esc(topic)}”</div>
    <div class="micbox"><div class="miclvl"><i id="micLvl"></i></div><div class="vstate" id="vstate">⏸ pause</div></div>
    <div class="vwords" id="vwords"></div><div class="muted" id="rmsg"></div>`;
  goal(0, L.target, '% flow');
  for (const n of [3, 2, 1]) { $('#rmsg').textContent = `Think about it… start talking in ${n}`; await sleep(800); if (run !== RUN) { rec.stop().catch(() => {}); return; } }
  $('#rmsg').textContent = '🎙️ Go! Keep talking until the timer ends.'; live = true;
  let RA = null, mic = null;
  try { RA = await import('./readalong.js?v=1'); if (RA.supported()) mic = RA.listen(t => { const w = RA.wordsOf(t), el = $('#vwords'); if (el) el.innerHTML = w.slice(-14).map(x => `<span>${esc(x)}</span>`).join(' ') + `<b>${w.length} words</b>`; }); } catch { mic = null; }
  const stop = {}, tick = setInterval(() => { if (ticks) goal(Math.round(talking / ticks * 100), L.target, '% talking (live estimate)'); }, 300);
  const how = await countdown(L.seconds, run, stop); clearInterval(tick); live = false;
  const words = mic ? RA.wordsOf(await mic.stop()).length : null;
  const blob = await rec.stop();
  if (how === 'quit' || run !== RUN) return;
  $('#gb').innerHTML = `<div class="empty" style="margin-top:60px"><div class="typing"><span></span><span></span><span></span></div> Measuring your pace and pauses…</div>`;
  let j;
  try { const fd = new FormData(); fd.append('file', blob, 'voice.wav'); const r = await fetch('/api/games/voice-analyze', { method: 'POST', body: fd }); j = await r.json(); if (!r.ok) throw new Error(j.detail || r.statusText); }
  catch (e) { if (run === RUN) retry(e.message); return; }
  if (run !== RUN) return;
  const m = j.metrics, finished = m.speaking_span_s >= L.seconds * 0.75;
  finish(g, j.flow, { finished, span: m.speaking_span_s, topic, words, metrics: m },
    [`You talked for ${m.speaking_span_s.toFixed(0)} s, at about ${m.speech_tempo.toFixed(1)} syllables a second, with ${m.pauses} pause${m.pauses === 1 ? '' : 's'} of ¼ s or more.`,
      words ? `About ${words} words.` : '', 'Flow is measured from the sound of your voice, not your words. It compares you with yourself, not a diagnosis.']);
}

// ============================================================ ANIMAL NAMING (levels: 15 s, Whisper counts the words)
async function fluency(g, L, classicSecs = 0) {
  const run = RUN, secs = classicSecs || L.seconds;
  const mode = await chooseMode([['voice', '🎤 Say them out loud', 'We record you and count the animals with a speech-recognition model (Whisper).'], ['type', '⌨️ Type them', 'Type each animal and press Enter.']]);
  if (run !== RUN) return;
  const entries = [], stop = {}; let rec = null;
  if (mode === 'voice') {
    try { const m = await import('./recorder.js?v=1'); rec = await m.startRecording({ onLevel: v => { const el = $('#micLvl'); if (el) el.style.width = Math.min(100, v * 300) + '%'; } }); }
    catch (e) { X().toast('Microphone not available (' + e.message + '). Switching to typing.'); }
  }
  const voice = !!rec;
  $('#gb').innerHTML = `${classicSecs ? `<div class="ghud"><div class="eyebrow">CLINICAL VERSION · ${secs} SECONDS</div><div class="gtime"><i id="gTime"></i><b id="gSec">${secs}</b></div></div>` : hudHTML(L)}
    ${voice ? `<div class="micbox"><div class="dm-big">🎤</div><div class="miclvl"><i id="micLvl"></i></div><div class="muted">Listening… say animals one after another, clearly, with a short pause between them.</div></div>`
      : '<input id="fin" placeholder="type an animal + Enter" autocomplete="off" style="max-width:360px">'}
    <div class="chips" id="fgot" style="justify-content:center;margin-top:14px"></div>`;
  if (!classicSecs) goal(0, L.target, voice ? 'animals (counted at the end)' : 'animals');
  if (!voice) { $('#fin').focus(); $('#fin').onkeydown = async e => { if (e.key === 'Enter' && e.target.value.trim()) { entries.push(e.target.value.trim()); e.target.value = '';
    const sc = await X().api('/api/games/fluency-score', { entries }); $('#fgot').innerHTML = sc.valid.map(v => `<span class="chip on">${esc(v)}</span>`).join(''); if (!classicSecs) goal(sc.score, L.target, 'animals'); } }; }
  const how = await countdown(secs, run, stop);
  if (how === 'quit') { if (rec) rec.stop().catch(() => {}); return; }
  let sc;
  if (voice) {
    $('#gb').innerHTML = `<div class="empty" style="margin-top:60px"><div class="typing"><span></span><span></span><span></span></div> Counting your animals with the speech model…</div>`;
    try {
      const blob = await rec.stop(), fd = new FormData(); fd.append('file', blob, 'animals.wav');
      const res = await fetch('/api/games/fluency-audio', { method: 'POST', body: fd }), j = await res.json();
      if (!res.ok) throw new Error(j.detail || res.statusText); sc = j;
    } catch (e) { X().toast('Speech model unavailable: ' + e.message); sc = { score: 0, valid: [], unrecognized: [], text: '' }; }
  } else sc = await X().api('/api/games/fluency-score', { entries });
  if (run !== RUN) return;
  const lines = [sc.valid.length ? `Counted: ${sc.valid.join(', ')}` : 'No animals recognized.', sc.unrecognized?.length ? `Not counted (not an animal on our list, or a repeat): ${sc.unrecognized.join(', ')}` : '',
    voice && sc.text != null ? `What the speech model heard: “${esc(sc.text || '…')}”` : ''];
  const detail = { mode: voice ? 'voice' : 'type', valid: sc.valid, unrecognized: sc.unrecognized, transcript: sc.text, asr: sc.model };
  if (classicSecs) finish(g, sc.score, { ...detail, classic: true, comparable: voice }, lines);
  else finish(g, sc.score, detail, lines);
}
const fluencyClassic = g => fluency(g, null, 60);

// ============================================================ TRAIL CONNECT (levels: connect N dots before time runs out)
async function trails(g, L) {
  const run = RUN, labels = [];
  for (let i = 0; labels.length < L.count; i++) { labels.push(String(i + 1)); if (L.mode === 'B' && labels.length < L.count) labels.push('ABCDEFGHIJ'[i]); }
  $('#gb').innerHTML = `${hudHTML(L)}<div class="tnext">NEXT: <b id="tnext">${labels[0]}</b><span id="tmsg">${L.mode === 'B' ? 'number → letter → number…' : 'go in number order'}</span></div><div class="tboard" id="tb"></div>`;
  goal(0, labels.length, 'dots');
  await sleep(50); if (run !== RUN) return;
  const box = $('#tb'), W = box.clientWidth, H = box.clientHeight, pts = [];
  for (const _ of labels) { let p, k = 0; do { p = { x: 34 + Math.random() * (W - 68), y: 34 + Math.random() * (H - 68) }; k++; } while (k < 500 && pts.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 74)); pts.push(p); }
  box.innerHTML = `<svg width="${W}" height="${H}" id="tl"></svg>` + labels.map((l, i) => `<button class="tdot ${i === 0 ? 'start' : ''}" data-i="${i}" style="left:${pts[i].x - 22}px;top:${pts[i].y - 22}px">${l}</button>`).join('');
  let next = 0, errors = 0, idle; const stop = {}, t0 = performance.now();
  const hint = () => { clearTimeout(idle); idle = setTimeout(() => $(`.tdot[data-i="${next}"]`)?.classList.add('hint'), 2500); };
  hint();
  $$('.tdot', box).forEach(b => b.onclick = () => {
    const i = +b.dataset.i; if (i < next || stop.done) return;
    if (i !== next) { errors++; b.classList.add('bad'); setTimeout(() => b.classList.remove('bad'), 300); $('#tmsg').textContent = `✗ that's ${labels[i]} · look for ${labels[next]}`; return; }
    b.classList.remove('hint', 'start'); b.classList.add('ok');
    if (i > 0) $('#tl').insertAdjacentHTML('beforeend', `<line x1="${pts[i - 1].x}" y1="${pts[i - 1].y}" x2="${pts[i].x}" y2="${pts[i].y}" stroke="var(--c)" stroke-width="3"/>`);
    next++; goal(next, labels.length, 'dots');
    if (next === labels.length) { stop.done = true; return; }
    $('#tnext').textContent = labels[next]; $('#tmsg').textContent = `✓ ${labels[i]} · now find ${labels[next]}`; hint();
  });
  const how = await countdown(L.seconds, run, stop); clearTimeout(idle);
  if (how === 'quit') return;
  const finished = next === labels.length, t = finished ? +((performance.now() - t0) / 1000).toFixed(1) : L.seconds;
  finish(g, t, { errors, finished, connected: next, count: labels.length, mode: L.mode }, [finished ? `All ${labels.length} dots in ${t} s with ${errors} mistake(s).` : `Connected ${next} of ${labels.length} dots.`]);
}

// ============================================================ COLOR CLASH (levels: 15 s, tap the ink color)
async function stroop(g, L) {
  const run = RUN, C = [['RED', '#FF5A6E'], ['GREEN', '#3DDC97'], ['BLUE', '#4FC3F7'], ['YELLOW', '#FFC83D']];
  let ok = 0, bad = 0; const rts = { con: [], inc: [] }, stop = {};
  $('#gb').innerHTML = `${hudHTML(L)}<div class="muted">Tap the <b>ink color</b>, not the word. <b id="sbad">0</b> wrong</div><div class="stroopword" id="sw"></div><div class="pad" id="spad" style="grid-template-columns:repeat(4,1fr)"></div>`;
  goal(0, L.target, 'correct');
  let cur, shown;
  const drawPad = () => { $('#spad').innerHTML = (L.shuffle ? shuffle(C) : C).map(([n, c]) => `<button data-c="${n}" style="background:${c}22;border-color:${c};color:${c}">${n}</button>`).join('');
    $$('[data-c]').forEach(b => b.onclick = () => { if (run !== RUN || stop.done) return; const rt = performance.now() - shown;
      if (b.dataset.c === cur.ink) { ok++; rts[cur.con ? 'con' : 'inc'].push(rt); $('#sw').classList.remove('bad'); } else { bad++; $('#sbad').textContent = bad; const w = $('#sw'); w.classList.remove('bad'); void w.offsetWidth; w.classList.add('bad'); }
      goal(ok, L.target, 'correct'); nextTrial(); }); };
  const nextTrial = () => { const word = C[Math.floor(Math.random() * 4)], con = Math.random() < L.match; const ink = con ? word : C.filter(c => c !== word)[Math.floor(Math.random() * 3)];
    cur = { ink: ink[0], con }; const w = $('#sw'); w.textContent = word[0]; w.style.color = ink[1]; shown = performance.now(); if (L.shuffle) drawPad(); };
  drawPad(); nextTrial();
  if (await countdown(L.seconds, run, stop) === 'quit') return;
  stop.done = true;
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const interf = med(rts.inc) != null && med(rts.con) != null ? Math.round(med(rts.inc) - med(rts.con)) : null;
  finish(g, ok, { errors: bad, median_rt_congruent: med(rts.con), median_rt_incongruent: med(rts.inc), interference_ms: interf },
    [`${ok} right, ${bad} wrong.`, interf != null ? `Mismatched words took you ${interf} ms longer than matching ones (the Stroop effect).` : '']);
}

// ============================================================ MEMORY GRID (levels: sequence length, 2 of 3 tries)
async function corsi(g, L) {
  const run = RUN;
  $('#gb').innerHTML = `${hudHTML(L, false)}<div class="tnext"><span id="ctry"></span><b id="cinfo">Watch…</b></div><div class="cboard" id="cb"></div>`;
  goal(0, L.target, 'right');
  const box = $('#cb'), pos = [[12, 18], [52, 8], [82, 22], [26, 46], [60, 40], [88, 58], [10, 78], [44, 72], [74, 86]];
  box.innerHTML = pos.map(([x, y], i) => `<button class="cblk" data-i="${i}" style="left:${x}%;top:${y}%"></button>`).join('');
  let right = 0, wrong = 0;
  for (let t = 0; t < L.tries; t++) {
    if (run !== RUN) return;
    if (right >= L.target || wrong > L.tries - L.target) break;   // already passed / can't pass any more
    $('#ctry').textContent = `TRY ${t + 1} OF ${L.tries} · `;
    const seq = shuffle([...Array(9).keys()]).slice(0, L.length);
    $('#cinfo').textContent = `Watch ${L.length} blocks…`; $$('.cblk').forEach(b => { b.disabled = true; b.classList.remove('good', 'wrong'); }); await sleep(600);
    for (const i of seq) { const b = $(`.cblk[data-i="${i}"]`); b.classList.add('lit'); await sleep(600); b.classList.remove('lit'); await sleep(220); if (run !== RUN) return; }
    $('#cinfo').textContent = 'Your turn: tap them in the same order'; $$('.cblk').forEach(b => b.disabled = false);
    const ok = await new Promise(res => { let k = 0; $$('.cblk').forEach(b => b.onclick = () => { const i = +b.dataset.i;
      if (i !== seq[k]) { b.classList.add('wrong'); return res(false); } b.classList.add('tap'); setTimeout(() => b.classList.remove('tap'), 200); k++; if (k === seq.length) res(true); }); });
    if (ok) { right++; $('#cinfo').textContent = '✓ Correct!'; } else { wrong++; $('#cinfo').textContent = '✗ Wrong block'; }
    goal(right, L.target, 'right'); await sleep(800);
  }
  finish(g, right, { errors: wrong, length: L.length }, [`${right} of your tries at ${L.length} blocks were right.`]);
}

// ============================================================ REFLEX (levels: median time; red = don't tap from level 5)
async function reaction(g, L) {
  const run = RUN, rts = []; let errors = 0, done = 0;
  $('#gb').innerHTML = `${hudHTML(L, false)}<div class="muted" id="rinfo">Tap the circle the moment it turns green${L.nogo ? ' · <b style="color:#FF5A6E">never tap red</b>' : ''}.</div><button class="rtc" id="rc">wait…</button><div class="muted" id="rlist"></div>`;
  goal(0, L.trials, 'taps');
  const c = $('#rc'), plan = shuffle([...Array(L.trials).fill('go'), ...(L.nogo ? ['red', 'red'] : [])]);
  for (let t = 0; t < plan.length; t++) {
    if (run !== RUN) return;
    c.className = 'rtc'; c.textContent = 'wait…';
    let armed = false, go = 0; const kind = plan[t];
    const res = await new Promise(resolve => {
      const timer = setTimeout(() => { armed = true; go = performance.now(); c.className = 'rtc ' + (kind === 'go' ? 'go' : 'red'); c.textContent = kind === 'go' ? 'TAP!' : '✋ don\'t!';
        if (kind === 'red') setTimeout(() => { if (c.onclick) { c.onclick = null; c.className = 'rtc'; c.textContent = '✓ held'; resolve('held'); } }, 1100); }, 800 + Math.random() * 1400);
      c.onclick = () => {
        if (!armed) { clearTimeout(timer); c.onclick = null; c.className = 'rtc early'; c.textContent = 'too early!'; setTimeout(() => resolve('early'), 600); }
        else if (kind === 'red') { c.onclick = null; c.className = 'rtc early'; c.textContent = '✗ that was red'; setTimeout(() => resolve('redtap'), 600); }
        else { const ms = performance.now() - go; c.onclick = null; c.className = 'rtc'; c.textContent = `${Math.round(ms)} ms`; resolve(ms); }
      };
    });
    if (res === 'early') { errors++; t--; if (errors > 6) break; }
    else if (res === 'redtap') errors++;
    else if (typeof res === 'number') { rts.push(Math.round(res)); done++; goal(done, L.trials, 'taps'); }
    $('#rlist').textContent = rts.map(r => r + ' ms').join(' · ') + (errors ? ` · ${errors} mistake(s)` : '');
    await sleep(400);
  }
  const med = rts.slice().sort((a, b) => a - b)[Math.floor(rts.length / 2)] ?? 999;
  finish(g, med, { trials: rts, errors }, [`Median of ${rts.length} taps · ${errors} mistake(s) (early taps${L.nogo ? ' or tapping red' : ''}).`]);
}

// ============================================================ CLINICAL WORD RECALL (CERAD-style, NHANES percentile)
async function recallClassic(g) {
  const run = RUN, { words, distractors } = await X().api('/api/games/recall-words');
  const mode = await chooseMode([['type', '⌨️ Free recall (type words)', 'Same as NHANES: recall without hints. Gets a NHANES percentile.'], ['tap', '👆 Tap mode (no keyboard)', 'Pick the words from a grid. Easier, so no NHANES comparison.']]);
  if (run !== RUN) return;
  const trials = [];
  for (let t = 0; t < 3; t++) {
    const order = shuffle(words);
    for (let i = 0; i < order.length; i++) {
      if (run !== RUN) return;
      $('#gb').innerHTML = `<div class="eyebrow">CLINICAL · TRIAL ${t + 1} OF 3 · LEARN THE WORDS</div><div class="bigword">${order[i]}</div><div class="muted">${i + 1} / 10</div>`;
      await sleep(2000);
    }
    trials.push(await collectRecall(words, distractors, mode, `CLINICAL · TRIAL ${t + 1} OF 3 · RECALL`));
    if (run !== RUN) return;
  }
  const learning = trials.reduce((a, b) => a + b.hits, 0);
  localStorage.setItem('nt_recall', JSON.stringify({ words, distractors, mode, at: Date.now(), player: me().name }));
  finish(g, learning, { classic: true, trials: trials.map(t => t.hits), false_alarms: trials.map(t => t.fa), mode, comparable: mode === 'type', norm_col: 'cerad_learning' },
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
  if (mins < 5) { row.insertAdjacentHTML('beforeend', `<button class="ghost" disabled>⏳ Clinical delayed recall opens in ${Math.ceil(5 - mins)} min</button>`); return; }
  row.insertAdjacentHTML('beforeend', `<button class="cta" id="delayed" style="background:linear-gradient(90deg,#9B7BFF,#59F0FF)">🧠 Clinical delayed recall now</button>`);
  $('#delayed').onclick = async () => {
    const r = await collectRecall(st.words, st.distractors, st.mode, `DELAYED RECALL · ${Math.round(mins)} MIN LATER`);
    localStorage.removeItem('nt_recall');
    finish(g, r.hits, { classic: true, delayed: true, minutes: Math.round(mins), false_alarms: r.fa, mode: st.mode, comparable: st.mode === 'type', norm_col: 'cerad_delayed' },
      ['Delayed recall (0–10). NHANES compares this against its own delayed-recall trial.']);
  };
}
function chooseMode(opts) {
  return new Promise(res => {
    $('#gb').innerHTML = `<div class="eyebrow">CHOOSE A MODE</div><div class="modes">${opts.map(([k, t, d]) => `<button class="mode glass" data-m="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>`;
    $$('[data-m]').forEach(b => b.onclick = () => res(b.dataset.m));
  });
}

// ============================================================ MRI PAGE (real 3D CNN)
export async function pageMRI() {
  RUN++;
  const [m, samples] = await Promise.all([X().api('/api/mri/metrics'), X().api('/api/mri/samples')]);
  const ok = samples.some(s => s.available);
  $('#p-mri').innerHTML = `<div class="scrollpage"><div class="wrap mx">${recordsTabs('mri')}
    <div class="mx-grid">
      <div class="mx-left">
        <div class="mx-card glass"><div class="mx-ic">🧪</div><b>Try a real scan</b>
          <select id="msel">${samples.map(s => `<option value="${s.file}">${s.Age} yrs · ${s.female ? 'woman' : 'man'} · ${s.status}</option>`).join('')}</select>
          <button class="cta" id="mrun" ${ok ? '' : 'disabled'}>🧠 Analyze</button>${ok ? '' : '<small class="muted">Sample scans not downloaded on this computer.</small>'}</div>
        <label class="mx-card glass mx-drop" id="drop"><input type="file" id="mfile" accept=".nii,.gz" hidden><div class="mx-ic">⬆️</div><b>Upload your MRI</b><small class="muted">.nii file · never saved</small></label>
        <details class="mx-info"><summary>ⓘ How accurate?</summary><p>Trained on ${m.n_volumes} real brain scans. Usually within ±${m.mae.toFixed(0)} years.</p></details>
      </div>
      <div class="glass mx-out" id="mout"><div class="mx-wait"><div class="mx-brain">🧠</div><p>Pick a scan to see its brain age</p></div></div>
    </div></div></div>`;
  const show = async (promise) => { $('#mout').innerHTML = '<div class="mx-wait"><div class="mx-brain spin">🧠</div><p>Reading the scan…</p></div>';
    try { renderMRI(await promise); } catch (e) { $('#mout').innerHTML = `<div class="mx-wait"><p>⚠ ${e.message}</p></div>`; } };
  $('#mrun').onclick = () => { const fd = new FormData(); fd.append('file', $('#msel').value); show(fetchForm(`/api/player/${encodeURIComponent(me().name)}/mri/sample`, fd)); };
  const up = f => { const fd = new FormData(); fd.append('file', f); fd.append('age', me().profile.age); show(fetchForm(`/api/player/${encodeURIComponent(me().name)}/mri/upload`, fd)); };
  $('#mfile').onchange = e => e.target.files[0] && up(e.target.files[0]);
  const d = $('#drop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
  d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); e.dataTransfer.files[0] && up(e.dataTransfer.files[0]); };
}
function mriConfidence(r) {
  const col = { high: '#3DDC97', medium: '#FFC83D', low: '#FF8A7A' }[r.confidence];
  const lo = Math.min(r.interval_low, r.age ?? r.interval_low) - 5, hi = Math.max(r.interval_high, r.age ?? r.interval_high) + 5;
  const x = v => `${((v - lo) / (hi - lo) * 100).toFixed(1)}%`;
  return `<div class="tiny" style="margin-top:14px">95% INTERVAL ${r.interval_low.toFixed(0)}–${r.interval_high.toFixed(0)} YRS${r.gap != null ? ` · GAP ${r.gap > 0 ? '+' : ''}${r.gap.toFixed(1)} (${r.gap_low.toFixed(0)} to ${r.gap_high > 0 ? '+' : ''}${r.gap_high.toFixed(0)})` : ''}</div>
    <div style="position:relative;height:30px;margin:6px 0 4px;background:rgba(255,255,255,.06);border-radius:8px">
      <div style="position:absolute;top:8px;height:14px;left:${x(r.interval_low)};width:calc(${x(r.interval_high)} - ${x(r.interval_low)});background:${col}55;border:1px solid ${col};border-radius:7px"></div>
      <div title="brain age" style="position:absolute;top:2px;height:26px;width:3px;left:${x(r.brain_age)};background:${col}"></div>
      ${r.age != null ? `<div title="actual age" style="position:absolute;top:2px;height:26px;width:3px;left:${x(r.age)};background:#9AA3C7"></div>` : ''}</div>
    <div class="tiny" style="color:#9AA3C7">colored bar = brain age${r.age != null ? ' · grey bar = actual age' : ''}</div>
    <p style="margin:12px 0 4px"><span style="display:inline-block;padding:3px 12px;border-radius:999px;border:1px solid ${col};color:${col};font-weight:700;text-transform:uppercase;letter-spacing:.06em">${r.confidence} confidence</span></p>
    <ul class="muted" style="margin:4px 0 8px 18px">${r.confidence_reasons.map(s => `<li>${s}</li>`).join('')}</ul>
    <div class="tiny">MODEL AGREEMENT (spread ${r.model_disagreement.toFixed(1)} yrs)</div>
    <div class="chips" style="margin:6px 0">${r.per_model.map(p => `<span class="chip" title="${p.n_models} fold model(s)">${p.label}: <b>${p.brain_age.toFixed(0)}</b></span>`).join('')}</div>`;
}
async function fetchForm(url, fd) { const r = await fetch(url, { method: 'POST', body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.detail || r.statusText); return j; }
function renderMRI(r) {
  const f = r.format;
  if (r.brain_age == null) { $('#mout').innerHTML = `<div class="mx-wait"><div class="mx-brain">🤔</div><p>This file can't be read as a brain scan.</p><small class="muted">${esc(f.issues[0] || '')}</small></div>`; return; }
  // Show the bias-corrected brain age (real age + corrected gap) so the big number and the "years older" line agree.
  const gap = r.gap, age = r.age != null ? Math.round(r.age) : null, t = r.truth;
  const ba = gap != null && r.age != null ? Math.round(r.age + gap) : Math.round(r.brain_age);
  const col = gap == null ? '#59F0FF' : gap > r.sdc ? '#FF8A7A' : gap < -r.sdc ? '#3DDC97' : '#59F0FF';
  const word = gap == null ? '' : Math.abs(gap) < r.sdc ? 'About the same as real age' : gap > 0 ? `${gap.toFixed(0)} years older than real age` : `${(-gap).toFixed(0)} years younger than real age`;
  const views = ['axial', 'coronal', 'sagittal'].filter(k => r.images[k]);
  $('#mout').innerHTML = `<div class="mx-res">
    <div class="mx-nums"><div><small>Brain age</small><b class="mx-count" style="color:${col}" data-to="${ba}">0</b></div>${age != null ? `<div><small>Real age</small><b>${age}</b></div>` : ''}</div>
    ${word ? `<div class="mx-word" style="--c:${col}">${word}</div>` : ''}
    ${views.length ? `<div class="mx-scan"><img id="mxImg" src="${r.images[views[0]]}" alt="brain scan heatmap"><div class="mx-views">${views.map((k, i) => `<button class="chip ${i ? '' : 'on'}" data-v="${k}">${{ axial: 'Top', coronal: 'Front', sagittal: 'Side' }[k]}</button>`).join('')}</div>
      <small class="muted">🟠 Orange = areas that made it look older</small></div>` : ''}
    ${t ? `<small class="muted mx-truth">This was a real ${t.age}-year-old · ${esc(t.status)}</small>` : ''}</div>`;
  const el = $('#mout .mx-count'), t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / 900); el.textContent = Math.round(ba * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  $$('#mout [data-v]').forEach(b => b.onclick = () => { $('#mxImg').src = r.images[b.dataset.v]; $$('#mout [data-v]').forEach(x => x.classList.toggle('on', x === b)); });
}
