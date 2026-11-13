// NeuroTrail v4 front end: one 3-minute session a day. Tabs: Today, Train, Learn, You.
// Every number comes from the Python API (trained models, SQLite, real datasets). Nothing is made up here.
import { pageGame, stopGames } from './gym.js?v=9';
import { pageVoice, stopVoice } from './ui2.js?v=7';

// Passkeys are bound to "localhost", and browsers refuse them on raw IPs, so send 127.0.0.1 visitors to localhost.
if (['127.0.0.1', '[::1]'].includes(location.hostname)) location.replace(location.href.replace(location.hostname, 'localhost'));

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x, d = 1) => (x > 0 ? '+' : '') + Number(x).toFixed(d);
const ic = (n, cls = '') => `<i class="ti ti-${n} ${cls}" aria-hidden="true"></i>`;
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
if (window.Chart) {
  Object.assign(Chart.defaults, { color: '#5F5E58' }); Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.elements.point.radius = 3; Chart.defaults.elements.line.borderWidth = 2.5;
  Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: '#1F1E1B', padding: 12, cornerRadius: 12 });
}
const chartOpts = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, animation: calm() ? false : undefined, plugins: { legend: { labels: { usePointStyle: true, font: { size: 14 } } } },
  scales: { x: { ticks: { maxRotation: 0, autoSkip: true, font: { size: 13 } }, grid: { display: false }, border: { display: false } }, y: { ticks: { font: { size: 13 } }, grid: { color: '#ECEAE4' }, border: { display: false } } }, ...extra });
const chart = (id, cfg) => { charts[id]?.destroy(); const el = document.getElementById(id); if (el) charts[id] = new Chart(el, cfg); };
const main = $('#main');

let AUTH = null, ME = null, QUESTS = [], QMAP = {}, FACTS = null, COACH = null, ROUTE = 'today', AFTER_GAME = null;

// ------------------------------------------------------------------ names, icons
const HABIT = {
  bp: { name: 'Check your blood pressure', short: 'Blood pressure', icon: 'heart-rate-monitor', tint: 'rose', ring: 'Body' },
  steps: { name: 'Take a walk', short: 'Walk', icon: 'walk', tint: 'green', ring: 'Move' },
  connect: { name: 'Talk with someone', short: 'Talk with someone', icon: 'message-circle', tint: 'blue', ring: 'Mind' },
  hearing: { name: 'Look after your hearing', short: 'Hearing', icon: 'ear', tint: 'violet', ring: 'Body' },
  joy: { name: 'Do something you enjoy', short: 'Something you enjoy', icon: 'mood-smile', tint: 'amber', ring: 'Mind' },
  smoke: { name: 'Smoke-free day', short: 'Smoke-free', icon: 'smoking-no', tint: 'rose', ring: 'Body' },
  sleep: { name: 'Sleep on a schedule', short: 'Sleep', icon: 'moon', tint: 'violet', ring: 'Body' },
  labs: { name: 'Know your numbers', short: 'Know your numbers', icon: 'flask', tint: 'blue', ring: 'Body' },
  mood: { name: 'Mood check', short: 'Mood check', icon: 'heart', tint: 'rose', ring: 'Mind' },
};
const FACTOR_HABIT = { sbp: 'bp', diabetes: 'labs', current_smoker: 'smoke', sleep_dev: 'sleep', phq9: 'mood', active_min_week: 'steps' };
const CHECKS = [
  { id: 'speed', name: 'Speed Sprint', icon: 'bolt', tint: 'amber', what: 'Match symbols to numbers', time: '90 s' },
  { id: 'stroop', name: 'Color Clash', icon: 'palette', tint: 'rose', what: 'Tap the ink color, not the word', time: '45 s' },
  { id: 'corsi', name: 'Memory Grid', icon: 'grid-dots', tint: 'violet', what: 'Repeat the lit squares', time: '2 min' },
  { id: 'reaction', name: 'Reflex', icon: 'hand-click', tint: 'green', what: 'Tap the moment it turns green', time: '30 s' },
  { id: 'trails', name: 'Trail Connect', icon: 'route', tint: 'teal', what: 'Tap numbers and letters in order', time: '1 min' },
  { id: 'fluency', name: 'Animal Naming', icon: 'paw', tint: 'green', what: 'Name animals for 60 seconds', time: '1 min' },
  { id: 'recall', name: 'Word Recall', icon: 'list-details', tint: 'blue', what: 'Learn 10 words, then find them', time: '3 min' },
  { id: 'voice', name: 'Voice check', icon: 'microphone', tint: 'rose', what: 'Read aloud; we measure your pace', time: '1 min' },
];
const CHECK_BY = Object.fromEntries(CHECKS.map(c => [c.id, c]));
// Daily game rotation: Speed Sprint (the one with trial evidence) every other day.
const ROTATION = ['speed', 'stroop', 'speed', 'corsi', 'speed', 'reaction', 'speed', 'trails', 'speed', 'fluency'];
const dayNum = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return Math.floor((d - d.getTimezoneOffset() * 6e4) / 864e5); };
const gameOfDay = (offset = 0) => ROTATION[dayNum(offset) % ROTATION.length];
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const habitFlag = () => 'nt-habit-' + localDay();

// Lancet Commission 2024 (Livingston et al.): weighted population attributable fractions, % of dementia cases.
const LANCET = [
  ['hearing', 'Hearing loss', 7], ['ldl', 'High LDL cholesterol', 7], ['edu', 'Less education', 5], ['isolation', 'Social isolation', 5],
  ['depression', 'Depression', 3], ['tbi', 'Head injury', 3], ['air', 'Air pollution', 3], ['inactivity', 'Physical inactivity', 2],
  ['smoking', 'Smoking', 2], ['diabetes', 'Diabetes', 2], ['bp', 'High blood pressure', 2], ['vision', 'Untreated vision loss', 2],
  ['obesity', 'Obesity', 1], ['alcohol', 'Too much alcohol', 1]];
const LANCET_URL = 'https://doi.org/10.1016/S0140-6736(24)01296-0';
const SUPPORT = `<div class="support-card" role="alert"><h2>You don't have to carry this alone</h2>
  <p>If you're struggling, <b>call or text 988</b> (free, 24/7) or chat at <a href="https://988lifeline.org" target="_blank" rel="noopener">988lifeline.org</a>. In an emergency, call <b>911</b>.</p>
  <p>Low mood is common and treatable. NeuroTrail is not treatment, and no person reads your answers.</p></div>`;
const HELP = `<p>NeuroTrail is not watched by a person. If you need help now:</p><ul class="help-list">
  <li><b>988</b><span>Call or text the Suicide & Crisis Lifeline, 24/7</span></li><li><b>911</b><span>Emergencies, including any stroke sign</span></li>
  <li><b>1-800-QUIT-NOW</b><span>Free help to stop smoking</span></li><li><b>1-800-272-3900</b><span>Alzheimer's Association helpline, 24/7</span></li></ul>`;

