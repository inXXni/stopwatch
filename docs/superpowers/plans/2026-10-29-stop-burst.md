# 停表爆裂 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把停表冲击加强为「爆裂」：停表那一刻先顿 70 ms（数字放大、镜头推近、色散拉开），随后整屏抖动、放射线与两道冲击环扩散；同时在「滴」之外响一声低音「咚」。

**Architecture:** `hit.js` 的 `stopHit` 改为七段动画，全部推迟 70 ms，顿帧期间要定格的几段用 `fill: 'backwards'` 停在第一帧；放射线坐标作为常量导出，由 `app.js` 启动时画进每格的 `<svg class="hit-lines">`。`beep.js` 的提示器加 `thump()`，与 `beep()` 共用音频环境。环与放射线的颜色改由格子上的 `--hit` 变量决定。

**Tech Stack:** 原生 HTML/CSS/JavaScript（ES module）、Web Animations API、Web Audio API、Node 内置 `node:test`；集成检查用 headless Chrome + CDP。

**Spec:** `docs/superpowers/specs/2026-10-29-stop-burst-design.md`

---

## 约定

- 下文 `$SCRATCH` 指本次会话的 scratchpad 目录，临时脚本与截图放这里，不提交。
  里面已有 `hit-check.mjs`（停表冲击的浏览器检查）、`spine-check.mjs` 与基线 `spine-shots/baseline.json`。
- 本机 8080 端口上常驻着用户的本地服务（项目目录下 `python3 -m http.server 8080`）。
  测试直接用它，不要另起服务占 8080；改完代码要重启它（Task 6）。
- headless Chrome 开在 9222 调试端口。
- 所有提交在分支 `feat/stop-burst` 上进行（设计文档已提交在这个分支上）。

## 文件结构

| 文件 | 改动 |
|---|---|
| `beep.js` | 抽出 `context()`；加 `thump()` 与参数常量 |
| `test/beep.test.js` | 假音频环境补齐噪声与滤波节点；加「咚」的测试 |
| `hit.js` | 改写为爆裂：`HITSTOP_MS`、`BURST_LINES`、`stopHit({ digits, rings, lines, stage, camera })` |
| `test/hit.test.js` | 按爆裂重写 |
| `index.html` | 每格多一个 `.hit-ring` 与一个 `.hit-lines`；`--hit` 变量；`.hit-lines` 样式 |
| `app.js` | 画放射线；`hitParts` 带上两道环、放射线与镜头；停表时响「咚」 |
| `sw.js` | `CACHE` 升到 v20 |
| `docs/superpowers/specs/2026-10-29-stop-hit-design.md` | 开头注明已加强为爆裂 |
| `docs/superpowers/specs/2026-10-28-slap-beep-design.md` | 非目标「开始与停表用不同的声音」指向爆裂 |
| `docs/superpowers/specs/2026-10-27-slap-stopwatch-design.md` | 停表冲击那一条改写为爆裂 |

---

### Task 1: 低音「咚」

**Files:**
- Modify: `beep.js`
- Test: `test/beep.test.js`

- [ ] **Step 1: 假音频环境补齐，加失败的测试**

`test/beep.test.js` 的导入改为：

```js
import { beepEnvelope, createBeeper, BEEP_FREQ, THUMP_FROM, THUMP_TO } from '../beep.js';
```

`fakeAudio()` 整个换成下面这版（多了指数渐变、噪声缓冲、低通滤波，并记下噪声源）：

```js
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
```

文件末尾加：

```js
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
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/beep.test.js`
Expected: FAIL，`beeper.thump is not a function`

- [ ] **Step 3: 实现**

`beep.js` 顶部注释后、`CUT_FADE` 之后加参数：

```js
// 停表那一拍的低音「咚」，参数见 docs/superpowers/specs/2026-10-29-stop-burst-design.md 第 4 节。
// 手机喇叭放不出真正的低音，所以从中频往下滑，小喇叭也听得出分量
export const THUMP_FROM = 300; // Hz
export const THUMP_TO = 70; // Hz
const THUMP_SWEEP = 0.14; // 音高滑下去用的时间，s
const THUMP_GAIN = 0.7;
const THUMP_LENGTH = 0.32; // s
// 敲击声：一小段快速衰减的白噪声，经低通去掉刺耳的高频
const CLICK_LENGTH = 0.03; // s
const CLICK_LOWPASS = 2500; // Hz
const CLICK_GAIN = 0.5;
```

`createBeeper` 里，`cutCurrent` 之前加：

```js
  // 浏览器只允许在用户操作中启动音频。第一次发声发生在拍击里，本身就是用户操作
  function context() {
    if (!ctx) ctx = new AudioContextClass();
    // 切到别的应用再回来时，音频环境可能被系统挂起
    if (ctx.state !== 'running') Promise.resolve(ctx.resume()).catch(() => {});
    return ctx;
  }
```

`beep()` 开头的

```js
      if (!AudioContextClass) return;
      // 浏览器只允许在用户操作中启动音频。第一次发声发生在第一拍里，本身就是用户操作
      if (!ctx) ctx = new AudioContextClass();
      // 切到别的应用再回来时，音频环境可能被系统挂起
      if (ctx.state !== 'running') Promise.resolve(ctx.resume()).catch(() => {});
      if (!wave) {
```

