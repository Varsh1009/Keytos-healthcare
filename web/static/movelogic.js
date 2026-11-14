// Movement-test logic, kept free of the DOM and the camera so it can be tested with recorded or
// synthetic poses (tests/test_movelogic.mjs). Landmarks are MediaPipe Pose's 33 points, normalised
// to the image (x right, y down, 0..1). `a` is the image aspect ratio (width / height), used to make
// distances isotropic. Every length is divided by the torso (shoulder-mid to hip-mid), so results
// don't depend on how far you stand from the camera.

export const P = { nose: 0, ls: 11, rs: 12, lw: 15, rw: 16, li: 19, ri: 20, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };
export const PARTS = { head: [0], shoulders: [11, 12], hips: [23, 24], knees: [25, 26], feet: [27, 28] };
export const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];

const pt = (lm, i, a) => ({ x: lm[i].x * a, y: lm[i].y });
const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const seen = (lm, i, t = 0.5) => !!lm[i] && (lm[i].visibility ?? 1) >= t && lm[i].x > 0.01 && lm[i].x < 0.99 && lm[i].y > 0.01 && lm[i].y < 0.99;

export function body(lm, a) {
  const sh = mid(pt(lm, P.ls, a), pt(lm, P.rs, a)), hip = mid(pt(lm, P.lh, a), pt(lm, P.rh, a));
  return { sh, hip, torso: Math.max(dist(sh, hip), 1e-3), sw: Math.max(dist(pt(lm, P.ls, a), pt(lm, P.rs, a)), 1e-3) };
}

/** Which of the needed body parts are in view. */
export function inView(lm, need) {
  if (!lm) return { ok: false, missing: need.slice() };
  const missing = need.filter(k => !PARTS[k].every(i => seen(lm, i)));
  return { ok: missing.length === 0, missing };
}

/** Light smoothing: removes frame-to-frame jitter while adding about one frame of delay. */
export class Smoother {
  constructor(alpha = 0.55) { this.alpha = alpha; this.s = null; }
  push(lm) {
    if (!lm) return this.s;
    if (!this.s) { this.s = lm.map(p => ({ ...p })); return this.s; }
    const k = this.alpha;
    this.s = lm.map((p, i) => { const q = this.s[i]; return { x: q.x + k * (p.x - q.x), y: q.y + k * (p.y - q.y), z: p.z, visibility: p.visibility }; });
    return this.s;
  }
}

// ------------------------------------------------------------------ 30-second chair stand (CDC STEADI)
// Signal: how far the knees sit below the hips, in torso lengths. Seated it's near 0 (thighs level);
// standing it's ~0.65–0.95 (legs vertical; 0.69 measured on a real photo through the app's model). Thresholds adapt to your own seated and standing values
// (camera height changes the seated value), with hysteresis + a short dwell so jitter can't double-count.
export class ChairCounter {
  constructor({ seated = 0.15, standing = 0.75, dwell = 120 } = {}) {
    this.s0 = seated; this.s1 = standing; this.dwell = dwell;
    this.state = null; this.pending = null; this.reps = 0; this.ratio = 0; this.peak = -9; this.trough = 9;
    this.torsoRef = null; this.armsFrames = 0; this.frames = 0;
  }
  calibrate(seatedRatio, torso) { this.s0 = seatedRatio; this.torsoRef = torso; this.state = 'down'; }
  get thresholds() {
    const span = Math.max(this.s1 - this.s0, 0.35);
    return { down: this.s0 + 0.3 * span, up: this.s0 + 0.6 * span };
  }
  static ratio(lm, a, torso) {
    const b = body(lm, a), knee = mid(pt(lm, P.lk, a), pt(lm, P.rk, a));
    return (knee.y - b.hip.y) / (torso || b.torso);
  }
  update(lm, a, t) {
    const b = body(lm, a);
    // Torso length is fixed; leaning forward to stand only shortens it on camera, so keep the larger reference.
    this.torsoRef = this.torsoRef ? Math.max(this.torsoRef * 0.998, b.torso) : b.torso;
    const r = this.ratio = ChairCounter.ratio(lm, a, this.torsoRef);
    const { up, down } = this.thresholds;
    let event = null;
    if (this.state === 'up') this.peak = Math.max(this.peak, r);
    if (this.state === 'down') this.trough = Math.min(this.trough, r);
    const target = r >= up ? 'up' : r <= down ? 'down' : null;
    if (target && target !== this.state) {
      if (this.pending?.s !== target) this.pending = { s: target, t };
      else if (t - this.pending.t >= this.dwell) {
        if (this.state === 'down' && target === 'up') { this.reps++; event = 'rep'; }
        // learn this person's own seated / standing values from the completed phase
        if (this.state === 'up' && this.peak > -9) this.s1 = 0.6 * this.s1 + 0.4 * this.peak;
        if (this.state === 'down' && this.trough < 9) this.s0 = 0.6 * this.s0 + 0.4 * this.trough;
        this.state = target; this.pending = null; this.peak = -9; this.trough = 9;
      }
    } else if (target === this.state) this.pending = null;
    // Arms should stay crossed on the chest (the test is void if you push off with your hands).
    const chest = { x: b.sh.x + 0.3 * (b.hip.x - b.sh.x), y: b.sh.y + 0.3 * (b.hip.y - b.sh.y) };
    const hand = Math.max(dist(pt(lm, P.lw, a), chest), dist(pt(lm, P.rw, a), chest)) / this.torsoRef;
    const armsCrossed = hand < 0.8;
    this.frames++; if (!armsCrossed) this.armsFrames++;
    return { state: this.state, reps: this.reps, ratio: r, event, armsCrossed };
  }
  /** CDC protocol: if you're more than halfway up when time runs out, it counts as a stand. */
  finalCredit() {
    const { up, down } = this.thresholds;
    return this.state === 'down' && this.ratio > (up + down) / 2 ? 1 : 0;
  }
  get armsOffShare() { return this.frames ? this.armsFrames / this.frames : 0; }
}

