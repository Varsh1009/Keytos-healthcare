// Brain records: brain scan (MRI) and brain waves (EEG). Built for everyone, including people who don't
// read much: pick from one dropdown, see the answer as a big icon and a picture, press Listen to hear it.
// All numbers, methods and sources are kept, folded into "details" at the bottom.
const X = () => window.NTX;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const me = () => X().getME();
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

import { icon } from './icons.js?v=1';   // shared line icons (no emoji)

// ------------------------------------------------------------ read aloud (the browser's built-in voice)
const SAY = {};
function speak(text, btn) {
  if (!('speechSynthesis' in window)) return X().toast('This browser cannot read aloud.');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.rate = 0.9; u.lang = 'en-US';
  $$('.rx-say.on').forEach(b => b.classList.remove('on')); btn?.classList.add('on');
  u.onend = u.onerror = () => btn?.classList.remove('on');
  speechSynthesis.speak(u);
}
const sayBtn = (key, text) => { SAY[key] = text; return `<button class="rx-say" data-say="${key}" aria-label="Read this out loud">${icon('speaker')} Listen</button>`; };
const wireSay = root => $$('[data-say]', root).forEach(b => b.onclick = () => speak(SAY[b.dataset.say], b));

// ------------------------------------------------------------ dropdown with grouped options and colored labels
// groups: [{ label, items: [{ value, title, pill: [cls, text], disabled }] }]
function dropdownHTML(id, groups, placeholder) {
  return `<div class="rx-dd" id="${id}">
    <button type="button" class="rx-dd-btn" aria-haspopup="listbox" aria-expanded="false"><span class="rx-dd-val ph">${placeholder}</span>${icon('chevron', 'rx-dd-chev')}</button>
    <div class="rx-dd-list" role="listbox" hidden>${groups.filter(g => g.items.length).map(g => `<div class="rx-dd-group">${g.label}</div>${g.items.map(o =>
      `<button type="button" role="option" class="rx-dd-opt" data-v="${esc(o.value)}" ${o.disabled ? 'disabled' : ''}><span>${esc(o.title)}</span>${o.pill ? `<span class="rx-pill ${o.pill[0]}">${o.pill[1]}</span>` : ''}</button>`).join('')}`).join('')}</div></div>`;
}
function wireDropdown(dd, onPick) {
  const btn = $('.rx-dd-btn', dd), list = $('.rx-dd-list', dd), opts = () => $$('.rx-dd-opt:not(:disabled)', dd);
  const open = on => { list.hidden = !on; btn.setAttribute('aria-expanded', on); dd.classList.toggle('open', on); if (on) ($('.rx-dd-opt.on', dd) || opts()[0])?.focus(); };
  btn.onclick = () => open(list.hidden);
  btn.onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); open(true); } };
  list.onkeydown = e => {
    const o = opts(), i = o.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); o[Math.min(o.length - 1, i + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); o[Math.max(0, i - 1)]?.focus(); }
    if (e.key === 'Escape') { open(false); btn.focus(); }
  };
  $$('.rx-dd-opt', dd).forEach(o => o.onclick = () => {
    $$('.rx-dd-opt', dd).forEach(x => x.classList.toggle('on', x === o));
    $('.rx-dd-val', dd).classList.remove('ph'); $('.rx-dd-val', dd).innerHTML = o.innerHTML;
    open(false); btn.focus(); onPick(o.dataset.v);
  });
  const outside = e => { if (!dd.isConnected) return document.removeEventListener('click', outside); if (!dd.contains(e.target)) open(false); };
  document.addEventListener('click', outside);
}

