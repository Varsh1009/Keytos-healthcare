// Read-along: listens with the browser's speech recognition and works out how far through a passage the
// reader is, so each word lights up as it's spoken. Used by the Read Aloud game and the Voice check.
// Chrome and Edge have this built in (Chrome sends the audio to Google's speech service to transcribe it).

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = w => w.toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9']/g, '');

export const supported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export const wordsOf = text => String(text).split(/\s+/).filter(Boolean);
export const spans = text => wordsOf(text).map((w, i) => `<span class="rw" data-i="${i}">${esc(w)}</span>`).join(' ');

function oneEdit(a, b) {   // true if a and b differ by at most one letter added, removed or changed
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}
function same(t, h) {      // t = passage word, h = heard word (both normalized)
  if (!t || !h) return false;
  if (t === h) return true;
  if (t.length < 4 || h.length < 4) return t + 's' === h || h + 's' === t;
  return oneEdit(t, h) || t.startsWith(h) || h.startsWith(t);
}

// Walk the heard words in order; each one may match the next passage word or skip up to 3 ahead.
// Pass the previous result as `prev` so words stay lit even when the recognizer revises its guess.
export function align(passageWords, heardText, prev = null) {
  const T = passageWords.map(norm), H = wordsOf(heardText).map(norm), hit = T.map((_, i) => !!prev?.hit[i]);
  let pos = 0;
  for (const h of H) {
    for (let j = pos; j < Math.min(T.length, pos + 4); j++) if (same(T[j], h)) { hit[j] = true; pos = j + 1; break; }
  }
  pos = Math.max(pos, prev?.pos ?? 0);
  return { pos, hit, count: hit.filter(Boolean).length };
}

export function paint(el, a) {
  if (!el) return;
  el.querySelectorAll('[data-i]').forEach(s => { const i = +s.dataset.i;
    s.classList.toggle('on', a.hit[i]); s.classList.toggle('skip', i < a.pos && !a.hit[i]); s.classList.toggle('cur', i === a.pos); });
}

// Start listening. onText(fullTranscriptSoFar) fires on every partial result; onError(message) on a fatal error.
// Chrome ends a recognition session after a silence, so we restart it and keep what was already heard.
export function listen(onText, onError = () => {}, lang = 'en-US') {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let committed = '', live = '', stopped = false, sr = null, ended = null, over = false;
  const start = () => {
    over = false; sr = new SR(); sr.lang = lang; sr.continuous = true; sr.interimResults = true; sr.maxAlternatives = 1;
    sr.onresult = e => { let s = ''; for (const r of e.results) s += ' ' + r[0].transcript; live = s; try { onText(committed + live); } catch { } };
    sr.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      stopped = true;
      onError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone permission was denied. Allow mic access and try again.'
        : e.error === 'network' ? 'Speech recognition needs an internet connection in this browser.'
          : e.error === 'audio-capture' ? 'No microphone found.' : `Speech recognition error (${e.error}).`);
    };
    sr.onend = () => { committed += live; live = ''; over = true; if (!stopped) { try { start(); } catch { stopped = true; } } else ended?.(); };
    try { sr.start(); } catch (e) { stopped = true; onError('Could not start speech recognition.'); }
  };
  start();
  return {
    text: () => committed + live,
    // Stop and wait (briefly) for the recognizer's last words.
    stop: () => new Promise(res => {
      if (over && stopped) return res(committed + live);
      stopped = true; const t = setTimeout(() => res(committed + live), 1200);
      ended = () => { clearTimeout(t); res(committed); };
      try { sr.stop(); } catch { clearTimeout(t); res(committed + live); }
    }),
  };
}