改为

```js
      if (!AudioContextClass) return;
      context();
      if (!wave) {
```

`beep()` 之后、`return` 之前加：

```js
  // 停表那一拍的「咚」，与「滴」同时响、各响各的，不经过 cutCurrent
  function thump() {
    try {
      if (!AudioContextClass) return;
      context();
      const t = ctx.currentTime;

      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(THUMP_FROM, t);
      osc.frequency.exponentialRampToValueAtTime(THUMP_TO, t + THUMP_SWEEP);
      // 指数渐变不能从 0 开始，用一个听不见的小值起步
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(THUMP_GAIN, t + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + THUMP_LENGTH);

      const n = Math.floor(ctx.sampleRate * CLICK_LENGTH);
      const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
      const click = ctx.createBufferSource();
      click.buffer = buffer;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = CLICK_LOWPASS;
      const clickAmp = ctx.createGain();
      clickAmp.gain.value = CLICK_GAIN;
      click.connect(lowpass).connect(clickAmp).connect(ctx.destination);
      click.start(t);
    } catch {
      // 同 beep：任何音频错误都不能影响计时
    }
  }
```

`return { beep };` 改为 `return { beep, thump };`，`createBeeper` 的文档注释第一行改为
`返回 { beep(), thump() }。两者都立即返回，声音交给浏览器的音频线程去播。`

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/beep.test.js`
Expected: 全部 PASS（原有 8 个 + 新增 3 个）

- [ ] **Step 5: 提交**

```bash
git add beep.js test/beep.test.js
git commit -m "feat: 停表那一拍的低音「咚」"
```

---

### Task 2: `hit.js` 改成爆裂

**Files:**
- Modify: `hit.js`
- Test: `test/hit.test.js`

- [ ] **Step 1: 重写测试**

`test/hit.test.js` 整个换成：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stopHit, HITSTOP_MS, BURST_LINES } from '../hit.js';

// 假元素：记下 animate 收到的关键帧与参数，getBoundingClientRect 返回给定的矩形
function fakeEl(rect = { left: 0, top: 0, width: 0, height: 0 }) {
  const calls = [];
  return {
    calls,
    style: {},
    getBoundingClientRect: () => rect,
    animate(frames, options) { calls.push({ frames, options }); return {}; },
  };
}
function hitOnce({ digitsRect, stageRect, cameraRect } = {}) {
  const parts = {
    digits: fakeEl(digitsRect),
    rings: [fakeEl(), fakeEl()],
    lines: fakeEl(),
    stage: fakeEl(stageRect),
    camera: fakeEl(cameraRect),
  };
  stopHit(parts);
  return parts;
}
// 数字上有两段动画：缩放与色散
const punch = (p) => p.digits.calls.find((c) => 'transform' in c.frames[0]);
const split = (p) => p.digits.calls.find((c) => 'filter' in c.frames[0]);
const allCalls = (p) => [p.digits, p.camera, p.stage, p.lines, ...p.rings].flatMap((el) => el.calls);
// [时长, 延迟, 顿帧期间是否停在第一帧]
const timing = (c) => [c.options.duration, c.options.delay, c.options.fill === 'backwards'];
// 数字中心 (320, 80)
const DIGITS = { left: 120, top: 30, width: 400, height: 100 };
const SCREEN = { left: 0, top: 0, width: 800, height: 360 };

test('停表爆裂: 顿帧 70 ms', () => {
  assert.equal(HITSTOP_MS, 70);
});

test('停表爆裂: 各段的时长、延迟，以及顿帧期间是否停在第一帧', () => {
  const p = hitOnce();
  assert.deepEqual(timing(punch(p)), [320, 70, true]);
  assert.deepEqual(timing(split(p)), [200, 70, true]);
  assert.deepEqual(timing(p.camera.calls[0]), [300, 70, true]);
  assert.deepEqual(timing(p.stage.calls[0]), [380, 70, false]);
  assert.deepEqual(timing(p.lines.calls[0]), [280, 70, false]);
  assert.deepEqual(timing(p.rings[0].calls[0]), [500, 70, false]);
  assert.deepEqual(timing(p.rings[1].calls[0]), [420, 160, false]);
});

test('停表爆裂: 一共七段，全部 0.6 秒内结束', () => {
  const calls = allCalls(hitOnce());
  assert.equal(calls.length, 7);
  for (const c of calls) assert.ok(c.options.delay + c.options.duration <= 600);
});

test('停表爆裂: 数字顿在 1.15 倍，回落后回到原样', () => {
  const { frames, options } = punch(hitOnce());
  assert.equal(frames[0].transform, 'scale(1.15)');
  assert.equal(frames.at(-1).transform, 'scale(1)');
  assert.equal(options.easing, 'ease-out');
});

test('停表爆裂: 色散从两侧偏色影子收拢到透明', () => {
  const f = split(hitOnce()).frames;
  assert.ok(f[0].filter.includes('drop-shadow(-1.9vmin 0.3vmin 0 rgba(0, 229, 255, 0.95))'));
  assert.ok(f[0].filter.includes('drop-shadow(1.9vmin -0.3vmin 0 rgba(255, 43, 214, 0.95))'));
  assert.ok(f.at(-1).filter.includes('drop-shadow(0 0 0 rgba(0, 229, 255, 0))'));
  assert.ok(f.at(-1).filter.includes('drop-shadow(0 0 0 rgba(255, 43, 214, 0))'));
});

test('停表爆裂: 色散的每一帧都保留数字原有的光晕（与 index.html 一致）', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const glow = html.match(/\.display \{[^}]*filter: ([^;]+);/)[1];
  for (const k of split(hitOnce()).frames) assert.ok(k.filter.endsWith(glow), k.filter);
});

test('停表爆裂: 镜头从 1.08 倍拉回，原点在数字中心', () => {
  const p = hitOnce({ digitsRect: DIGITS, cameraRect: SCREEN });
  assert.deepEqual(p.camera.calls[0].frames.map((k) => k.transform), ['scale(1.08)', 'scale(1)']);
  assert.equal(p.camera.style.transformOrigin, '320px 80px');
});

test('停表爆裂: 放射线从 0.6 倍放大到 1.35 倍并淡出，始终以 left、top 为中心', () => {
  const f = hitOnce().lines.calls[0].frames;
  assert.equal(f[0].transform, 'translate(-50%, -50%) scale(0.6)');
  assert.equal(f[0].opacity, 1);
  assert.equal(f.at(-1).transform, 'translate(-50%, -50%) scale(1.35)');
  assert.equal(f.at(-1).opacity, 0);
});

test('停表爆裂: 第一道环 8.3 → 138 vmin，第二道 7.2 → 106 vmin，最后都看不见', () => {
  const [r1, r2] = hitOnce().rings.map((r) => r.calls[0].frames);
  assert.equal(r1[0].width, '8.3vmin');
  assert.equal(r1.at(-1).width, '138vmin');
  assert.equal(r2[0].width, '7.2vmin');
  assert.equal(r2[0].opacity, 0.8);
  assert.equal(r2.at(-1).width, '106vmin');
  for (const f of [r1, r2]) assert.equal(f.at(-1).opacity, 0);
});

test('停表爆裂: 两道环与放射线都落在数字中心', () => {
  const p = hitOnce({ digitsRect: DIGITS, stageRect: SCREEN });
  for (const el of [...p.rings, p.lines]) {
    assert.equal(el.style.left, '320px');
    assert.equal(el.style.top, '80px');
  }
});

test('停表爆裂: 整屏正在抖（数字与 #stage 一起平移）时，位置不变', () => {
  const p = hitOnce({
    digitsRect: { left: 113, top: 34, width: 400, height: 100 },
    stageRect: { left: -7, top: 4, width: 800, height: 360 },
  });
  for (const el of [...p.rings, p.lines]) {
    assert.equal(el.style.left, '320px');
    assert.equal(el.style.top, '80px');
  }
});

test('停表爆裂: 14 根放射线长短交替，都画在 viewBox 内', () => {
  assert.equal(BURST_LINES.length, 14);
  const len = ({ x1, y1, x2, y2 }) => Math.hypot(x2 - x1, y2 - y1);
  BURST_LINES.forEach((l, k) => {
    if (k % 2) assert.ok(Math.abs(len(l) - 20.8) < 0.1, `第 ${k} 根应当是短线`);
    else assert.ok(Math.abs(len(l) - 37.5) < 0.1, `第 ${k} 根应当是长线`);
    for (const v of Object.values(l)) assert.ok(Math.abs(v) <= 60);
  });
});

test('停表爆裂: 每段关键帧的进度逐个递增', () => {
  for (const c of allCalls(hitOnce())) {
    const offsets = c.frames.map((k) => k.offset).filter((o) => o !== undefined);
    for (let i = 1; i < offsets.length; i++) assert.ok(offsets[i] > offsets[i - 1]);
  }
});

test('停表爆裂: 浏览器不支持 element.animate 时什么都不做', () => {
  assert.doesNotThrow(() => stopHit({ digits: {}, rings: [{}, {}], lines: {}, stage: {}, camera: {} }));
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/hit.test.js`
Expected: FAIL（`HITSTOP_MS`、`BURST_LINES` 未导出）

