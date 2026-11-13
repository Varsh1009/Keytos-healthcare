// NeuroTrail v2 front end. Four tabs: Today, Checks, My Brain, Me.
// Every number comes from the Python API (trained models, SQLite, real datasets). Nothing is made up here.
import { pageGame, stopGames } from './gym.js?v=7';
import { pageVoice, stopVoice, buddy } from './ui2.js?v=5';

// Passkeys are bound to "localhost", and browsers refuse them on raw IPs, so send 127.0.0.1 visitors to localhost.
if (['127.0.0.1', '[::1]'].includes(location.hostname)) location.replace(location.href.replace(location.hostname, 'localhost'));

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x, d = 1) => (x > 0 ? '+' : '') + Number(x).toFixed(d);
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText);
  return j;
}
async function postForm(url, fd) { const r = await fetch(url, { method: 'POST', body: fd }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || r.statusText); return j; }
const toast = (m, ms = 3200) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); };
const charts = {};
const calm = () => document.body.classList.contains('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
if (window.Chart) { Chart.defaults.font.family = 'Inter, system-ui, sans-serif'; Chart.defaults.color = '#A9B2CA'; Chart.defaults.elements.point.radius = 3; Chart.defaults.elements.point.hoverRadius = 6; Chart.defaults.elements.line.borderWidth = 2.5;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(14,18,34,.95)'; Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,.15)'; Chart.defaults.plugins.tooltip.borderWidth = 1; Chart.defaults.plugins.tooltip.padding = 12; Chart.defaults.plugins.tooltip.cornerRadius = 12; }
const chartOpts = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, animation: calm() ? false : undefined, plugins: { legend: { labels: { color: '#A9B2CA', font: { size: 14 }, usePointStyle: true } } },
  scales: { x: { ticks: { color: '#A9B2CA', maxRotation: 0, autoSkip: true, font: { size: 13 } }, grid: { display: false }, border: { display: false } }, y: { ticks: { color: '#A9B2CA', font: { size: 13 } }, grid: { color: 'rgba(255,255,255,.06)' }, border: { display: false } } }, ...extra });
const chart = (id, cfg) => { charts[id]?.destroy(); const el = document.getElementById(id); if (el) charts[id] = new Chart(el, cfg); };
const main = $('#main');

let AUTH = null, ME = null, QUESTS = [], QMAP = {}, FACTS = null, COACH = null, ROUTE = 'today';

// ------------------------------------------------------------------ plain-language names
const HABIT = {
  bp: { name: 'Check your blood pressure', ico: '🩺', ring: 'Body' },
  steps: { name: 'Take a walk', ico: '👟', ring: 'Move' },
  connect: { name: 'Talk with someone', ico: '💬', ring: 'Mind' },
  hearing: { name: 'Look after your hearing', ico: '👂', ring: 'Body' },
  joy: { name: 'Do something you enjoy', ico: '🎯', ring: 'Mind' },
  smoke: { name: 'Smoke-free day', ico: '🚭', ring: 'Body' },
  sleep: { name: 'Sleep on a schedule', ico: '🌙', ring: 'Body' },
  labs: { name: 'Know your numbers', ico: '🧪', ring: 'Body' },
  mood: { name: 'Mood check (8 questions)', ico: '💛', ring: 'Mind' },
};
const FACTOR_HABIT = { sbp: 'bp', diabetes: 'labs', current_smoker: 'smoke', sleep_dev: 'sleep', phq9: 'mood', active_min_week: 'steps' };
const CHECKS = [
  { id: 'speed', name: 'Speed Sprint', ico: '⚡', color: '#FBBF24', what: 'Match symbols to numbers for 90 seconds.', main: true },
  { id: 'recall', name: 'Word Recall', ico: '📝', color: '#60A5FA', what: 'Learn 10 words, then pick them out.', main: true },
  { id: 'fluency', name: 'Animal Naming', ico: '🦒', color: '#4ADE80', what: 'Name as many animals as you can in 60 seconds.', main: true },
  { id: 'voice', name: 'Voice check', ico: '🎙️', color: '#F472B6', what: 'Read a short passage aloud. We measure pace and pauses.', main: true },
  { id: 'trails', name: 'Trail Connect', ico: '🔗', color: '#5EEAD4', what: 'Tap numbers (and letters) in order.' },
  { id: 'stroop', name: 'Color Clash', ico: '🎨', color: '#FB7185', what: 'Tap the ink color, not the word.' },
  { id: 'corsi', name: 'Memory Grid', ico: '🟦', color: '#818CF8', what: 'Repeat a sequence of lit squares.' },
  { id: 'reaction', name: 'Reflex', ico: '🏁', color: '#A78BFA', what: 'Tap the moment the circle turns green.' },
];
// Lancet Commission 2024 (Livingston et al.): weighted population attributable fractions, % of dementia cases.
const LANCET = [
  ['hearing', 'Hearing loss', 7], ['ldl', 'High LDL cholesterol', 7], ['edu', 'Less education', 5], ['isolation', 'Social isolation', 5],
  ['depression', 'Depression', 3], ['tbi', 'Head injury', 3], ['air', 'Air pollution', 3], ['inactivity', 'Physical inactivity', 2],
  ['smoking', 'Smoking', 2], ['diabetes', 'Diabetes', 2], ['bp', 'High blood pressure', 2], ['vision', 'Untreated vision loss', 2],
  ['obesity', 'Obesity', 1], ['alcohol', 'Too much alcohol', 1]];
const LANCET_URL = 'https://doi.org/10.1016/S0140-6736(24)01296-0';
const SUPPORT = `<div class="support-card" role="alert"><h2>You don't have to carry this alone</h2>
  <p>You told us you've been feeling down. If you're struggling, <b>call or text 988</b> (US Suicide & Crisis Lifeline, free, 24/7) or chat at <a href="https://988lifeline.org" target="_blank" rel="noopener">988lifeline.org</a>. In an emergency call <b>911</b>.</p>
  <p>Low mood is common and treatable. Talking to your doctor is a strong next step. NeuroTrail is not treatment and no person reads your answers.</p></div>`;

// ------------------------------------------------------------------ settings: text size + calm mode
function applySettings() {
  const s = +(store.get('nt-size') || 1); document.documentElement.style.setProperty('--scale', s);
  $$('.sizer button').forEach(b => b.classList.toggle('on', +b.dataset.size === s));
  const c = store.get('nt-calm') === '1'; document.body.classList.toggle('calm', c); $('#calmBtn').setAttribute('aria-pressed', c);
}
$$('.sizer button').forEach(b => b.onclick = () => { store.set('nt-size', b.dataset.size); applySettings(); });
$('#calmBtn').onclick = () => { store.set('nt-calm', store.get('nt-calm') === '1' ? '0' : '1'); applySettings(); };
const bodyClass = r => { document.body.className = 'r-' + r + (store.get('nt-calm') === '1' ? ' calm' : ''); };