// ------------------------------------------------------------ shared pieces
export function recordsTabs(active) {
  const t = [['mri', 'scan', 'Brain scan', 'How old does it look?'], ['eeg', 'wave', 'Brain waves', 'Is the rhythm normal?']];
  return `<div class="h1">Brain records</div>
    <nav class="rx-tabs">${t.map(([id, ic, name, sub]) => `<a href="#/${id}" class="${id === active ? 'on' : ''}"><span class="rx-tab-ic">${icon(ic)}</span><b>${name}</b><small>${sub}</small></a>`).join('')}</nav>`;
}
const pickerHTML = (label, dd, uploadId, accept, uploadLabel) => `<section class="glass rx-pick" id="${uploadId}-box">
  <div class="rx-label">${label}</div>
  <div class="rx-pickrow">${dd}<span class="rx-or">or</span>
    <label class="rx-up"><input type="file" id="${uploadId}" accept="${accept}" hidden>${icon('upload')}<span>${uploadLabel}</span></label></div>
  <div class="rx-lock">${icon('lock')} Your file is never saved. Only the result is kept.</div></section>`;
const emptyHTML = (ic, text) => `<div class="rx-empty"><div class="rx-empty-ic">${icon(ic)}</div><b>${text}</b></div>`;
const loadingHTML = text => `<div class="rx-empty"><div class="rx-spin"></div><b>${text}</b></div>`;
const errorHTML = msg => `<div class="rx-empty"><div class="rx-empty-ic warn">${icon('alert')}</div><b>${esc(msg)}</b></div>`;
const badge = (cls, ic) => `<div class="rx-badge ${cls}">${icon(ic)}</div>`;
const chip = (ic, html, cls = '') => `<span class="rx-chip ${cls}">${icon(ic)}${html}</span>`;

async function post(url, fd) {
  const r = await fetch(url, { method: 'POST', body: fd }); const j = await r.json();
  if (!r.ok) throw new Error(j.detail || r.statusText); return j;
}
function wireUpload(box, inputId, onFile) {
  $('#' + inputId).onchange = e => e.target.files[0] && onFile(e.target.files[0]);
  box.ondragover = e => { e.preventDefault(); box.classList.add('over'); }; box.ondragleave = () => box.classList.remove('over');
  box.ondrop = e => { e.preventDefault(); box.classList.remove('over'); e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]); };
}
async function showResult(out, promise, render, loadingText) {
  out.innerHTML = loadingHTML(loadingText);
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try { render(await promise); } catch (e) { out.innerHTML = errorHTML(e.message); }
}

// ============================================================ BRAIN SCAN (MRI)
const MEM = { healthy: ['m-ok', 'Healthy memory'], 0.5: ['m-mid', 'Very mild memory problems'], 1: ['m-high', 'Mild memory problems'], 2: ['m-sev', 'Moderate memory problems'], 3: ['m-sev', 'Severe memory problems'] };
const memOf = (status, cdr) => /dementia/i.test(status || '') ? (MEM[cdr] || ['m-high', 'Memory problems']) : MEM.healthy;

