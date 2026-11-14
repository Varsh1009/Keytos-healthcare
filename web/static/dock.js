// Side menu (☰) and the floating brain-buddy coach.
// Side menu: Science, full coach page, text size, log out — kept out of the main tabs.
// Buddy: bottom-right, opens a small chat with the same AI coach (/api/player/{name}/coach).
// It can talk: replies are read aloud (browser speech synthesis) and you can speak your question
// (browser speech recognition, Chrome/Edge/Safari). Both are optional and can be switched off.
import { buddy } from './ui2.js?v=12';

const X = () => window.NTX;
const $ = s => document.querySelector(s);
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };

const SIZES = [['A', 1], ['A+', 1.15], ['A++', 1.3]];
const HIDE_BUDDY_ON = ['home', 'coach', 'game', 'sprint', 'hands'];   // Home has its own big buddy (tap it to chat)   // full-screen tasks: keep the buddy out of the way
const QUICK = ['How am I doing?', 'What should I do today?', 'What do my games say?'];
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
let ready = false, talk = store.get('nt_talk', '1') === '1', loaded = false;

function applySize(i) {
  document.documentElement.style.setProperty('--zoom', SIZES[i][1]);
  document.querySelectorAll('#drawer [data-size]').forEach(b => b.classList.toggle('on', +b.dataset.size === i));
  store.set('nt_size', i);
}

function say(text) {
  if (!talk || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g, '').slice(0, 600));
  u.rate = 1.02; u.pitch = 1.15;
  speechSynthesis.speak(u);
}

function bubble(m) {
  return `<div class="bmsg ${m.role}">${esc(m.content)}</div>`;
}

async function loadHistory() {
  const box = $('#bMsgs'), me = X().getME();
  const h = await X().api(`/api/player/${enc(me.name)}/coach`).catch(() => ({ messages: [] }));
  const ms = h.messages.slice(-6);
  box.innerHTML = ms.length ? ms.map(bubble).join('')
    : bubble({ role: 'assistant', content: `Hi ${me.name}! I'm your brain buddy. I read your games and your data, then answer. Ask me anything!` });
  box.scrollTop = box.scrollHeight;
  loaded = true;
}

async function send(text) {
  text = text.trim();
  if (!text) return;
  const box = $('#bMsgs'), me = X().getME();
  $('#bAsk').value = '';
  box.insertAdjacentHTML('beforeend', bubble({ role: 'user', content: text }) + '<div class="bmsg assistant typing" id="bTyping"><span></span><span></span><span></span></div>');
  box.scrollTop = box.scrollHeight;
  $('#coachFab').classList.add('thinking');
  try {
    const r = await X().api(`/api/player/${enc(me.name)}/coach`, { text });
    $('#bTyping')?.remove();
    box.insertAdjacentHTML('beforeend', bubble({ role: 'assistant', content: r.text }));
    say(r.text);
  } catch (e) {
    $('#bTyping')?.remove();
    box.insertAdjacentHTML('beforeend', bubble({ role: 'assistant', content: `Sorry, I couldn't answer: ${e.message}` }));
  }
  $('#coachFab').classList.remove('thinking');
  box.scrollTop = box.scrollHeight;
}

function listen() {
  if (!Speech) return X().toast('Voice input needs Chrome, Edge or Safari');
  const rec = new Speech();
  rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
  const mic = $('#bMic');
  mic.classList.add('on');
  rec.onresult = e => { $('#bAsk').value = [...e.results].map(r => r[0].transcript).join(''); };
  rec.onerror = e => X().toast(e.error === 'not-allowed' ? 'Microphone blocked. Allow it in the browser to talk.' : 'Didn\'t catch that. Try again?');
  rec.onend = () => { mic.classList.remove('on'); send($('#bAsk').value); };
  rec.start();
}

function togglePop(open) {
  const pop = $('#coachPop');
  open = open ?? !pop.classList.contains('open');
  pop.classList.toggle('open', open);
  $('#coachFab').classList.toggle('open', open);
  if (open) { if (!loaded) loadHistory(); setTimeout(() => $('#bAsk').focus(), 50); }
  else window.speechSynthesis?.cancel();
}

function toggleDrawer(open) {
  open = open ?? !$('#drawer').classList.contains('open');
  $('#drawer').classList.toggle('open', open);
  $('#scrim').classList.toggle('open', open);
  if (open) $('#drawerName').textContent = X().getME()?.name || '';
}

function onRoute() {
  const r = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'home';
  $('#coachFab').hidden = HIDE_BUDDY_ON.includes(r);
  if ($('#coachFab').hidden) togglePop(false);
  toggleDrawer(false);
  mediaCheck(r);
}