// ------------------------------------------------------------------ settings, sheet, chrome
function applySettings() {
  document.documentElement.style.setProperty('--scale', +(store.get('nt-size') || 1));
  document.body.classList.toggle('calm', store.get('nt-calm') === '1');
}
const bodyClass = r => { document.body.className = 'r-' + r + (store.get('nt-calm') === '1' ? ' calm' : ''); };
function sheet(title, html) {
  closeSheet();
  const d = document.createElement('div'); d.className = 'sheet-back';
  d.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div>
    <div class="sheet-h"><h2>${esc(title)}</h2><button class="iconbtn" data-x aria-label="Close">${ic('x')}</button></div><div>${html}</div></div>`;
  d.onclick = e => { if (e.target === d || e.target.closest('[data-x]')) closeSheet(); };
  document.body.appendChild(d); $('[data-x]', d).focus();
}
const closeSheet = () => $('.sheet-back')?.remove();
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
const WHY = {};
const whyBtn = (key, label = 'Why?') => `<button class="why" data-why="${key}">${ic('info-circle')}${label}</button>`;
document.addEventListener('click', e => { const b = e.target.closest('[data-why]'); if (b && WHY[b.dataset.why]) { const [t, h] = WHY[b.dataset.why]; sheet(t, typeof h === 'function' ? h() : h); } });
$('#helpBtn').onclick = () => sheet('Help is here', HELP);

function renderWho() {
  const banner = $('#demoBanner'), demo = AUTH?.signed_in && AUTH.demo;
  if (demo && !banner) $('.top').insertAdjacentHTML('afterend', '<div id="demoBanner" class="demobanner" role="note"><b>Demo person.</b> Everything here is made-up data.</div>');
  else if (!demo) banner?.remove();
}
async function refresh() { ME = await api('/api/me'); return ME; }
const firstName = () => AUTH?.name && !/^(guest|demo)/i.test(AUTH.name) ? AUTH.name.split(' ')[0] : '';

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
const sizeCls = s => ({ 'On target': 'ontarget', Unknown: 'unknown', 'Not shown in data': 'notshown' }[s] || s);
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
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
  return { youN, html: `<div class="icons" role="img" aria-label="100 people: 45 linked to changeable factors, ${youN} of them to factors you told us about">${cells.map(c => `<i class="${c}"></i>`).join('')}</div>
    <div class="legend"><span style="--c:#D97706">Linked to your answers</span><span style="--c:#A7C7C2">Other changeable factors</span><span style="--c:var(--surface-3)">Not changeable</span></div>` };
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
const doneToday = id => ME.trail?.[id] === 'done';
function confetti() {
  if (calm()) return '';
  const C = ['#0F766E', '#14B8A6', '#D97706', '#BE123C', '#6D28D9', '#1D4ED8'];
  return Array.from({ length: 28 }, (_, i) => { const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 140;
    return `<i style="background:${C[i % C.length]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 40}px;--r:${Math.random() * 720 - 360}deg;animation-delay:${Math.random() * 120}ms"></i>`; }).join('');
}

// ------------------------------------------------------------------ ROUTER
const routes = { today: pageToday, session: pageSession, habit: pageHabit, checks: pageChecks, check: pageCheck, sprint: () => pageCheck('speed'), brain: pageBrain, me: pageMe };
const TAB = { session: 'today', habit: 'today', check: 'checks', sprint: 'checks' };
let brainView = null;
async function route() {
  STOP_SPRINT(); stopGames(); stopVoice(); AFTER_GAME = null; closeSheet();
  if (!AUTH?.signed_in) return pageWelcome();
  if (!AUTH.onboarded) return pageOnboard();
  const [, r = 'today', ...args] = (location.hash || '#/today').split('/');
  ROUTE = routes[r] ? r : 'today';
  bodyClass(ROUTE === 'me' && args[0] === 'report' ? 'report' : ROUTE);
  $$('#tabs a').forEach(a => { const on = a.dataset.r === (TAB[ROUTE] || ROUTE); a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  if (ROUTE !== 'brain') brainView?.stop();
  try { await refresh(); } catch { AUTH = { signed_in: false }; return pageWelcome(); }
  renderWho();
  await routes[ROUTE](...args);
  main.focus({ preventScroll: true }); scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ================================================================== WELCOME
const MARK = `<svg class="mark" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="#E1F3F0" stroke-width="12"/>
  <circle cx="60" cy="60" r="50" fill="none" stroke="#0F766E" stroke-width="12" stroke-linecap="round" stroke-dasharray="210 314" transform="rotate(-90 60 60)"/>
  <circle cx="60" cy="60" r="30" fill="#E1F3F0"/><path d="M47 60l9 9 17-18" fill="none" stroke="#0F766E" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function pageWelcome() {
  bodyClass('welcome');
  main.innerHTML = `<div class="welcome stagger">${MARK}
    <h1>3 minutes a day<br>for a sharper brain</h1>
    <p class="lead">Find the habits that matter most for your brain, then build them with one short daily session.</p>
    <div class="ctas"><button class="btn accent big" id="start">Get started</button>
      <button class="btn secondary big" id="login">${ic('key')} I have a passkey</button><div id="demoSlot"></div></div>
    <div class="values"><span>${ic('chart-line')}Built on CDC data</span><span>${ic('lock')}Private by design</span><span>${ic('sparkles')}No hype</span></div>
    <p class="tiny" style="margin-top:18px">A wellness tool, not a diagnosis.</p></div>`;
  $('#start').onclick = async () => { try { await api('/auth/guest', {}); AUTH = await api('/auth/me'); route(); } catch (e) { toast(`Couldn't start: ${e.message}`, 5000); } };
  $('#login').onclick = passkeyLogin;
  api('/api/config').then(c => {
    if (!c.demo || !$('#demoSlot')) return;
    $('#demoSlot').innerHTML = '<button class="linkbtn" id="demoBtn">Explore a demo person (made-up data)</button>';
    $('#demoBtn').onclick = async () => { try { await api('/auth/demo', {}); AUTH = await api('/auth/me'); location.hash = '#/today'; route(); } catch (e) { toast(e.message, 5000); } };
  }).catch(() => {});
}
// Passkeys only work in a secure context (https, or http://localhost). Explain instead of failing silently.
function passkeyBlocker() {
  if (!window.isSecureContext) return `Passkeys need a secure address. On the computer running NeuroTrail, open http://localhost:${location.port || 8600}. From another device the app must be served over https.`;
  if (!window.PublicKeyCredential || !window.SimpleWebAuthnBrowser) return 'This browser doesn\'t support passkeys. Try an up-to-date Chrome, Safari, Edge or Firefox.';
  return null;
}
const passkeyError = (e, what) => {
  if (e.name === 'NotAllowedError') return `${what} was cancelled or timed out. If no passkey was offered, you may not have saved one on this device yet.`;
  if (e.name === 'InvalidStateError') return 'This device already has a passkey for this account. Use "I have a passkey" to sign in.';
  if (e.name === 'SecurityError') return `Passkeys can't be used at this address. Open http://localhost:${location.port || 8600} instead.`;
  return `${what} failed: ${e.message}`;
};
async function passkeyLogin() {
  const block = passkeyBlocker(); if (block) { toast(block, 8000); return; }
  try {
    const { key, options } = await api('/auth/login/options', {});
    const credential = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    await api('/auth/login/verify', { key, credential });
    AUTH = await api('/auth/me'); toast(`Welcome back`);
    if (location.hash === '#/today') route(); else location.hash = '#/today';
  } catch (e) { toast(passkeyError(e, 'Passkey sign-in'), 8000); }
}
async function savePasskey(after) {
  const block = passkeyBlocker(); if (block) { toast(block, 8000); return; }
  try {
    const { key, options } = await api('/auth/register/options', {});
    const credential = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    await api('/auth/register/verify', { key, credential });
    AUTH = await api('/auth/me'); toast('Saved. Next time, sign in with your fingerprint, face or PIN.', 5000); after?.();
  } catch (e) { toast(e.name === 'NotAllowedError' ? 'Passkey setup was cancelled. You can do it later in You → Passkey.' : passkeyError(e, 'Saving the passkey'), 8000); }
}

// ================================================================== ONBOARDING: one question per screen
const YN = [['1', 'Yes'], ['0', 'No']];
const OBQ = [
  { k: 'age', q: 'How old are you?', age: true },
  { k: 'female', q: 'What is your sex?', opts: [['1', 'Female'], ['0', 'Male']], why: ['Why we ask', '<p>The CDC survey we learn from recorded sex, so we use it to compare you with similar people. That\'s all it\'s used for.</p>'] },
  { k: 'toldbp', q: 'Has a doctor ever said you have high blood pressure?', opts: [['1', 'Yes'], ['0', 'No'], ['u', 'Not sure']], why: ['Why blood pressure', '<p>Lowering blood pressure is the brain-health step with the strongest trial evidence: in SPRINT MIND, a lower target reduced mild memory problems.</p>'] },
  { k: 'diabetes', q: 'Do you have diabetes?', opts: YN },
  { k: 'current_smoker', q: 'Do you smoke?', opts: YN },
  { k: 'sleep_hours', q: 'How much do you usually sleep?', opts: [['5.5', 'Under 6 hours'], ['6.5', '6 to 7 hours'], ['7.5', '7 to 8 hours'], ['8.5', 'More than 8 hours']] },
  { k: 'hearing_trouble', q: 'Do you have trouble hearing, even with hearing aids?', opts: YN, why: ['Why hearing', '<p>Hearing loss is the largest single changeable risk factor in the 2024 Lancet report. Only about 1 in 7 adults over 50 with hearing loss uses hearing aids.</p>'] },
  { k: 'feel_down', q: 'In the last 2 weeks, have you often felt down or hopeless?', opts: YN },
];
let OB = null;
async function pageOnboard() {
  bodyClass('onboard');
  if (!QUESTS.length) await loadQuests();
  OB ||= { i: 0, a: { age: 65 } };
  ME = await refresh().catch(() => null);
  obRender();
}
const qtop = (i, n, backFn) => `<div class="qtop">${backFn ? `<button class="iconbtn" id="qBack" aria-label="Back">${ic('arrow-left')}</button>` : '<span style="width:44px"></span>'}<div class="segs">${Array.from({ length: n }, (_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div></div>`;
function obRender() {
  scrollTo(0, 0);
  const i = OB.i, n = OBQ.length + 2;
  if (i < OBQ.length) {
    const Q = OBQ[i];
    if (Q.why) WHY['ob' + i] = Q.why;
    main.innerHTML = `<div class="qscreen pop">${qtop(i, n, i > 0)}<div class="step">Question ${i + 1} of ${OBQ.length}</div><h1>${Q.q}</h1>
      ${Q.age ? `<div style="text-align:center">${stepper('obAge', OB.a.age, ' years', 'Age')}</div><div class="foot"><button class="btn accent big" id="obNext">Continue</button></div>`
        : `<div class="opts">${Q.opts.map(([v, t]) => `<button class="opt ${String(OB.a[Q.k]) === v ? 'on' : ''}" data-v="${v}">${t}${ic('check')}</button>`).join('')}</div>
           <div class="foot">${Q.why ? whyBtn('ob' + i) : ''}</div>`}</div>`;
    $('#qBack') && ($('#qBack').onclick = () => { OB.i--; obRender(); });
    if (Q.age) { wireStepper(main, 'obAge', () => OB.a.age, v => { OB.a.age = v; }, { min: 18, max: 100, step: 1, unit: ' years' }); $('#obNext').onclick = () => { OB.i++; obRender(); }; return; }
    $$('.opt', main).forEach(b => b.onclick = () => {
      $$('.opt', main).forEach(x => x.classList.toggle('on', x === b)); OB.a[Q.k] = b.dataset.v;
      setTimeout(async () => { if (OB.i === OBQ.length - 1) await obSubmit(); else { OB.i++; obRender(); } }, calm() ? 0 : 220);
    });
  } else if (i === OBQ.length) {           // support first if they've been feeling down
    main.innerHTML = `<div class="qscreen pop">${qtop(i, n)}${SUPPORT}<div class="foot"><button class="btn accent big" id="obNext">Continue</button></div></div>`;
    $('#obNext').onclick = () => { OB.i++; obRender(); };
  } else if (i === OBQ.length + 1) {
    const ia = iconArray(ME.profile);
    WHY.lancet = ['Where this comes from', `<p>The 2024 Lancet Commission estimated that about 45% of dementia cases are linked to 14 things that can change, like blood pressure, hearing and inactivity.</p><p>This describes whole populations, not your personal chance. <a href="${LANCET_URL}" target="_blank" rel="noopener">Read the report</a>.</p>`];
    main.innerHTML = `<div class="qscreen pop">${qtop(i, n)}<div class="step">The big picture</div>
      <h1>45 of every 100 dementia cases are linked to things that can change</h1>${ia.html}
      ${ia.youN ? `<p class="muted" style="text-align:center">${ia.youN} of those are linked to things you told us. That's where we'll start.</p>` : ''}
      <div class="foot"><button class="btn accent big" id="obNext">Continue</button><div style="text-align:center">${whyBtn('lancet')}</div></div></div>`;
    $('#obNext').onclick = () => { OB.i++; obRender(); };
  } else {
    const plan = planFor(ME), L = ME.lever;
    const top = Object.values(L.per_factor).filter(f => f.known && f.significant && f.points > .1).sort((a, b) => b.points - a.points).slice(0, 2);
    WHY.survey = ['How we know', `<p>In a CDC survey of ${L.n.toLocaleString()} adults over 60, people with these factors scored lower on a thinking-speed test than people at healthy targets.</p><p>That's a link in survey data, not proof of cause. You can see every number in You → How we know.</p>`];
    main.innerHTML = `<div class="qscreen pop">${qtop(i, n)}<div class="step">Your plan</div><h1>Here's where to focus</h1>
      ${top.length ? `<div class="list">${top.map(f => `<div class="lrow"><span class="ico rose">${ic('target-arrow')}</span><div class="txt"><b>${esc(f.label)}</b><span>Linked to about ${f.points.toFixed(1)} points slower thinking</span></div></div>`).join('')}</div>` : ''}
      <div class="section-h"><h2>Your first habits</h2></div>
      <div class="list">${plan.map(id => `<div class="lrow"><span class="ico ${HABIT[id].tint}">${ic(HABIT[id].icon)}</span><div class="txt"><b>${HABIT[id].name}</b></div></div>`).join('')}</div>
      <p class="muted" style="margin-top:14px">Each day: one 3-minute session with a check-in, a short game and one habit.</p>
      <div class="foot stack"><button class="btn accent big" id="save">${ic('key')} Save with a passkey</button><button class="btn secondary big" id="later">Not now</button><div style="text-align:center">${whyBtn('survey')}</div></div></div>`;
    const done = () => { OB = null; AUTH.onboarded = true; if (location.hash === '#/today') route(); else location.hash = '#/today'; };
    $('#save').onclick = () => savePasskey(done);
    $('#later').onclick = done;
  }
}
async function obSubmit() {
  const a = OB.a;
  store.set('nt-toldbp', a.toldbp === '1' ? '1' : '0');
  const body = { age: a.age, female: a.female === '1', diabetes: a.diabetes === '1', current_smoker: a.current_smoker === '1', sleep_hours: +a.sleep_hours,
    hearing_trouble: a.hearing_trouble === '1', feel_down: a.feel_down === '1', sbp: null };
  try { ME = await api('/api/me/onboard', body); } catch (e) { toast(e.message); return; }
  OB.i = body.feel_down ? OBQ.length : OBQ.length + 1; obRender();
}

// ================================================================== TODAY
async function sessionState() {
  const G = await api('/api/me/games').catch(() => ({}));
  const plan = planFor(ME);
  const doneId = Object.keys(HABIT).find(id => id !== 'sleep' && id !== 'mood' && doneToday(id));
  const habitToday = store.get(habitFlag()) === '1' || !!doneId;
  const habit = plan.find(id => id !== 'sleep' && !habitDone(id)) || ['steps', 'connect', 'joy'].find(id => !doneToday(id)) || 'steps';
  const game = gameOfDay();
  const played = Object.entries(G).find(([, g]) => g.played_today)?.[0];
  const steps = [{ k: 'checkin', label: 'Check-in', done: doneToday('sleep') },
    { k: 'game', label: CHECK_BY[played || game]?.name || 'Game', done: !!played },
    { k: 'habit', label: habitToday ? (doneId ? HABIT[doneId].short : 'Mood check') : HABIT[habit].short, done: habitToday }];
  return { steps, n: steps.filter(s => s.done).length, habit, game, G };
}
const sessRing = (n, size = 132) => { const C = 2 * Math.PI * 54;
  return `<div class="sess-ring" style="width:${size}px;height:${size}px" role="img" aria-label="${n} of 3 steps done today"><svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="54" stroke="#E9E7E0" stroke-width="12" fill="none"/>
    <circle cx="66" cy="66" r="54" stroke="#0F766E" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - n / 3)}"/></svg>
    <div class="lbl">${n === 3 ? ic('check') : `<b>${n}/3</b>`}</div></div>`; };
async function pageToday() {
  const [S, I, P] = await Promise.all([sessionState(), api('/api/me/insights').catch(() => null), api('/api/me/progress?days=7').catch(() => null)]);
  const h = new Date().getHours(), hi = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening', nm = firstName();
  const all = S.n === 3;
  main.innerHTML = `<div class="stack stagger">
    ${ME.support ? SUPPORT : ''}
    <div><div class="datebar"><span>${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>${ME.streak ? `<span class="pill amber">${ic('flame')} ${ME.streak}</span>` : ''}</div>
      <h1 class="today-h">${hi}${nm ? `, ${esc(nm)}` : ''}</h1></div>
    <section class="card sess">${sessRing(S.n)}
      <h2>${all ? 'Done for today' : S.n ? 'Keep going' : "Today's 3-minute session"}</h2>
      <div class="sess-steps">${S.steps.map(s => `<span class="${s.done ? 'done' : ''}">${ic(s.done ? 'circle-check' : 'circle')}${esc(s.label)}</span>`).join('')}</div>
      ${all ? `<div class="row" style="justify-content:center"><a class="btn secondary" href="#/checks">Play another game</a><a class="btn secondary" href="#/me/week">Your week</a></div>`
        : `<a class="btn accent big" href="#/session">${S.n ? 'Continue' : 'Start'}</a>`}
    </section>
    <div id="todayInsight">${insightMini(I)}</div>
    ${weekDots(P)}
  </div>`;
}
function insightMini(I) {
  if (!I) return '';
  if (!I.ready) {
    const S = I.status, left = S.days_needed - S.days_with_both;
    return `<a class="card minicard" href="#/me/patterns"><span class="ico amber">${ic('bulb')}</span><div class="txt"><b>Personal insights in ${left} day${left === 1 ? '' : 's'}</b>
      <span>Finish your session daily and we'll find what works for you.</span><div class="unlock"><i style="width:${S.days_with_both / S.days_needed * 100}%"></i></div></div></a>`;
  }
  const top = I.insights.find(i => i.level === 'clear' || i.level === 'hint');
  if (!top) return `<a class="card minicard" href="#/me/patterns"><span class="ico amber">${ic('bulb')}</span><div class="txt"><b>No clear patterns yet</b><span>Keep going: patterns get clearer with more days.</span></div>${ic('chevron-right')}</a>`;
  const e = top.example, pct = e ? Math.abs(e.better_pct) : null;
  return `<a class="card minicard" href="#/me/patterns"><span class="ico amber">${ic('bulb')}</span><div class="txt"><b>${pct != null && top.direction === 'better' ? `Sharper by ${pct}% after you ${esc(top.phrase)}` : esc(top.headline)}</b>
    <span>${top.level === 'clear' ? 'Clear pattern' : 'Early hint'} in your own data</span></div>${ic('chevron-right')}</a>`;
}
function weekDots(P) {
  if (!P) return '';
  const active = new Set([...P.days.filter((d, i) => P.quests_per_day[i] > 0), ...P.speed.map(r => r.date)]);
  const today = P.days[P.days.length - 1];
  return `<a class="card" href="#/me/week" style="display:block;text-decoration:none;color:inherit"><div class="datebar" style="margin:0 0 12px"><b style="color:var(--ink)">This week</b><span>${[...active].filter(d => P.days.includes(d)).length} of 7 days ${ic('chevron-right')}</span></div>
    <div class="weekdots">${P.days.map(d => `<div class="${active.has(d) ? 'on' : ''} ${d === today ? 'today' : ''}"><i></i>${new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</div>`).join('')}</div></a>`;
}

// ================================================================== THE DAILY SESSION
async function pageSession() {
  scrollTo(0, 0);
  const S = await sessionState(), next = S.steps.find(s => !s.done);
  if (!next) return celebrate();
  const k = S.steps.indexOf(next);
  const top = `<div class="qtop"><a class="iconbtn" href="#/today" aria-label="Close session">${ic('x')}</a><div class="segs">${S.steps.map(s => `<i class="${s.done ? 'on' : ''}"></i>`).join('')}</div></div>`;
  const nextStep = async () => { await refresh(); if (ROUTE === 'session') pageSession(); };
  if (next.k === 'checkin') {
    WHY.checkin = ['Why we ask every day', '<p>Your sleep, matched with today\'s game, is what powers your personal insights: after a few days we can see whether your checks go better after a good night.</p>'];
    main.innerHTML = `<div class="qscreen pop">${top}<div class="step">Step ${k + 1} of 3 · Check-in</div><h1>How did you sleep last night?</h1>
      <div class="opts">${[['5.5', 'Under 6 hours'], ['6.5', '6 to 7 hours'], ['7.5', '7 to 8 hours'], ['8.5', 'More than 8 hours']].map(([v, t]) => `<button class="opt" data-v="${v}">${t}${ic('check')}</button>`).join('')}</div>
      <div class="foot">${whyBtn('checkin')}</div></div>`;
    $$('.opt', main).forEach(b => b.onclick = async () => {
      $$('.opt', main).forEach(x => x.classList.toggle('on', x === b));
      try { await api('/api/me/complete', { quest: 'sleep', value: +b.dataset.v, extra: { source: 'check-in' } }); } catch (e) { toast(e.message); return; }
      setTimeout(nextStep, calm() ? 0 : 250);
    });
  } else if (next.k === 'game') {
    main.innerHTML = `<div class="qscreen pop">${top}<div class="step">Step ${k + 1} of 3 · Today's game</div><div id="sessGame" style="margin-top:10px"></div></div>`;
    if (S.game === 'speed') runSprint($('#sessGame'), { onDone: nextStep, doneLabel: 'Continue' });
    else { $('#sessGame').innerHTML = '<div id="p-game"></div>'; AFTER_GAME = nextStep; pageGame(S.game); }
  } else {
    main.innerHTML = `<div class="qscreen pop">${top}<div class="step">Step ${k + 1} of 3 · One habit</div><div id="sessHabit" style="margin-top:6px"></div></div>`;
    renderHabit($('#sessHabit'), S.habit, { onDone: () => { store.set(habitFlag(), '1'); nextStep(); } });
  }
}
async function celebrate() {
  main.innerHTML = `<div class="celebrate"><div class="confetti">${confetti()}</div><div class="cel-check">${ic('check')}</div>
    <h1>Session complete</h1><p class="muted">${ME.streak > 1 ? `${ME.streak} days in a row. Nice.` : 'Day one done. Come back tomorrow.'}</p>
    <div class="statrow"><div class="stat"><span>Streak</span><b>${ME.streak || 1} day${(ME.streak || 1) === 1 ? '' : 's'}</b></div><div class="stat"><span>Tomorrow's game</span><b>${CHECK_BY[gameOfDay(1)].name}</b></div></div>
    <div id="celebIns" style="text-align:left"></div>
    <div class="stack" style="margin-top:14px"><a class="btn accent big" href="#/today">Done</a><a class="btn secondary big" href="#/me/week">See your week</a></div></div>`;
  const I = await api('/api/me/insights').catch(() => null);
  if ($('#celebIns') && I) $('#celebIns').innerHTML = insightMini(I);
}

// ================================================================== HABITS
async function loadQuests() { QUESTS = await api('/api/quests'); QMAP = Object.fromEntries(QUESTS.map(q => [q.id, q])); }
function nextWhy(id) {
  const L = ME.lever.per_factor;
  return { bp: ME.profile.sbp == null ? 'Your blood pressure is unknown, and it\'s the step with the strongest trial evidence for the brain.' : 'The brain-health step with the strongest trial evidence.',
    labs: L.diabetes?.points > .1 ? 'Diabetes had the biggest link to slower thinking in the survey. Knowing your HbA1c is step one.' : 'Know your cholesterol and blood sugar.',
    sleep: 'Sleeping much more or less than 6–8 hours was linked to slower thinking.',
    smoke: 'Quitting at any age helps your brain.',
    mood: '8 short questions about the last 2 weeks.',
    steps: 'More walking is linked to lower dementia risk.',
    connect: 'Social isolation is one of the 14 changeable risk factors.',
    hearing: 'Hearing loss is the largest changeable risk factor.',
    joy: 'Planning one enjoyable thing is a proven way to lift mood.' }[id] || '';
}
async function pageHabit(id) {
  if (!QUESTS.length) await loadQuests();
  if (id !== 'mood' && (!QMAP[id] || id === 'speed')) { location.hash = '#/today'; return; }
  main.innerHTML = `<a class="back" href="#/today">${ic('arrow-left')}Today</a><div id="hbox" class="pop"></div>`;
  renderHabit($('#hbox'), id, {});
}
function renderHabit(root, id, { onDone } = {}) {
  if (id === 'mood') return renderMood(root, { onDone });
  const q = QMAP[id], H = HABIT[id], v = {}, last = ME.profile || {};
  const chipset = (cid, opts) => `<div class="chips" id="${cid}">${opts.map((w, i) => `<button class="chip ${i ? '' : 'on'}" aria-pressed="${!i}" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div>`;
  const input = {
    bp: () => { v.s = last.sbp ? Math.round(last.sbp) : 125; v.d = 80; return `<div id="bpCuff"><div class="q"><b>Top number</b>${stepper('hS', v.s, ' mmHg', 'Systolic')}</div><div class="q"><b>Bottom number</b>${stepper('hD', v.d, ' mmHg', 'Diastolic')}</div></div>
      <button class="linkbtn" id="noCuff">I don't have a cuff</button><div id="noCuffBox"></div>`; },
    steps: () => { v.n = 4000; return `<div class="q"><b>Steps today</b>${stepper('hN', v.n, ' steps', 'Steps')}</div>`; },
    connect: () => { v.who = 'Family'; v.mins = 15; return `<div class="q"><b>Who with?</b>${chipset('hWho', ['Family', 'Partner', 'Friend', 'Neighbor', 'Someone new'])}</div><div class="q"><b>How long?</b>${stepper('hM', v.mins, ' min', 'Minutes')}</div>`; },
    hearing: () => { v.path = 'Wore my hearing aids'; return `<div class="q"><b>What did you do?</b>${chipset('hPath', ['Wore my hearing aids', 'Took a hearing screening', 'Booked a hearing test'])}</div>`; },
    joy: () => { v.act = q.log.menu[0]; v.before = 5; v.after = 6; return `<div class="q"><b>What did you do?</b>${chipset('hAct', q.log.menu)}</div>
      <div class="q"><b>Mood before (0–10)</b>${stepper('hB', 5, '', 'Mood before')}</div><div class="q"><b>Mood after (0–10)</b>${stepper('hA', 6, '', 'Mood after')}</div>`; },
    check: () => { v.trigger = 'Morning coffee'; v.sub = '5-minute walk'; return `<div class="q"><b>Biggest trigger today</b>${chipset('hTr', ['Morning coffee', 'After meals', 'Stress', 'With friends', 'Driving', 'Alcohol'])}</div>
      <div class="q"><b>What you did instead</b>${chipset('hSub', ['5-minute walk', 'Glass of water', 'Gum', 'Deep breaths', 'Call someone'])}</div><p class="muted">Free coaching: 1-800-QUIT-NOW</p>`; },
    sleep: () => { v.h = last.sleep_hours ?? 7; return `<div class="q"><b>Hours slept last night</b>${stepper('hH', v.h, ' h', 'Sleep hours')}</div>`; },
    labs: () => { v.ldl = null; v.a1c = null; return `<p>Checked or booked a test? Add numbers if you have them.</p>
      <div class="q"><b>LDL cholesterol</b> <button class="linkbtn" data-add="ldl">Add</button><div id="ldlBox"></div></div><div class="q"><b>HbA1c</b> <button class="linkbtn" data-add="a1c">Add</button><div id="a1cBox"></div></div>`; },
  }[q.log.kind];
  WHY['how-' + id] = ['How to do it', `<ol class="steps-list">${q.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`];
  WHY['ev-' + id] = ['Why this habit', `${q.evidence.map(e => `<p>${esc(e.claim)} <a href="${e.url}" target="_blank" rel="noopener">Source</a></p>`).join('')}
    ${q.nhanes ? `<p class="muted">CDC survey: ${esc(q.nhanes.label)} ↔ ${fmt(q.nhanes.dsst_points)} points on a thinking-speed test (95% range ${fmt(q.nhanes.dsst_ci[0])} to ${fmt(q.nhanes.dsst_ci[1])}). A link, not proof of cause.</p>` : ''}
    ${q.caveat ? `<p class="caveat">${esc(q.caveat)}</p>` : ''}`];
  root.innerHTML = `<div class="habit-h"><span class="ico lg ${H.tint}">${ic(H.icon)}</span><div><h1>${H.name}</h1></div></div>
    <p class="muted">${esc(nextWhy(id))}</p>
    ${doneToday(id) ? '<p class="done-sheet">Done today. You can log it again.</p>' : ''}
    <div class="card" id="hIn">${input ? input() : ''}</div>
    <button class="btn accent big" id="hDone" style="margin-top:14px">${ic('check')} Done</button>
    <div class="row" style="justify-content:center">${whyBtn('how-' + id, 'How to do it')}${whyBtn('ev-' + id, 'Why it matters')}</div>
    <div id="hRes" aria-live="polite"></div>`;
  const r = $('#hIn', root);
  const pick = (cid, k) => $('#' + cid, r) && choice(r, `#${cid} .chip`, val => { v[k] = val; });
  const k = q.log.kind;
  if (k === 'bp') {
    wireStepper(r, 'hS', () => v.s, x => { v.s = x; }, { min: 80, max: 220, step: 1, unit: ' mmHg' }); wireStepper(r, 'hD', () => v.d, x => { v.d = x; }, { min: 40, max: 130, step: 1, unit: ' mmHg' });
    $('#noCuff', r).onclick = () => { v.nocuff = true; $('#bpCuff', r).hidden = true; $('#noCuff', r).hidden = true;
      $('#noCuffBox', r).innerHTML = `<p><b>No cuff? Three easy options:</b></p><ul class="plain"><li>Many pharmacies have a free blood pressure kiosk.</li><li>Ask at your next doctor visit.</li><li>Home upper-arm cuffs are widely sold; look for one listed at validatebp.org.</li></ul><p class="muted">Tap Done when you know where to check.</p>`; };
  }
  if (k === 'steps') wireStepper(r, 'hN', () => v.n, x => { v.n = x; }, { min: 0, max: 40000, step: 500, unit: ' steps', fmtv: x => x.toLocaleString() });
  if (k === 'connect') { pick('hWho', 'who'); wireStepper(r, 'hM', () => v.mins, x => { v.mins = x; }, { min: 5, max: 180, step: 5, unit: ' min' }); }
  if (k === 'hearing') pick('hPath', 'path');
  if (k === 'joy') { pick('hAct', 'act'); wireStepper(r, 'hB', () => v.before, x => { v.before = x; }, { min: 0, max: 10, step: 1 }); wireStepper(r, 'hA', () => v.after, x => { v.after = x; }, { min: 0, max: 10, step: 1 }); }
  if (k === 'check') { pick('hTr', 'trigger'); pick('hSub', 'sub'); }
  if (k === 'sleep') wireStepper(r, 'hH', () => v.h, x => { v.h = x; }, { min: 2, max: 12, step: .25, unit: ' h' });
  if (k === 'labs') $$('[data-add]', r).forEach(b => b.onclick = () => { const kk = b.dataset.add; b.hidden = true; v[kk] = kk === 'ldl' ? 100 : 5.6;
    $(`#${kk}Box`, r).innerHTML = stepper('h_' + kk, v[kk], kk === 'ldl' ? ' mg/dL' : ' %', kk);
    wireStepper(r, 'h_' + kk, () => v[kk], x => { v[kk] = x; }, kk === 'ldl' ? { min: 40, max: 250, step: 1, unit: ' mg/dL' } : { min: 4, max: 12, step: .1, unit: ' %', fmtv: x => x.toFixed(1) }); });
  $('#hDone', root).onclick = async () => {
    let value = null, extra = {};
    if (k === 'bp') { if (v.nocuff) extra = { path: 'no-cuff' }; else { value = v.s; extra = { readings: [[v.s, v.d]] }; } }
    if (k === 'steps') value = v.n;
    if (k === 'connect') { value = v.mins; extra = { who: v.who }; }
    if (k === 'hearing') extra = { path: v.path };
    if (k === 'joy') { value = v.after - v.before; extra = { activity: v.act, before: v.before, after: v.after }; }
    if (k === 'check') extra = { trigger: v.trigger, substitute: v.sub };
    if (k === 'sleep') value = v.h;
    if (k === 'labs') extra = { ldl: v.ldl, a1c: v.a1c };
    $('#hDone', root).disabled = true;
    try { ME = await api('/api/me/complete', { quest: q.id, value, extra }); } catch (e) { toast(e.message); $('#hDone', root).disabled = false; return; }
    store.set(habitFlag(), '1');
    let note = '';
    if (k === 'bp' && value >= 180) note = '<p class="caveat"><b>180 or higher is very high.</b> Rest 5 minutes and measure again. If it stays this high, or you have chest pain, weakness, or vision or speech changes, call 911.</p>';
    else if (k === 'bp' && value >= 130) note = '<p>130 or above is worth raising with your doctor. Measure on a few different days to see your usual level.</p>';
    else if (k === 'steps') note = `<p>${value >= 9800 ? 'You reached the "best" level from a UK study of 78,000 people.' : value >= 3800 ? `Above the minimum level. ${(9800 - value).toLocaleString()} more reaches the best level.` : `${(3800 - value).toLocaleString()} more steps reaches the minimum level.`}</p>`;
    if (onDone && !note) { toast(`Logged · +${ME.gained} points`); onDone(); return; }
    $('#hRes', root).innerHTML = `<div class="card done-sheet pop" style="margin-top:14px"><h2>${ic('circle-check')} Logged</h2>${note}
      ${onDone ? '<button class="btn accent big" id="hCont">Continue</button>' : '<a class="btn secondary" href="#/today">Back to Today</a>'}</div>`;
    $('#hCont') && ($('#hCont').onclick = onDone);
    $('#hRes', root).scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
  };
}
const PHQ8 = ['Little interest or pleasure in doing things', 'Feeling down, depressed, or hopeless', 'Trouble falling or staying asleep, or sleeping too much', 'Feeling tired or having little energy',
  'Poor appetite or overeating', 'Feeling bad about yourself, or that you are a failure or have let yourself or your family down', 'Trouble concentrating on things, such as reading or watching TV',
  'Moving or speaking so slowly that other people could have noticed, or being so fidgety or restless that you have been moving around a lot more than usual'];
const PHQO = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];
function pageMood() { main.innerHTML = `<a class="back" href="#/today">${ic('arrow-left')}Today</a><div id="hbox"></div>`; renderMood($('#hbox'), {}); }
function renderMood(root, { onDone } = {}) {
  const a = Array(8).fill(null); let i = 0;
  const show = () => {
    scrollTo(0, 0);
    root.innerHTML = `<div class="pop"><div class="step muted">Mood check · ${i + 1} of 8 · over the last 2 weeks</div>
      <div class="segs" style="margin:10px 0 16px">${a.map((x, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
      <h1 style="font-size:1.5rem">${PHQ8[i]}</h1><div class="opts">${PHQO.map((o, j) => `<button class="opt ${a[i] === j ? 'on' : ''}" data-v="${j}">${o}${ic('check')}</button>`).join('')}</div>
      ${i ? `<button class="back" id="mBack" style="margin-top:10px">${ic('arrow-left')}Previous</button>` : ''}</div>`;
    $('#mBack', root) && ($('#mBack', root).onclick = () => { i--; show(); });
    $$('.opt', root).forEach(b => b.onclick = () => { a[i] = +b.dataset.v; b.classList.add('on'); setTimeout(() => { if (i < 7) { i++; show(); } else submit(); }, calm() ? 0 : 200); });
  };
  const submit = async () => {
    const r = await api('/api/me/mood', { answers: a }); ME = r.player; store.set(habitFlag(), '1');
    const band = r.score < 5 ? 'few or no symptoms' : r.score < 10 ? 'mild symptoms' : r.score < 15 ? 'moderate symptoms' : r.score < 20 ? 'moderately severe symptoms' : 'severe symptoms';
    root.innerHTML = `<div class="pop">${r.support ? SUPPORT : ''}<div class="card" style="margin-top:14px;text-align:center"><div class="muted">Your score</div><div class="a-big">${r.score}<span style="font-size:1.4rem;color:var(--dim)"> / 24</span></div>
      <p>That usually means <b>${band}</b>. It's a screening questionnaire (PHQ-8), not a diagnosis.</p>
      ${r.support ? '<p>Scores of 10 or more are a good reason to talk with a doctor.</p>' : '<p class="muted">Mood changes. Check again in a couple of weeks.</p>'}
      ${onDone ? '<button class="btn accent big" id="mCont">Continue</button>' : '<a class="btn secondary" href="#/today">Back to Today</a>'}</div></div>`;
    $('#mCont', root) && ($('#mCont', root).onclick = onDone);
  };
  show();
}