export async function pageMRI() {
  const [m, samples] = await Promise.all([X().api('/api/mri/metrics'), X().api('/api/mri/samples')]);
  const cv = m.clinical_validity, tr = m.test_retest, have = samples.some(s => s.available);
  const item = s => ({ value: s.file, title: `${s.female ? 'Woman' : 'Man'}, ${s.Age}`, pill: memOf(s.status, s.CDR), disabled: !s.available });
  const byAge = (a, b) => a.Age - b.Age, ill = s => /dementia/i.test(s.status || '');
  const dd = dropdownHTML('mdd', [{ label: 'Healthy memory', items: samples.filter(s => !ill(s)).sort(byAge).map(item) },
    { label: 'Memory problems', items: samples.filter(ill).sort((a, b) => (a.CDR - b.CDR) || byAge(a, b)).map(item) }], 'Choose an example person');
  $('#p-mri').innerHTML = `<div class="scrollpage"><div class="wrap rx">${recordsTabs('mri')}
    ${pickerHTML('Pick a person', dd, 'mfile', '.nii,.gz', 'Use my own scan')}
    ${have ? '' : '<p class="caveat">The example scans aren\'t on this computer yet. Ask whoever set up the app to run <code>python setup_neurotrail.py</code>.</p>'}
    <section class="glass rx-out" id="mout">${emptyHTML('scan', 'Pick a person to see how old their brain looks')}</section>
    <details class="ev"><summary>How accurate is this? (for doctors and the curious)</summary><div class="evb">
      <p>The estimate is usually within about ${Math.round(m.mae)} years of the person's real age. 3D convolutional neural networks trained on <b>${m.n_volumes} real MRI scans</b> (OASIS-1, ${esc(m.data.split(':')[0])}), joined to each person's real age and dementia rating.${m.active_model ? ` Active model: <b>${m.active_model === 'ensemble' ? `ensemble of ${Object.entries(m.n_models).map(([k, n]) => `${n} × ${k}`).join(' + ')}` : m.active_model}</b>${m.interval_coverage_95 != null ? `; its 95% intervals contain the true age of ${(m.interval_coverage_95 * 100).toFixed(0)}% of cognitively normal people` : ''}.` : ''}</p>
      <div class="kpis"><div class="kpi"><div class="v">${m.mae.toFixed(1)} yrs</div><div class="l">MAE on ${m.n_normal} cognitively normal people, 5-fold CV split by subject (r = ${m.r.toFixed(2)}). Volume-only model: ${m.nwbv_model_mae.toFixed(1)}.</div></div>
        <div class="kpi"><div class="v">AUC ${cv.auc.toFixed(2)}</div><div class="l">brain-age gap separates dementia (n=${m.n_dementia}) from age-matched normals · 95% CI ${cv.auc_ci[0].toFixed(2)}–${cv.auc_ci[1].toFixed(2)}</div></div>
        <div class="kpi"><div class="v">ICC ${tr.icc.toFixed(2)}</div><div class="l">${tr.n_pairs} people scanned twice: mean difference ${tr.mean_abs_diff.toFixed(1)} yrs</div></div>
        <div class="kpi"><div class="v">±${tr.smallest_detectable_change.toFixed(1)} yrs</div><div class="l">smallest change detectable between two scans of one person</div></div></div></div></details>
    <details class="ev"><summary>Which scan files work?</summary><div class="evb">
      <p>A T1-weighted MRI saved as <b>.nii</b> or <b>.nii.gz</b>, <b>skull-stripped and registered to the 2 mm MNI grid (91×109×91)</b>, the format the model was trained on. Raw scanner files (DICOM, or scans with the skull still on) need preprocessing first, e.g. FSL <code>bet</code> + <code>flirt</code> to MNI152 2 mm. Your scan is analyzed in memory and never saved; only the result is kept.</p></div></details>
  </div></div>`;
  const out = $('#mout'), url = k => `/api/player/${enc(me().name)}/mri/${k}`;
  wireDropdown($('#mdd'), file => { const fd = new FormData(); fd.append('file', file); showResult(out, post(url('sample'), fd), r => renderMRI(r, samples.find(s => s.file === file)), 'Looking at the brain…'); });
  wireUpload($('#mfile-box'), 'mfile', f => { const fd = new FormData(); fd.append('file', f); fd.append('age', me().profile.age); showResult(out, post(url('upload'), fd), r => renderMRI(r), 'Looking at your scan…'); });
}

// Verdict from the bias-corrected gap (brain age vs healthy people of the same real age).
// Inside the scan-to-scan noise band counts as normal.
function mriVerdict(r) {
  const g = r.gap, sdc = r.sdc ?? 3.6;
  if (g == null) return ['ok', 'scan', 'Brain age ready', 'Add your age to your profile to compare it with your real age.'];
  if (Math.abs(g) < sdc) return ['ok', 'check', 'Normal for age', 'That is normal for their age.'];
  if (g < 0) return ['ok', 'down', 'Younger than usual', 'That is younger than usual for their age.'];
  return g >= 10 ? ['high', 'up', 'Older than usual', 'Compared with healthy people of the same age, it looks older than usual.']
    : ['mid', 'up', 'A bit older than usual', 'Compared with healthy people of the same age, it looks a bit older than usual.'];
}
const SURE = { high: [3, 'Quite sure'], medium: [2, 'Fairly sure'], low: [1, 'Not very sure'] };