- [ ] **Step 3: 改写 `hit.js`**

整个换成：

```js
/**
 * 停表爆裂：停表那一刻画面先顿一下（数字放大、镜头推近、色散拉开），
 * 随后整屏抖动、放射线与两道冲击环扩散。普通模式与 PK 模式共用，
 * 参数见 docs/superpowers/specs/2026-10-29-stop-burst-design.md 第 3 节。
 * 尺寸都用 vmin，各种屏幕上比例一致。
 */

// 顿帧：前 70 ms 画面定格在被打中的那一下，之后各部分一齐放开
export const HITSTOP_MS = 70;

// 整屏抖动：形状与砸入撞击后的抖动相同，幅度 1.6 倍
const SHAKE_FRAMES = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-3.04vmin, 1.76vmin)', offset: 0.14 },
  { transform: 'translate(2.74vmin, -1.76vmin)', offset: 0.31 },
  { transform: 'translate(-1.76vmin, 0.97vmin)', offset: 0.52 },
  { transform: 'translate(0.97vmin, -0.48vmin)', offset: 0.74 },
  { transform: 'translate(0, 0)' },
];

// 数字顿在 1.15 倍，回落时略缩到 0.97 倍，再落定。只缩放，读数不变
const PUNCH_FRAMES = [
  { transform: 'scale(1.15)' },
  { transform: 'scale(0.97)', offset: 0.45 },
  { transform: 'scale(1.02)', offset: 0.7 },
  { transform: 'scale(1)' },
];

// 色散：数字两侧各拖一份偏色的影子，向数字收拢并淡出。
// 最后一层是数字原有的光晕（index.html 里 .display 的 filter），前后不变
const GLOW = 'drop-shadow(0 0 0.4vmin currentColor)';
const SPLIT_FRAMES = [
  { filter: `drop-shadow(-1.9vmin 0.3vmin 0 rgba(0, 229, 255, 0.95)) drop-shadow(1.9vmin -0.3vmin 0 rgba(255, 43, 214, 0.95)) ${GLOW}` },
  { filter: `drop-shadow(0 0 0 rgba(0, 229, 255, 0)) drop-shadow(0 0 0 rgba(255, 43, 214, 0)) ${GLOW}` },
];

// 镜头：以数字中心为原点，整页推近再拉回
const ZOOM_FRAMES = [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }];

// 放射线整组放大并淡出。translate 让 SVG 的中心对准 left、top
const LINES_FRAMES = [
  { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 1 },
  { transform: 'translate(-50%, -50%) scale(1.35)', opacity: 0 },
];

// 两道冲击环从数字中心出现，边扩散边变细变淡；第二道晚 90 ms、更细更小
const RING_FRAMES = [
  { width: '8.3vmin', height: '8.3vmin', borderWidth: '2.8vmin', opacity: 0.9 },
  { width: '138vmin', height: '138vmin', borderWidth: '0.3vmin', opacity: 0 },
];
const RING2_FRAMES = [
  { width: '7.2vmin', height: '7.2vmin', borderWidth: '1.7vmin', opacity: 0.8 },
  { width: '106vmin', height: '106vmin', borderWidth: '0.3vmin', opacity: 0 },
];

/**
 * 14 根放射线的端点，单位 vmin，以数字中心为原点。长短交替：
 * 偶数根从半径 22.2 画到 59.7，奇数根从 26.4 画到 47.2。
 */
export const BURST_LINES = Array.from({ length: 14 }, (_, k) => {
  const angle = (k * 2 * Math.PI) / 14 + 0.11;
  const [from, to] = k % 2 ? [26.4, 47.2] : [22.2, 59.7];
  const at = (r) => [Math.cos(angle) * r, Math.sin(angle) * r].map((v) => Math.round(v * 100) / 100);
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  return { x1, y1, x2, y2 };
});

/**
 * 对停表那一格播一次爆裂。digits 是这一格的数字（.display），rings 是这一格的两道冲击环，
 * lines 是这一格的放射线，camera 是推近时缩放的元素（整页）。
 * 浏览器不支持 element.animate 时什么都不做。
 */
export function stopHit({ digits, rings, lines, stage, camera }) {
  if (typeof digits?.animate !== 'function') return;
  // 数字中心。各矩形同受整屏抖动的平移，相减后与抖动无关
  const d = digits.getBoundingClientRect();
  const cx = d.left + d.width / 2;
  const cy = d.top + d.height / 2;
  const s = stage.getBoundingClientRect();
  for (const el of [...rings, lines]) {
    el.style.left = `${cx - s.left}px`;
    el.style.top = `${cy - s.top}px`;
  }
  const c = camera.getBoundingClientRect();
  camera.style.transformOrigin = `${cx - c.left}px ${cy - c.top}px`;

  // 顿帧期间要定格的几段停在第一帧；其余的顿帧之后才出现
  const held = { delay: HITSTOP_MS, fill: 'backwards', easing: 'ease-out' };
  digits.animate(PUNCH_FRAMES, { ...held, duration: 320 });
  digits.animate(SPLIT_FRAMES, { ...held, duration: 200 });
  camera.animate(ZOOM_FRAMES, { ...held, duration: 300 });
  stage.animate(SHAKE_FRAMES, { delay: HITSTOP_MS, duration: 380 });
  lines.animate(LINES_FRAMES, { delay: HITSTOP_MS, duration: 280, easing: 'ease-out' });
  rings[0].animate(RING_FRAMES, { delay: HITSTOP_MS, duration: 500, easing: 'ease-out' });
  rings[1].animate(RING2_FRAMES, { delay: HITSTOP_MS + 90, duration: 420, easing: 'ease-out' });
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/hit.test.js`
Expected: 14 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add hit.js test/hit.test.js
git commit -m "feat: 停表冲击加强为爆裂"
```

---

### Task 3: 页面、样式、接线与离线缓存

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `sw.js`

- [ ] **Step 1: 每格加第二道环与放射线**

两格的 `<span class="hit-ring"></span>` 之后各加：

```html
      <span class="hit-ring"></span>
      <svg class="hit-lines" viewBox="-60 -60 120 120" aria-hidden="true"></svg>