// ================================================================== TRAIN
async function pageChecks() {
  const [S, V] = await Promise.all([api('/api/me/games'), api('/api/me/voice')]);
  const g = gameOfDay(), C = CHECK_BY[g];
  const stat = c => { if (c.id === 'voice') { const n = V.history.length; return n ? `${n} recording${n > 1 ? 's' : ''}` : 'New'; }
    const s = S[c.id]; return s?.plays ? `Best ${s.best} · ${s.plays} play${s.plays > 1 ? 's' : ''}` : 'New'; };
  WHY.train = ['Do brain games work?', '<p>Only speed training has trial evidence linked to fewer dementia diagnoses (the ACTIVE trial). Practicing other games mostly makes you better at that game.</p><p>So here, games are <b>measurements</b>: you\'re compared only with your own earlier scores, and the trend over weeks matters more than any one day.</p>'];
  main.innerHTML = `<div class="stack stagger"><div><h1>Train</h1><p class="muted" style="margin-top:-4px">Short games based on real thinking tests.</p></div>
    <a class="card featured" href="#/check/${g}" style="text-decoration:none;color:inherit"><span class="ico lg ${C.tint}">${ic(C.icon)}</span><div class="txt"><div class="eyebrow">Today's game</div><b style="font:700 1.15rem var(--display)">${C.name}</b><div class="muted">${C.what} · ${C.time}</div></div><span class="btn accent">${ic('player-play')}</span></a>
    <div class="grid3">${CHECKS.map(c => `<a class="tile" href="#/check/${c.id}"><span class="ico ${c.tint}">${ic(c.icon)}</span><b>${c.name}</b><span>${c.what}</span><div class="st">${stat(c)} · ${c.time}</div></a>`).join('')}</div>
    <div style="text-align:center">${whyBtn('train', 'Do brain games work?')}</div></div>`;
}
async function pageCheck(id) {
  const back = `<a class="back" href="#/checks">${ic('arrow-left')}Train</a>`;
  if (id === 'speed') { main.innerHTML = `${back}<div id="sprintBox" style="margin-top:8px"></div>`; return runSprint($('#sprintBox'), {}); }
  if (id === 'voice') { main.innerHTML = `${back}<div id="p-voice"></div>`; return pageVoice(); }
  main.innerHTML = '<div id="p-game"></div>'; return pageGame(id);
}