// ------------------------------------------------------------------ one-leg stand (balance)
// A foot counts as lifted when one ankle is clearly higher than the other. The clock starts the
// moment it lifts and stops when it comes back down (after a short debounce), or at the time limit.
export class BalanceTimer {
  constructor({ lift = 0.12, drop = 0.06, dwellUp = 200, dwellDown = 300, max = 30000, lostAfter = 1200 } = {}) {
    Object.assign(this, { lift, drop, dwellUp, dwellDown, max, lostAfter });
    this.state = 'ready'; this.start = null; this.end = null; this.cand = null; this.foot = null;
    this.torsoRef = null; this.lastHip = null; this.path = 0; this.minX = 9; this.maxX = -9; this.lastSeen = null; this.reason = null;
  }
  diff(lm, a) {
    const la = pt(lm, P.la, a), ra = pt(lm, P.ra, a);
    return { d: Math.abs(la.y - ra.y) / this.torsoRef, foot: la.y < ra.y ? 'left' : 'right' };
  }
  get held() { return this.start == null ? 0 : Math.min(((this.end ?? this._now) - this.start), this.max) / 1000; }
  update(lm, a, t) {
    this._now = t;
    if (this.state === 'done') return this.snapshot();
    const feet = lm && [P.la, P.ra].every(i => (lm[i]?.visibility ?? 1) >= 0.3);
    if (!feet) {
      if (this.state === 'holding' && t - (this.lastSeen ?? t) > this.lostAfter) this.finish(this.lastSeen, 'lost');
      return this.snapshot();
    }
    this.lastSeen = t;
    const b = body(lm, a);
    this.torsoRef = this.torsoRef ? Math.max(this.torsoRef * 0.998, b.torso) : b.torso;
    const { d, foot } = this.diff(lm, a);
    if (this.state === 'ready') {
      if (d > this.lift) { this.cand ??= t; if (t - this.cand >= this.dwellUp) { this.state = 'holding'; this.start = this.cand; this.foot = foot; this.cand = null; } }
      else this.cand = null;
    } else if (this.state === 'holding') {
      // sway: how far the hips travel sideways while you hold, in torso lengths
      // (low-passed first, so camera jitter isn't counted as wobble)
      const raw = b.hip.x / this.torsoRef, hx = this.lastHip == null ? raw : this.lastHip + 0.2 * (raw - this.lastHip);
      if (this.lastHip != null) this.path += Math.abs(hx - this.lastHip);
      this.lastHip = hx; this.minX = Math.min(this.minX, hx); this.maxX = Math.max(this.maxX, hx);
      this.n = (this.n || 0) + 1; this.sx = (this.sx || 0) + hx; this.sxx = (this.sxx || 0) + hx * hx;
      if (d < this.drop) { this.cand ??= t; if (t - this.cand >= this.dwellDown) this.finish(this.cand, 'foot down'); }
      else this.cand = null;
      if (this.state === 'holding' && t - this.start >= this.max) this.finish(this.start + this.max, 'time');
    }
    return this.snapshot();
  }
  finish(t, reason) { this.state = 'done'; this.end = t; this.reason = reason; }
  snapshot() {
    const secs = this.held;
    return { state: this.state, held: secs, foot: this.foot, reason: this.reason,
      // sway = standard deviation of the hips' sideways position, as % of torso length
      sway: this.n > 10 ? 100 * Math.sqrt(Math.max(0, this.sxx / this.n - (this.sx / this.n) ** 2)) : 0,
      range: this.maxX > this.minX ? this.maxX - this.minX : 0 };
  }
}