```

- [ ] **Step 2: 颜色改由 `--hit` 决定**

`.slot` 规则里 `color: var(--ink);` 之后加：

```css
    --hit: var(--ink-hit); /* 停表冲击环与放射线的颜色 */
```

`:root[data-pk] .slot[data-side="blue"] { color: var(--ink-blue); }` 与它下面那行
`:root[data-pk] .slot[data-side="blue"] .hit-ring { border-color: var(--ink-blue-hit); }` 合并为：

```css
  :root[data-pk] .slot[data-side="blue"] { color: var(--ink-blue); --hit: var(--ink-blue-hit); }
```

- [ ] **Step 3: 冲击环样式改用 `--hit`，加放射线样式**

把现有的

```css
  /* 停表冲击环：停表时 hit.js 把它挪到这一格数字的中心，从那里扩散出去。
     平时尺寸为 0、不可见。两格的数字带 filter，各自成层，环要提一层才能盖住另一格的数字；
     PK 模式下 VS 再高一层，压在环上面。见 docs/superpowers/specs/2026-10-29-stop-hit-design.md */
  .hit-ring {
```

改为

```css
  /* 停表爆裂的两道冲击环与放射线：停表时 hit.js 把它们挪到这一格数字的中心，从那里扩散出去。
     平时不可见。两格的数字带 filter，各自成层，要提一层才能盖住另一格的数字；
     PK 模式下 VS 再高一层，压在上面。见 docs/superpowers/specs/2026-10-29-stop-burst-design.md */
  .hit-ring {
```

`.hit-ring` 里 `border: 0 solid var(--ink-hit);` 改为 `border: 0 solid var(--hit);`。

把

```css
  /* 带 ?green 时停表这一刻数字转绿，环跟着用浅绿（只出现在普通模式） */
  :root[data-green-stop] .hit-ring { border-color: var(--ink-green-hit); }
```

改为

```css
  /* 放射线的 SVG 宽高与 viewBox 都是 120，线的坐标与线宽因此直接是 vmin */
  .hit-lines {
    position: absolute;
    z-index: 1;
    width: 120vmin;
    height: 120vmin;
    overflow: visible;
    transform: translate(-50%, -50%);
    opacity: 0;
    pointer-events: none;
    stroke: var(--hit);
    stroke-width: 0.8;
    stroke-linecap: round;
  }

  /* 带 ?green 时停表这一刻数字转绿，环与放射线跟着用浅绿（只出现在普通模式） */
  :root[data-green-stop] .slot { --hit: var(--ink-green-hit); }
```

- [ ] **Step 4: `app.js` 接线**

导入改为：

```js
import { stopHit, BURST_LINES } from './hit.js';
```

把现有的

```js
// 停表那一刻冲击停表那一格：整屏抖、数字弹、冲击环扩散。普通模式只用第一格
const hitParts = slots.map((slot) => ({
  digits: slot.querySelector('.display'),
  ring: slot.querySelector('.hit-ring'),
  stage,
}));
function hit(i) {
  if (reducedMotion()) return;
  stopHit(hitParts[i]);
}
```

改为

```js
// 停表那一刻冲击停表那一格：顿帧、镜头推近、色散，随后整屏抖、放射线与两道环扩散，
// 同时响一声「咚」。普通模式只用第一格
const hitParts = slots.map((slot) => ({
  digits: slot.querySelector('.display'),
  rings: [...slot.querySelectorAll('.hit-ring')],
  lines: slot.querySelector('.hit-lines'),
  stage,
  camera: document.body,
}));
for (const { lines } of hitParts) {
  for (const coords of BURST_LINES) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    for (const [k, v] of Object.entries(coords)) line.setAttribute(k, v);
    lines.append(line);
  }
}
function hit(i) {
  beeper.thump(); // 声音不是动态效果，不受「减弱动态效果」影响
  if (reducedMotion()) return;
  stopHit(hitParts[i]);
}
```

两处 `hit(…); // 成绩已经写好，动画在锁定期内播完` 的注释改为 `// 成绩已经写好，之后才播`。

- [ ] **Step 5: `sw.js` 升版本**

`CACHE` 改为 `'slap-stopwatch-v20'`。

- [ ] **Step 6: 全部测试**

Run: `npm test`
Expected: 全部通过（82 − 8 + 14 + 3 = 91 个）

- [ ] **Step 7: 静止外观对比基线**

Run: `cd $SCRATCH && node spine-check.mjs spine-shots`
Expected: 全部通过

- [ ] **Step 8: 提交**

```bash
git add index.html app.js sw.js
git commit -m "feat: 停表时播爆裂并响「咚」，普通模式与 PK 都播"
```

---

### Task 4: 浏览器里检查

**Files:**
- Create: `$SCRATCH/burst-check.mjs`（不提交）

- [ ] **Step 1: 写检查脚本**

`$SCRATCH/burst-check.mjs`：

```js
// 停表爆裂的检查。用法：node burst-check.mjs <截图目录>
// 前提：本地服务 http://localhost:8080；headless Chrome 开着 9222 调试端口。
// 在页面脚本之前拦截 Element.prototype.animate 与 AudioContext.prototype.createOscillator，
// 记下每段动画的目标、所在格、属性、时长、延迟、是否停在第一帧，以及建了哪些振荡器；
// 同时记下每次 Enter 的事件时间戳，核对成绩仍按事件时间计算。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatTime } from '/Users/wx.su/study/timer/timer-core.js';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.error('超时'); process.exit(2); }, 240000).unref();
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${CDP}/json/version`)).ok) break; } catch {}
  await sleep(200);
}