// ------------------------------------------------------------------ Speed Sprint: race your ghost (your first try)
const SYM = ['◆', '▲', '●', '■', '★', '✚', '⬟', '☾', '♥'];
let G = null;
function STOP_SPRINT() { if (G) G.over = true; G = null; }
function runSprint(box, { onDone, doneLabel }) {
  const ghost = ME?.first_speed;
  box.innerHTML = `<div class="arcade pop"><span class="ico lg amber" style="margin:0 auto">${ic('bolt')}</span><h2 class="game-title">Speed Sprint</h2>
    <p class="muted" style="max-width:460px;margin:0 auto 6px">Find the big symbol in the key and tap its number. 90 seconds. Go fast, but try not to slip.</p>
    <p>${ghost != null ? `Race your first try: <b>${ghost}</b>` : 'This round sets your baseline.'}</p>
    <button class="btn accent big" id="goBtn" style="max-width:360px">${ic('player-play')} Start</button></div>`;
  $('#goBtn', box).onclick = () => startSprint(box, ghost, onDone, doneLabel);
}
function startSprint(box, ghost, onDone, doneLabel) {
  const d = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - .5);
  G = { key: Object.fromEntries(SYM.map((s, i) => [s, d[i]])), t0: performance.now(), ok: 0, bad: 0, combo: 0, best: 0, tgt: SYM[Math.floor(Math.random() * 9)], over: false, box, ghost, onDone, doneLabel };
  box.innerHTML = `<div class="arcade"><div class="a-top"><div class="a-stat"><small>CORRECT</small><span id="aOk">0</span></div>
      <div class="timer"><svg width="120" height="120" aria-hidden="true"><circle cx="60" cy="60" r="52" stroke="#E9E7E0" stroke-width="8" fill="none"/><circle id="tRing" cx="60" cy="60" r="52" stroke="#0F766E" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="326.7"/></svg><div class="t" id="tLeft" aria-label="seconds left">90</div></div>
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
  $('#aOk').textContent = G.ok; $('#aBad').textContent = G.bad; $('#combo').textContent = G.combo >= 5 ? `${G.combo} in a row` : '';
}
addEventListener('keydown', e => { if (G && !G.over && /^[1-9]$/.test(e.key)) answer(+e.key); });
function tick() {
  if (!G || G.over) return;
  const el = (performance.now() - G.t0) / 1000, left = Math.max(0, 90 - el);
  $('#tLeft').textContent = Math.ceil(left); $('#tRing').style.strokeDashoffset = 326.7 * (1 - left / 90); if (left <= 10) $('#tRing').setAttribute('stroke', '#BE123C');
  if (G.ghost != null) { const gNow = Math.floor(G.ghost * Math.min(1, el / 90)), mx = Math.max(G.ghost, G.ok, 1) * 1.1;
    $('#barYou').style.width = G.ok / mx * 100 + '%'; $('#barGhost').style.width = gNow / mx * 100 + '%'; $('#nYou').textContent = G.ok; $('#nGhost').textContent = gNow; }
  if (left <= 0) return endSprint(); setTimeout(tick, 100);
}
async function endSprint() {
  const g = G; g.over = true; const prevBest = ME.best_speed;
  let r; try { r = await api('/api/me/speed', { correct: g.ok, wrong: g.bad, best_combo: g.best }); } catch (e) { toast(e.message); return; }
  ME = r; const acc = g.ok / Math.max(1, g.ok + g.bad);
  const vs = g.ghost == null ? 'Baseline set. Next time, you race this score.' : g.ok > g.ghost ? `${g.ok - g.ghost} more than your first try.` : g.ok === g.ghost ? 'A tie with your first try.' : 'A little behind your first try. Day-to-day scores bounce around; the weekly trend is what matters.';
  g.box.innerHTML = `<div class="arcade pop"><div class="eyebrow">Round complete</div><div class="a-big">${g.ok}</div><div class="muted">correct · ${(acc * 100).toFixed(0)}% accurate</div>
    ${prevBest != null && g.ok > prevBest ? '<div style="margin-top:10px"><span class="pb">New personal best</span></div>' : ''}<p>${vs}</p>
    ${r.history.length > 1 ? '<div class="chartbox" style="height:160px;margin:12px 0"><canvas id="hChart" aria-label="Your Speed Sprint scores over time"></canvas></div>' : ''}
    <div class="stack">${g.onDone ? `<button class="btn accent big" id="nextBtn">${g.doneLabel || 'Next'}</button>` : `<button class="btn accent big" id="againBtn">${ic('refresh')} Play again</button><a class="btn secondary big" href="#/checks">Back to Train</a>`}</div></div>`;
  if (r.history.length > 1) chart('hChart', { type: 'line', data: { labels: r.history.map((_, i) => `#${i + 1}`), datasets: [{ label: 'correct', data: r.history, borderColor: '#0F766E', backgroundColor: 'rgba(15,118,110,.08)', fill: true, tension: .35 }] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  $('#nextBtn') && ($('#nextBtn').onclick = g.onDone);
  $('#againBtn') && ($('#againBtn').onclick = () => runSprint(g.box, {}));
  G = null;
}