function renderWho() {
  if (!AUTH?.signed_in) { $('#who').textContent = ''; return; }
  const av = `<span class="av" aria-hidden="true">${esc((AUTH.name || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
  $('#who').innerHTML = AUTH.passkey ? `${av}${esc(AUTH.name)} · 🔑 saved` : `${av}${esc(AUTH.name)} · <a href="#/me/security">not saved yet</a>`;
}
async function refresh() { ME = await api('/api/me'); return ME; }

// ------------------------------------------------------------------ helpers
const stepper = (id, val, unit = '', label = '') => `<div class="stepper" role="group" aria-label="${esc(label)}">
  <button type="button" data-dec="${id}" aria-label="Less">−</button><output id="${id}" aria-live="polite">${val}${unit}</output><button type="button" data-inc="${id}" aria-label="More">+</button></div>`;
function wireStepper(root, id, get, set, { min, max, step, unit = '', fmtv = v => v }) {
  const out = $('#' + id, root), upd = () => { out.textContent = fmtv(get()) + unit; };
  $(`[data-dec="${id}"]`, root).onclick = () => { set(Math.max(min, +(get() - step).toFixed(2))); upd(); };
  $(`[data-inc="${id}"]`, root).onclick = () => { set(Math.min(max, +(get() + step).toFixed(2))); upd(); };
  upd();
}
function choice(root, sel, cb) { $$(sel, root).forEach(b => b.onclick = () => { $$(sel, root).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); cb(b.dataset.v, b); }); }
const ring = (label, v, goal, color) => { const C = 2 * Math.PI * 42, f = Math.min(1, v / goal);
  return `<div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,.08)" stroke-width="12" fill="none"/>
    <circle cx="50" cy="50" r="42" stroke="${color}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - f)}"/></svg>
    <b>${label}</b><span>${v} / ${goal} this week</span></div>`; };
const sizeCls = s => ({ 'On target': 'ontarget', Unknown: 'unknown', 'Not shown in data': 'notshown' }[s] || s);
function userFactors(p) {
  const f = new Set();
  if (p.hearing_trouble) f.add('hearing'); if (p.feel_down || (p.phq9 ?? 0) >= 10) f.add('depression');
  if (p.current_smoker) f.add('smoking'); if (p.diabetes) f.add('diabetes');
  if ((p.sbp ?? 0) >= 130 || store.get('nt-toldbp') === '1') f.add('bp');
  return f;
}
function iconArray(p) {
  const mine = userFactors(p), order = [...LANCET.filter(x => mine.has(x[0])), ...LANCET.filter(x => !mine.has(x[0]))];
  const cells = []; for (const [k, , n] of order) for (let i = 0; i < n; i++) cells.push(mine.has(k) ? 'you' : 'on');
  while (cells.length < 100) cells.push('');
  const youN = order.filter(x => mine.has(x[0])).reduce((a, x) => a + x[2], 0);
  return { youN, html: `<div class="icons" role="img" aria-label="100 people: 45 colored, ${youN} of them gold">${cells.map((c, i) => `<i class="${c} ${calm() ? '' : 'anim'}" style="animation-delay:${i * 18}ms"></i>`).join('')}</div>
    <div class="legend"><span style="--c:var(--gold)">linked to factors you told us about (${youN})</span><span style="--c:var(--violet)">other changeable factors (${45 - youN})</span><span style="--c:#2E3768">not linked to these 14 (age, genes, unknown)</span></div>` };
}
function planFor(me) {
  const L = me.lever?.per_factor || {}, p = me.profile, out = [];
  const ranked = Object.entries(L).filter(([, f]) => f.known && (f.points ?? 0) > .1 && f.significant).sort((a, b) => b[1].points - a[1].points);
  for (const [k] of ranked) if (FACTOR_HABIT[k]) out.push(FACTOR_HABIT[k]);
  if (p.sbp == null) out.push('bp');
  if (p.feel_down) out.push('mood');
  if (p.hearing_trouble) out.push('hearing');
  if (p.phq9 == null) out.push('mood');
  out.push('steps', 'connect', 'joy', 'sleep');
  return [...new Set(out)].filter(id => id === 'mood' || (QMAP[id] && (id !== 'smoke' || p.current_smoker))).slice(0, 3);
}
const habitDone = id => id === 'mood' ? ME.profile.phq9 != null : ME.trail?.[id] === 'done';

// ------------------------------------------------------------------ ROUTER
const routes = { today: pageToday, habit: pageHabit, checks: pageChecks, check: pageCheck, sprint: () => pageCheck('speed'), brain: pageBrain, me: pageMe };
const TAB = { habit: 'today', check: 'checks', sprint: 'checks' };
let brainView = null;
async function route() {
  STOP_SPRINT(); stopGames(); stopVoice();
  if (!AUTH?.signed_in) return pageWelcome();
  if (!AUTH.onboarded) return pageOnboard();
  const [, r = 'today', ...args] = (location.hash || '#/today').split('/');
  ROUTE = routes[r] ? r : 'today';
  bodyClass(ROUTE);
  $$('#tabs a').forEach(a => { const on = a.dataset.r === (TAB[ROUTE] || ROUTE); a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  if (ROUTE !== 'brain') brainView?.stop();
  try { await refresh(); } catch { AUTH = { signed_in: false }; return pageWelcome(); }
  renderWho();
  await routes[ROUTE](...args);
  main.focus({ preventScroll: true }); if (!(ROUTE === 'me' && args[0])) scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ================================================================== WELCOME
function pageWelcome() {
  bodyClass('welcome');
  main.innerHTML = `<div class="hero stagger">
    <div><div class="buddy-wrap">${buddy('happy', 128)}</div></div>
    <div><span class="badge-row"><b>FREE</b> Built on real CDC &amp; MRI research data</span></div>
    <h1>What actually helps<br><em>your</em> brain?</h1>
    <p class="lead">Two minutes, a few taps, and you'll see which of your habits matter most, backed by real health data from thousands of people. Then build those habits with small daily steps.</p>
    <div class="ctas"><button class="btn big" id="start">Start now · no sign-up needed →</button>
      <button class="btn alt big" id="login">🔑 I already have a passkey</button></div>
    <div class="statstrip"><div><b class="grad-text">2,597</b><span>adults 60+ in the CDC survey</span></div><div><b class="grad-text">436</b><span>real MRI scans tested</span></div><div><b class="grad-text">2 min</b><span>to your first result</span></div></div>
    <div class="promise">
      <div><span class="ico-tile" aria-hidden="true">📊</span><b>Real data</b>Models trained on public CDC and OASIS research data, not guesses.</div>
      <div><span class="ico-tile" aria-hidden="true">🙅</span><b>No hype</b>We show what we tested and what failed. No "brain age".</div>
      <div><span class="ico-tile" aria-hidden="true">🔒</span><b>Private</b>Saved on this computer. Sign in with a passkey, not a password.</div></div>
    <p class="muted">A wellness and education tool, not a diagnosis. If you're worried about your memory, talk to a doctor.</p></div>`;
  $('#start').onclick = async () => { try { await api('/auth/guest', {}); AUTH = await api('/auth/me'); route(); } catch (e) { toast(`Couldn't start: ${e.message}`, 5000); } };
  $('#login').onclick = passkeyLogin;
}
// Passkeys only work in a secure context (https, or http://localhost). Explain instead of failing silently.
function passkeyBlocker() {
  if (!window.isSecureContext) return `Passkeys need a secure address. On the computer running NeuroTrail, open http://localhost:${location.port || 8600}. From another device the app must be served over https.`;
  if (!window.PublicKeyCredential || !window.SimpleWebAuthnBrowser) return 'This browser doesn\'t support passkeys. Try an up-to-date Chrome, Safari, Edge or Firefox.';
  return null;
}
const passkeyError = (e, what) => {
  if (e.name === 'NotAllowedError') return `${what} was cancelled or timed out. If no passkey was offered, you may not have saved one on this device yet.`;
  if (e.name === 'InvalidStateError') return 'This device already has a passkey for this account. Use "I already have a passkey" to sign in.';
  if (e.name === 'SecurityError') return `Passkeys can't be used at this address. Open http://localhost:${location.port || 8600} instead.`;
  return `${what} failed: ${e.message}`;
};
async function passkeyLogin() {
  const block = passkeyBlocker(); if (block) { toast(block, 8000); return; }
  try {
    const { key, options } = await api('/auth/login/options', {});
    const credential = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    await api('/auth/login/verify', { key, credential });
    AUTH = await api('/auth/me'); toast(`Welcome back, ${AUTH.name}`);
    if (location.hash === '#/today') route(); else location.hash = '#/today';   // hashchange runs route() once
  } catch (e) { toast(passkeyError(e, 'Passkey sign-in'), 8000); }
}
async function savePasskey(after) {
  const block = passkeyBlocker(); if (block) { toast(block, 8000); return; }
  try {
    const { key, options } = await api('/auth/register/options', {});
    const credential = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    await api('/auth/register/verify', { key, credential });
    AUTH = await api('/auth/me'); renderWho(); toast('🔑 Saved. Next time, sign in with your fingerprint, face or device PIN.', 5000); after?.();
  } catch (e) { toast(e.name === 'NotAllowedError' ? 'Passkey setup was cancelled. You can do it later in Me → Security.' : passkeyError(e, 'Saving the passkey'), 8000); }
}