const SPY = `(() => {
  window.__anim = []; window.__objs = []; window.__osc = []; window.__keys = []; window.__errors = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const slot = this.closest('.slot');
    window.__anim.push({
      who: this.id || this.getAttribute('class') || this.tagName.toLowerCase(),
      side: slot ? slot.dataset.side : '',
      prop: Object.keys(frames[0]).filter((k) => k !== 'offset' && k !== 'easing').join('+'),
      ms: options.duration, delay: options.delay || 0, held: options.fill === 'backwards',
    });
    const a = animate.apply(this, arguments);
    window.__objs.push(a);
    return a;
  };
  const createOscillator = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const o = createOscillator.apply(this, arguments);
    window.__osc.push(o);
    return o;
  };
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.repeat) window.__keys.push(e.timeStamp); }, true);
  addEventListener('error', (e) => window.__errors.push(String(e.message)));
})();`;

async function open(path, { w = 800, h = 360, reduce = false } = {}) {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
    return r.result.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  if (reduce) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  }
  await send('Page.enable');
  // 本机 Chrome 里可能还装着旧版 Service Worker，绕过它和 HTTP 缓存
  await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
  await send('Page.navigate', { url: BASE + path });
  await sleep(1500);
  const key = (type) => send('Input.dispatchKeyEvent',
    { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  return {
    evaluate,
    close: () => fetch(`${CDP}/json/close/${t.id}`),
    enter: async (wait) => { await key('keyDown'); await key('keyUp'); await sleep(wait); },
    shot: async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, file), Buffer.from(r.result.data, 'base64'));
    },
  };
}