// ================================================================== LEARN (3D brain)
let ATL = null, BMODE = 'learn', DSEL = null, DSTAGE = 0, MINE = null, PICKBOUND = false;
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const VIEW = { alzheimers: [.9, -.45, .1, true], parkinsons: [1, .1, .1, true], stroke: [-1, .3, .2], huntingtons: [1, .2, .2, true], als: [-.6, 1, .2], ftd: [-.5, .2, 1], ms: [-.8, .3, .7] };
const GROUPS = [['lower', 'You can lower your risk'], ['live', 'You can live better with it'], ['early', 'Early help matters most']];
async function pageBrain(mode, arg) {
  ATL ||= await api('/api/atlas');
  if (mode === 'mine' || mode === 'learn') BMODE = mode;
  DSEL = mode === 'learn' && arg ? arg : null;
  if (DSEL) DSTAGE = 0;
  const stage = $('#stage');
  if (!brainView) {
    stage.innerHTML = '<div class="stagehint">Drag to turn · tap a part</div>';
    try { const { createBrain } = await import('./brain3d.js?v=2'); brainView = await createBrain(stage); window.NT = { brain: brainView }; }
    catch (e) { stage.innerHTML = `<div class="empty">The 3D brain couldn't load on this device (${esc(e.message)}). Everything else still works.</div>`; }
  }
  brainView?.start();
  if (brainView && !PICKBOUND) { PICKBOUND = true; bindPick(); }
  if (BMODE === 'mine') MINE = await api('/api/me/brain');
  main.innerHTML = `<div class="brainpane"><div id="rinfo" aria-live="polite"></div>
    <div class="seg" role="tablist"><button role="tab" aria-selected="${BMODE === 'learn'}" class="${BMODE === 'learn' ? 'on' : ''}" data-m="learn">Brain diseases</button><button role="tab" aria-selected="${BMODE === 'mine'}" class="${BMODE === 'mine' ? 'on' : ''}" data-m="mine">Your brain map</button></div>
    <div id="bp"></div></div>`;
  $$('.seg button').forEach(b => b.onclick = () => { location.hash = `#/brain/${b.dataset.m}`; });
  BMODE === 'learn' ? (DSEL ? diseaseDetail() : learnList()) : mineView();
}
const RN = () => Object.fromEntries(ATL.regions.map(r => [r.id, r]));
const dIcon = d => `<span class="ico" style="background:${d.color}22;color:${d.color}">${ic('brain')}</span>`;
function learnList() {
  brainView?.set({}, false); brainView?.home();
  $('#bp').innerHTML = `${GROUPS.map(([g, t]) => `<div class="dgroup"><h3>${t}</h3><div class="list">${ATL.diseases.filter(d => d.group === g).map(d => `<a class="lrow" href="#/brain/learn/${d.id}">${dIcon(d)}<div class="txt"><b>${esc(d.name)}</b><span>${esc(d.what.split('. ')[0])}.</span></div>${ic('chevron-right')}</a>`).join('')}</div></div>`).join('')}
    <div class="section-h"><h2>Myth or fact?</h2><span class="muted">Tap a card</span></div>
    <div class="grid3">${MYTHS.map((m, i) => `<button class="myth" data-my="${i}"><b>Myth</b><br>${m[0]}</button>`).join('')}</div>`;
  $$('[data-my]').forEach(b => b.onclick = () => { const m = MYTHS[+b.dataset.my]; b.classList.add('flip'); b.innerHTML = `<b>Fact</b><br>${m[1]} <a href="${m[2]}" target="_blank" rel="noopener">Source</a>`; });
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
  $('#bp').innerHTML = `<a class="back" href="#/brain/learn">${ic('arrow-left')}All diseases</a>
    <div class="habit-h">${dIcon(d)}<h1 style="font-size:1.5rem">${esc(d.name)}</h1></div><p>${esc(d.what)}</p>
    <div class="card">${d.stages.length > 1 ? `<label for="stageSlider" class="eyebrow">How it usually spreads</label>
      <input type="range" id="stageSlider" min="0" max="${d.stages.length - 1}" value="${DSTAGE}" aria-valuetext="${esc(st.label)}">
      <div class="stagelbls">${d.stages.map((s, i) => `<span class="${i === DSTAGE ? 'on' : ''}">${esc(s.label)}</span>`).join('')}</div>` : '<div class="eyebrow">Where in the brain</div>'}
      <p style="margin-top:12px"><b>${esc(st.label)}</b>${st.when ? ` · ${esc(st.when)}` : ''}<br>${esc(st.symptoms || '')}</p>
      <p class="tiny">Highlighted: ${st.regions.map(r => N[r]?.name).filter(Boolean).slice(0, 5).map(esc).join(', ')}${st.regions.length > 5 ? '…' : ''}</p></div>
    ${d.id === 'stroke' ? `<div class="section-h"><h2>Spot a stroke: BE-FAST</h2></div><div class="befast">${[['B', 'Balance'], ['E', 'Eyes'], ['F', 'Face'], ['A', 'Arm'], ['S', 'Speech'], ['T', 'Time: 911']].map(([l, t]) => `<div><b>${l}</b>${t}</div>`).join('')}</div>` : ''}
    <div class="section-h"><h2>What you can do</h2></div>
    <div class="list">${d.home.map(h => { const href = h.mission && HABIT[h.mission] ? `#/habit/${h.mission}` : h.game ? `#/check/${h.game}` : null;
      return `<${href ? `a href="${href}"` : 'div'} class="lrow"><span class="ico teal">${ic('check')}</span><div class="txt"><b>${esc(h.do)}</b><span>${esc(h.why)}</span></div>${href ? ic('chevron-right') : ''}</${href ? 'a' : 'div'}>`; }).join('')}</div>
    <div class="support-card warn" style="margin-top:14px"><b>When to call a doctor:</b> ${esc(d.doctor)}</div>
    <details class="card" style="margin-top:14px"><summary>How it varies</summary><p>${esc(d.varies)}</p><p class="tiny">Source: <a href="${d.source[1]}" target="_blank" rel="noopener">${esc(d.source[0])}</a>. Regions are mapped to a standard brain atlas: a guide, not a scan of anyone.</p></details>`;
  $('#stageSlider') && ($('#stageSlider').oninput = e => { DSTAGE = +e.target.value; diseaseDetail(); $('#stageSlider')?.focus(); });
  const colors = {}, c = hex(d.color);
  d.stages.forEach((s, i) => { if (i > DSTAGE) return; for (const r of s.regions) colors[r] = [...c, i === DSTAGE ? .85 : .45]; });
  brainView?.set(colors, deep);
  const v = VIEW[d.id] || [-1, .2, .3]; brainView?.fly(v[0], v[1], v[2], !!v[3]);
}
function mineView() {
  const S = MINE.skills;
  const C = { learning: '#8D8B83', improving: '#15803D', steady: '#0F766E', dipping: '#D97706' };
  const st = s => s.plays < 3 ? 'learning' : s.status === 'baseline' ? 'steady' : s.status;
  const W = { learning: 'Learning your baseline', improving: 'Improving', steady: 'Steady', dipping: 'Dipping: keep an eye on it' };
  const colors = {};
  for (const s of S) { if (!s.plays) continue; const sk = ATL.skills.find(x => x.id === s.id); for (const r of sk.regions) colors[r] = [...hex(C[st(s)]), .8]; }
  brainView?.set(colors, true); brainView?.fly(-1, .35, .55);
  const link = { memory: '#/check/recall', speed: '#/check/speed', movement: '#/check/reaction', language: '#/check/fluency', spatial: '#/check/corsi' };
  WHY.skills = ['How the map works', '<p>Each skill is linked to brain areas by decades of research. We color those areas from your games, compared only with your own first tries.</p><p>A game score tracks a skill, not brain tissue. A steady dip over weeks is worth mentioning to a doctor; one bad day isn\'t.</p>'];
  $('#bp').innerHTML = `<div class="list">${S.map(s => `<a class="lrow" href="${link[s.id] || '#/checks'}"><span class="ico" style="background:${C[st(s)]}1f;color:${C[st(s)]}">${ic('brain')}</span><div class="txt"><b>${esc(s.name)}</b><span>${s.plays ? `${W[st(s)]} · ${s.plays} play${s.plays === 1 ? '' : 's'}` : 'Not tested yet'}</span></div>${ic('chevron-right')}</a>`).join('')}</div>
    <div style="text-align:center">${whyBtn('skills', 'How the map works')}</div>
    <details class="card" style="margin-top:10px"><summary>Brain scans (research preview)</summary>
      <p class="muted">Our own MRI measures weren't reliable enough to score a person, so this is for learning only.</p>
      <div class="seg"><button class="on" data-mr="sample">A real research scan</button><button data-mr="upload">Check my file</button></div><div id="mriBox"></div></details>`;
  const show = m => { $$('[data-mr]').forEach(b => b.classList.toggle('on', b.dataset.mr === m)); m === 'sample' ? mriSamples() : mriUpload(); };
  $$('[data-mr]').forEach(b => b.onclick = () => show(b.dataset.mr));
  api('/api/mri/status').then(s => {
    if (s.samples) return show('sample');
    const sb = $('[data-mr="sample"]'); if (sb) { sb.disabled = true; sb.title = 'Research scans not downloaded'; }
    show('upload');
    $('#mriBox')?.insertAdjacentHTML('afterbegin', '<p class="tiny">Research scans aren\'t downloaded on this computer (needs <code>python data/download_data.py</code>).</p>');
  }).catch(() => show('upload'));
}
async function mriSamples() {
  const list = await api('/api/mri/samples'), box = $('#mriBox');
  box.innerHTML = `<p class="tiny">From the OASIS-1 study. Pick one person:</p><div class="chips">${list.map(s => `<button class="chip" data-f="${esc(s.file)}">${s.female ? 'F' : 'M'} ${Math.round(s.Age)} · ${s.status === 'cognitively normal' ? 'healthy' : 'dementia'}</button>`).join('')}</div><div id="mriOut" aria-live="polite"></div>`;
  $$('[data-f]', box).forEach(b => b.onclick = async () => {
    $$('[data-f]', box).forEach(x => x.classList.toggle('on', x === b));
    $('#mriOut').innerHTML = '<p class="muted">Loading the scan…</p>';
    const fd = new FormData(); fd.append('file', b.dataset.f);
    try {
      const r = await postForm('/api/me/mri/sample', fd), v = r.view;
      $('#mriOut').innerHTML = `<div class="mslices" style="margin-top:12px">${Object.entries(r.images).map(([k, src]) => `<img src="${src}" alt="${k} slice of the scan">`).join('')}</div>
        <h3>${r.female ? 'Woman' : 'Man'}, ${Math.round(r.age)} · ${r.status === 'cognitively normal' ? 'healthy volunteer' : `dementia diagnosis${r.cdr ? ` (CDR ${r.cdr})` : ''}`}</h3>
        <p>About <b>${v.per100_lower} of 100</b> healthy people the same age and sex have less brain tissue than this person.</p>
        <div class="bubble"><b>The lesson:</b> even this validated measure flags ${v.healthy_flag_per100} of 100 healthy people over 60 but only ${v.dementia_flag_per100} of 100 with dementia. One MRI number can't screen a person.</div>`;
    } catch (e) { $('#mriOut').innerHTML = `<p class="caveat">${esc(e.message)}</p>`; }
  });
}
function mriUpload() {
  $('#mriBox').innerHTML = `<label class="drop" id="mdrop"><input type="file" id="mfile" accept=".nii,.gz" hidden>${ic('upload')}<b>Choose a NIfTI file (.nii or .nii.gz)</b><span class="muted">It stays on this computer.</span></label><div id="mriOut" aria-live="polite"></div>`;
  const up = async f => {
    $('#mriOut').innerHTML = '<p class="muted">Reading your file…</p>';
    const fd = new FormData(); fd.append('file', f);
    try {
      const r = await postForm('/api/me/mri/upload', fd), F = r.format;
      $('#mriOut').innerHTML = `${Object.keys(r.images).length ? `<div class="mslices">${Object.entries(r.images).map(([k, src]) => `<img src="${src}" alt="${k} slice of your scan">`).join('')}</div>` : ''}
        <p>${F.ok ? 'Your file opened and matches the research format.' : esc((F.issues || []).join(' ') || 'This file is not in the research format our tools expect.')}</p>
        <p class="muted">We won't put a number on your scan: our measures failed accuracy tests. A radiologist's report is the trustworthy source.</p>`;
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
    const hits = ATL.diseases.filter(d => d.stages.some(s => s.regions.includes(rid))).map(d => esc(d.name.replace(' (motor neurone disease)', '')));
    sheet(r.name, `<div class="eyebrow">${r.kind === 'cortex' ? 'Outer layer (cortex)' : r.kind === 'fluid' ? 'Fluid space' : 'Deep structure'}</div><p>${esc(r.function || '')}</p>${hits.length ? `<p class="muted">Affected in: ${hits.join(', ')}</p>` : ''}`);
  });
}