// ================================================================== ONBOARDING (about 2 minutes)
let OB = null;
async function pageOnboard() {
  bodyClass('onboard');
  if (!QUESTS.length) await loadQuests();
  OB ||= { step: 0, age: 65, female: null, toldbp: null, sbp: null, knowsbp: false, diabetes: null, current_smoker: null, sleep_hours: 7, hearing_trouble: null, feel_down: null };
  ME = await refresh().catch(() => null);
  obRender();
}
const dots = n => `<div class="progressdots" aria-label="Step ${n + 1} of 4">${[0, 1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
function obRender() {
  const s = OB.step;
  if (s === 0) {
    main.innerHTML = `${dots(0)}<div class="card pop"><div class="eyebrow">About you</div><h1>How old are you?</h1>
      ${stepper('obAge', OB.age, ' years', 'Age')}
      <h2 style="margin-top:22px">Sex</h2><p class="muted">The survey data we compare with recorded sex, so we use it to match you fairly.</p>
      <div class="yesno"><button data-v="1" class="${OB.female === true ? 'on' : ''}">Female</button><button data-v="0" class="${OB.female === false ? 'on' : ''}">Male</button></div>
      <button class="btn big" id="next" style="margin-top:22px" ${OB.female == null ? 'disabled' : ''}>Next</button></div>`;
    wireStepper(main, 'obAge', () => OB.age, v => { OB.age = v; }, { min: 18, max: 100, step: 1, unit: ' years' });
    choice(main, '.yesno button', v => { OB.female = v === '1'; $('#next').disabled = false; });
    $('#next').onclick = () => { OB.step = 1; obRender(); };
  } else if (s === 1) {
    main.innerHTML = `${dots(1)}<div class="card pop"><div class="eyebrow">Quick check · 90 seconds</div><h1>Speed Sprint</h1>
      <p>Match each symbol to its number using the key. This is how we'll track your <b>processing speed</b> over time, compared only with <b>you</b>. Today's score becomes your "first try" that you race later.</p>
      <p class="muted">Speed training was the one brain exercise linked to fewer dementia diagnoses in a 10-year trial (ACTIVE). One round is a baseline, not a test result.</p>
      <button class="btn big" id="go">▶ Start the 90-second sprint</button>
      <div style="margin-top:10px"><button class="btn alt big" id="skip">Skip for now</button></div></div>`;
    $('#go').onclick = () => { main.innerHTML = `${dots(1)}<div id="sprintBox"></div>`; runSprint($('#sprintBox'), { onDone: () => { OB.step = 2; obRender(); }, doneLabel: 'Next: 6 quick questions' }); };
    $('#skip').onclick = () => { OB.step = 2; obRender(); };
  } else if (s === 2) {
    const yn = (k, a = 'Yes', b = 'No', c = null) => `<div class="yesno" data-k="${k}"><button data-v="1" class="${OB[k] === true ? 'on' : ''}">${a}</button><button data-v="0" class="${OB[k] === false ? 'on' : ''}">${b}</button>${c ? `<button data-v="u" class="${OB[k] === 'u' ? 'on' : ''}">${c}</button>` : ''}</div>`;
    main.innerHTML = `${dots(2)}<div class="card pop"><div class="eyebrow">6 quick taps</div><h1>A little about your health</h1>
      <div class="q"><b>1. Has a doctor ever told you that you have high blood pressure?</b>${yn('toldbp', 'Yes', 'No', 'Not sure')}
        <div id="bpBox" style="margin-top:10px">${OB.knowsbp ? `<p class="muted">Your usual top number (systolic):</p>${stepper('obSbp', OB.sbp ?? 130, ' mmHg', 'Systolic blood pressure')}` : '<button class="linkbtn" id="knowbp">I know my latest reading (optional)</button>'}</div></div>
      <div class="q"><b>2. Do you have diabetes?</b>${yn('diabetes')}</div>
      <div class="q"><b>3. Do you smoke now?</b>${yn('current_smoker')}</div>
      <div class="q"><b>4. How many hours do you usually sleep a night?</b>${stepper('obSleep', OB.sleep_hours, ' h', 'Sleep hours')}</div>
      <div class="q"><b>5. Do you have trouble hearing, even with hearing aids?</b>${yn('hearing_trouble')}</div>
      <div class="q"><b>6. In the last 2 weeks, have you often felt down, depressed or hopeless?</b>${yn('feel_down')}</div>
      <button class="btn big" id="next" style="margin-top:12px">See what matters for me</button><p class="muted" id="miss" aria-live="polite"></p></div>`;
    $$('.yesno', main).forEach(g => choice(g, 'button', v => { const k = g.dataset.k; OB[k] = v === 'u' ? 'u' : v === '1'; }));
    wireStepper(main, 'obSleep', () => OB.sleep_hours, v => { OB.sleep_hours = v; }, { min: 3, max: 12, step: .5, unit: ' h' });
    const wireBp = () => { if ($('#obSbp')) wireStepper(main, 'obSbp', () => OB.sbp ?? 130, v => { OB.sbp = v; }, { min: 80, max: 220, step: 2, unit: ' mmHg' }); };
    $('#knowbp') && ($('#knowbp').onclick = () => { OB.knowsbp = true; OB.sbp = 130; $('#bpBox').innerHTML = `<p class="muted">Your usual top number (systolic):</p>${stepper('obSbp', 130, ' mmHg', 'Systolic blood pressure')}`; wireBp(); });
    wireBp();
    $('#next').onclick = async () => {
      const need = ['toldbp', 'diabetes', 'current_smoker', 'hearing_trouble', 'feel_down'].filter(k => OB[k] == null);
      if (need.length) { $('#miss').textContent = `Please answer ${need.length} more question${need.length > 1 ? 's' : ''} (tap Yes or No).`; return; }
      store.set('nt-toldbp', OB.toldbp === true ? '1' : '0');
      const body = { age: OB.age, female: OB.female, diabetes: OB.diabetes, current_smoker: OB.current_smoker, sleep_hours: OB.sleep_hours,
        hearing_trouble: OB.hearing_trouble, feel_down: OB.feel_down, sbp: OB.knowsbp ? OB.sbp : null };
      try { ME = await api('/api/me/onboard', body); } catch (e) { toast(e.message); return; }
      OB.step = OB.feel_down ? 3 : 4; obRender();
    };
  } else if (s === 3) {
    main.innerHTML = `${dots(3)}<div class="pop">${SUPPORT}<button class="btn big" id="next" style="margin-top:16px">Continue to my results</button></div>`;
    $('#next').onclick = () => { OB.step = 4; obRender(); };
  } else {
    const ia = iconArray(ME.profile), plan = planFor(ME), L = ME.lever;
    const top = Object.values(L.per_factor).filter(f => f.known && f.significant && f.points > .1).sort((a, b) => b.points - a.points);
    main.innerHTML = `${dots(3)}<div class="stack pop">
      <div class="card"><div class="eyebrow">The big picture</div><h1>Out of 100 people with dementia…</h1>
        <p>…about <b>45</b> cases are linked to <b>14 things that can change</b>, according to the 2024 Lancet Commission. ${ia.youN ? `The <b style="color:var(--gold)">gold ones (${ia.youN})</b> are linked to factors you told us apply to you.` : 'None of the factors you told us about are on the list. A great place to start from.'}</p>
        ${ia.html}
        <p class="muted">This describes whole populations, not your personal chance. <a href="${LANCET_URL}" target="_blank" rel="noopener">Lancet 2024 ↗</a></p></div>
      <div class="card"><div class="eyebrow">What matters most for you</div>
        ${top.length ? `<p>In a CDC survey of ${L.n.toLocaleString()} adults 60+, people with these factors scored lower on a <b>thinking-speed test</b> than people at healthy targets:</p>
          ${top.map(f => `<div class="lever"><b>${esc(f.label)}</b><span class="size ${sizeCls(f.size)}">${f.size}</span><span class="muted" style="grid-column:1/-1">about ${f.points.toFixed(1)} points lower on average (range ${f.ci[0].toFixed(1)} to ${f.ci[1].toFixed(1)})</span></div>`).join('')}`
          : '<p>Your answers are at the healthy targets for every factor with a clear link in the survey data. Keep it up, and keep checking.</p>'}
        ${L.per_factor.sbp && !L.per_factor.sbp.known ? '<p class="muted">Blood pressure: unknown. It has the strongest trial evidence (SPRINT MIND), so measuring it is one of your first habits.</p>' : ''}
        <p class="muted">Links in survey data, not proof of cause. Points are on a 0–133 test. <button class="linkbtn" data-how>How we know</button></p></div>
      <div class="card next"><div class="eyebrow">Your first 3 habits</div>
        <div class="plan">${plan.map(id => `<a href="#/habit/${id}"><span class="ico">${HABIT[id].ico}</span>${HABIT[id].name}<span class="go">Start →</span></a>`).join('')}</div></div>
      <div class="card"><h2>🔑 Save your progress</h2><p>Use a <b>passkey</b>: your fingerprint, face or device PIN. No password to remember or leak.</p>
        <button class="btn big" id="save">Save with a passkey</button><div style="margin-top:10px"><button class="btn alt big" id="later">Not now, go to Today</button></div></div></div>`;
    const done = (hash = '#/today') => { OB = null; AUTH.onboarded = true; if (location.hash === hash) route(); else location.hash = hash; };
    $('#save').onclick = () => savePasskey(() => done());
    $('#later').onclick = () => done();
    $('[data-how]').onclick = () => done('#/me/how');
    $$('.plan a', main).forEach(a => a.onclick = e => { e.preventDefault(); done(a.getAttribute('href')); });
  }
}

// ================================================================== TODAY
async function pageToday() {
  const plan = planFor(ME), next = plan.find(id => !habitDone(id)), R = ME.rings, L = ME.lever;
  const top = Object.entries(L.per_factor).filter(([, f]) => f.known && f.significant && f.points > .1).sort((a, b) => b[1].points - a[1].points).slice(0, 3);
  const unknown = Object.entries(L.per_factor).filter(([, f]) => !f.known);
  const h = new Date().getHours(), hi = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const nDone = plan.filter(habitDone).length;
  const C = 2 * Math.PI * 54, frac = nDone / Math.max(1, plan.length);
  main.innerHTML = `<div class="stack stagger">
    ${ME.support ? SUPPORT : ''}
    <section class="card today-hero">
      <div class="hello">${buddy(nDone === 3 ? 'wow' : 'happy', 88)}<div>
        <h1>${hi}${AUTH?.name && !/^guest/i.test(AUTH.name) ? `, <span class="grad-text">${esc(AUTH.name.split(' ')[0])}</span>` : ''}</h1>
        <p class="lede">${nDone === 3 ? 'All 3 habits done today. That is how it adds up.' : nDone ? `${nDone} of 3 habits done. Nice momentum.` : 'One small step today is enough.'}</p>
        <div class="chips">${ME.streak ? `<span class="tag">🔥 ${ME.streak}-day streak</span>` : '<span class="tag">✨ Day one starts now</span>'}<span class="tag">🛌 Rest days never break a streak</span></div></div></div>
      <div class="dayring" role="img" aria-label="${nDone} of ${plan.length} habits done today"><svg viewBox="0 0 132 132" aria-hidden="true"><defs><linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5EEAD4"/><stop offset=".55" stop-color="#818CF8"/><stop offset="1" stop-color="#C084FC"/></linearGradient></defs>
        <circle cx="66" cy="66" r="54" stroke="rgba(255,255,255,.08)" stroke-width="12" fill="none"/><circle cx="66" cy="66" r="54" stroke="url(#dg)" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
        <div class="lbl"><b>${nDone}/${plan.length}</b><span>today</span></div></div>
    </section>
    ${next ? `<a class="card next feature" href="#/habit/${next}"><span class="ico-tile lg" aria-hidden="true">${HABIT[next].ico}</span><div><div class="eyebrow">Your next step</div><h2>${HABIT[next].name}</h2><p>${esc(nextWhy(next))}</p></div><span class="btn">Start →</span></a>`
      : `<a class="card next feature" href="#/checks"><span class="ico-tile lg" aria-hidden="true">🎯</span><div><div class="eyebrow">All habits done</div><h2>Want a quick check?</h2><p>Play a 90-second Speed Sprint and race your first try. Or rest: rest counts too.</p></div><span class="btn">Go to Checks →</span></a>`}
    <div class="bento">
      <div class="card c7"><div class="cardhead"><div class="eyebrow">${next ? 'Also on today\'s list' : 'Today\'s 3 habits'}</div><span class="muted">${nDone}/${plan.length} done</span></div><div class="plan">${plan.filter(id => id !== next).map(id => `<a href="#/habit/${id}" class="${habitDone(id) ? 'done' : ''}"><span class="ico">${habitDone(id) ? '✓' : HABIT[id].ico}</span>${HABIT[id].name}<span class="go">${habitDone(id) ? 'Done' : 'Start →'}</span></a>`).join('')}</div></div>
      <div class="card c5"><div class="eyebrow">Care rings · last 7 days</div><div class="rings">${ring('Move', R.move.points, R.move.goal, '#4ADE80')}${ring('Mind', R.mind.points, R.mind.goal, '#A78BFA')}${ring('Body', R.body.points, R.body.goal, '#5EEAD4')}</div>
        <p class="muted">Each habit fills a ring by how strong its evidence is. Trial-backed habits count more.</p></div>
      <div class="card c7"><div class="eyebrow">What matters most for you</div>
        ${top.length ? top.map(([k, f]) => `<div class="lever"><b>${esc(f.label)}</b><span class="size ${sizeCls(f.size)}">${f.size}</span>
          <span class="muted" style="grid-column:1/-1">about ${f.points.toFixed(1)} points lower on a thinking-speed test, on average (CDC survey, adults 60+)${FACTOR_HABIT[k] ? ` · <a href="#/habit/${FACTOR_HABIT[k]}">habit</a>` : ''}</span></div>`).join('') : '<p>No factor with a clear link is off target right now.</p>'}
        ${unknown.length ? `<p class="muted">Not known yet: ${unknown.map(([, f]) => esc(f.label)).join(', ')}. ${unknown.some(([k]) => k === 'sbp') ? '<a href="#/habit/bp">Measure it</a>.' : ''}${unknown.some(([k]) => k === 'phq9') ? ' <a href="#/habit/mood">Take the mood check</a>.' : ''}</p>` : ''}
        <details class="drawer"><summary>🎛 Try a change: what if…</summary><div id="tryBox"></div></details></div>
      <div class="card c5 tipcard" id="tipCard"><div class="eyebrow">Tip of the day</div>${tip()}</div>
    </div>
    <div id="askBox"></div>
  </div>`;
  wireTry();
  coachStatus().then(ok => { if (ok && $('#askBox')) askCard(); });
}
function nextWhy(id) {
  const L = ME.lever.per_factor;
  return { bp: ME.profile.sbp == null ? 'Your blood pressure is unknown, and lowering it is the step with the strongest trial evidence for the brain (SPRINT MIND).' : 'Blood pressure is the brain-health step with the strongest trial evidence.',
    labs: L.diabetes?.points > .1 ? 'Diabetes had the biggest link to slower thinking in the survey data. Knowing your HbA1c is the first step.' : 'Cholesterol and blood sugar: know your numbers.',
    sleep: 'Sleeping much more or less than 6–8 hours was linked to slower thinking in the survey.',
    smoke: 'Smoking was linked to slower thinking, and quitting at any age helps.',
    mood: 'Mood is linked to thinking speed. 8 short questions, about 2 minutes.',
    steps: 'Walking more is linked to lower dementia risk in a study of 78,000 people.',
    connect: 'Social isolation is one of the 14 changeable dementia risk factors.',
    hearing: 'Hearing loss is the largest single changeable risk factor in the Lancet 2024 report.',
    joy: 'Planning one enjoyable thing is a proven way to lift low mood.' }[id] || '';
}
const TIPS = [
  ['Blood pressure', 'Lowering top-number blood pressure to under 120 (vs under 140) reduced mild memory problems in the SPRINT MIND trial.', 'https://jamanetwork.com/journals/jama/fullarticle/2723256'],
  ['Hearing', 'In the ACHIEVE trial, hearing aids slowed thinking decline over 3 years in older adults at higher risk.', 'https://doi.org/10.1016/S0140-6736(23)01406-X'],
  ['Walking', 'In 78,430 UK adults, about 9,800 steps a day was linked to about half the dementia risk; even 3,800 helped.', 'https://jamanetwork.com/journals/jamaneurology/fullarticle/2795819'],
  ['Stroke', 'Know BE-FAST: Balance, Eyes, Face, Arm, Speech, Time to call 911. Fast treatment saves brain.', 'https://pubmed.ncbi.nlm.nih.gov/28082668/'],
];
const tip = () => { const [h, t, u] = TIPS[new Date().getDate() % TIPS.length]; return `<h3>${h}</h3><p>${t}</p><a href="${u}" target="_blank" rel="noopener">Source ↗</a>`; };
function wireTry() {
  const p = { ...ME.profile }, box = $('#tryBox');
  const S = { sbp: p.sbp ? Math.round(p.sbp) : 140, sleep: p.sleep_hours ?? 7, smoke: !!p.current_smoker };
  box.innerHTML = `<p class="muted">See how the survey model's points change if one thing changes. A "what if", not a promise.</p>
    <div class="q"><b>Blood pressure (top number)</b>${stepper('trSbp', S.sbp, ' mmHg', 'Blood pressure')}</div>
    <div class="q"><b>Sleep</b>${stepper('trSleep', S.sleep, ' h', 'Sleep')}</div>
    ${p.current_smoker ? `<div class="q"><b>Smoking</b><div class="yesno"><button data-v="1" class="on">Still smoking</button><button data-v="0">Quit</button></div></div>` : ''}
    <div class="bubble" id="trOut" aria-live="polite">…</div>`;
  let t; const go = () => { clearTimeout(t); t = setTimeout(async () => {
    const body = { sbp: S.sbp, diabetes: !!p.diabetes, current_smoker: S.smoke, active_min_week: p.active_min_week ?? 0, sedentary_min_day: p.sedentary_min_day ?? 360, sleep_hours: S.sleep, phq9: p.phq9 };
    const r = await api('/api/lever', body), now = ME.lever.points;
    $('#trOut').innerHTML = `Points linked to your factors: <b>${now.toFixed(1)}</b> now${ME.profile.sbp == null ? ' (blood pressure not counted: unknown)' : ''} → <b>${r.points.toFixed(1)}</b> with these values. Lower is better.`;
  }, 200); };
  wireStepper(box, 'trSbp', () => S.sbp, v => { S.sbp = v; go(); }, { min: 90, max: 200, step: 5, unit: ' mmHg' });
  wireStepper(box, 'trSleep', () => S.sleep, v => { S.sleep = v; go(); }, { min: 3, max: 12, step: .5, unit: ' h' });
  choice(box, '.yesno button', v => { S.smoke = v === '1'; go(); });
  go();
}
async function coachStatus() { if (COACH == null) COACH = await api('/api/coach/status').then(s => !!s.claude).catch(() => false); return COACH; }
function askCard() {
  $('#askBox').innerHTML = `<div class="card"><div class="eyebrow">Ask a question</div><p class="muted">An AI assistant (Claude) that can read your logs and run the same models. It can be wrong; it is not a doctor.</p>
    <div class="chips">${['What should I focus on this week?', 'Why does blood pressure matter for my brain?', 'Make me a 7-day plan'].map(q => `<button class="chip" data-q="${esc(q)}">${q}</button>`).join('')}</div>
    <div id="askOut" aria-live="polite" style="margin-top:12px"></div></div>`;
  $$('[data-q]').forEach(b => b.onclick = async () => {
    $('#askOut').innerHTML = '<div class="bubble">Thinking…</div>';
    try { const r = await api('/api/me/coach', { text: b.dataset.q }); $('#askOut').innerHTML = `<div class="bubble">${esc(r.text).replace(/\n/g, '<br>')}</div>`; }
    catch (e) { $('#askOut').innerHTML = `<p class="caveat">${esc(e.message)}</p>`; }
  });
}

// ================================================================== HABIT PAGE
async function loadQuests() { QUESTS = await api('/api/quests'); QMAP = Object.fromEntries(QUESTS.map(q => [q.id, q])); }
async function pageHabit(id) {
  if (!QUESTS.length) await loadQuests();
  if (id === 'mood') return pageMood();
  const q = QMAP[id]; if (!q || id === 'speed') { location.hash = '#/today'; return; }
  const H = HABIT[id], done = habitDone(id), v = {}, last = ME.profile || {};
  const chipset = (cid, opts) => `<div class="chips" id="${cid}">${opts.map((w, i) => `<button class="chip ${i ? '' : 'on'}" aria-pressed="${!i}" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div>`;
  const input = {
    bp: () => { v.s = last.sbp ? Math.round(last.sbp) : 125; v.d = 80; return `<div id="bpCuff"><p><b>Your reading</b> (set it to what the cuff shows):</p>
      <div class="q"><b>Top number (systolic)</b>${stepper('hS', v.s, ' mmHg', 'Systolic')}</div><div class="q"><b>Bottom number (diastolic)</b>${stepper('hD', v.d, ' mmHg', 'Diastolic')}</div></div>
      <button class="linkbtn" id="noCuff">I don't have a blood pressure cuff</button><div id="noCuffBox"></div>`; },
    steps: () => { v.n = 4000; return `<div class="q"><b>Steps today</b> (from your phone or watch)${stepper('hN', v.n, ' steps', 'Steps')}</div><p class="muted">Levels from a UK study of 78,430 people: about 3,800 (minimum) and 9,800 (best) steps a day.</p>`; },
    connect: () => { v.who = 'Family'; v.mins = 15; return `<div class="q"><b>Who did you talk to?</b>${chipset('hWho', ['Family', 'Partner', 'Friend', 'Neighbor', 'Someone new'])}</div><div class="q"><b>For how long?</b>${stepper('hM', v.mins, ' min', 'Minutes')}</div>`; },
    hearing: () => { v.path = 'Wore my hearing aids all day'; return `<div class="q"><b>What did you do?</b>${chipset('hPath', ['Wore my hearing aids all day', 'Took a hearing screening', 'Booked a hearing test'])}</div>`; },
    joy: () => { v.act = q.log.menu[0]; v.before = 5; v.after = 6; return `<div class="q"><b>Your activity</b>${chipset('hAct', q.log.menu)}</div>
      <div class="q"><b>Mood before (0–10)</b>${stepper('hB', 5, '', 'Mood before')}</div><div class="q"><b>Mood after (0–10)</b>${stepper('hA', 6, '', 'Mood after')}</div>`; },
    check: () => { v.trigger = 'Morning coffee'; v.sub = '5-minute walk'; return `<div class="q"><b>Your biggest trigger today</b>${chipset('hTr', ['Morning coffee', 'After meals', 'Stress', 'With friends', 'Driving', 'Alcohol'])}</div>
      <div class="q"><b>Your substitute</b>${chipset('hSub', ['5-minute walk', 'Glass of water', 'Gum', 'Deep breaths', 'Call someone'])}</div><p>Free coaching: <b>1-800-QUIT-NOW</b> (CDC).</p>`; },
    sleep: () => { v.h = last.sleep_hours ?? 7; return `<div class="q"><b>Hours you slept last night</b>${stepper('hH', v.h, ' h', 'Sleep hours')}</div>`; },
    labs: () => { v.ldl = null; v.a1c = null; return `<p>Found your numbers? Add them (optional). Otherwise tap Done once you've checked or booked a test.</p>
      <div class="q"><b>LDL cholesterol</b> <button class="linkbtn" data-add="ldl">add</button><div id="ldlBox"></div></div><div class="q"><b>HbA1c</b> <button class="linkbtn" data-add="a1c">add</button><div id="a1cBox"></div></div>`; },
  }[q.log.kind];
  main.innerHTML = `<div class="stack stagger" style="max-width:780px">
    <div><a href="#/today" class="ghost back">← Today</a></div>
    <div class="card"><div class="habithead"><span class="ico-tile lg" aria-hidden="true">${H.ico}</span><div><div class="eyebrow">${H.ring} habit · ${esc(q.tier)}</div><h1>${H.name}</h1></div></div>
      ${done ? '<p class="done-sheet">✓ Done today. You can log again if you like.</p>' : ''}
      <h3>How to do it</h3><ol class="steps-list">${q.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div id="hIn">${input ? input() : ''}</div>
      <button class="btn big" id="done" style="margin-top:16px">✓ Done</button>
      <div id="sheet" aria-live="polite"></div>
      <details><summary>Why this habit? The evidence</summary>${q.evidence.map(e => `<p>• ${esc(e.claim)} <a href="${e.url}" target="_blank" rel="noopener">source ↗</a></p>`).join('')}
        ${q.nhanes ? `<p>In our CDC survey analysis: ${esc(q.nhanes.label)} ↔ ${fmt(q.nhanes.dsst_points)} points on the thinking-speed test (95% range ${fmt(q.nhanes.dsst_ci[0])} to ${fmt(q.nhanes.dsst_ci[1])}), ${q.nhanes.p_value < .05 ? 'a clear link' : 'no clear link'}. Association, not cause.</p>` : ''}
        ${q.caveat ? `<p class="caveat">⚠ ${esc(q.caveat)}</p>` : ''}</details></div></div>`;
  const r = $('#hIn');
  const pick = (cid, k) => $('#' + cid, r) && choice(r, `#${cid} .chip`, val => { v[k] = val; });
  if (q.log.kind === 'bp') {
    wireStepper(r, 'hS', () => v.s, x => { v.s = x; }, { min: 80, max: 220, step: 1, unit: ' mmHg' }); wireStepper(r, 'hD', () => v.d, x => { v.d = x; }, { min: 40, max: 130, step: 1, unit: ' mmHg' });
    $('#noCuff').onclick = () => { v.nocuff = true; $('#bpCuff').hidden = true; $('#noCuff').hidden = true;
      $('#noCuffBox').innerHTML = `<div class="bubble"><b>No cuff? Three easy options:</b><ul class="plain"><li>Many pharmacies have a free blood pressure kiosk.</li><li>Ask at your next doctor or clinic visit.</li><li>Home upper-arm cuffs are widely sold; look for one listed at validatebp.org.</li></ul>Tap Done when you've found where to check. We won't record a number.</div>`; $('#done').textContent = '✓ Done: I know where to check'; };
  }
  if (q.log.kind === 'steps') wireStepper(r, 'hN', () => v.n, x => { v.n = x; }, { min: 0, max: 40000, step: 500, unit: ' steps', fmtv: x => x.toLocaleString() });
  if (q.log.kind === 'connect') { pick('hWho', 'who'); wireStepper(r, 'hM', () => v.mins, x => { v.mins = x; }, { min: 5, max: 180, step: 5, unit: ' min' }); }
  if (q.log.kind === 'hearing') pick('hPath', 'path');
  if (q.log.kind === 'joy') { pick('hAct', 'act'); wireStepper(r, 'hB', () => v.before, x => { v.before = x; }, { min: 0, max: 10, step: 1 }); wireStepper(r, 'hA', () => v.after, x => { v.after = x; }, { min: 0, max: 10, step: 1 }); }
  if (q.log.kind === 'check') { pick('hTr', 'trigger'); pick('hSub', 'sub'); }
  if (q.log.kind === 'sleep') wireStepper(r, 'hH', () => v.h, x => { v.h = x; }, { min: 2, max: 12, step: .25, unit: ' h' });
  if (q.log.kind === 'labs') $$('[data-add]', r).forEach(b => b.onclick = () => { const k = b.dataset.add; b.hidden = true; v[k] = k === 'ldl' ? 100 : 5.6;
    $(`#${k}Box`).innerHTML = stepper('h_' + k, v[k], k === 'ldl' ? ' mg/dL' : ' %', k);
    wireStepper(r, 'h_' + k, () => v[k], x => { v[k] = x; }, k === 'ldl' ? { min: 40, max: 250, step: 1, unit: ' mg/dL' } : { min: 4, max: 12, step: .1, unit: ' %', fmtv: x => x.toFixed(1) }); });
  $('#done').onclick = async () => {
    const k = q.log.kind; let value = null, extra = {};
    if (k === 'bp') { if (v.nocuff) extra = { path: 'no-cuff' }; else { value = v.s; extra = { readings: [[v.s, v.d]] }; } }
    if (k === 'steps') value = v.n;
    if (k === 'connect') { value = v.mins; extra = { who: v.who }; }
    if (k === 'hearing') extra = { path: v.path };
    if (k === 'joy') { value = v.after - v.before; extra = { activity: v.act, before: v.before, after: v.after }; }
    if (k === 'check') extra = { trigger: v.trigger, substitute: v.sub };
    if (k === 'sleep') value = v.h;
    if (k === 'labs') extra = { ldl: v.ldl, a1c: v.a1c };
    $('#done').disabled = true;
    try { ME = await api('/api/me/complete', { quest: q.id, value, extra }); } catch (e) { toast(e.message); $('#done').disabled = false; return; }
    const R = ME.rings[H.ring.toLowerCase()];
    let note = '';
    if (k === 'bp' && value >= 180) note = '<p class="caveat"><b>180 or higher is very high.</b> Rest 5 minutes and measure again. If it stays this high, or you have chest pain, weakness, vision or speech changes, call 911.</p>';
    else if (k === 'bp' && value >= 130) note = '<p>130 or above is worth talking about with your doctor. Measure on a few different days to see your usual level.</p>';
    else if (k === 'steps') note = `<p>${value >= 9800 ? 'You reached the "best" level from the UK study. 🏅' : value >= 3800 ? `Above the minimum level. ${(9800 - value).toLocaleString()} more reaches the best level.` : `${(3800 - value).toLocaleString()} more steps reaches the minimum level.`}</p>`;
    else if (k === 'joy' && v.after > v.before) note = `<p>Mood ${v.before} → ${v.after}. Noticing that is part of how this works.</p>`;
    const nxt = planFor(ME).find(x => !habitDone(x));
    $('#sheet').innerHTML = `<div class="card done-sheet pop" style="margin-top:14px"><h2>✓ Nice work!</h2><p><b>+${ME.gained} points</b> to your ${H.ring} ring (${R.points} / ${R.goal} this week).</p>${note}
      <div class="row">${nxt ? `<a class="btn" href="#/habit/${nxt}">Next: ${HABIT[nxt].name} →</a>` : '<a class="btn" href="#/checks">Try a check →</a>'}<a class="ghost" href="#/today">Back to Today</a></div></div>`;
    $('#sheet').scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
  };
}
const PHQ8 = ['Little interest or pleasure in doing things', 'Feeling down, depressed, or hopeless', 'Trouble falling or staying asleep, or sleeping too much', 'Feeling tired or having little energy',
  'Poor appetite or overeating', 'Feeling bad about yourself, or that you are a failure or have let yourself or your family down', 'Trouble concentrating on things, such as reading or watching TV',
  'Moving or speaking so slowly that other people could have noticed, or being so fidgety or restless that you have been moving around a lot more than usual'];
const PHQO = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];
function pageMood() {
  const a = Array(8).fill(null);
  main.innerHTML = `<div class="stack stagger" style="max-width:780px"><div><a href="#/today" class="ghost back">← Today</a></div>
    <div class="card"><div class="habithead"><span class="ico-tile lg" aria-hidden="true">💛</span><div><div class="eyebrow">Mind habit · 2 minutes</div><h1>Mood check</h1></div></div>
      <p>Over the <b>last 2 weeks</b>, how often have you been bothered by the following? (PHQ-8, a standard questionnaire.)</p>
      ${PHQ8.map((t, i) => `<div class="q"><b>${i + 1}. ${t}</b><div class="yesno" data-i="${i}">${PHQO.map((o, j) => `<button data-v="${j}">${o}</button>`).join('')}</div></div>`).join('')}
      <button class="btn big" id="moodGo">See my result</button><p class="muted" id="moodMiss" aria-live="polite"></p><div id="moodOut" aria-live="polite"></div></div></div>`;
  $$('.yesno', main).forEach(g => choice(g, 'button', v => { a[+g.dataset.i] = +v; }));
  $('#moodGo').onclick = async () => {
    const left = a.filter(x => x == null).length; if (left) { $('#moodMiss').textContent = `${left} question${left > 1 ? 's' : ''} left.`; return; }
    $('#moodMiss').textContent = '';
    const r = await api('/api/me/mood', { answers: a }); ME = r.player;
    const band = r.score < 5 ? 'few or no symptoms' : r.score < 10 ? 'mild symptoms' : r.score < 15 ? 'moderate symptoms' : r.score < 20 ? 'moderately severe symptoms' : 'severe symptoms';
    $('#moodOut').innerHTML = (r.support ? SUPPORT : '') + `<div class="card" style="margin-top:14px"><h2>Your score: ${r.score} of 24</h2><p>That usually means <b>${band}</b>. This is a screening questionnaire, not a diagnosis.</p>
      ${r.support ? '<p>Scores of 10 or more are a good reason to talk with a doctor. Planning enjoyable activities (the "Do something you enjoy" habit) is one proven self-help step.</p>' : '<p>Thanks for checking in. Mood changes; check again in a couple of weeks.</p>'}
      <a class="btn" href="#/today">Back to Today</a></div>`;
    $('#moodOut').scrollIntoView({ block: 'start' });
  };
}