// ------------------------------------------------------------------ reach go / no-go
// Targets appear within arm's reach around your body. Touch green ones with either hand; leave red
// ones alone. Mixes a thinking rule (inhibition) with movement: a dual-task.
export class ReachGame {
  constructor({ duration = 40000, life = 1700, gap = [450, 900], pRed = 0.3, rand = Math.random } = {}) {
    Object.assign(this, { duration, life, gap, pRed, rand });
    this.t0 = null; this.target = null; this.nextAt = null; this.done = false;
    this.hits = 0; this.misses = 0; this.falseTouches = 0; this.avoids = 0; this.rts = []; this.bag = [];
  }
  /** Exactly 3 red in every 10 (shuffled), so every play has the same mix and scores are comparable. */
  nextRed() {
    if (!this.bag.length) {
      const n = 10, reds = Math.round(n * this.pRed);
      this.bag = Array.from({ length: n }, (_, i) => i < reds);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; }
      if (this.hits + this.misses + this.falseTouches + this.avoids === 0 && this.bag[n - 1]) this.bag.reverse();   // the first target is always green
    }
    return this.bag.pop();
  }
  start(t) { this.t0 = t; this.nextAt = t + 600; }
  hands(lm, a) {
    return [[P.li, P.lw], [P.ri, P.rw]].map(([f, w]) => (lm[f]?.visibility ?? 1) >= 0.4 ? pt(lm, f, a) : pt(lm, w, a));
  }
  spawn(lm, a, t) {
    const b = body(lm, a), r = 0.3 * b.torso, hs = this.hands(lm, a);
    for (let k = 0; k < 12; k++) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const x = b.sh.x + side * (0.35 + 0.75 * this.rand()) * b.sw * 1.6;
      const y = b.sh.y + (-0.55 + 1.2 * this.rand()) * b.torso;
      const c = { x: Math.min(Math.max(x, 0.07 * a), 0.93 * a), y: Math.min(Math.max(y, 0.08), 0.92) };
      if (hs.every(h => dist(h, c) > 2.2 * r)) {   // never spawn under a hand (that would be a free hit)
        this.target = { ...c, r, red: this.nextRed(), born: t };
        return;
      }
    }
    this.nextAt = t + 150;   // hands everywhere: try again shortly
  }
  update(lm, a, t) {
    const events = [];
    if (this.done) return { events, target: null, done: true };
    if (t - this.t0 >= this.duration) {
      this.done = true; this.target = null;
      return { events, target: null, done: true };
    }
    if (!this.target && t >= this.nextAt && lm) this.spawn(lm, a, t);
    const g = this.target;
    if (g && lm) {
      const touched = this.hands(lm, a).some(h => dist(h, g) < g.r);
      if (touched) {
        if (g.red) { this.falseTouches++; events.push({ type: 'false', target: g }); }
        else { this.hits++; this.rts.push(t - g.born); events.push({ type: 'hit', target: g, rt: t - g.born }); }
        this.target = null;
      }
    }
    if (this.target && t - this.target.born >= this.life) {
      if (this.target.red) { this.avoids++; events.push({ type: 'avoid', target: this.target }); }
      else { this.misses++; events.push({ type: 'miss', target: this.target }); }
      this.target = null;
    }
    if (!this.target && events.length) this.nextAt = t + this.gap[0] + this.rand() * (this.gap[1] - this.gap[0]);
    return { events, target: this.target, done: false, left: Math.max(0, this.duration - (t - this.t0)) };
  }
  get score() { return Math.max(0, this.hits - this.falseTouches); }
  get medianRt() {
    if (!this.rts.length) return null;
    const s = [...this.rts].sort((x, y) => x - y), m = s.length >> 1;
    return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
  }
}
