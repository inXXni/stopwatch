import test from 'node:test';
import assert from 'node:assert/strict';
import { beepEnvelope, createBeeper, BEEP_FREQ } from '../beep.js';

test('包络: 从 0 开始，0.4 秒后回到 0', () => {
  const env = beepEnvelope(10, 0.5);
  assert.deepEqual(env[0], [10, 0]);
  const [lastT, lastV] = env.at(-1);
  assert.ok(Math.abs(lastT - 10.4) < 1e-9, `结束于 ${lastT}`);
  assert.equal(lastV, 0);
});

test('包络: 峰值等于给定增益', () => {
  const env = beepEnvelope(0, 0.5);
  assert.equal(Math.max(...env.map(([, v]) => v)), 0.5);
});

test('包络: 时间点逐个递增', () => {
  const env = beepEnvelope(3, 0.5);
  for (let i = 1; i < env.length; i++) {
    assert.ok(env[i][0] > env[i - 1][0], `第 ${i} 个时间点没有递增`);
  }
});

// 假的音频环境：只记录调用，不出声
function fakeAudio() {
  const log = { contexts: 0, resumed: 0, ctx: null, oscillators: [] };
  class Param {
    constructor(v) { this.value = v; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime() {}
    cancelScheduledValues() {}
  }
  class Node { connect(next) { return next; } }
  class Ctx {
    constructor() {
      log.contexts++;
      log.ctx = this;
      this.currentTime = 0;
      this.state = 'suspended';
      this.destination = new Node();
    }
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve(); }
    createPeriodicWave() { return {}; }
    createGain() { const g = new Node(); g.gain = new Param(1); return g; }
    createOscillator() {
      const o = new Node();
      o.frequency = new Param(440);
      o.stops = [];
      o.setPeriodicWave = () => {};
      o.start = (t) => { o.startAt = t; };
      o.stop = (t) => { o.stops.push(t); };
      log.oscillators.push(o);
      return o;
    }
  }
  return { Ctx, log };
}

test('发声: 第一拍才建音频环境，按 2461 Hz 起振，响 0.4 秒', () => {
  const { Ctx, log } = fakeAudio();
  const beeper = createBeeper({ AudioContextClass: Ctx });
  assert.equal(log.contexts, 0, '创建时不应启动音频');
  beeper.beep();
  assert.equal(log.contexts, 1);
  assert.equal(log.resumed, 1, '挂起的音频环境要先恢复');
  assert.equal(log.oscillators.length, 1);
  const [o] = log.oscillators;
  assert.equal(o.frequency.value, BEEP_FREQ);
  assert.equal(o.startAt, 0);
  assert.deepEqual(o.stops, [0.4]);
});

test('发声: 之后每拍复用同一个音频环境', () => {
  const { Ctx, log } = fakeAudio();
  const beeper = createBeeper({ AudioContextClass: Ctx });
  beeper.beep();
  beeper.beep();
  beeper.beep();
  assert.equal(log.contexts, 1);
  assert.equal(log.oscillators.length, 3);
});

test('发声: 上一声没响完又来一拍，上一声 5 ms 内停掉，新的一声从头开始', () => {
  const { Ctx, log } = fakeAudio();
  const beeper = createBeeper({ AudioContextClass: Ctx });
  beeper.beep();
  log.ctx.currentTime = 0.1;
  beeper.beep();
  const [first, second] = log.oscillators;
  assert.equal(first.stops.length, 2);
  assert.ok(Math.abs(first.stops[1] - 0.105) < 1e-9, `上一声停在 ${first.stops[1]}`);
  assert.equal(second.startAt, 0.1);
  assert.ok(Math.abs(second.stops[0] - 0.5) < 1e-9);
});

test('发声: 浏览器没有 Web Audio 时静默跳过', () => {
  const beeper = createBeeper({ AudioContextClass: null });
  assert.doesNotThrow(() => beeper.beep());
});

test('发声: 音频出错不抛出，不影响计时', () => {
  class Broken { constructor() { throw new Error('boom'); } }
  const beeper = createBeeper({ AudioContextClass: Broken });
  assert.doesNotThrow(() => beeper.beep());
});