const STATE = `({ anim: window.__anim, keys: window.__keys, errors: window.__errors,
  thumps: window.__osc.filter((o) => o.type === 'triangle').length,
  values: [...document.querySelectorAll('.display')].map((s) => s.dataset.value) })`;
// 停表爆裂的七段。砸入的三段（vs-text、vs-ring 与 560 ms 的 #stage）不算在内
const hits = (m) => m.anim.filter((a) => a.who !== 'vs-text' && a.who !== 'vs-ring' && a.ms !== 560);
const desc = (list) => list.map((a) =>
  `${a.who}${a.side ? '@' + a.side : ''}/${a.prop}/${a.ms}+${a.delay}${a.held ? '定格' : ''}`).sort().join('\n        ');
const expectOf = (side) => [
  'body/transform/300+70定格',
  `display@${side}/filter/200+70定格`,
  `display@${side}/transform/320+70定格`,
  `hit-lines@${side}/transform+opacity/280+70`,
  `hit-ring@${side}/width+height+borderWidth+opacity/500+70`,
  `hit-ring@${side}/width+height+borderWidth+opacity/420+160`,
  'stage/transform/380+70',
].sort().join('\n        ');
const PAUSE = (ms) => `window.__objs.slice(-7).forEach((a) => { a.pause(); a.currentTime = ${ms}; }), true`;
const FINISH = `window.__objs.slice(-7).forEach((a) => a.finish()), true`;
// 第 i 格：两道环与放射线的中心、数字中心、颜色
const GEOM = (i) => `(() => {
  const slot = document.querySelectorAll('.slot')[${i}];
  const c = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const rings = [...slot.querySelectorAll('.hit-ring')];
  const lines = slot.querySelector('.hit-lines');
  return {
    digits: c(slot.querySelector('.display')),
    parts: [...rings, lines].map(c),
    colors: [...rings.map((r) => getComputedStyle(r).borderTopColor), getComputedStyle(lines).stroke],
  };
})()`;
const maxDist = (g) => Math.max(...g.parts.map((p) => Math.hypot(p[0] - g.digits[0], p[1] - g.digits[1])));
const REST = `({ body: getComputedStyle(document.body).transform,
  filters: [...document.querySelectorAll('.display')].map((s) => getComputedStyle(s).filter) })`;

let failed = 0;
const check = (name, pass, detail) => {
  if (!pass) failed++;
  console.log(`${pass ? 'OK  ' : 'FAIL'}  ${name}\n      ${detail}`);
};

const RED = 'rgb(255, 194, 189)';
const BLUE = 'rgb(196, 220, 255)';
const GREEN = 'rgb(192, 255, 210)';

