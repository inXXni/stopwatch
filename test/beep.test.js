import test from 'node:test';
import assert from 'node:assert/strict';
import { beepEnvelope, createBeeper, BEEP_FREQ, THUMP_FROM, THUMP_TO } from '../beep.js';

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
  const log = { contexts: 0, resumed: 0, ctx: null, oscillators: [], sources: [] };
  class Param {
    constructor(v) { this.value = v; this.ramps = []; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime() {}
    exponentialRampToValueAtTime(v, t) { this.ramps.push([v, t]); }
    cancelScheduledValues() {}
  }
  class Node { connect(next) { return next; } }
  class Ctx {
    constructor() {
      log.contexts++;
      log.ctx = this;
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = 'suspended';
      this.destination = new Node();
    }
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve(); }
    createPeriodicWave() { return {}; }
    createGain() { const g = new Node(); g.gain = new Param(1); return g; }
    createBiquadFilter() { const f = new Node(); f.frequency = new Param(350); return f; }
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    }
    createBufferSource() {
      const s = new Node();
      s.start = (t) => { s.startAt = t; };
      log.sources.push(s);
      return s;
    }
    createOscillator() {
      const o = new Node();
      o.type = 'sine';
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

test('咚: 三角波从 300 Hz 往下滑到 70 Hz，0.32 秒停，同时带一段敲击噪声', () => {
  const { Ctx, log } = fakeAudio();
  const beeper = createBeeper({ AudioContextClass: Ctx });
  beeper.thump();
  assert.equal(log.oscillators.length, 1);
  const [o] = log.oscillators;
  assert.equal(o.type, 'triangle');
  assert.equal(o.frequency.value, THUMP_FROM);
  assert.deepEqual(o.frequency.ramps, [[THUMP_TO, 0.14]]);
  assert.equal(o.startAt, 0);
  assert.deepEqual(o.stops, [0.32]);
  assert.equal(log.sources.length, 1, '应当有一段敲击噪声');
  assert.equal(log.sources[0].startAt, 0);
});

test('咚: 与滴共用音频环境，也不打断正在响的滴', () => {
  const { Ctx, log } = fakeAudio();
  const beeper = createBeeper({ AudioContextClass: Ctx });
  beeper.beep();
  log.ctx.currentTime = 0.1;
  beeper.thump();
  assert.equal(log.contexts, 1);
  const [beep] = log.oscillators;
  assert.deepEqual(beep.stops, [0.4], '滴应当照常响完');
});

test('咚: 浏览器没有 Web Audio 或音频出错时静默跳过', () => {
  assert.doesNotThrow(() => createBeeper({ AudioContextClass: null }).thump());
  class Broken { constructor() { throw new Error('boom'); } }
  assert.doesNotThrow(() => createBeeper({ AudioContextClass: Broken }).thump());
});