// ================================================================== CHECKS
async function pageChecks() {
  const [S, V, P] = await Promise.all([api('/api/me/games'), api('/api/me/voice'), api('/api/me/progress?days=365')]);
  const rounds = P.speed.length;
  const stat = c => {
    if (c.id === 'speed') return rounds ? `${rounds} round${rounds > 1 ? 's' : ''} · first ${ME.first_speed} · best ${ME.best_speed}` : 'Not played yet';
    if (c.id === 'voice') { const n = V.history.length; return n ? `${n} recording${n > 1 ? 's' : ''}` : 'Not tried yet'; }
    const s = S[c.id]; return s?.plays ? `${s.plays} play${s.plays > 1 ? 's' : ''} · first ${s.history[0]} · last ${s.last}` : 'Not played yet';
  };
  const plays = c => c.id === 'speed' ? rounds : c.id === 'voice' ? V.history.length : S[c.id]?.plays || 0;
  const card = c => `<a class="card checkcard ${c.main ? 'feat' : ''}" href="#/check/${c.id}" style="--c:${c.color}"><span class="ico" aria-hidden="true">${c.ico}</span><h3>${c.name}</h3><span>${c.what}</span>
    <span class="stat">${stat(c)}</span>${plays(c) && plays(c) < 3 ? '<span class="muted">Learning your baseline: play on 3 days to see a trend</span>' : ''}</a>`;
  main.innerHTML = `<div class="stack"><div class="pagehead"><div><div class="eyebrow">Checks</div><h1>How's your thinking today?</h1><p class="sub">Short tasks modeled on real thinking tests. You're compared <b>only with yourself</b>, so changes over weeks mean more than any single score. Not a diagnosis.</p></div></div>
    <div class="grid3 stagger">${CHECKS.filter(c => c.main).map(card).join('')}</div>
    <div class="sectionhead"><h2>More checks</h2></div><div class="grid3 stagger">${CHECKS.filter(c => !c.main).map(card).join('')}</div>
    <p class="note">Honest note: only speed training has trial evidence linked to fewer dementia diagnoses (ACTIVE). Practicing other brain games mostly improves the game itself (Simons 2016).</p></div>`;
}
async function pageCheck(id) {
  if (id === 'speed') {
    main.innerHTML = `<div class="sprint-wrap"><div style="margin-bottom:14px"><a href="#/checks" class="ghost back">← Checks</a></div><div id="sprintBox"></div></div>`;
    return runSprint($('#sprintBox'), {});
  }
  if (id === 'voice') { main.innerHTML = '<div style="margin-bottom:14px"><a href="#/checks" class="ghost back">← Checks</a></div><div id="p-voice"></div>'; return pageVoice(); }
  main.innerHTML = '<div id="p-game"></div>'; return pageGame(id);
}

