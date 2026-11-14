// Typing fallback. Some embedded browsers (for example an app's built-in preview pane) deliver key
// presses to a text box but never insert the letters, so you can't type your name. If a key press
// didn't change the box by the time the browser's own handling is done, we apply it ourselves.
// In normal browsers the letter is already there, so this does nothing (no double letters).
const editable = el => el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', 'password'].includes(el.type));

document.addEventListener('keydown', e => {
  const el = e.target;
  if (!editable(el) || el.readOnly || el.disabled || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const k = e.key;
  if (!(k.length === 1 || k === 'Backspace' || k === 'Delete')) return;
  const before = el.value, s = el.selectionStart ?? before.length, en = el.selectionEnd ?? s;
  setTimeout(() => {
    if (el.value !== before) return;                       // the browser handled it
    let v, pos;
    if (k === 'Backspace') {
      if (s === en && s === 0) return;
      v = s !== en ? before.slice(0, s) + before.slice(en) : before.slice(0, s - 1) + before.slice(s);
      pos = s !== en ? s : s - 1;
    } else if (k === 'Delete') {
      if (s === en && s === before.length) return;
      v = before.slice(0, s) + before.slice(s !== en ? en : s + 1); pos = s;
    } else {
      if (el.maxLength > 0 && before.length - (en - s) >= el.maxLength) return;
      v = before.slice(0, s) + k + before.slice(en); pos = s + 1;
    }
    el.value = v;
    try { el.setSelectionRange(pos, pos); } catch { }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, 0);
}, true);