// ================================================================== YOU
const ME_SECTIONS = {
  week: ['calendar-week', 'teal', 'Your week', 'Your weekly story'],
  patterns: ['bulb', 'amber', 'My patterns', 'What works for you'],
  report: ['file-text', 'blue', 'Doctor report', 'One page to print or share'],
  progress: ['chart-line', 'violet', 'Charts', 'Speed, blood pressure, steps, sleep'],
  focus: ['target-arrow', 'rose', 'What matters for you', 'From the CDC survey, plus what-ifs'],
  answers: ['clipboard-text', '', 'My answers', 'Update your health details'],
  connect: ['device-watch', '', 'Phone and watch', 'Import steps and sleep'],
  ask: ['message-circle', '', 'Ask a question', 'An AI assistant that reads your logs'],
  settings: ['settings', '', 'Text size and motion', 'Make it easier to read'],
  security: ['key', '', 'Passkey and sign-out', ''],
  how: ['microscope', '', 'How we know', 'The data, models and what we removed'],
  help: ['lifebuoy', '', 'Help and support', 'Crisis and helplines'],
};
async function pageMe(section) {
  if (section && ME_SECTIONS[section]) return meSection(section);
  const coach = await coachStatus();
  const row = k => { const [icon, tint, t, s] = ME_SECTIONS[k]; const sub = k === 'security' ? (AUTH.passkey ? 'Saved with a passkey' : 'Not saved yet') : s;
    return `<a class="lrow" href="#/me/${k}"><span class="ico ${tint}">${ic(icon)}</span><div class="txt"><b>${t}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ic('chevron-right')}</a>`; };
  main.innerHTML = `<div class="stack stagger"><div class="habit-h"><span class="ico lg teal">${ic('user')}</span><div><h1>${esc(firstName() || 'You')}</h1><span class="pill ${AUTH.passkey ? 'green' : 'amber'}">${ic(AUTH.passkey ? 'key' : 'alert-triangle')} ${AUTH.passkey ? 'Saved with a passkey' : 'Not saved yet'}</span></div></div>
    <div class="list">${['week', 'patterns', 'report', 'progress', 'focus'].map(row).join('')}</div>
    <div class="list">${['answers', 'connect', ...(coach ? ['ask'] : [])].map(row).join('')}</div>
    <div class="list">${['settings', 'security', 'how', 'help'].map(row).join('')}</div></div>`;
}
async function meSection(k) {
  const [, , title] = ME_SECTIONS[k];
  main.innerHTML = `<a class="back noprint" href="#/me">${ic('arrow-left')}You</a>${k === 'report' ? '' : `<h1>${title}</h1>`}<div id="sec" class="pop"></div>`;
  const box = $('#sec');
  if (k === 'week') return weekStory(box);
  if (k === 'report') return doctorReport(box);
  if (k === 'patterns') { box.innerHTML = '<div id="ibox"></div>'; return patternsBox(); }
  if (k === 'progress') { box.innerHTML = '<div class="stack" id="charts"></div>'; return progressCharts(); }
  if (k === 'focus') return focusBox(box);
  if (k === 'answers') { box.innerHTML = '<div class="card" id="abox"></div>'; return answersBox(); }
  if (k === 'connect') { box.innerHTML = '<div class="card" id="wbox"></div>'; return wearBox(); }
  if (k === 'ask') { box.innerHTML = '<div id="askBox"></div>'; return askCard(); }
  if (k === 'how') { FACTS ||= await api('/api/facts'); box.innerHTML = `<div class="card">${howWeKnow()}</div>`; return; }
  if (k === 'help') { box.innerHTML = `<div class="card">${HELP}</div>`; return; }
  if (k === 'settings') return settingsBox(box);
  if (k === 'security') {
    box.innerHTML = `<div class="card"><p>${AUTH.passkey ? 'You sign in with your fingerprint, face or device PIN. There\'s no password to steal.' : 'Not saved yet: this browser is your only way back in. Save a passkey to keep your progress.'}</p>
      <div class="stack"><button class="btn accent big" id="addPk">${ic('key')} ${AUTH.passkey ? 'Add another passkey' : 'Save with a passkey'}</button><button class="btn secondary big" id="signout">${ic('logout')} Sign out</button></div>
      <p class="tiny" style="margin-top:12px">Passkeys (WebAuthn) are bound to this site, so a look-alike site can't phish them. Your data stays in a local database on this computer.</p></div>`;
    $('#addPk').onclick = () => savePasskey(() => meSection('security'));
    $('#signout').onclick = async () => { if (!AUTH.passkey && !confirm('You haven\'t saved a passkey. If you sign out, you can\'t get back to this progress. Sign out anyway?')) return; await api('/auth/logout', {}); AUTH = { signed_in: false }; renderWho(); history.replaceState(null, '', '/'); route(); };
  }
}
function settingsBox(box) {
  const s = store.get('nt-size') || '1', c = store.get('nt-calm') === '1';
  box.innerHTML = `<div class="card"><b>Text size</b><div class="seg" style="grid-template-columns:repeat(3,1fr)">${[['1', 'A'], ['1.15', 'A+'], ['1.3', 'A++']].map(([v, t]) => `<button class="${s === v ? 'on' : ''}" data-size="${v}" aria-pressed="${s === v}">${t}</button>`).join('')}</div>
    <b>Calm mode</b><p class="muted">Turns off all animation and movement.</p><button class="btn ${c ? 'accent' : 'secondary'}" id="calmT" aria-pressed="${c}">${c ? 'On' : 'Off'}</button></div>`;
  $$('[data-size]', box).forEach(b => b.onclick = () => { store.set('nt-size', b.dataset.size); applySettings(); settingsBox(box); });
  $('#calmT').onclick = () => { store.set('nt-calm', c ? '0' : '1'); applySettings(); settingsBox(box); };
}