function ageRuler(real, brain, cls) {
  const vals = [brain, real].filter(v => v != null);
  const lo = Math.floor((Math.min(...vals) - 8) / 10) * 10, hi = Math.ceil((Math.max(...vals) + 8) / 10) * 10;
  const x = v => `${((v - lo) / (hi - lo) * 100).toFixed(1)}%`;
  const a = real != null ? Math.min(real, brain) : null, b = real != null ? Math.max(real, brain) : null;
  return `<div class="rx-ruler"><span>${lo}</span><div class="rx-track">
      ${real != null ? `<div class="rx-span ${cls}" style="left:${x(a)};width:calc(${x(b)} - ${x(a)})"></div>` : ''}
      <div class="rx-mark brain ${cls}" style="left:${x(brain)}"><small>Brain looks</small><b>${Math.round(brain)}</b><i></i></div>
      ${real != null ? `<div class="rx-mark real" style="left:${x(real)}"><i></i><b>${Math.round(real)}</b><small>Real age</small></div>` : ''}
    </div><span>${hi}</span></div>`;
}

function renderMRI(r, sample) {
  const out = $('#mout'), f = r.format;
  if (r.brain_age == null) {
    out.innerHTML = `<div class="rx-top">${badge('mid', 'alert')}<div><b class="rx-big">Can't read this file</b>${sayBtn('mfail', 'We can\'t read this scan file. It needs to be prepared in a special way first. Try one of the example people instead.')}</div></div>
      <div class="rx-chips">${chip('user', 'Try an example person above')}${chip('info', 'Or ask your clinic for a prepared scan')}</div>
      <details class="ev"><summary>Technical details</summary><div class="evb">${f.issues.map(i => `<p>${esc(i)}</p>`).join('')}<p>Preprocess it to skull-stripped MNI 2 mm space and try again.</p></div></details>`;
    wireSay(out); return;
  }
  const [cls, ic, head, say] = mriVerdict(r), gap = r.gap, inside = gap != null && Math.abs(gap) < r.sdc, t = r.truth;
  // Show the bias-corrected brain age (real age + corrected gap) so the number and the verdict always agree.
  const shown = gap != null && r.age != null ? r.age + gap : r.brain_age;
  const [dots, sure] = SURE[r.confidence] || [2, 'Fairly sure'], [mCls, mWord] = t ? memOf(t.status, t.cdr) : [];
  const spoken = `This brain looks about ${Math.round(shown)} years old.${r.age != null ? ` The person is really ${Math.round(r.age)}.` : ''} ${say} We are ${sure.toLowerCase()} about this. This is not a diagnosis. If you are worried about your memory, talk to your doctor.`;
  const views = [['axial', 'Top'], ['coronal', 'Front'], ['sagittal', 'Side']];
  out.innerHTML = `<div class="rx-res">
    <div>
      <div class="rx-top">${badge(cls, ic)}<div><b class="rx-big">${head}</b>${sayBtn('mri', spoken)}</div></div>
      ${ageRuler(r.age, shown, cls)}
      <div class="rx-sure"><span>How sure?</span>${[1, 2, 3].map(i => `<i class="${i <= dots ? 'on' : ''}"></i>`).join('')}<b>${sure}</b></div>
      <div class="rx-chips">${t ? chip('user', `Example, not you${sample ? ` · ${sample.female ? 'Woman' : 'Man'}, ${Math.round(t.age)}` : ''} <span class="rx-pill ${mCls}">${mWord}</span>`) : chip('user', 'Your scan')}
        ${chip('info', 'Not a diagnosis')}</div>
    </div>
    <div class="rx-scan"><img id="mimg" src="${r.images.axial}" alt="Brain scan with highlighted areas">
      <div class="rx-views">${views.map(([k, w], i) => `<button data-v="${k}" class="${i ? '' : 'on'}">${w}</button>`).join('')}</div>
      <div class="rx-small"><i class="rx-dot orange"></i> Orange = where the computer looked</div></div>
  </div>
  <details class="ev"><summary>Technical details (for doctors and the curious)</summary><div class="evb">
    ${f.ok ? '' : f.issues.map(i => `<p>${esc(i)}</p>`).join('')}
    ${r.confidence ? mriConfidence(r) : `<p>5 models: ${r.fold_preds.map(p => p.toFixed(0)).join(' · ')} yrs.</p>`}
    ${gap != null ? `<p>Shown brain age = real age + bias-corrected gap = <b>${shown.toFixed(1)}</b> (raw model estimate ${r.brain_age.toFixed(1)}).</p><p>Bias-corrected brain-age gap: <b>${gap > 0 ? '+' : ''}${gap.toFixed(1)} yrs</b>, ${inside ? 'inside' : 'larger than'} the ±${r.sdc.toFixed(1)}-yr scan-to-scan noise band.</p>` : ''}
    <p>Model error ±${r.mae.toFixed(1)} yrs (MAE). Template similarity r = ${f.similarity?.toFixed(2)}. Highlighted areas: Grad-CAM (orange = pushed the age estimate up); in ageing brains these are often enlarged ventricles and widened sulci.</p>
    ${t ? `<p>Ground truth (OASIS): ${esc(t.id)}, age ${t.age}, ${esc(t.status)}${t.cdr != null ? `, CDR ${t.cdr}` : ''}. Honest out-of-fold brain age: <b>${t.oof_brain_age.toFixed(1)}</b>. ${esc(t.note)}</p>` : ''}</div></details>`;
  wireSay(out);
  $$('.rx-views button', out).forEach(b => b.onclick = () => { $('#mimg').src = r.images[b.dataset.v]; $$('.rx-views button', out).forEach(x => x.classList.toggle('on', x === b)); });
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
    <ul style="margin:4px 0 8px 18px">${r.confidence_reasons.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    <div class="tiny">MODEL AGREEMENT (spread ${r.model_disagreement.toFixed(1)} yrs)</div>
    <div class="chips" style="margin:6px 0">${r.per_model.map(p => `<span class="chip" title="${p.n_models} fold model(s)">${esc(p.label)}: <b>${p.brain_age.toFixed(0)}</b></span>`).join('')}</div>`;
}

// ============================================================ BRAIN WAVES (EEG)
export async function pageEEG() {
  const samples = await X().api('/api/eeg/samples');
  const dd = dropdownHTML('edd', [{ label: 'Healthy volunteers', items: samples.map((s, i) => ({ value: s.file, title: `Volunteer ${i + 1}`, pill: ['m-ok', 'Resting, eyes closed'] })) }], 'Choose an example recording');
  $('#p-eeg').innerHTML = `<div class="scrollpage"><div class="wrap rx">${recordsTabs('eeg')}
    ${pickerHTML('Pick a recording', samples.length ? dd : '<span class="muted">No example recordings on this computer yet.</span>', 'efile', '.edf', 'Use my own recording')}
    ${samples.length ? '' : '<p class="caveat">The example recordings aren\'t on this computer yet. Ask whoever set up the app to run <code>python setup_neurotrail.py</code>.</p>'}
    <section class="glass rx-out" id="eout">${emptyHTML('wave', 'Pick a recording to see the brain waves')}</section>
    <details class="ev"><summary>Which files work?</summary><div class="evb">
      <p>A standard <b>.edf</b> recording (most clinical EEG systems, Muse and OpenBCI can export this), at least 30 seconds and ideally 2+ minutes, <b>resting with eyes closed</b>. Back-of-head channels (O1, O2, Pz) give the clearest result. The file is analyzed in memory and never saved; only the numbers are kept.</p></div></details>
  </div></div>`;
  const out = $('#eout'), url = k => `/api/player/${enc(me().name)}/eeg/${k}`;
  if (samples.length) wireDropdown($('#edd'), file => { const fd = new FormData(); fd.append('file', file); showResult(out, post(url('sample'), fd), renderEEG, 'Reading the brain waves…'); });
  wireUpload($('#efile-box'), 'efile', f => { const fd = new FormData(); fd.append('file', f); showResult(out, post(url('upload'), fd), renderEEG, 'Reading your brain waves…'); });
}

function eegVerdict(r) {
  const hz = r.paf_hz.toFixed(1);
  if (r.paf_hz < 8) return ['mid', 'down', 'Slower than usual', `The brain's resting rhythm is ${hz} waves every second. Most healthy adults are between 8 and 12. Being tired, or some medicines, can slow it. If it stays slow on repeat checks, tell your doctor.`];
  if (r.paf_hz > 12) return ['ok', 'up', 'A bit faster than usual', `The brain's resting rhythm is ${hz} waves every second, just above the usual 8 to 12. This is usually nothing to worry about.`];
  return ['ok', 'check', 'Normal rhythm', `The brain's resting rhythm is ${hz} waves every second. Most healthy adults are between 8 and 12, so this is normal.`];
}

// Half-circle dial: slow (6) → normal (8–12) → fast (14); the needle swings to the value.
function gauge(v) {
  const lo = 6, hi = 14, cx = 150, cy = 150, R = 112;
  const ang = x => Math.PI * (1 - (Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo));
  const pt = a => [(cx + R * Math.cos(a)).toFixed(1), (cy - R * Math.sin(a)).toFixed(1)];
  const arc = (a0, a1, col) => { const [x0, y0] = pt(ang(a0)), [x1, y1] = pt(ang(a1)); return `<path d="M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}" stroke="${col}" stroke-width="24" fill="none"/>`; };
  const deg = -(ang(v) * 180 / Math.PI).toFixed(1);
  return `<svg class="rx-gauge" viewBox="0 0 300 200" role="img" aria-label="Brain rhythm ${v.toFixed(1)}, normal is 8 to 12">
    ${arc(6, 8, '#FFC83D')}${arc(8, 12, '#3DDC97')}${arc(12, 14, '#59F0FF')}
    <text x="150" y="22" text-anchor="middle">Normal</text>
    <g class="rx-needle" style="--r:${deg}deg"><line x1="${cx}" y1="${cy}" x2="${cx + R - 18}" y2="${cy}" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g>
    <circle cx="${cx}" cy="${cy}" r="11" fill="#fff"/>
    <text x="38" y="186" text-anchor="middle">Slow</text><text x="262" y="186" text-anchor="middle">Fast</text>
    <text class="val" x="150" y="192" text-anchor="middle">${v.toFixed(1)}</text></svg>`;
}

// A live wave drawn at the measured speed: one second across the box, so 10 Hz shows 10 waves.
function animateWave(cv, hz, color) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, t0 = performance.now();
  const draw = now => {
    if (!cv.isConnected) return;
    const t = (now - t0) / 1000;
    g.clearRect(0, 0, W, H); g.lineWidth = 4; g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 14; g.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const s = x / W, amp = H * 0.32 * (0.75 + 0.25 * Math.sin(2 * Math.PI * (s * 0.7 + t * 0.25)));
      const y = H / 2 + Math.sin(2 * Math.PI * (hz * s - t * 0.8)) * amp;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke(); requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function renderEEG(r) {
  const out = $('#eout'), [cls, ic, head, say] = eegVerdict(r), color = cls === 'ok' ? '#3DDC97' : '#FFC83D';
  const bands = [['delta', 'Delta 1–4 Hz', 'deep sleep'], ['theta', 'Theta 4–8 Hz', 'drowsy'], ['alpha', 'Alpha 8–13 Hz', 'relaxed, eyes closed'], ['beta', 'Beta 13–30 Hz', 'alert']];
  const spoken = `${head}. ${say}${r.clear_alpha ? '' : ' The rhythm was not very clear in this recording. For a better result, rest for two minutes with your eyes closed.'} One recording cannot diagnose anything.`;
  out.innerHTML = `<div class="rx-res">
    <div>
      <div class="rx-top">${badge(cls, ic)}<div><b class="rx-big">${head}</b>${sayBtn('eeg', spoken)}</div></div>
      <div class="rx-wavebox"><canvas id="ewave" width="800" height="150"></canvas>
        <div class="rx-wavelab"><span><b>${r.paf_hz.toFixed(1)}</b>waves every second</span><span>${icon('clock')} 1 second</span></div></div>
      <div class="rx-chips">${chip('user', r.sample ? 'Example, not you' : 'Your recording')}
        ${r.clear_alpha ? '' : chip('alert', 'Rhythm not clear · rest 2 min, eyes closed', 'warn')}
        ${!r.sample && r.history?.length > 1 ? chip('clock', r.history.map(h => h.paf_hz.toFixed(1)).join(' → ')) : ''}
        ${chip('info', 'Not a diagnosis')}</div>
    </div>
    ${gauge(r.paf_hz)}
  </div>
  <details class="ev" id="eDet"><summary>Technical details (for doctors and the curious)</summary><div class="evb">
    ${r.plain.map(t => `<p>${esc(t)}</p>`).join('')}
    <div style="height:200px;margin:10px 0"><canvas id="eSpec"></canvas></div>
    <div class="ebands">${bands.map(([k, n, w]) => `<div><b>${Math.round(r.rel_power[k] * 100)}%</b><span>${n}</span><small>${w}</small></div>`).join('')}</div>
    <p>Peak alpha frequency ${r.paf_hz.toFixed(2)} Hz (found by: ${esc(r.paf_method)}) · theta/alpha ratio ${r.theta_alpha_ratio} · ${r.seconds}s at ${r.fs} Hz · ${r.n_channels} channels (${esc(r.channels.slice(0, 6).join(', ').replace(/\./g, ''))}${r.channels.length > 6 ? '…' : ''}).${!r.sample && r.history?.length > 1 ? ` Your recordings: ${r.history.map(h => `${h.paf_hz.toFixed(1)} Hz (${h.ts.slice(0, 10)})`).join(' → ')}.` : ''}</p>
    <p>Evidence: slower alpha in Alzheimer's (<a href="https://doi.org/10.1093/braincomms/fcaf236" target="_blank" rel="noopener">David 2025</a>) and it falls as the disease progresses (<a href="https://doi.org/10.1177/13872877261476331" target="_blank" rel="noopener">Wang 2026</a>).</p></div></details>`;
  wireSay(out);
  animateWave($('#ewave'), r.paf_hz, color);
  // draw the spectrum the first time the details are opened (a chart in a closed box has no size)
  $('#eDet').addEventListener('toggle', function draw() {
    $('#eDet').removeEventListener('toggle', draw);
    X().chart('eSpec', { type: 'line', data: { labels: r.spectrum.f, datasets: [{ data: r.spectrum.db, borderColor: '#59F0FF', pointRadius: 0, borderWidth: 2, fill: false, tension: .2 }] },
      options: X().chartOpts({ plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => c[0].label + ' Hz' } } },
        scales: { x: { type: 'linear', min: 1, max: 40, title: { display: true, text: 'frequency (Hz)', color: '#9AA3C7' }, ticks: { color: '#9AA3C7' } },
          y: { title: { display: true, text: 'power (dB)', color: '#9AA3C7' }, ticks: { color: '#9AA3C7' } } } }) });
  });
}
