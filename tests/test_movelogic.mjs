// Movement-test logic on synthetic camera poses (30 fps, with tracking noise).
// Run: node tests/test_movelogic.mjs   (also run by tests/test_movement.py)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/static/movelogic.js', import.meta.url), 'utf8');
const M = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const { ChairCounter, BalanceTimer, ReachGame, Smoother, inView } = M;

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const noise = s => (rnd() - 0.5) * 2 * s;
const A = 4 / 3, FPS = 30, DT = 1000 / FPS;

/** A front-facing person. kneeDrop/ankle values are in torso lengths below the hips (torso = 0.25 of image height). */
function pose({ kneeDrop = 0.95, lAnkle = 1.9, rAnkle = 1.9, hipX = 0.5, hands = null, torso = 0.25, lean = 0, jitter = 0.004 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  const T = torso * (1 - lean);                        // leaning toward the camera shortens the torso on screen
  const hipY = 0.45, shY = hipY - T, sw = 0.09;
  const set = (i, x, y) => { lm[i] = { x: x + noise(jitter), y: y + noise(jitter), z: 0, visibility: 0.99 }; };
  set(0, hipX, shY - 0.08);
  set(11, hipX + sw, shY); set(12, hipX - sw, shY);
  set(23, hipX + 0.05, hipY); set(24, hipX - 0.05, hipY);
  set(25, hipX + 0.05, hipY + kneeDrop * torso); set(26, hipX - 0.05, hipY + kneeDrop * torso);
  set(27, hipX + 0.05, hipY + lAnkle * torso); set(28, hipX - 0.05, hipY + rAnkle * torso);
  const crossed = [{ x: hipX - 0.04, y: shY + 0.06 }, { x: hipX + 0.04, y: shY + 0.06 }];
  const [l, r] = hands || crossed;
  set(15, l.x, l.y); set(16, r.x, r.y); set(19, l.x, l.y - 0.01); set(20, r.x, r.y - 0.01);
  return lm;
}

// ---------------------------------------------------------------- chair stands
function chairRun({ reps, seated, standing = 0.95, secs = 30, lean = 0.2, jitter = 0.006, endHalfway = false }) {
  const c = new ChairCounter(), sm = new Smoother();
  c.calibrate(ChairCounter.ratio(pose({ kneeDrop: seated }), A), 0.25);
  const period = secs * 1000 / (reps + (endHalfway ? 0.3 : 0.15));
  let t = 0;
  for (; t < secs * 1000; t += DT) {
    const ph = (t / period) % 1;                       // 0 seated → 0.5 standing → 1 seated
    const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
    const kneeDrop = seated + (standing - seated) * k;
    const l = lean * Math.sin(Math.PI * Math.min(1, k * 2)) * (k < 0.9 ? 1 : 0);   // lean forward while rising
    c.update(sm.push(pose({ kneeDrop, lean: l, jitter })), A, t);
  }
  return c.reps + c.finalCredit();
}
// standing 0.69 is what the real pose model gave for a real standing person; 0.95 = long-legged
for (const standing of [0.65, 0.69, 0.95]) {
  for (const [seated, label] of [[0.15, 'camera at seat height'], [0.3, 'camera up high'], [-0.05, 'camera low']]) {
    for (const reps of [6, 12, 18]) {
      const got = chairRun({ reps, seated, standing });
      assert.equal(got, reps, `chair stands, ${label}, standing ${standing}: expected ${reps}, counted ${got}`);
    }
  }
}
assert.equal(chairRun({ reps: 10, seated: 0.15, endHalfway: true }), 11, 'more than halfway up at the end counts (CDC rule)');
// Jitter around a threshold while sitting still must not count anything.
{
  const c = new ChairCounter(); c.calibrate(0.2, 0.25);
  for (let t = 0; t < 10000; t += DT) c.update(pose({ kneeDrop: 0.2 + 0.25 * Math.sin(t / 37), jitter: 0.01 }), A, t);
  assert.equal(c.reps, 0, 'fidgeting in the chair is not a stand');
}
// Pushing off the thighs with your hands is noticed.
{
  const c = new ChairCounter(); c.calibrate(0.15, 0.25);
  for (let t = 0; t < 3000; t += DT) c.update(pose({ kneeDrop: 0.15, hands: [{ x: 0.56, y: 0.62 }, { x: 0.44, y: 0.62 }] }), A, t);
  assert.ok(c.armsOffShare > 0.9, 'hands on knees flagged');
}

// ---------------------------------------------------------------- one-leg balance
function balanceRun(holdSecs, { maxSecs = 30, jitter = 0.005, sway = 0.01 } = {}) {
  const b = new BalanceTimer({ max: maxSecs * 1000 }), sm = new Smoother();
  const liftAt = 1500, dropAt = liftAt + holdSecs * 1000;
  let s;
  for (let t = 0; t < dropAt + 3000; t += DT) {
    const up = t >= liftAt && t < dropAt;
    const ramp = up ? Math.min(1, (t - liftAt) / 150) : 0;
    s = b.update(sm.push(pose({ lAnkle: 1.9 - 0.45 * ramp, hipX: 0.5 + sway * Math.sin(t / 300), jitter })), A, t);
  }
  return s;
}
for (const hold of [4.2, 9.5, 12.3, 21.7]) {
  const s = balanceRun(hold);
  assert.ok(Math.abs(s.held - hold) < 0.35, `balance: held ${hold}s, timed ${s.held.toFixed(2)}s`);
  assert.equal(s.foot, 'left'); assert.equal(s.reason, 'foot down');
}
{ const s = balanceRun(40); assert.equal(s.held, 30); assert.equal(s.reason, 'time'); }
{ const calm = balanceRun(10, { sway: 0.002 }), wobbly = balanceRun(10, { sway: 0.03 }); assert.ok(wobbly.sway > 3 * calm.sway, 'sway measured'); }
// Standing still on both feet never starts the clock.
{ const b = new BalanceTimer(); let s; for (let t = 0; t < 8000; t += DT) s = b.update(pose({ jitter: 0.008 }), A, t); assert.equal(s.state, 'ready'); }

// ---------------------------------------------------------------- reach go / no-go
{
  const g = new ReachGame({ duration: 40000, rand: rnd }); g.start(0);
  let hand = null, rtTarget = 520, events = [];
  for (let t = 0; t <= 41000; t += DT) {
    const tg = g.target;
    // a player who reaches each green target ~520 ms after it appears and ignores red ones
    if (tg && !tg.red && t - tg.born >= rtTarget - 40) hand = { x: tg.x / A, y: tg.y };
    else hand = null;
    const lm = pose({ kneeDrop: 0.95, hands: hand ? [hand, { x: 0.46, y: 0.3 }] : null });
    events.push(...g.update(lm, A, t).events);
  }
  assert.ok(g.hits >= 12, `reach: ${g.hits} hits`);
  assert.equal(g.falseTouches, 0); assert.equal(g.misses, 0);
  assert.ok(g.avoids >= 3, 'red targets were left alone');
  const n = g.hits + g.avoids; assert.ok(Math.abs(g.avoids / n - 0.3) < 0.1, `fixed red share: ${g.avoids}/${n}`);
  assert.ok(Math.abs(g.medianRt - rtTarget) < 80, `reach time ${g.medianRt} ms`);
  assert.ok(g.done && g.score === g.hits);
}
{   // touching every target, red ones included, is penalised
  const g = new ReachGame({ duration: 20000, rand: rnd }); g.start(0);
  for (let t = 0; t <= 21000; t += DT) { const tg = g.target; g.update(pose({ hands: tg && t - tg.born > 300 ? [{ x: tg.x / A, y: tg.y }, { x: 0.46, y: 0.3 }] : null }), A, t); }
  assert.ok(g.falseTouches >= 1 && g.score === Math.max(0, g.hits - g.falseTouches));
}

// ---------------------------------------------------------------- framing
assert.ok(inView(pose(), ['head', 'shoulders', 'hips', 'knees', 'feet']).ok);
{ const lm = pose(); lm[27].visibility = 0.1; assert.deepEqual(inView(lm, ['knees', 'feet']).missing, ['feet']); }

console.log('movelogic: all checks passed');