// 普通模式：只在停表时播、响「咚」；成绩按事件时间戳；播完不留痕
{
  const p = await open('/');
  const rest0 = await p.evaluate(REST);
  await p.enter(400); await p.enter(100); // 开始、停表
  const m1 = await p.evaluate(STATE);
  check('普通 · 停表播爆裂七段', desc(hits(m1)) === expectOf('red'), desc(hits(m1)) || '没有');
  check('普通 · 停表响一声咚', m1.thumps === 1, `${m1.thumps} 声`);
  await p.enter(700); // 锁定期内拍
  await p.enter(300); // 清零
  await p.enter(400); // 开始
  const m2 = await p.evaluate(STATE);
  check('普通 · 锁定期内拍、清零、开始都不播不响', hits(m2).length === 7 && m2.thumps === 1, `${hits(m2).length} 段，${m2.thumps} 声`);
  await p.enter(800); // 停表，等播完
  const m3 = await p.evaluate(STATE);
  check('普通 · 第二次停表再播一次', hits(m3).length === 14 && m3.thumps === 2, `${hits(m3).length} 段，${m3.thumps} 声`);
  const expect = formatTime(m3.keys[5] - m3.keys[4]);
  check('普通 · 成绩仍按按键事件的时间戳计算', m3.values[0] === expect, `显示 ${m3.values[0]}，按事件时间算 ${expect}`);
  const rest1 = await p.evaluate(REST);
  check('普通 · 播完后页面没有残留的缩放，数字光晕复原',
    rest1.body === 'none' && rest1.filters[0] === rest0.filters[0], `${rest1.body} / ${rest1.filters[0]}`);
  check('普通 · 没有脚本错误', m3.errors.length === 0, m3.errors.join(' / ') || '无');
  await p.close();
}

// 普通模式横竖屏、?green：环与放射线在数字中心，颜色对
for (const [path, w, h, color, name] of [
  ['/', 800, 360, RED, '普通-横屏'],
  ['/', 360, 708, RED, '普通-竖屏'],
  ['/?green', 800, 360, GREEN, '绿色停表'],
]) {
  const p = await open(path, { w, h });
  await p.enter(400); await p.enter(0);
  for (const ms of [30, 150]) {
    await p.evaluate(PAUSE(ms));
    await sleep(150);
    await p.shot(`${name}-${ms}ms.png`);
  }
  const g = await p.evaluate(GEOM(0));
  await p.evaluate(FINISH);
  await p.close();
  check(`${name} · 两道环与放射线在数字中心`, maxDist(g) < 1, `最大相差 ${maxDist(g).toFixed(2)} px`);
  check(`${name} · 颜色`, g.colors.every((c) => c === color), g.colors.join(' / '));
}

// PK：红方、蓝方停表各冲击自己那一格并响「咚」；其余拍不播不响；成绩按事件时间戳
{
  const p = await open('/?pk');
  await p.enter(400); await p.enter(100); // 红方开始、停表
  const m1 = await p.evaluate(STATE);
  check('PK · 红方停表冲击红方', desc(hits(m1)) === expectOf('red'), desc(hits(m1)) || '没有');
  await p.enter(700); // 锁定期内拍
  await p.enter(400); await p.enter(100); // 蓝方开始、停表
  const m2 = await p.evaluate(STATE);
  check('PK · 蓝方停表冲击蓝方', desc(hits(m2).slice(7)) === expectOf('blue'), desc(hits(m2).slice(7)) || '没有');
  await p.enter(700); // 锁定期内拍
  await p.enter(300); // 清场
  await p.enter(400); // 红方开始
  const m3 = await p.evaluate(STATE);
  check('PK · 锁定期内拍、清场、开始都不播不响', hits(m3).length === 14 && m3.thumps === 2, `${hits(m3).length} 段，${m3.thumps} 声`);
  // m2 时的按键：红方开始、停表、锁定期内拍、蓝方开始、停表
  const e0 = formatTime(m2.keys[1] - m2.keys[0]);
  check('PK · 红方成绩仍按按键事件的时间戳计算', m2.values[0] === e0, `显示 ${m2.values[0]}，按事件时间算 ${e0}`);
  const e1 = formatTime(m2.keys[4] - m2.keys[3]);
  check('PK · 蓝方成绩仍按按键事件的时间戳计算', m2.values[1] === e1, `显示 ${m2.values[1]}，按事件时间算 ${e1}`);
  check('PK · 没有脚本错误', m3.errors.length === 0, m3.errors.join(' / ') || '无');
  await p.close();
}

// PK 三种排法：环与放射线在数字中心，颜色对
for (const [w, h] of [[800, 360], [360, 800], [1024, 768]]) {
  const p = await open('/?pk', { w, h });
  await sleep(600); // 等打开时的砸入播完
  await p.enter(400); await p.enter(0); // 红方
  await p.evaluate(PAUSE(150));
  const g0 = await p.evaluate(GEOM(0));
  await sleep(150);
  await p.shot(`PK-${w}x${h}-红方-150ms.png`);
  await p.evaluate(FINISH);
  await sleep(700);
  await p.enter(400); await p.enter(0); // 蓝方
  await p.evaluate(PAUSE(150));
  const g1 = await p.evaluate(GEOM(1));
  await sleep(150);
  await p.shot(`PK-${w}x${h}-蓝方-150ms.png`);
  await p.evaluate(FINISH);
  await p.close();
  check(`PK ${w}x${h} · 红方环与放射线在数字中心`, maxDist(g0) < 1, `最大相差 ${maxDist(g0).toFixed(2)} px`);
  check(`PK ${w}x${h} · 蓝方环与放射线在数字中心`, maxDist(g1) < 1, `最大相差 ${maxDist(g1).toFixed(2)} px`);
  check(`PK ${w}x${h} · 颜色`, g0.colors.every((c) => c === RED) && g1.colors.every((c) => c === BLUE),
    `${g0.colors.join(' / ')} | ${g1.colors.join(' / ')}`);
}

