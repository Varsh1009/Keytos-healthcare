// Brain records: MRI and EEG in one place. Helpers come from app.js via window.NTX.
const X = () => window.NTX;
const $ = (s, r = document) => r.querySelector(s);
const me = () => X().getME();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The strip at the top of every Brain records page
export function recordsTabs(active) {
  const t = [['mri', '🩻', 'MRI scan', 'Brain age from a 3D scan'], ['eeg', '〰️', 'EEG', 'Your resting brain rhythm']];
  return `<div class="h1">🧠 Brain records</div>
    <div class="sub">Scans and recordings of your brain. Upload your own, or try a real sample to see how it works. Your own results feed your Progress page.</div>
    <nav class="rtabs">${t.map(([id, ic, name, sub]) => `<a href="#/${id}" class="${id === active ? 'on' : ''}"><span>${ic}</span><b>${name}</b><small>${sub}</small></a>`).join('')}
      <span class="rtab-soon" title="Coming later">➕ More record types later (blood tests, sleep studies)</span></nav>`;
}

async function post(url, fd) {
  const r = await fetch(url, { method: 'POST', body: fd }); const j = await r.json();
  if (!r.ok) throw new Error(j.detail || r.statusText); return j;
}

export async function pageEEG() {
  const samples = await X().api('/api/eeg/samples');
  $('#p-eeg').innerHTML = `<div class="scrollpage"><div class="wrap">${recordsTabs('eeg')}
    <div class="cr-grid" style="margin-top:16px">
      <div class="glass card">
        <div class="eyebrow">1 · TRY A REAL EEG</div>
        ${samples.length ? `<select id="esel" style="margin:10px 0;width:100%">${samples.map(s => `<option value="${esc(s.file)}">${esc(s.label)}</option>`).join('')}</select>
          <button class="cta" id="erun" style="width:100%">〰️ Analyze this recording</button>
          <p class="muted">Healthy volunteers resting with eyes closed, from PhysioNet's open EEG dataset. Not you, so not counted in your Progress.</p>`
          : `<p class="caveat">⚠ The sample EEGs aren't downloaded on this computer yet. Run <code>python setup_neurotrail.py</code>.</p>`}
        <div class="eyebrow" style="margin-top:22px">2 · OR UPLOAD YOUR OWN</div>
        <label class="drop" id="edrop"><input type="file" id="efile" accept=".edf" hidden>
          <div style="font-size:34px">⬆</div><b>Drop an .edf EEG file</b><span class="muted">or click to choose a file</span></label>
        <p class="muted"><b>What works:</b> a standard <b>.edf</b> recording (most clinical EEG systems and Muse / OpenBCI exports), at least 30 seconds, ideally 2+ minutes <b>resting with eyes closed</b>. Back-of-head channels (O1, O2, Pz) give the clearest result.</p>
        <p class="muted">The file is analyzed in memory and not saved; only the numbers are kept.</p>
      </div>
      <div class="glass card" id="eout"><div class="empty">Pick a recording or upload one to see your resting brain rhythm.</div></div>
    </div></div></div>`;
  const show = async promise => {
    $('#eout').innerHTML = '<div class="empty"><div class="typing"><span></span><span></span><span></span></div> Reading the EEG…</div>';
    try { render(await promise); } catch (e) { $('#eout').innerHTML = `<div class="empty">⚠ ${esc(e.message)}</div>`; }
  };
  const url = k => `/api/player/${encodeURIComponent(me().name)}/eeg/${k}`;
  $('#erun') && ($('#erun').onclick = () => { const fd = new FormData(); fd.append('file', $('#esel').value); show(post(url('sample'), fd)); });
  const up = f => { const fd = new FormData(); fd.append('file', f); show(post(url('upload'), fd)); };
  $('#efile').onchange = e => e.target.files[0] && up(e.target.files[0]);
  const d = $('#edrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
  d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); e.dataTransfer.files[0] && up(e.dataTransfer.files[0]); };
}

function render(r) {
  const inRange = r.paf_hz >= 8 && r.paf_hz <= 12, col = inRange ? '#3DDC97' : '#FFC83D';
  const bands = [['delta', 'Delta 1–4 Hz', 'deep sleep'], ['theta', 'Theta 4–8 Hz', 'drowsy'], ['alpha', 'Alpha 8–13 Hz', 'relaxed, eyes closed'], ['beta', 'Beta 13–30 Hz', 'alert']];
  $('#eout').innerHTML = `<div class="eyebrow">RESULT${r.sample ? ' · SAMPLE (NOT YOU)' : ''}</div>
    <div class="eres"><div><div class="tiny">RESTING BRAIN RHYTHM</div><div class="eval" style="color:${col}">${r.paf_hz.toFixed(1)}<small> Hz</small></div></div>
      <div class="erange"><div class="erange-bar"><i style="left:${(Math.min(14, Math.max(6, r.paf_hz)) - 6) / 8 * 100}%;background:${col}"></i><span style="left:25%;width:50%"></span></div>
        <div class="erange-lab"><span>6 Hz slower</span><span>typical 8–12 Hz</span><span>faster 14 Hz</span></div></div></div>
    <ul class="plain">${r.plain.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <div style="height:200px;margin:10px 0"><canvas id="eSpec"></canvas></div>
    <div class="ebands">${bands.map(([k, n, w]) => `<div><b>${Math.round(r.rel_power[k] * 100)}%</b><span>${n}</span><small>${w}</small></div>`).join('')}</div>
    <p class="muted">${r.seconds}s at ${r.fs} Hz · ${r.n_channels} channels (${esc(r.channels.slice(0, 6).join(', ').replace(/\./g, ''))}${r.channels.length > 6 ? '…' : ''}) · peak found by: ${esc(r.paf_method)}.
      Evidence: slower alpha in Alzheimer's (<a href="https://doi.org/10.1093/braincomms/fcaf236" target="_blank" rel="noopener">David 2025</a>) and it falls as the disease progresses (<a href="https://doi.org/10.1177/13872877261476331" target="_blank" rel="noopener">Wang 2026</a>).</p>
    ${!r.sample && r.history?.length > 1 ? `<p><b>Your recordings:</b> ${r.history.map(h => `${h.paf_hz.toFixed(1)} Hz (${h.ts.slice(0, 10)})`).join(' → ')}</p>` : ''}`;
  X().chart('eSpec', { type: 'line', data: { labels: r.spectrum.f, datasets: [{ data: r.spectrum.db, borderColor: '#59F0FF', pointRadius: 0, borderWidth: 2, fill: false, tension: .2 }] },
    options: X().chartOpts({ plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => c[0].label + ' Hz' } } },
      scales: { x: { type: 'linear', min: 1, max: 40, title: { display: true, text: 'frequency (Hz)', color: '#9AA3C7' }, ticks: { color: '#9AA3C7' } },
        y: { title: { display: true, text: 'power (dB)', color: '#9AA3C7' }, ticks: { color: '#9AA3C7' } } } }) });
}