// ------------------------------------------------------------------ Speed Sprint: race your ghost (your first try)
const SYM = ['◆', '▲', '●', '■', '★', '✚', '⬟', '☾', '♥'];
let G = null;
function STOP_SPRINT() { if (G) G.over = true; G = null; }
function runSprint(box, { onDone, doneLabel }) {
  const ghost = ME?.first_speed;
  box.innerHTML = `<div class="arcade pop" style="--c:#FBBF24"><div class="eyebrow">Speed Sprint · 90 seconds</div><div class="symbol" aria-hidden="true" style="font-size:4.5rem">⚡</div><h2 class="game-title">Match the symbol to its number</h2>
    <p class="muted" style="max-width:560px;margin:0 auto">Look at the big symbol, find it in the key, and tap its number (or press keys 1–9). Go fast, but try not to make mistakes.</p>
    ${ghost != null ? `<p>Race your <b>first try: ${ghost}</b> correct. The grey bar shows your ghost's pace.</p>` : '<p>This round sets your baseline. Later you will race it.</p>'}
    <button class="btn big" id="goBtn" style="max-width:420px">▶ Start</button></div>`;
  $('#goBtn', box).onclick = () => startSprint(box, ghost, onDone, doneLabel);
}
function startSprint(box, ghost, onDone, doneLabel) {
  const d = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - .5);
  G = { key: Object.fromEntries(SYM.map((s, i) => [s, d[i]])), t0: performance.now(), ok: 0, bad: 0, combo: 0, best: 0, tgt: SYM[Math.floor(Math.random() * 9)], over: false, box, ghost, onDone, doneLabel };
  box.innerHTML = `<div class="arcade" style="--c:#FBBF24"><div class="a-top"><div class="a-stat"><small>CORRECT</small><span id="aOk">0</span></div>
      <div class="timer"><svg width="120" height="120" aria-hidden="true"><circle cx="60" cy="60" r="52" stroke="rgba(255,255,255,.08)" stroke-width="8" fill="none"/><circle id="tRing" cx="60" cy="60" r="52" stroke="#5EEAD4" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="326.7"/></svg><div class="t" id="tLeft" aria-label="seconds left">90</div></div>
      <div class="a-stat"><small>MISSES</small><span id="aBad">0</span></div></div>
    ${ghost != null ? `<div class="race"><div class="ghostbar"><span>You</span><div><i id="barYou"></i></div><b id="nYou">0</b></div><div class="ghostbar g"><span>First try</span><div><i id="barGhost"></i></div><b id="nGhost">0</b></div></div>` : ''}
    <div class="symbol" id="sym">${G.tgt}</div><div class="combo" id="combo"></div>
    <div class="keyrow" aria-label="Key">${SYM.slice().sort((a, b) => G.key[a] - G.key[b]).map(s => `<div><b>${s}</b><span>${G.key[s]}</span></div>`).join('')}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}" aria-label="${n}">${n}</button>`).join('')}</div></div>`;
  $$('.pad button', box).forEach(b => b.onclick = () => answer(+b.dataset.n, b));
  tick();
}
function answer(n, btn) {
  if (!G || G.over) return;
  btn = btn || $(`.pad button[data-n="${n}"]`, G.box); btn?.classList.add('hit'); setTimeout(() => btn?.classList.remove('hit'), 100);
  const sym = $('#sym'); sym.classList.remove('ok', 'bad'); void sym.offsetWidth;
  if (G.key[G.tgt] === n) { G.ok++; G.combo++; G.best = Math.max(G.best, G.combo); sym.classList.add('ok'); } else { G.bad++; G.combo = 0; sym.classList.add('bad'); }
  let nx; do { nx = SYM[Math.floor(Math.random() * 9)]; } while (nx === G.tgt); G.tgt = nx; setTimeout(() => { if (G) sym.textContent = G.tgt; }, 90);
  $('#aOk').textContent = G.ok; $('#aBad').textContent = G.bad; $('#combo').textContent = G.combo >= 5 ? `${G.combo} in a row!` : '';
}
addEventListener('keydown', e => { if (G && !G.over && /^[1-9]$/.test(e.key)) answer(+e.key); });
function tick() {
  if (!G || G.over) return;
  const el = (performance.now() - G.t0) / 1000, left = Math.max(0, 90 - el);
  $('#tLeft').textContent = Math.ceil(left); $('#tRing').style.strokeDashoffset = 326.7 * (1 - left / 90); if (left <= 10) $('#tRing').setAttribute('stroke', '#FB7185');
  if (G.ghost != null) { const gNow = Math.floor(G.ghost * Math.min(1, el / 90)), mx = Math.max(G.ghost, G.ok, 1) * 1.1;
    $('#barYou').style.width = G.ok / mx * 100 + '%'; $('#barGhost').style.width = gNow / mx * 100 + '%'; $('#nYou').textContent = G.ok; $('#nGhost').textContent = gNow; }
  if (left <= 0) return endSprint(); setTimeout(tick, 100);
}
async function endSprint() {
  const g = G; g.over = true; const prevBest = ME.best_speed;
  let r; try { r = await api('/api/me/speed', { correct: g.ok, wrong: g.bad, best_combo: g.best }); } catch (e) { toast(e.message); return; }
  ME = r; const acc = g.ok / Math.max(1, g.ok + g.bad);
  const vs = g.ghost == null ? '<p>Baseline set. Next time you race this score.</p>' : `<p>You <b>${g.ok}</b> vs your first try <b>${g.ghost}</b>: ${g.ok > g.ghost ? `${g.ok - g.ghost} more 🎉` : g.ok === g.ghost ? 'a tie' : 'a little behind. Scores bounce around by a few from day to day; the trend over weeks is what matters.'}</p>`;
  g.box.innerHTML = `<div class="arcade pop" style="--c:#FBBF24"><div class="eyebrow">Round complete</div><div class="a-big">${g.ok}</div><div class="muted">correct in 90 seconds · ${(acc * 100).toFixed(0)}% accurate</div>
    ${prevBest != null && g.ok > prevBest ? '<div style="margin-top:10px"><span class="pb">New personal best</span></div>' : ''}${vs}
    ${r.history.length > 1 ? '<div class="chartbox" style="max-width:620px;margin:16px auto"><canvas id="hChart" aria-label="Your Speed Sprint scores over time"></canvas></div>' : ''}
    ${r.history.length < 3 ? '<p class="muted">Learning your baseline: play on 3 days to see a trend.</p>' : ''}
    <div class="row" style="justify-content:center">${g.onDone ? `<button class="btn" id="nextBtn">${g.doneLabel || 'Next'}</button>` : '<button class="btn" id="againBtn">↻ Play again</button><a class="ghost" href="#/checks">Back to Checks</a>'}</div></div>`;
  if (r.history.length > 1) chart('hChart', { type: 'line', data: { labels: r.history.map((_, i) => `#${i + 1}`), datasets: [{ label: 'correct', data: r.history, borderColor: '#5EEAD4', backgroundColor: 'rgba(94,234,212,.12)', fill: true, tension: .35 }] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  $('#nextBtn') && ($('#nextBtn').onclick = g.onDone);
  $('#againBtn') && ($('#againBtn').onclick = () => runSprint(g.box, {}));
  G = null;
}

// ================================================================== MY BRAIN (Learn | Mine)
let ATL = null, BMODE = 'learn', DSEL = null, DSTAGE = 0, MINE = null, PICKBOUND = false;
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const VIEW = { alzheimers: [.9, -.45, .1, true], parkinsons: [1, .1, .1, true], stroke: [-1, .3, .2], huntingtons: [1, .2, .2, true], als: [-.6, 1, .2], ftd: [-.5, .2, 1], ms: [-.8, .3, .7] };
const GROUPS = [['lower', '✅ You can lower your risk'], ['live', '🤝 You can live better with it'], ['early', '🩺 No proven prevention: early help matters']];
async function pageBrain(mode, arg) {
  ATL ||= await api('/api/atlas');
  if (mode === 'mine' || mode === 'learn') BMODE = mode;
  DSEL = mode === 'learn' && arg ? arg : null;
  if (DSEL) DSTAGE = 0;
  const stage = $('#stage');
  if (!brainView) {
    stage.innerHTML = '<div class="stagehint">Drag to turn · tap a part to learn what it does</div>';
    try { const { createBrain } = await import('./brain3d.js?v=2'); brainView = await createBrain(stage); window.NT = { brain: brainView }; }
    catch (e) { stage.innerHTML = `<div class="empty">The 3D brain couldn't load on this device (${esc(e.message)}). Everything else still works.</div>`; }
  }
  brainView?.start();
  if (brainView && !PICKBOUND) { PICKBOUND = true; bindPick(); }
  if (BMODE === 'mine') MINE = await api('/api/me/brain');
  main.innerHTML = `<div class="brainpane"><div class="eyebrow">My Brain</div><h1>Explore a real 3D brain</h1>
    <div class="seg" role="tablist"><button role="tab" aria-selected="${BMODE === 'learn'}" class="${BMODE === 'learn' ? 'on' : ''}" data-m="learn">Learn</button><button role="tab" aria-selected="${BMODE === 'mine'}" class="${BMODE === 'mine' ? 'on' : ''}" data-m="mine">Mine</button></div>
    <div id="bp"></div><div id="rinfo" class="regioninfo" aria-live="polite"></div></div>`;
  $$('.seg button').forEach(b => b.onclick = () => { location.hash = `#/brain/${b.dataset.m}`; });
  BMODE === 'learn' ? (DSEL ? diseaseDetail() : learnList()) : mineView();
}
const RN = () => Object.fromEntries(ATL.regions.map(r => [r.id, r]));
function learnList() {
  brainView?.set({}, false); brainView?.home();
  $('#bp').innerHTML = `<p>Seven brain diseases: <b>which parts each one affects</b>, how it changes over time, and <b>what you can do at home</b>.</p>
    ${GROUPS.map(([g, t]) => `<div class="dgroup"><h3>${t}</h3>${ATL.diseases.filter(d => d.group === g).map(d => `<a class="dbtn" href="#/brain/learn/${d.id}"><span aria-hidden="true">${d.icon}</span><div>${esc(d.name)}<small>${esc(d.what.split('. ')[0])}.</small></div></a>`).join('')}</div>`).join('')}
    <h3 style="margin-top:22px">Myth or fact? <span class="muted">(tap a card)</span></h3>
    <div class="grid3">${MYTHS.map((m, i) => `<button class="myth" data-my="${i}"><b>Myth:</b> ${m[0]}</button>`).join('')}</div>`;
  $$('[data-my]').forEach(b => b.onclick = () => { const m = MYTHS[+b.dataset.my]; b.classList.add('flip'); b.innerHTML = `<b>Fact:</b> ${m[1]} <a href="${m[2]}" target="_blank" rel="noopener">source ↗</a>`; });
}
const MYTHS = [
  ['Dementia is a normal part of getting old.', 'Dementia is caused by diseases. Many people live into their 90s without it.', 'https://www.alz.org/alzheimers-dementia/what-is-alzheimers/myths'],
  ['Nothing can be done to lower dementia risk.', 'About 45% of cases are linked to 14 changeable factors, like blood pressure and hearing.', LANCET_URL],
  ['Brain-training games prevent dementia.', 'Practice mostly improves the practiced game. Speed training is the one type linked to fewer diagnoses in a trial.', 'https://doi.org/10.1177/1529100616661983'],
  ['A stroke only happens to old people.', 'Strokes can happen at any age. Know BE-FAST and call 911 right away.', 'https://pubmed.ncbi.nlm.nih.gov/28082668/'],
];
function diseaseDetail() {
  const d = ATL.diseases.find(x => x.id === DSEL); if (!d) { DSEL = null; return learnList(); }
  const st = d.stages[Math.min(DSTAGE, d.stages.length - 1)], N = RN(), deep = d.stages.slice(0, DSTAGE + 1).some(s => s.regions.some(r => !r.startsWith('c')));
  $('#bp').innerHTML = `<a class="ghost back" href="#/brain/learn">← All diseases</a>
    <div class="card pop" style="margin-top:14px;border-color:${d.color}88;box-shadow:var(--shadow),0 0 40px -18px ${d.color}"><div class="habithead"><span class="ico-tile lg" aria-hidden="true" style="background:${d.color}33;border-color:${d.color}77">${d.icon}</span><h2 style="margin:0">${esc(d.name)}</h2></div><p>${esc(d.what)}</p>
    <h3>Where in the brain</h3>
    ${d.stages.length > 1 ? `<label for="stageSlider" class="muted">Typical order of spread (approximate; it varies from person to person)</label>
      <input type="range" id="stageSlider" min="0" max="${d.stages.length - 1}" value="${DSTAGE}" aria-valuetext="${esc(st.label)}">
      <div class="stagelbls">${d.stages.map((s, i) => `<span class="${i === DSTAGE ? 'on' : ''}">${esc(s.label)}</span>`).join('')}</div>` : ''}
    <div class="bubble" style="margin-top:8px"><b>${esc(st.label)}</b>${st.when ? ` · ${esc(st.when)}` : ''}<br>${esc(st.symptoms || '')}
      <div class="muted" style="margin-top:6px">Highlighted: ${st.regions.map(r => N[r]?.name).filter(Boolean).slice(0, 6).map(esc).join(', ')}${st.regions.length > 6 ? '…' : ''}${deep ? ' (the see-through view shows deep parts)' : ''}</div></div>
    <h3>How it varies</h3><p>${esc(d.varies)}</p>
    ${d.id === 'stroke' ? `<h3>Spot a stroke: BE-FAST</h3><div class="befast">${[['B', 'Balance loss'], ['E', 'Eyes: vision loss'], ['F', 'Face drooping'], ['A', 'Arm weakness'], ['S', 'Speech trouble'], ['T', 'Time: call 911']].map(([l, t]) => `<div><b>${l}</b>${t}</div>`).join('')}</div>` : ''}
    <h3>What you can do at home</h3>${d.home.map(h => `<div class="lever"><b>${esc(h.do)}</b>${h.mission && HABIT[h.mission] ? `<a class="ghost" href="#/habit/${h.mission}">Habit →</a>` : h.game ? `<a class="ghost" href="#/check/${h.game}">Check →</a>` : '<span></span>'}<span class="muted" style="grid-column:1/-1">${esc(h.why)} <a href="${h.url}" target="_blank" rel="noopener">source ↗</a></span></div>`).join('')}
    <div class="support-card warn" style="margin-top:14px"><b>🩺 When to call a doctor:</b> ${esc(d.doctor)}</div>
    <p class="muted">Source: <a href="${d.source[1]}" target="_blank" rel="noopener">${esc(d.source[0])} ↗</a>. Regions are mapped to the nearest areas of a standard brain atlas, so the picture is a guide, not a scan of anyone.</p></div>`;
  $('#stageSlider') && ($('#stageSlider').oninput = e => { DSTAGE = +e.target.value; diseaseDetail(); $('#stageSlider')?.focus(); });
  const colors = {}, c = hex(d.color);
  d.stages.forEach((s, i) => { if (i > DSTAGE) return; for (const r of s.regions) colors[r] = [...c, i === DSTAGE ? .85 : .45]; });
  brainView?.set(colors, deep);
  const v = VIEW[d.id] || [-1, .2, .3]; brainView?.fly(v[0], v[1], v[2], !!v[3]);
}
function mineView() {
  const S = MINE.skills;
  const C = { learning: '#7D87A3', improving: '#4ADE80', steady: '#5EEAD4', dipping: '#FBBF24' };
  const st = s => s.plays < 3 ? 'learning' : s.status === 'baseline' ? 'steady' : s.status;
  const W = { learning: 'learning your baseline', improving: 'improving', steady: 'steady', dipping: 'dipping: worth keeping an eye on' };
  const colors = {};
  for (const s of S) { if (!s.plays) continue; const sk = ATL.skills.find(x => x.id === s.id); for (const r of sk.regions) colors[r] = [...hex(C[st(s)]), .8]; }
  brainView?.set(colors, true); brainView?.fly(-1, .35, .55);
  const link = { memory: '#/check/recall', speed: '#/check/speed', movement: '#/check/reaction', language: '#/check/fluency', spatial: '#/check/corsi' };
  $('#bp').innerHTML = `<div class="card"><h2>Your skills map</h2><p>Each skill is linked to brain areas by decades of research. We color those areas from <b>your checks</b>, compared only with your own first tries. Grey until you've played 3 times.</p>
    ${S.map(s => `<div class="lever"><b>${s.icon} ${esc(s.name)}</b><span class="size" style="background:${C[st(s)]}33;color:${C[st(s)]}">${s.plays ? W[st(s)] : 'not tested'}</span>
      <span class="muted" style="grid-column:1/-1">${s.plays} play${s.plays === 1 ? '' : 's'} · <a href="${link[s.id] || '#/checks'}">${s.plays ? 'play again' : 'test it'}</a></span></div>`).join('')}
    <p class="muted">A game score tracks a skill, not brain tissue. A steady dip over weeks is worth mentioning to a doctor; one bad day isn't.</p></div>
    <div class="card" style="margin-top:16px"><div class="eyebrow">Research preview</div><h2>🩻 MRI scans</h2>
      <p>We tested our own MRI measures on 436 real scans and <b>they weren't reliable enough</b> to put a number on your brain. So here you can <b>learn from real research scans</b>, and check that your own file opens.</p>
      <div class="seg"><button class="on" data-mr="sample">Try a real research scan</button><button data-mr="upload">Upload my scan</button></div><div id="mriBox"></div></div>`;
  const show = m => { $$('[data-mr]').forEach(b => b.classList.toggle('on', b.dataset.mr === m)); m === 'sample' ? mriSamples() : mriUpload(); };
  $$('[data-mr]').forEach(b => b.onclick = () => show(b.dataset.mr));
  api('/api/mri/status').then(s => {
    if (s.samples) return show('sample');
    const sb = $('[data-mr="sample"]'); if (sb) { sb.disabled = true; sb.title = 'Research scans not downloaded'; }
    show('upload');
    $('#mriBox')?.insertAdjacentHTML('afterbegin', '<p class="muted">The real research scans aren\'t downloaded on this computer (they need a free Kaggle account: <code>python data/download_data.py</code>). You can still check your own file.</p>');
  }).catch(() => show('upload'));
}
async function mriSamples() {
  const list = await api('/api/mri/samples'), box = $('#mriBox');
  box.innerHTML = `<p class="muted">From the OASIS-1 study (Washington University). Pick one person:</p><div class="chips">${list.map(s => `<button class="chip" data-f="${esc(s.file)}">${s.female ? '♀' : '♂'} ${Math.round(s.Age)} y · ${s.status === 'cognitively normal' ? 'healthy volunteer' : 'dementia diagnosis'}</button>`).join('')}</div><div id="mriOut" aria-live="polite"></div>`;
  $$('[data-f]', box).forEach(b => b.onclick = async () => {
    $$('[data-f]', box).forEach(x => x.classList.toggle('on', x === b));
    $('#mriOut').innerHTML = '<p class="muted">Loading the real scan…</p>';
    const fd = new FormData(); fd.append('file', b.dataset.f);
    try {
      const r = await postForm('/api/me/mri/sample', fd), v = r.view;
      $('#mriOut').innerHTML = `<div class="mslices" style="margin-top:12px">${Object.entries(r.images).map(([k, src]) => `<img src="${src}" alt="${k} slice of the scan">`).join('')}</div>
        <h3>${r.female ? 'Woman' : 'Man'}, ${Math.round(r.age)} · ${r.status === 'cognitively normal' ? 'healthy volunteer' : `dementia diagnosis${r.cdr ? ` (CDR ${r.cdr})` : ''}`}</h3>
        <p>Using OASIS's own validated brain-volume measure, about <b>${v.per100_lower} of 100</b> healthy people the same age and sex have even less brain tissue than this person.</p>
        <div class="bubble"><b>The lesson:</b> even this validated measure, at our best cut-off, flags about <b>${v.healthy_flag_per100} of 100</b> healthy people over 60, but only <b>${v.dementia_flag_per100} of 100</b> people with dementia. ${v.flag ? 'This scan is past the cut-off.' : 'This scan is not past the cut-off.'} One MRI number can't screen a person. That's why we don't score uploads.</div>`;
    } catch (e) { $('#mriOut').innerHTML = `<p class="caveat">${esc(e.message)}</p>`; }
  });
}
function mriUpload() {
  $('#mriBox').innerHTML = `<label class="drop" id="mdrop"><input type="file" id="mfile" accept=".nii,.gz" hidden><span style="font-size:2rem" aria-hidden="true">📂</span><b>Choose a NIfTI file (.nii or .nii.gz)</b><span class="muted">It stays on this computer.</span></label><div id="mriOut" aria-live="polite"></div>`;
  const up = async f => {
    $('#mriOut').innerHTML = '<p class="muted">Reading your file…</p>';
    const fd = new FormData(); fd.append('file', f);
    try {
      const r = await postForm('/api/me/mri/upload', fd), F = r.format;
      $('#mriOut').innerHTML = `${Object.keys(r.images).length ? `<div class="mslices">${Object.entries(r.images).map(([k, src]) => `<img src="${src}" alt="${k} slice of your scan">`).join('')}</div>` : ''}
        <p>${F.ok ? '✅ Your file opened and matches the research format (skull-stripped, standard space).' : `⚠ ${esc((F.issues || []).join(" ") || 'This file is not in the research format our tools expect.')}`}</p>
        <div class="bubble">We <b>won't put a number on your scan</b>. Our hippocampus, ventricle and whole-brain measures all failed our accuracy and repeat-scan tests. A radiologist's report on your scan is the trustworthy source. <a href="#/me/how">See the test results</a>.</div>`;
    } catch (e) { $('#mriOut').innerHTML = `<p class="caveat">${esc(e.message)}</p>`; }
  };
  $('#mfile').onchange = e => e.target.files[0] && up(e.target.files[0]);
  const d = $('#mdrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over'); d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); e.dataTransfer.files[0] && up(e.dataTransfer.files[0]); };
}
function bindPick() {
  let down = null; const cv = brainView.canvas;
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', e => {
    if (ROUTE !== 'brain' || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const rid = brainView.pick(e.clientX, e.clientY), r = rid && RN()[rid]; if (!r) return;
    const hits = ATL.diseases.filter(d => d.stages.some(s => s.regions.includes(rid))).map(d => `${d.icon} ${esc(d.name.replace(' (motor neurone disease)', ''))}`);
    $('#rinfo').innerHTML = `<div class="card pop" style="position:relative"><button class="close" id="rclose" aria-label="Close">✕</button><div class="eyebrow">${r.kind === 'cortex' ? 'Outer layer (cortex)' : r.kind === 'fluid' ? 'Fluid space' : 'Deep structure'}</div>
      <h3 style="padding-right:50px">${esc(r.name)}</h3><p>${esc(r.function || '')}</p>${hits.length ? `<p class="muted">Affected in: ${hits.join(', ')}</p>` : ''}</div>`;
    $('#rclose').onclick = () => { $('#rinfo').innerHTML = ''; };
  });
}