// 减弱动态效果：停表没有画面效果，「咚」照响
for (const path of ['/', '/?pk']) {
  const p = await open(path, { reduce: true });
  await p.enter(400); await p.enter(700); await p.enter(400); await p.enter(700);
  const m = await p.evaluate(STATE);
  await p.close();
  const stops = path === '/' ? 1 : 2;
  check(`减弱动态效果 · ${path} 停表没有画面效果，咚照响`, hits(m).length === 0 && m.thumps === stops,
    `${hits(m).length} 段，${m.thumps} 声`);
}

// 停表过程的几帧：手机横屏 PK 红方停表
{
  const p = await open('/?pk');
  await sleep(600);
  await p.enter(400); await p.enter(0);
  for (const ms of [30, 100, 200, 350]) {
    await p.evaluate(PAUSE(ms));
    await sleep(150);
    await p.shot(`PK-红方停表-${ms}ms.png`);
  }
  await p.evaluate(FINISH);
  await sleep(150);
  await p.shot('PK-播完.png');
  await p.close();
}

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: 跑检查**

Run: `cd $SCRATCH && node burst-check.mjs burst-shots`
Expected: 每项 `OK`，最后一行「全部通过」

- [ ] **Step 3: 看截图**

用 Read 打开 `burst-shots/` 里的截图，逐张确认：

- 30 ms（顿帧）：数字明显放大、画面推近、数字两侧有青色与品红的影子，还没有环和放射线
- 100、150、200 ms：整屏位移、放射线与环出现，色散已收拢
- PK 下环与放射线在 VS 下面、在另一格数字上面；蓝方是浅蓝，绿色停表是浅绿
- `PK-播完.png` 与改动前的静止画面一致

- [ ] **Step 4: 复跑脊柱外观检查**

Run: `cd $SCRATCH && node spine-check.mjs spine-shots`
Expected: 全部通过

---

### Task 5: 同步设计文档

**Files:**
- Modify: `docs/superpowers/specs/2026-10-29-stop-hit-design.md`
- Modify: `docs/superpowers/specs/2026-10-28-slap-beep-design.md`
- Modify: `docs/superpowers/specs/2026-10-27-slap-stopwatch-design.md`

- [ ] **Step 1: 冲击设计开头「基础」那一行之后加**

```markdown

> 后续：停表效果已加强为「爆裂」，见 `2026-10-29-stop-burst-design.md`。本文的整屏抖动与第一道冲击环原样保留，
> 「数字弹一下」被顿帧后的回落取代，停表那一拍另加了低音「咚」。
```

- [ ] **Step 2: 提示音设计第 7 节非目标**

`- 开始与停表用不同的声音` 改为：

```markdown
- 开始与停表用不同的声音。后来停表那一拍另加了一声低音「咚」，见 `2026-10-29-stop-burst-design.md`
```

- [ ] **Step 3: 主设计交互一节**

把

```markdown
- 停表那一刻整屏抖一下，停表那一格的数字弹大再落回，并从数字中心扩散出一圈浅色环，
  0.5 秒内、锁定期结束前播完；开了「减弱动态效果」时不播。
  详见 `2026-10-29-stop-hit-design.md`。
```

改为

```markdown
- 停表那一刻画面先顿 70 ms（数字放大、镜头推近、色散拉开），随后整屏抖动、放射线与两道
  浅色冲击环扩散，0.6 秒内播完；同时在「滴」之外响一声低音「咚」。开了「减弱动态效果」时
  只有声音。详见 `2026-10-29-stop-burst-design.md`。
```

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-10-29-stop-hit-design.md docs/superpowers/specs/2026-10-28-slap-beep-design.md docs/superpowers/specs/2026-10-27-slap-stopwatch-design.md
git commit -m "docs: 旧设计指向停表爆裂"
```

---

### Task 6: 收尾

- [ ] **Step 1: 重启 8080**

停掉本次会话起的 8080 后台任务，在项目目录重新起 `python3 -m http.server 8080`（后台），然后：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
curl -s http://127.0.0.1:8080/sw.js | grep "const CACHE"
```

Expected: `200`，`const CACHE = 'slap-stopwatch-v20';`

- [ ] **Step 2: 手机真机看一眼（手机连着且没锁屏时）**

`adb devices` 能看到手机时：`adb reverse tcp:8080 tcp:8080`，在手机 Chrome 打开
`http://localhost:8080/` 与 `http://localhost:8080/?pk`（刷新两次换成 v20），看停表爆裂是否流畅、「咚」听不听得见。
只碰秒表的标签页。手机没连或锁屏时跳过，不卡在这里，并在计划末尾记下。

- [ ] **Step 3: 按 superpowers:finishing-a-development-branch 处理分支**

推送等于发布线上版本，每次都要等用户明确同意。