// Camera / mic blocked? Say so up front with the fix, instead of a check that silently never records.
const NEEDS = { hands: ['camera', '📷 Camera'], voice: ['microphone', '🎙️ Microphone'] };
async function mediaCheck(r) {
  document.getElementById('mediaBanner')?.remove();
  const voiceGame = r === 'game' && /#\/game\/(voice|readaloud|fluency)/.test(location.hash);
  const need = NEEDS[r] || (voiceGame ? NEEDS.voice : null);
  if (!need) return;
  let state = 'prompt';
  try { state = (await navigator.permissions.query({ name: need[0] })).state; } catch { }
  if (state !== 'denied') return;
  const url = location.href;
  document.body.insertAdjacentHTML('beforeend', `<div class="media-banner glass" id="mediaBanner" role="alert">
    <b>${need[1]} is blocked in this window</b><span>Nothing can be recorded here. Allow it in the browser, or open the app in Chrome.</span>
    <button class="chip" id="mbCopy">Copy link for Chrome</button><button class="chip" id="mbClose" aria-label="Close">✕</button></div>`);
  $('#mbCopy').onclick = () => navigator.clipboard?.writeText(url).then(() => X().toast('Link copied. Paste it into Chrome.'));
  $('#mbClose').onclick = () => document.getElementById('mediaBanner')?.remove();
}

export function initDock() {
  if (ready) { loaded = false; onRoute(); return; }      // new player: reload chat on next open
  ready = true;
  $('#hud .brand').insertAdjacentHTML('beforebegin', '<button class="menu-btn" id="menuBtn" aria-label="Open menu">☰</button>');
  document.body.insertAdjacentHTML('beforeend', `
    <div class="scrim" id="scrim"></div>
    <aside class="drawer glass" id="drawer" aria-label="Menu">
      <div class="drawer-head"><div class="dbuddy">${buddy('happy', 46)}</div><div><div class="tiny">SIGNED IN AS</div><b id="drawerName"></b></div>
        <button class="dclose" id="drawerClose" aria-label="Close menu">✕</button></div>
      <a class="ditem" href="#/coach">🤖 <span>Coach chat &amp; saved plans</span></a>
      <a class="ditem" href="#/science">🔬 <span>The science</span></a>
      <div class="dsec">TEXT SIZE</div>
      <div class="dsizes">${SIZES.map(([l], i) => `<button class="chip" data-size="${i}">${l}</button>`).join('')}</div>
      <div class="dsec">BUDDY</div>
      <label class="ditem dtoggle"><input type="checkbox" id="talkToggle" ${talk ? 'checked' : ''}> <span>🔊 Buddy reads answers aloud</span></label>
      <button class="ditem dlogout" id="logoutBtn">🚪 <span>Log out / switch player</span></button>
    </aside>
    <div class="coach-fab" id="coachFab">
      <div class="fab-hint" id="fabHint">Psst… ask me!</div>
      <button class="fab-btn" id="fabBtn" aria-label="Open your brain buddy coach">${buddy('happy', 74)}</button>
    </div>
    <div class="coach-pop glass" id="coachPop" role="dialog" aria-label="Brain buddy coach">
      <div class="bhead"><b>🧠 Brain buddy</b><span class="muted">your AI coach</span>
        <button class="chip" id="bSpeak" title="Read answers aloud">${talk ? '🔊' : '🔇'}</button><button class="chip" id="bClose" aria-label="Close">✕</button></div>
      <div class="bmsgs" id="bMsgs"></div>
      <div class="bquick">${QUICK.map(q => `<button class="chip" data-q="${esc(q)}">${q}</button>`).join('')}</div>
      <div class="bcomp"><button class="chip bmic" id="bMic" title="Speak your question" ${Speech ? '' : 'hidden'}>🎤</button>
        <input id="bAsk" placeholder="Ask your buddy…" autocomplete="off"><button class="cta" id="bSend">Send</button></div>
    </div>`);

  $('#menuBtn').onclick = () => toggleDrawer(true);
  $('#drawerClose').onclick = $('#scrim').onclick = () => toggleDrawer(false);
  document.querySelectorAll('#drawer [data-size]').forEach(b => b.onclick = () => applySize(+b.dataset.size));
  $('#talkToggle').onchange = e => { talk = e.target.checked; store.set('nt_talk', talk ? '1' : '0'); $('#bSpeak').textContent = talk ? '🔊' : '🔇'; };
  $('#logoutBtn').onclick = () => { try { localStorage.removeItem('nt_player'); } catch { } location.hash = '#/'; location.reload(); };

  $('#fabBtn').onclick = () => { $('#fabHint').remove?.(); togglePop(); };
  $('#bClose').onclick = () => togglePop(false);
  $('#bSpeak').onclick = () => { $('#talkToggle').checked = !talk; $('#talkToggle').onchange({ target: $('#talkToggle') }); if (!talk) speechSynthesis?.cancel(); };
  $('#bSend').onclick = () => send($('#bAsk').value);
  $('#bAsk').onkeydown = e => { if (e.key === 'Enter') send($('#bAsk').value); };
  $('#bMic').onclick = listen;
  document.querySelectorAll('#coachPop [data-q]').forEach(b => b.onclick = () => send(b.dataset.q));
  addEventListener('keydown', e => { if (e.key === 'Escape') { toggleDrawer(false); togglePop(false); } });
  addEventListener('hashchange', onRoute);

  applySize(Math.min(2, Math.max(0, +store.get('nt_size', 0) || 0)));
  onRoute();
}