// ================================================================== ME
async function pageMe(section) {
  FACTS ||= await api('/api/facts');
  main.innerHTML = `<div class="stack"><div class="mehead"><span class="av" aria-hidden="true">${esc((AUTH.name || '?').trim()[0]?.toUpperCase() || '?')}</span><div><div class="eyebrow">Me</div><h1>${esc(AUTH.name || 'You')}</h1><span class="tag">${AUTH.passkey ? '🔑 Saved with a passkey' : '⚠ Not saved yet'}</span></div></div>
    <nav class="chips sticky" aria-label="Sections">${[['progress', '📈 Progress'], ['connect', '⌚ Connect a device'], ['answers', '📝 My answers'], ['security', '🔑 Security'], ['how', '🔬 How we know'], ['help', '💛 Support']].map(([k, t]) => `<a class="chip" href="#/me/${k}">${t}</a>`).join('')}</nav>
    <section class="card" id="s-progress"><h2>📈 Progress</h2><div class="grid" id="charts"></div></section>
    <section class="card" id="s-connect"><h2>⌚ Connect a device</h2><div id="wbox"></div></section>
    <section class="card" id="s-answers"><h2>📝 My answers</h2><div id="abox"></div></section>
    <section class="card" id="s-security"><h2>🔑 Security</h2>
      ${AUTH.passkey ? '<p>✅ Saved with a passkey. You sign in with your fingerprint, face or device PIN. There is no password to steal.</p>' : '<p>⚠ Not saved yet. This browser session is your only way back in.</p>'}
      <div class="row"><button class="btn" id="addPk">${AUTH.passkey ? 'Add another passkey' : 'Save with a passkey'}</button><button class="ghost" id="signout">Sign out</button></div>
      <p class="muted">Passkeys (WebAuthn / FIDO2) are bound to this site, so a look-alike site can't phish them. Your health data is stored in a local SQLite database on this computer.</p></section>
    <section class="card" id="s-how"><h2>🔬 How we know</h2>${howWeKnow()}</section>
    <section class="card" id="s-help"><h2>💛 Support</h2><ul class="help-list"><li><b>988</b><span>Call or text the US Suicide & Crisis Lifeline, 24/7.</span></li><li><b>911</b><span>Emergencies, including any stroke sign (BE-FAST).</span></li>
      <li><b>1-800-QUIT-NOW</b><span>Free help to stop smoking (CDC).</span></li><li><b>1-800-272-3900</b><span>Alzheimer's Association 24/7 helpline, for memory worries and caregivers.</span></li></ul></section></div>`;
  $('#addPk').onclick = () => savePasskey(() => pageMe('security'));
  $('#signout').onclick = async () => { if (!AUTH.passkey && !confirm('You have not saved a passkey. If you sign out, you cannot get back to this progress. Sign out anyway?')) return; await api('/auth/logout', {}); AUTH = { signed_in: false }; renderWho(); history.replaceState(null, '', '/'); route(); };
  answersBox(); progressCharts(); wearBox();
  if (section) setTimeout(() => $('#s-' + section)?.scrollIntoView({ block: 'start' }), 60);
}
function howWeKnow() {
  const F = FACTS, N = F.nhanes, O = F.oasis;
  return `<h3>What NeuroTrail is for</h3><div class="tablewrap"><table class="t"><tr><th>It is</th><th>It is not</th></tr>
    <tr><td>A habit coach built on published evidence</td><td>A diagnosis or a dementia risk score</td></tr>
    <tr><td>Personal tracking against your own first tries</td><td>A comparison with other people's scores</td></tr>
    <tr><td>Education about how brain diseases affect the brain</td><td>A reading of your MRI</td></tr></table></div>
    <h3>Model 1: habits and thinking speed (CDC NHANES 2011–2014)</h3>
    <p>${N.complete_cases.toLocaleString()} adults 60+ with complete answers. Survey-weighted regression on the Digit Symbol test (0–133 points). Adding habits to age, sex, education and income improved prediction from R² ${N.r2_demographics.toFixed(2)} to ${N.r2_full.toFixed(2)} (cross-validated).</p>
    <div class="tablewrap"><table class="t"><tr><th>Change</th><th>Points on the test</th><th>Clear link?</th></tr>${N.contrasts.map(c => `<tr><td>${esc(c.label)}</td><td>${fmt(c.dsst_points)} (${fmt(c.dsst_ci[0])} to ${fmt(c.dsst_ci[1])})</td><td>${c.p_value < .05 ? 'Yes' : 'No'} (p=${c.p_value.toPrecision(2)})</td></tr>`).join('')}</table></div>
    <p class="muted">Fairness check: the prediction model's average error differs by group (${Object.entries(N.fairness_mean_bias).map(([g, b]) => `${esc(g)} ${fmt(b)}`).join(', ')} points), so we only use these numbers for "what if" comparisons within one person, never to rank people.</p>
    <h3>Model 2: real MRI scans (OASIS-1, ${O.volumes} volumes)</h3>
    <p>${O.people} people plus ${O.rescans} repeat scans (${esc(O.rescan_note)}). OASIS's validated brain-volume measure separates dementia from healthy scans with AUC ${F.nwbv_model.auc.toFixed(2)} (95% CI ${F.nwbv_model.auc_ci.map(x => x.toFixed(2)).join('–')}): useful for research, not for screening one person.</p>
    <h3>What we built, tested and removed</h3>
    ${F.removed.map(r => `<div class="lever"><b>❌ ${esc(r.what)}</b><span></span><span class="muted" style="grid-column:1/-1">${esc(r.why)}</span></div>`).join('')}
    <p class="muted">Every number in this section is read from <code>models/artifacts/facts.json</code>, written by the training scripts in the repository.</p>`;
}
function answersBox() {
  const p = { ...ME.profile }, box = $('#abox');
  const yn = (k, label) => `<div class="q"><b>${label}</b><div class="yesno" data-k="${k}"><button data-v="1" class="${p[k] ? 'on' : ''}">Yes</button><button data-v="0" class="${p[k] ? '' : 'on'}">No</button></div></div>`;
  box.innerHTML = `<p class="muted">Change these any time. Habits you log in the last 7 days take priority (for blood pressure and sleep).</p>
    <div class="q"><b>Blood pressure (top number)</b>${p.sbp == null ? '<p class="muted">Unknown. <button class="linkbtn" id="setBp">Add my reading</button></p><div id="bpS"></div>' : stepper('aSbp', Math.round(p.sbp), ' mmHg', 'Blood pressure')}</div>
    <div class="q"><b>Usual sleep</b>${stepper('aSleep', p.sleep_hours ?? 7, ' h', 'Sleep')}</div>
    ${yn('diabetes', 'Diabetes')}${yn('current_smoker', 'Smoke now')}${yn('hearing_trouble', 'Trouble hearing')}
    <button class="btn" id="saveAns">Save my answers</button>`;
  const wireBp = () => wireStepper(box, 'aSbp', () => p.sbp, v => { p.sbp = v; }, { min: 80, max: 220, step: 1, unit: ' mmHg' });
  if (p.sbp != null) { p.sbp = Math.round(p.sbp); wireBp(); }
  $('#setBp') && ($('#setBp').onclick = () => { p.sbp = 125; $('#bpS').innerHTML = stepper('aSbp', 125, ' mmHg', 'Blood pressure'); wireBp(); });
  wireStepper(box, 'aSleep', () => p.sleep_hours ?? 7, v => { p.sleep_hours = v; }, { min: 2, max: 12, step: .5, unit: ' h' });
  $$('.yesno', box).forEach(g => choice(g, 'button', v => { p[g.dataset.k] = v === '1'; }));
  $('#saveAns').onclick = async () => { ME = await api('/api/me/profile', { sbp: p.sbp, sleep_hours: p.sleep_hours, diabetes: p.diabetes, current_smoker: p.current_smoker, hearing_trouble: p.hearing_trouble }); toast('Saved ✓'); };
}
async function progressCharts() {
  const P = await api('/api/me/progress?days=30'), box = $('#charts'), sh = d => d.slice(5), bp = P.bp.filter(b => b.value != null);
  box.innerHTML = [
    `<div><h3>⚡ Speed Sprint</h3><p class="muted">Correct answers in 90 seconds. Compared only with you.</p>${P.speed.length ? '<div class="chartbox"><canvas id="cSpeed"></canvas></div>' : '<div class="empty">Play a Speed Sprint to start this chart.</div>'}</div>`,
    `<div><h3>🩺 Blood pressure</h3><p class="muted">Top number. Trial target: under 120 (SPRINT MIND).</p>${bp.length ? '<div class="chartbox"><canvas id="cBP"></canvas></div>' : '<div class="empty">Log a reading in the blood pressure habit.</div>'}</div>`,
    `<div><h3>👟 Steps</h3><p class="muted">Dashed lines at 3,826 and 9,826 steps.</p>${P.steps.length ? '<div class="chartbox"><canvas id="cSteps"></canvas></div>' : '<div class="empty">Log steps in the walking habit.</div>'}</div>`,
    `<div><h3>🌙 Sleep</h3><p class="muted">Hours per night.</p>${P.sleep.length ? '<div class="chartbox"><canvas id="cSleep"></canvas></div>' : '<div class="empty">Log sleep in the sleep habit.</div>'}</div>`,
  ].join('') + `<p class="muted" style="grid-column:1/-1">${P.totals.quests} habits logged · ${P.totals.active_days} active days · ${P.totals.streak}-day streak</p>`;
  const line = (id, labels, data, color, extra = []) => chart(id, { type: 'line', data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + '33', fill: true, tension: .3, label: 'you' }, ...extra] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  if (P.speed.length) line('cSpeed', P.speed.map(r => sh(r.date)), P.speed.map(r => r.correct), '#5EEAD4');
  if (bp.length) line('cBP', bp.map(b => sh(b.date)), bp.map(b => b.value), '#FB7185', [{ data: bp.map(() => 120), borderColor: '#4ADE80', borderDash: [6, 4], pointRadius: 0, label: 'target 120' }]);
  if (P.steps.length) line('cSteps', P.steps.map(s => sh(s.date)), P.steps.map(s => s.value), '#4ADE80', [{ data: P.steps.map(() => 3826), borderColor: '#FBBF24', borderDash: [6, 4], pointRadius: 0 }, { data: P.steps.map(() => 9826), borderColor: '#A78BFA', borderDash: [6, 4], pointRadius: 0 }]);
  if (P.sleep.length) line('cSleep', P.sleep.map(s => sh(s.date)), P.sleep.map(s => s.value), '#A78BFA');
}
async function wearBox() {
  const W = await api('/api/me/wearables'), S = W.summary, days = Object.entries(W.days), box = $('#wbox');
  box.innerHTML = `<p>Bring in steps and sleep from your phone or watch to <b>see</b> them here. (Watch sleep is shown, not fed into the survey model, which was built on self-reported sleep.)</p>
    <label class="drop" id="wdrop"><input type="file" id="wfile" accept=".zip,.xml,.csv" hidden><span style="font-size:2rem" aria-hidden="true">⌚</span><b>Choose your Apple Health export.zip</b><span class="muted">or a CSV with a date column and steps / sleep_hours</span></label>
    <p class="muted">iPhone: Health app → your photo → Export All Health Data.</p><div id="wmsg" aria-live="polite"></div>
    ${S.days_with_data ? `<div class="vstats">${S.steps != null ? `<div><b>${Math.round(S.steps).toLocaleString()}</b><span>steps a day</span></div>` : ''}${S.sleep_hours != null ? `<div><b>${S.sleep_hours.toFixed(1)} h</b><span>sleep a night</span></div>` : ''}${S.resting_hr != null ? `<div><b>${Math.round(S.resting_hr)}</b><span>resting heart rate</span></div>` : ''}</div>
      <p class="muted">${S.days_with_data} days imported (${S.from} to ${S.to}).</p><div class="chartbox"><canvas id="wch"></canvas></div>` : ''}`;
  if (days.length) chart('wch', { type: 'bar', data: { labels: days.map(d => d[0].slice(5)), datasets: [{ label: 'steps', data: days.map(d => d[1].steps ?? null), backgroundColor: 'rgba(74,222,128,.7)', borderRadius: 8 }] }, options: chartOpts() });
  const up = async f => { $('#wmsg').innerHTML = '<p class="muted">Reading your file… (large exports can take a minute)</p>';
    const fd = new FormData(); fd.append('file', f);
    try { const j = await postForm('/api/me/wearables', fd); ME = j.player; toast(`Imported ${j.imported_days} days ✓`); wearBox(); } catch (e) { $('#wmsg').innerHTML = `<p class="caveat">⚠ ${esc(e.message)}</p>`; } };
  $('#wfile').onchange = e => e.target.files[0] && up(e.target.files[0]);
  const d = $('#wdrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over'); d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); e.dataTransfer.files[0] && up(e.dataTransfer.files[0]); };
}

// ================================================================== BOOT
window.NTX = { api, toast, chart, chartOpts, fmt, renderHUD: renderWho, QMAP: () => QMAP, getME: () => ME, setME: m => { ME = m; } };
(async () => {
  applySettings();
  try { AUTH = await api('/auth/me'); } catch { AUTH = { signed_in: false }; }
  await loadQuests().catch(() => {});
  route();
})();