// ------------------------------------------------------------------ Your week
async function weekStory(box) {
  const [P, I] = await Promise.all([api('/api/me/progress?days=7'), api('/api/me/insights').catch(() => null)]);
  const days = P.days, inWeek = d => d >= days[0];
  const roundsWeek = P.speed.filter(r => inWeek(r.date)), roundsBefore = P.speed.filter(r => !inWeek(r.date));
  const act = days.map((d, i) => P.quests_per_day[i] + roundsWeek.filter(r => r.date === d).length);
  const active = act.filter(x => x > 0).length, mx = Math.max(1, ...act);
  const bestW = roundsWeek.length ? Math.max(...roundsWeek.map(r => r.correct)) : null, bestB = roundsBefore.length ? Math.max(...roundsBefore.map(r => r.correct)) : null;
  const head = bestW != null && bestB != null && bestW > bestB ? 'Your quickest week yet' : active >= 5 ? `A steady week: ${active} of 7 days` : active ? `A start: ${active} day${active > 1 ? 's' : ''} this week` : 'A fresh week ahead';
  const bp = avg(P.bp.map(b => b.value).filter(v => v != null)), sl = avg(P.sleep.map(s => s.value).filter(v => v != null));
  const top = I?.ready && I.insights.find(i => i.level === 'clear' || i.level === 'hint');
  const fmtD = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  box.innerHTML = `<p class="muted" style="margin-top:-6px">${fmtD(days[0])} to ${fmtD(days[6])}</p>
    <div class="card"><h2 style="font-size:1.5rem">${head}</h2>
      <div class="weekbars">${days.map((d, i) => `<div class="${act[i] ? 'on' : ''}"><i style="height:${Math.max(4, act[i] / mx * 100)}%"></i>${new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</div>`).join('')}</div></div>
    <div class="statrow"><div class="stat"><span>Active days</span><b>${active}/7</b></div><div class="stat"><span>Best Speed Sprint</span><b>${bestW ?? '–'}</b></div>
      <div class="stat"><span>Blood pressure</span><b>${bp != null ? Math.round(bp) : '–'}</b></div><div class="stat"><span>Sleep</span><b>${sl != null ? sl.toFixed(1) + ' h' : '–'}</b></div></div>
    ${top ? `<div class="card minicard"><span class="ico amber">${ic('bulb')}</span><div class="txt"><b>${esc(top.headline)}</b><span>${top.level === 'clear' ? 'Clear pattern' : 'Early hint'} in your data</span></div></div>` : ''}
    <div class="stack" style="margin-top:14px"><a class="btn accent big" href="#/me/report">${ic('file-text')} Share report with my doctor</a></div>`;
}

// ------------------------------------------------------------------ Doctor report (print / save as PDF)
async function doctorReport(box, signed = null) {
  const { report: R, signed: list } = await api('/api/me/report');
  const G = R.glance, fmtD = d => new Date(d.length === 10 ? d + 'T12:00' : d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const live = list.filter(s => !s.revoked && new Date(s.expires) > new Date());
  WHY.signing = ['How signing works', `<p><b>1. You approve it</b> with your passkey (fingerprint, face or PIN). Your passkey signs this exact report.</p>
    <p><b>2. NeuroTrail signs it</b> with a certificate from its own certificate authority, the same way hospitals and banks sign documents.</p>
    <p><b>3. Your doctor scans the QR code.</b> Their browser checks both signatures. If anyone changed a single number, it shows "This report has been changed".</p>
    <p class="muted">The report expires in 90 days, and you can revoke it at any time.</p>`];
  box.innerHTML = `<div class="row noprint" style="justify-content:space-between;margin-bottom:12px"><span class="pill ${signed ? 'green' : ''}">${ic(signed ? 'shield-check' : 'file-text')} ${signed ? 'Signed and verifiable' : 'Draft'}</span>
      <button class="btn secondary" id="printBtn">${ic('printer')} Print or PDF</button></div>
  ${signed ? '' : `<div class="card noprint" style="margin-bottom:14px"><div class="habit-h" style="margin:0 0 6px"><span class="ico teal">${ic('signature')}</span><div><b style="font:700 1.1rem var(--display)">Make it verifiable</b><div class="muted">Add a QR code your doctor can scan to check nothing was changed.</div></div></div>
      <button class="btn accent big" id="signBtn">${ic(AUTH.passkey ? 'fingerprint' : 'qrcode')} ${AUTH.passkey ? 'Approve with your passkey and sign' : 'Sign and add QR code'}</button>
      <div style="text-align:center">${whyBtn('signing', 'How signing works')}</div>
      ${AUTH.passkey ? '' : '<p class="tiny">Save a passkey (You → Passkey) so your doctor also sees that you approved it.</p>'}</div>`}
  <article class="report">
    <h1>Brain-health summary</h1>
    <div class="meta"><span>${esc(R.subject.label)}</span><span>Age ${R.subject.age}</span><span>${esc(R.subject.sex)}</span><span>${fmtD(R.period[0])} to ${fmtD(R.period[1])}</span></div>
    <h2>At a glance</h2>
    <div class="statrow"><div class="stat"><span>Blood pressure (avg)</span><b>${G.bp_avg ?? '–'}</b><span>${G.bp_readings} reading${G.bp_readings === 1 ? '' : 's'}</span></div>
      <div class="stat"><span>Mood (PHQ-8)</span><b>${G.phq8 ?? '–'}</b><span>of 24</span></div><div class="stat"><span>Sleep (avg)</span><b>${G.sleep_avg_h != null ? G.sleep_avg_h + ' h' : '–'}</b></div>
      <div class="stat"><span>Steps (avg)</span><b>${G.steps_avg != null ? Math.round(G.steps_avg).toLocaleString() : '–'}</b></div></div>
    ${R.questions.length ? `<h2>Questions to ask</h2><ul>${R.questions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${R.bp_readings.length ? `<h2>Home blood pressure</h2><div class="tablewrap"><table class="t"><tr><th>Date</th><th>Reading</th></tr>${R.bp_readings.slice().reverse().map(([d, s, di]) => `<tr><td>${fmtD(d)}</td><td>${s}${di ? ' / ' + di : ''} mmHg</td></tr>`).join('')}</table></div>` : ''}
    ${R.games.length ? `<h2>Thinking games (compared only with themselves)</h2><div class="tablewrap"><table class="t"><tr><th>Game</th><th>Plays</th><th>First</th><th>Best</th><th>Latest</th></tr>${R.games.map(g => `<tr><td>${esc(g.game)}</td><td>${g.plays}</td><td>${g.first}</td><td>${g.best}</td><td>${g.latest}</td></tr>`).join('')}</table></div>
      <p class="tiny">Scores usually rise with practice. A steady drop over several weeks is more meaningful than any single result.</p>` : ''}
    ${R.patterns.length ? `<h2>Patterns in their own data</h2><ul>${R.patterns.map(p => `<li>${esc(p.finding)} (${p.level === 'clear' ? 'clear pattern' : 'early hint'}, ${p.days[0]} vs ${p.days[1]} days)</li>`).join('')}</ul>` : ''}
    ${R.self_reported.length ? `<h2>Self-reported</h2><p>${R.self_reported.map(esc).join(' · ')}</p>` : ''}
    ${signed ? `<h2>Verify this report</h2><div class="row" style="align-items:center;gap:18px"><img src="/api/report/${encodeURIComponent(signed.id)}/qr.svg" alt="QR code to verify this report" width="132" height="132" style="border-radius:12px;border:1px solid var(--line)">
      <div><p style="margin:0"><b>${signed.approved ? 'Approved by the patient with a passkey and signed by NeuroTrail' : 'Signed by NeuroTrail'}</b></p>
      <p class="tiny" style="margin:4px 0">Scan to check it hasn't been changed, or visit:<br><a href="${esc(signed.url)}" target="_blank" rel="noopener">${esc(signed.url)}</a></p>
      <p class="tiny" style="margin:0">Report ${esc(signed.id)} · valid 90 days</p></div></div>` : ''}
    <p class="tiny" style="margin-top:22px">${esc(R.note)}</p>
  </article>
  ${live.length ? `<div class="section-h noprint"><h2>Your signed reports</h2></div><div class="list noprint">${live.map(s => `<div class="lrow"><span class="ico green">${ic('shield-check')}</span><div class="txt"><b>${fmtD(s.issued)}</b><span>Valid until ${fmtD(s.expires)}</span></div>
      <a class="btn secondary" href="/verify/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Open</a><button class="btn secondary" data-revoke="${esc(s.id)}">Revoke</button></div>`).join('')}</div>` : ''}`;
  $('#printBtn').onclick = () => print();
  $$('[data-revoke]', box).forEach(b => b.onclick = async () => {
    if (!confirm('Revoke this report? Anyone who scans it will see it was withdrawn.')) return;
    await api(`/api/me/report/${encodeURIComponent(b.dataset.revoke)}/revoke`, {}); toast('Report revoked'); doctorReport(box, signed?.id === b.dataset.revoke ? null : signed);
  });
  $('#signBtn') && ($('#signBtn').onclick = async () => {
    $('#signBtn').disabled = true;
    try {
      const o = await api('/api/me/report/options', {});
      let body = { id: o.id };
      if (o.approval) {
        const block = passkeyBlocker(); if (block) throw new Error(block);
        const credential = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: o.approval.options });
        body = { ...body, key: o.approval.key, credential };
      }
      const s = await api('/api/me/report/sign', body);
      toast(s.approved ? 'Approved and signed' : 'Signed'); doctorReport(box, s); scrollTo(0, 0);
    } catch (e) { toast(e.name === 'NotAllowedError' ? 'Passkey approval was cancelled.' : e.message, 6000); $('#signBtn') && ($('#signBtn').disabled = false); }
  });
}

// ------------------------------------------------------------------ What matters (survey model + what-if)
function focusBox(box) {
  const L = ME.lever, top = Object.entries(L.per_factor).filter(([, f]) => f.known && f.significant && f.points > .1).sort((a, b) => b[1].points - a[1].points);
  const unknown = Object.entries(L.per_factor).filter(([, f]) => !f.known);
  box.innerHTML = `<p class="muted" style="margin-top:-6px">In a CDC survey of ${L.n.toLocaleString()} adults over 60, these were linked to slower thinking.</p>
    <div class="card">${top.length ? top.map(([k, f]) => `<div class="lever"><b>${esc(f.label)}</b><span class="size ${sizeCls(f.size)}">${f.size}</span>
      <span class="muted" style="grid-column:1/-1">About ${f.points.toFixed(1)} points lower on a thinking-speed test${FACTOR_HABIT[k] ? ` · <a href="#/habit/${FACTOR_HABIT[k]}">Habit</a>` : ''}</span></div>`).join('') : '<p>You\'re at the healthy targets for every factor with a clear link.</p>'}
      ${unknown.length ? `<p class="muted">Not known yet: ${unknown.map(([, f]) => esc(f.label)).join(', ')}.</p>` : ''}</div>
    <div class="section-h"><h2>What if…</h2></div><div class="card" id="tryBox"></div>
    <p class="tiny">Links in survey data, not proof of cause. Points are on a 0–133 test.</p>`;
  wireTry();
}
function wireTry() {
  const p = { ...ME.profile }, box = $('#tryBox');
  const S = { sbp: p.sbp ? Math.round(p.sbp) : 140, sleep: p.sleep_hours ?? 7, smoke: !!p.current_smoker };
  box.innerHTML = `<div class="q"><b>Blood pressure</b>${stepper('trSbp', S.sbp, ' mmHg', 'Blood pressure')}</div>
    <div class="q"><b>Sleep</b>${stepper('trSleep', S.sleep, ' h', 'Sleep')}</div>
    ${p.current_smoker ? `<div class="q"><b>Smoking</b><div class="yesno"><button data-v="1" class="on">Still smoking</button><button data-v="0">Quit</button></div></div>` : ''}
    <div class="bubble" id="trOut" aria-live="polite">…</div>`;
  let t; const go = () => { clearTimeout(t); t = setTimeout(async () => {
    const body = { sbp: S.sbp, diabetes: !!p.diabetes, current_smoker: S.smoke, active_min_week: p.active_min_week ?? 0, sedentary_min_day: p.sedentary_min_day ?? 360, sleep_hours: S.sleep, phq9: p.phq9 };
    const r = await api('/api/lever', body), now = ME.lever.points;
    $('#trOut') && ($('#trOut').innerHTML = `Points linked to your factors: <b>${now.toFixed(1)}</b> now → <b>${r.points.toFixed(1)}</b> with these values. Lower is better.`);
  }, 200); };
  wireStepper(box, 'trSbp', () => S.sbp, v => { S.sbp = v; go(); }, { min: 90, max: 200, step: 5, unit: ' mmHg' });
  wireStepper(box, 'trSleep', () => S.sleep, v => { S.sleep = v; go(); }, { min: 3, max: 12, step: .5, unit: ' h' });
  choice(box, '.yesno button', v => { S.smoke = v === '1'; go(); });
  go();
}

// ------------------------------------------------------------------ Personal insights
const LEVEL = { clear: ['Clear pattern', 'lv-clear'], hint: ['Early hint', 'lv-hint'], none: ['No clear difference yet', 'lv-none'], more_data: ['Needs more days', 'lv-none'] };
const INS_ICON = { sleep: ['moon', 'violet'], steps: ['walk', 'green'], connect: ['message-circle', 'blue'], joy: ['mood-smile', 'amber'] };
function insightExample(e) {
  if (!e) return '';
  const fmtv = v => ['ms', 'correct', 'animals'].includes(e.unit) ? Math.round(v) : v;
  const word = e.better_pct >= 0 ? (e.lower_is_better ? 'faster' : 'better') : (e.lower_is_better ? 'slower' : 'lower');
  const mx = Math.max(e.with, e.without) || 1;
  return `<div class="ibars" role="img" aria-label="${esc(e.check)}: ${fmtv(e.with)} ${esc(e.unit)} on those days versus ${fmtv(e.without)} on other days">
      <div class="ibar yes"><span>Those days</span><i style="--w:${e.with / mx * 100}%"></i><b>${fmtv(e.with)} ${esc(e.unit)}</b></div>
      <div class="ibar"><span>Other days</span><i style="--w:${e.without / mx * 100}%"></i><b>${fmtv(e.without)} ${esc(e.unit)}</b></div></div>
    <p class="tiny">${esc(e.check)}: ${Math.abs(e.better_pct)}% ${word} on average.</p>`;
}
function insightRow(i) {
  const [lab, cls] = LEVEL[i.level], [icon, tint] = INS_ICON[i.key] || ['bulb', 'amber'];
  const head = i.level === 'more_data' ? `Days you ${esc(i.phrase)}` : esc(i.headline);
  const sub = i.level === 'more_data' ? `Needs 3+ days each way (now ${i.n_yes} with, ${i.n_no} without).` : `${i.n_yes} days vs ${i.n_no} days`;
  return `<div class="insight ${i.level === 'none' || i.level === 'more_data' ? 'dim' : ''}"><span class="ico ${tint}">${ic(icon)}</span><div><b>${head}</b>
    ${i.level === 'clear' || i.level === 'hint' ? insightExample(i.example) : ''}<p class="tiny">${sub}</p></div><span class="lv ${cls}">${lab}</span></div>`;
}
async function patternsBox() {
  const r = await api('/api/me/insights').catch(() => null), box = $('#ibox');
  if (!r || !box) return;
  WHY.conf = ['How confident is this?', `<p>Each row compares your game scores on days you did something with your other days. Practice gains are removed first, so getting used to a game isn't credited to a habit.</p>
    <p><b>Clear pattern</b>: unlikely to be chance, even after adjusting for testing several habits at once, with 5+ days on each side.<br><b>Early hint</b>: worth watching.<br><b>No clear difference</b>: your data can't tell yet.</p><p class="muted">${esc(r.note || 'Patterns in your own data, not proof of cause.')}</p>`];
  if (!r.ready) {
    const S = r.status;
    box.innerHTML = `<div class="card"><p>After ${S.days_needed} days of sessions, we'll show which of <b>your</b> habits go with better results on <b>your</b> games.</p>
      <div class="unlock"><i style="width:${S.days_with_both / S.days_needed * 100}%"></i></div><p class="tiny">${S.days_with_both} of ${S.days_needed} days so far</p><a class="btn accent" href="#/session">Do today's session</a></div>`;
    return;
  }
  box.innerHTML = `<div class="card">${r.insights.map(insightRow).join('')}</div><div style="text-align:center">${whyBtn('conf', 'How confident is this?')}</div>`;
}

// ------------------------------------------------------------------ AI assistant (optional)
async function coachStatus() { if (COACH == null) COACH = await api('/api/coach/status').then(s => !!s.claude).catch(() => false); return COACH; }
function askCard() {
  $('#askBox').innerHTML = `<div class="card"><p class="muted">An AI assistant (Claude) that can read your logs and run the same models. It can be wrong, and it isn't a doctor.</p>
    <div class="opts">${['What should I focus on this week?', 'Why does blood pressure matter for my brain?', 'Make me a 7-day plan'].map(q => `<button class="opt" data-q="${esc(q)}">${q}${ic('arrow-right')}</button>`).join('')}</div>
    <div id="askOut" aria-live="polite" style="margin-top:12px"></div></div>`;
  $$('[data-q]').forEach(b => b.onclick = async () => {
    $('#askOut').innerHTML = '<div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div>';
    try { const r = await api('/api/me/coach', { text: b.dataset.q }); $('#askOut').innerHTML = `<div class="bubble">${esc(r.text).replace(/\n/g, '<br>')}</div>`; }
    catch (e) { $('#askOut').innerHTML = `<p class="caveat">${esc(e.message)}</p>`; }
  });
}

// ------------------------------------------------------------------ data pages
function howWeKnow() {
  const F = FACTS, N = F.nhanes, O = F.oasis;
  return `<h3>What NeuroTrail is for</h3><div class="tablewrap"><table class="t"><tr><th>It is</th><th>It is not</th></tr>
    <tr><td>A habit coach built on published evidence</td><td>A diagnosis or a dementia risk score</td></tr>
    <tr><td>Tracking against your own earlier scores</td><td>A comparison with other people</td></tr>
    <tr><td>Education about brain diseases</td><td>A reading of your MRI</td></tr></table></div>
    <h3 style="margin-top:18px">Habits and thinking speed (CDC NHANES 2011–2014)</h3>
    <p>${N.complete_cases.toLocaleString()} adults 60+. Survey-weighted regression on the Digit Symbol test (0–133 points). Adding habits improved prediction from R² ${N.r2_demographics.toFixed(2)} to ${N.r2_full.toFixed(2)}.</p>
    <div class="tablewrap"><table class="t"><tr><th>Change</th><th>Points</th><th>Clear link?</th></tr>${N.contrasts.map(c => `<tr><td>${esc(c.label)}</td><td>${fmt(c.dsst_points)} (${fmt(c.dsst_ci[0])} to ${fmt(c.dsst_ci[1])})</td><td>${c.p_value < .05 ? 'Yes' : 'No'}</td></tr>`).join('')}</table></div>
    <p class="tiny">Fairness check: the model's average error differs by group (${Object.entries(N.fairness_mean_bias).map(([g, b]) => `${esc(g)} ${fmt(b)}`).join(', ')}), so these numbers are only used for what-ifs within one person.</p>
    <h3 style="margin-top:18px">Real MRI scans (OASIS-1, ${O.volumes} volumes)</h3>
    <p>OASIS's validated brain-volume measure separates dementia from healthy scans with AUC ${F.nwbv_model.auc.toFixed(2)}: useful for research, not for screening one person.</p>
    <h3 style="margin-top:18px">What we built, tested and removed</h3>
    ${F.removed.map(r => `<div class="lever"><b>${esc(r.what)}</b><span class="size Bigger">Removed</span><span class="muted" style="grid-column:1/-1">${esc(r.why)}</span></div>`).join('')}`;
}
function answersBox() {
  const p = { ...ME.profile }, box = $('#abox');
  const yn = (k, label) => `<div class="q"><b>${label}</b><div class="yesno" data-k="${k}"><button data-v="1" class="${p[k] ? 'on' : ''}">Yes</button><button data-v="0" class="${p[k] ? '' : 'on'}">No</button></div></div>`;
  box.innerHTML = `<div class="q"><b>Blood pressure (top number)</b>${p.sbp == null ? '<p class="muted">Unknown. <button class="linkbtn" id="setBp">Add my reading</button></p><div id="bpS"></div>' : stepper('aSbp', Math.round(p.sbp), ' mmHg', 'Blood pressure')}</div>
    <div class="q"><b>Usual sleep</b>${stepper('aSleep', p.sleep_hours ?? 7, ' h', 'Sleep')}</div>
    ${yn('diabetes', 'Diabetes')}${yn('current_smoker', 'Smoke now')}${yn('hearing_trouble', 'Trouble hearing')}
    <button class="btn accent big" id="saveAns">Save</button>`;
  const wireBp = () => wireStepper(box, 'aSbp', () => p.sbp, v => { p.sbp = v; }, { min: 80, max: 220, step: 1, unit: ' mmHg' });
  if (p.sbp != null) { p.sbp = Math.round(p.sbp); wireBp(); }
  $('#setBp') && ($('#setBp').onclick = () => { p.sbp = 125; $('#bpS').innerHTML = stepper('aSbp', 125, ' mmHg', 'Blood pressure'); wireBp(); });
  wireStepper(box, 'aSleep', () => p.sleep_hours ?? 7, v => { p.sleep_hours = v; }, { min: 2, max: 12, step: .5, unit: ' h' });
  $$('.yesno', box).forEach(g => choice(g, 'button', v => { p[g.dataset.k] = v === '1'; }));
  $('#saveAns').onclick = async () => { ME = await api('/api/me/profile', { sbp: p.sbp, sleep_hours: p.sleep_hours, diabetes: p.diabetes, current_smoker: p.current_smoker, hearing_trouble: p.hearing_trouble }); toast('Saved'); };
}
async function progressCharts() {
  const P = await api('/api/me/progress?days=30'), box = $('#charts'), sh = d => d.slice(5), bp = P.bp.filter(b => b.value != null);
  const block = (t, sub, has, id, empty) => `<div class="card"><h3>${t}</h3><p class="tiny">${sub}</p>${has ? `<div class="chartbox"><canvas id="${id}"></canvas></div>` : `<div class="empty">${empty}</div>`}</div>`;
  box.innerHTML = [block('Speed Sprint', 'Correct in 90 seconds', P.speed.length, 'cSpeed', 'Play a Speed Sprint to start this chart.'),
    block('Blood pressure', 'Top number. Trial target: under 120.', bp.length, 'cBP', 'Log a reading in the blood pressure habit.'),
    block('Steps', 'Lines at 3,826 and 9,826 steps', P.steps.length, 'cSteps', 'Log steps in the walking habit.'),
    block('Sleep', 'Hours per night', P.sleep.length, 'cSleep', 'Do the daily check-in to start this chart.')].join('');
  const line = (id, labels, data, color, extra = []) => chart(id, { type: 'line', data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + '14', fill: true, tension: .3, label: 'you' }, ...extra] }, options: chartOpts({ plugins: { legend: { display: false } } }) });
  if (P.speed.length) line('cSpeed', P.speed.map(r => sh(r.date)), P.speed.map(r => r.correct), '#0F766E');
  if (bp.length) line('cBP', bp.map(b => sh(b.date)), bp.map(b => b.value), '#BE123C', [{ data: bp.map(() => 120), borderColor: '#15803D', borderDash: [6, 4], pointRadius: 0, label: 'target 120' }]);
  if (P.steps.length) line('cSteps', P.steps.map(s => sh(s.date)), P.steps.map(s => s.value), '#15803D', [{ data: P.steps.map(() => 3826), borderColor: '#D97706', borderDash: [6, 4], pointRadius: 0 }, { data: P.steps.map(() => 9826), borderColor: '#6D28D9', borderDash: [6, 4], pointRadius: 0 }]);
  if (P.sleep.length) line('cSleep', P.sleep.map(s => sh(s.date)), P.sleep.map(s => s.value), '#6D28D9');
}
async function wearBox() {
  const W = await api('/api/me/wearables'), S = W.summary, days = Object.entries(W.days), box = $('#wbox');
  box.innerHTML = `<label class="drop" id="wdrop"><input type="file" id="wfile" accept=".zip,.xml,.csv" hidden>${ic('device-watch')}<b>Choose your Apple Health export.zip</b><span class="muted">or a CSV with date, steps and sleep_hours</span></label>
    <p class="tiny">iPhone: Health app → your photo → Export All Health Data.</p><div id="wmsg" aria-live="polite"></div>
    ${S.days_with_data ? `<div class="vstats">${S.steps != null ? `<div><b>${Math.round(S.steps).toLocaleString()}</b><span>steps a day</span></div>` : ''}${S.sleep_hours != null ? `<div><b>${S.sleep_hours.toFixed(1)} h</b><span>sleep a night</span></div>` : ''}${S.resting_hr != null ? `<div><b>${Math.round(S.resting_hr)}</b><span>resting heart rate</span></div>` : ''}</div>
      <p class="tiny">${S.days_with_data} days imported (${S.from} to ${S.to}).</p><div class="chartbox"><canvas id="wch"></canvas></div>` : ''}`;
  if (days.length) chart('wch', { type: 'bar', data: { labels: days.map(d => d[0].slice(5)), datasets: [{ label: 'steps', data: days.map(d => d[1].steps ?? null), backgroundColor: 'rgba(15,118,110,.7)', borderRadius: 6 }] }, options: chartOpts() });
  const up = async f => { $('#wmsg').innerHTML = '<p class="muted">Reading your file… (large exports can take a minute)</p>';
    const fd = new FormData(); fd.append('file', f);
    try { const j = await postForm('/api/me/wearables', fd); ME = j.player; toast(`Imported ${j.imported_days} days`); wearBox(); } catch (e) { $('#wmsg').innerHTML = `<p class="caveat">${esc(e.message)}</p>`; } };
  $('#wfile').onchange = e => e.target.files[0] && up(e.target.files[0]);
  const d = $('#wdrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over'); d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); e.dataTransfer.files[0] && up(e.dataTransfer.files[0]); };
}

// ================================================================== BOOT
window.NTX = { api, toast, chart, chartOpts, fmt, renderHUD: renderWho, QMAP: () => QMAP, getME: () => ME, setME: m => { ME = m; },
  afterGame: () => AFTER_GAME, closeHref: () => ROUTE === 'session' ? '#/today' : '#/checks' };
(async () => {
  applySettings();
  try { AUTH = await api('/auth/me'); } catch { AUTH = { signed_in: false }; }
  await loadQuests().catch(() => {});
  route();
})();
