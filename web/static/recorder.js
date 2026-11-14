// Mic recorder for Animal Naming: raw PCM -> 16 kHz mono 16-bit WAV Blob for server-side speech-to-text.
// Usage: const rec = await startRecording({ onLevel: v => meter.style.width = v * 100 + '%' });
//        ...; const wavBlob = await rec.stop();

const TARGET_RATE = 16000;

export async function startRecording({ onLevel } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio. Please open the app in Chrome or Edge.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    throw new Error(denied ? 'Microphone permission was denied. Please allow mic access and try again.'
      : `Could not open the microphone (${e?.name || e}).`);
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { } }
  const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), chunks = [];
  let lastLevel = 0, peak = 0;
  proc.onaudioprocess = e => {
    const d = new Float32Array(e.inputBuffer.getChannelData(0)); chunks.push(d);
    if (!onLevel) return;
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    peak = Math.max(peak, Math.sqrt(s / d.length));
    const now = performance.now();
    if (now - lastLevel >= 100) { lastLevel = now; try { onLevel(Math.min(1, peak * 4)); } catch { } peak = 0; }
  };
  // Route through a muted gain so the processor runs without echoing the mic to the speakers.
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  const rate = ctx.sampleRate;
  let stopped = null;
  return {
    stop: async () => {
      if (stopped) return stopped;
      try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch { }
      stream.getTracks().forEach(t => t.stop());
      try { await ctx.close(); } catch { }
      stopped = new Blob([toWav(chunks, rate)], { type: 'audio/wav' });
      return stopped;
    },
  };
}

// Same approach as toWav in ui2.js, but averages samples per output step (simple low-pass) when downsampling.
function toWav(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const step = rate / TARGET_RATE, len = Math.floor(n / step), pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step)); let s = 0;
    for (let j = a; j < b && j < n; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / (b - a)));
    pcm[i] = v < 0 ? v * 32768 : v * 32767;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf), w = (p, s) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, TARGET_RATE, true); v.setUint32(28, TARGET_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm); return buf;
}
