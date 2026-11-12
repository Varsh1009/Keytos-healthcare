// Brain Atlas: diseases on a real 3D brain (with deep structures), and "My brain" tracking.
const X = () => window.NTX;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
let A = null, MODE = 'diseases', SEL = 'alzheimers', STAGE = 0, MEASURED = false, MINE = null, bound = false;
const RNAME = () => Object.fromEntries(A.regions.map(r => [r.id, r]));
const VIEW = { alzheimers: [-1, -.25, .25], parkinsons: [-1, .1, .7], stroke: [-1, .3, .2], huntingtons: [-.7, .2, .8], als: [-.6, 1, .2], ftd: [-.5, .2, 1], ms: [-.8, .3, .7] };
const XRAY = d => d.stages.some(s => s.regions.some(r => !r.startsWith('c')));
const pctTxt = f => f > .99 ? 'more than 99%' : `about ${Math.round(f * 100)}%`;
const Phi = z => { const t = 1 / (1 + .2316419 * Math.abs(z)), d = .3989423 * Math.exp(-z * z / 2), p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

export async function pageAtlas(arg) {
  A ||= await X().api('/api/atlas');
  MINE = await X().api(`/api/player/${encodeURIComponent(X().getME().name)}/brain`);
  if (arg === 'me') MODE = 'me';
  $('#p-atlas').innerHTML = `<div class="atlas"><div class="apanel glass" id="apanel"></div><div class="ainfo glass" id="ainfo" hidden></div></div>`;
  X().brain.autoRotate(false);
  if (!bound) { bindPicking(); bound = true; }
  render();
}

function render() {
  const p = $('#apanel');
  const tabs = `<div class="atabs"><button class="${MODE === 'diseases' ? 'on' : ''}" data-m="diseases">🦠 Diseases</button><button class="${MODE === 'me' ? 'on' : ''}" data-m="me">🙋 My brain</button></div>`;
  p.innerHTML = tabs + (MODE === 'diseases' ? diseaseHTML() : myBrainHTML());
  $$('[data-m]', p).forEach(b => b.onclick = () => { MODE = b.dataset.m; STAGE = 0; render(); });
  if (MODE === 'diseases') wireDisease(); else wireMine();
}

// ------------------------------------------------------------ DISEASES
function diseaseHTML() {
  const d = A.diseases.find(x => x.id === SEL), st = d.stages[Math.min(STAGE, d.stages.length - 1)], AD = d.id === 'alzheimers';
  return `<div class="eyebrow" style="margin-top:14px">TAP A DISEASE</div>
    <div class="dgrid">${A.diseases.map(x => `<button class="dchip ${x.id === SEL ? 'on' : ''}" data-d="${x.id}" style="--c:${x.color}"><span>${x.icon}</span>${x.name.replace(' (motor neurone disease)', '')}</button>`).join('')}</div>
    <div class="dcard" style="--c:${d.color}">
      <div class="dname">${d.icon} ${d.name}</div>
      <p>${d.what}</p>
      <div class="eyebrow">HOW IT CHANGES</div><p>${d.varies}</p>
      ${AD ? `<div class="chips" style="margin:6px 0 10px"><button class="chip ${!MEASURED ? 'on' : ''}" data-meas="0">📚 Textbook stages</button><button class="chip ${MEASURED ? 'on' : ''}" data-meas="1">📊 Measured in 436 real MRIs</button></div>` : ''}
      ${AD && MEASURED ? measuredHTML() : `
      ${d.stages.length > 1 ? `<div class="stagebar"><input type="range" min="0" max="${d.stages.length - 1}" value="${STAGE}" id="stageSlider"><div class="stagelbls">${d.stages.map((s, i) => `<span class="${i === STAGE ? 'on' : ''}">${s.label}</span>`).join('')}</div></div>` : ''}
      <div class="stagebox"><b>${st.label}</b>${st.when ? ` · ${st.when}` : ''}<div>${st.symptoms || ''}</div>
        <div class="muted" style="margin-top:6px">Lit up: ${st.regions.map(r => RNAME()[r]?.name).filter(Boolean).slice(0, 6).join(', ')}${st.regions.length > 6 ? '…' : ''}</div></div>
      <div class="muted">Source: <a href="${d.source[1]}" target="_blank">${d.source[0]} ↗</a>. Regions are mapped to the nearest atlas areas (approximate).</div>`}
      <div class="eyebrow" style="margin-top:14px">🏠 WHAT YOU CAN DO AT HOME</div>
      ${d.home.map(h => `<div class="homecard"><b>${h.do}</b><span>${h.why} <a href="${h.url}" target="_blank">source ↗</a></span>
        ${h.mission ? `<a class="go" href="#/play/${h.mission}">Start mission →</a>` : h.game ? `<a class="go" href="#/game/${h.game}">Play →</a>` : ''}</div>`).join('')}
    </div>
    <p class="muted">👆 Tap any part of the brain to see what it does. Drag to rotate.</p>`;
}
function measuredHTML() {
  const m = A.alzheimers_measured, rows = Object.entries(m.regions).sort((a, b) => a[1].cohens_d - b[1].cohens_d).slice(0, 8), N = RNAME();
  return `<div class="stagebox"><b>Where Alzheimer's shrank the brain in real people</b>
    <div class="muted">${m.comparison}. Computed by this project from the OASIS scans: brighter = bigger difference.</div>
    <table class="t" style="margin-top:8px"><tr><th>Region</th><th>Difference</th><th>Reliable?</th></tr>
    ${rows.map(([rid, v]) => `<tr><td>${N[rid]?.name}</td><td>${bar(-v.cohens_d)}</td><td>${v.q_fdr < .05 ? '✅ yes' : '–'}</td></tr>`).join('')}</table>
    <div class="muted">"Reliable" = significant after correcting for testing 57 regions (FDR < 0.05). The hippocampus, the memory center, came out on top on its own.</div></div>`;
}
const bar = d => `<span class="dbar"><i style="width:${Math.min(100, Math.max(0, d) / 1.1 * 100)}%"></i></span> ${d.toFixed(2)}`;
function wireDisease() {
  const d = A.diseases.find(x => x.id === SEL);
  $$('[data-d]').forEach(b => b.onclick = () => { SEL = b.dataset.d; STAGE = 0; MEASURED = false; render(); fly(); });
  $$('[data-meas]').forEach(b => b.onclick = () => { MEASURED = b.dataset.meas === '1'; render(); });
  $("#stageSlider") && ($("#stageSlider").oninput = e => { STAGE = +e.target.value; render(); });
  paintDisease(d);
}
function paintDisease(d) {
  const colors = {}, c = hex(d.color);
  if (d.id === 'alzheimers' && MEASURED) {
    for (const [rid, v] of Object.entries(A.alzheimers_measured.regions)) { const s = -v.cohens_d; if (s > .15) colors[rid] = [1, .55 - .4 * Math.min(1, s), .25, Math.min(1, s) * .55, 0]; }
  } else {
    d.stages.forEach((st, i) => { if (i > STAGE) return; const cur = i === STAGE; for (const r of st.regions) colors[r] = [...c, cur ? .42 : .16, cur ? 1 : 0]; });
  }
  X().brain.setAtlas({ colors, xray: XRAY(d) });
}
function fly() { const v = VIEW[SEL] || [-1, .2, .3]; X().brain.flyDir(...v); }

// ------------------------------------------------------------ MY BRAIN
function myBrainHTML() {
  const S = MINE.scans, last = S[S.length - 1], N = RNAME();
  if (last) {
    const low = Object.entries(last.regions).filter(([k]) => N[k]).sort((a, b) => a[1] - b[1]).slice(0, 6);
    const ch = MINE.change;
    return `<div class="eyebrow" style="margin-top:14px">FROM YOUR MRI · ${last.ts.slice(0, 10)}${S.length > 1 ? ` · ${S.length} scans` : ''}</div>
      <div class="dcard" style="--c:#59F0FF"><div class="dname">Your brain vs healthy people your age</div>
      <p class="muted">Each region of your scan compared with ${A.norm_n} cognitively normal OASIS adults of the same age and sex. Orange/red = more shrinkage than typical.</p>
      <div class="eyebrow">REGIONS FURTHEST FROM TYPICAL</div>
      ${low.map(([rid, z]) => `<div class="zrow"><b>${N[rid].name}</b><span>${z < -1 ? `smaller than ${pctTxt(1 - Phi(z))} of healthy peers your age` : 'within the normal range'} (z ${z.toFixed(1)})</span><small>${N[rid].function}</small></div>`).join('')}
      <div class="legend"><span style="background:#3DDC97"></span>typical <span style="background:#FFC83D"></span>a bit lower <span style="background:#FF5A6E"></span>much lower</div>
      ${ch ? `<div class="eyebrow" style="margin-top:12px">CHANGE SINCE YOUR LAST SCAN</div>
        <p>${ch.beyond_noise.length ? `${ch.beyond_noise.length} region(s) changed more than normal scan-to-scan noise (±${ch.threshold.toFixed(2)} z): ${ch.beyond_noise.map(k => N[k]?.name).join(', ')}.` : `No region changed more than normal scan-to-scan noise (±${ch.threshold.toFixed(2)} z, measured on 20 people scanned twice).`}</p>`
        : '<p class="muted">Upload another scan later (months or years apart) to track change region by region.</p>'}
      <p class="muted">This compares your scan with real scans; it is not a diagnosis. The simple tissue measure is validated on OASIS (hippocampus best), but it does not capture ventricle enlargement.</p>
      <a class="bigbtn" href="#/mri">🩻 Upload another scan</a></div>
      ${skillsHTML()}`;
  }
  return `<div class="dcard" style="--c:#59F0FF;margin-top:14px"><div class="dname">No MRI? No problem.</div>
      <p>We track the <b>skills</b> each brain area is known for, using your games and voice checks, and color the brain by how each skill is trending against <b>your own</b> first try.</p>
      <a class="bigbtn" href="#/mri" style="background:linear-gradient(90deg,#9B7BFF,#59F0FF)">🩻 Have an MRI? Upload it for a region-by-region map</a></div>${skillsHTML()}`;
}
function skillsHTML() {
  const C = { untested: '#5B6390', baseline: '#59F0FF', improving: '#3DDC97', steady: '#7C8CFF', dipping: '#FFC83D' };
  const W = { untested: 'not tested yet', baseline: 'baseline set: play again to see a trend', improving: 'improving 🟢', steady: 'steady', dipping: 'dipping: worth a look 🟡' };
  return `<div class="eyebrow" style="margin-top:14px">🧩 YOUR SKILLS (FROM GAMES & VOICE)</div>
    ${MINE.skills.map(s => `<div class="skill" style="--c:${C[s.status]}"><span class="sico">${s.icon}</span><div><b>${s.name}</b><small>${W[s.status]} · ${s.plays} play${s.plays === 1 ? '' : 's'}</small></div>
      <a href="${{ memory: '#/game/recall', speed: '#/sprint', movement: '#/game/reaction', language: '#/voice', spatial: '#/game/corsi' }[s.id]}">${s.plays ? 'Play again' : 'Test it'} →</a></div>`).join('')}
    <p class="muted">Skills are linked to brain areas by decades of neuroscience, but a game score doesn't measure the tissue itself. Use it to spot changes worth mentioning to a doctor.</p>`;
}
function wireMine() {
  const S = MINE.scans, last = S[S.length - 1], colors = {};
  if (last) {
    for (const [rid, z] of Object.entries(last.regions)) {
      if (z > -1) colors[rid] = [.24, .86, .59, .12, 0];
      else if (z > -2) colors[rid] = [1, .78, .24, .32, 0];
      else colors[rid] = [1, .35, .43, .5, 1];
    }
  } else {
    const C = { baseline: hex('#59F0FF'), improving: hex('#3DDC97'), steady: hex('#7C8CFF'), dipping: hex('#FFC83D') };
    for (const s of MINE.skills) { const sk = A.skills.find(x => x.id === s.id); if (!C[s.status]) continue; for (const r of sk.regions) colors[r] = [...C[s.status], .35, s.status === 'dipping' ? 1 : 0]; }
  }
  X().brain.setAtlas({ colors, xray: true });
  X().brain.flyDir(-1, .35, .55);
}

// ------------------------------------------------------------ tap a region
function bindPicking() {
  const cv = document.querySelector('#stage canvas'); let down = null;
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', e => {
    if (!location.hash.startsWith('#/atlas') || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rid = X().brain.pick(e.clientX, e.clientY); if (!rid || !A) return;
    const r = RNAME()[rid]; if (!r) return;
    const hits = A.diseases.flatMap(d => d.stages.map((s, i) => s.regions.includes(rid) ? `${d.icon} ${d.name.replace(' (motor neurone disease)', '')} (${s.label})` : null)).filter(Boolean);
    const m = A.alzheimers_measured.regions[rid], z = MINE?.scans.at(-1)?.regions?.[rid];
    const box = $('#ainfo'); box.hidden = false;
    box.innerHTML = `<button class="close" id="aiclose">✕</button><div class="eyebrow">${r.kind === 'cortex' ? 'CORTEX' : r.kind === 'fluid' ? 'FLUID SPACE' : 'DEEP STRUCTURE'}</div>
      <div class="dname" style="font-size:20px">${r.name}</div><p>${r.function || ''}</p>
      ${hits.length ? `<div class="eyebrow">AFFECTED IN</div><p>${hits.join('<br>')}</p>` : '<p class="muted">Not a main target of the diseases in this atlas.</p>'}
      ${m ? `<p class="muted">In 436 real MRIs, dementia vs healthy peers: difference ${(-m.cohens_d).toFixed(2)}${m.q_fdr < .05 ? ' (reliable)' : ''}.</p>` : ''}
      ${z != null ? `<p><b>Your scan:</b> z ${z.toFixed(1)} ${z < -1 ? '(lower than typical)' : '(typical)'}</p>` : ''}`;
    $('#aiclose').onclick = () => { box.hidden = true; };
  });
}
