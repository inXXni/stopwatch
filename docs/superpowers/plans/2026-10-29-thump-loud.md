# 「咚」放大 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 停表那一拍的「咚」配方不变、音量放大到 3 倍，「滴」与「咚」经同一个软限幅出口，「滴」一点不变、叠在一起不破音。

**Architecture:** 全部改动在 `beep.js`：`THUMP_GAIN` 0.7 → 2.1、`CLICK_GAIN` 0.5 → 1.5；新增纯函数 `softClip(x)`（|x| ≤ 0.5 原样，超过的部分 tanh 软压到 0.95）；`createBeeper` 里第一次发声时建共用出口（增益 1/4 → WaveShaper，曲线 4096 点覆盖 −4～4，不做过采样 → destination），`beep()` 与 `thump()` 都接到它。

**Tech Stack:** Web Audio API、Node 内置 `node:test`；离线渲染核对用 headless Chrome + CDP + `OfflineAudioContext`。

**Spec:** `docs/superpowers/specs/2026-10-29-thump-loud-design.md`

---

## 文件

| 文件 | 动作 | 职责 |
|---|---|---|
| `beep.js` | 修改 | 咚的两个增益、软限幅曲线、共用出口 |
| `test/beep.test.js` | 修改 | 假音频环境记下连接与 WaveShaper；新增出口与增益的测试 |
| `sw.js` | 修改 | 缓存版本 v23 |
| `docs/superpowers/specs/2026-10-29-stop-burst-design.md` | 修改 | 第 4 节加注 |

本计划之外、放在 scratchpad（下称 `$S`）的核对脚本：`thump-render-check.mjs`。

---

### Task 1: 共用出口与 3 倍增益

**Files:**
- Modify: `beep.js`
- Test: `test/beep.test.js`

- [ ] **Step 1: 让假音频环境记下连接、增益节点与 WaveShaper**

`test/beep.test.js` 第 3 行：

```js
import { beepEnvelope, createBeeper, BEEP_FREQ, THUMP_FROM, THUMP_TO } from '../beep.js';
```

改为：

```js
import { beepEnvelope, createBeeper, softClip, BEEP_FREQ, THUMP_FROM, THUMP_TO, THUMP_GAIN, CLICK_GAIN } from '../beep.js';
```

`fakeAudio()` 里：

```js
  const log = { contexts: 0, resumed: 0, ctx: null, oscillators: [], sources: [] };
```

改为：

```js
  const log = { contexts: 0, resumed: 0, ctx: null, oscillators: [], sources: [], gains: [], shapers: [] };
```

```js
  class Node { connect(next) { return next; } }
```

改为（记下接到了谁，测试据此检查连线）：

```js
  class Node { connect(next) { this.next = next; return next; } }
```

```js
    createGain() { const g = new Node(); g.gain = new Param(1); return g; }
```

改为（WaveShaper 的过采样默认值故意设成 `'unset'`，才能验出代码把它设成了 `'none'`）：

```js
    createGain() { const g = new Node(); g.gain = new Param(1); log.gains.push(g); return g; }
    createWaveShaper() { const w = new Node(); w.curve = null; w.oversample = 'unset'; log.shapers.push(w); return w; }
```

- [ ] **Step 2: 写新测试**

追加到 `test/beep.test.js` 末尾：

```js
test('出口: 0.5 以内原样通过，滴的峰值一点不变', () => {
  for (const x of [0, 0.1, 0.3, 0.5, -0.2, -0.5]) assert.equal(softClip(x), x);
});

test('出口: 超过 0.5 软压，单调、正负对称，不超过 0.95', () => {
  let prev = softClip(0.5);
  for (let x = 0.55; x <= 10; x += 0.05) {
    const y = softClip(x);
    assert.ok(y >= prev && y <= 0.95 + 1e-12, `x=${x} y=${y}`);
    assert.equal(softClip(-x), -y);
    prev = y;
  }
  assert.ok(softClip(4) > 0.94, `输入 4 时 ${softClip(4)}`);
});

test('出口: 滴和咚都接到同一个出口，出口经软限幅接到喇叭，只建一次', () => {
  const { Ctx, log } = fakeAudio();
  const beeper = createBeeper({ AudioContextClass: Ctx });
  beeper.beep();
  beeper.thump();
  beeper.beep();
  assert.equal(log.shapers.length, 1, '出口只建一次');
  const [shaper] = log.shapers;
  assert.equal(shaper.next, log.ctx.destination);
  assert.equal(shaper.oversample, 'none');
  assert.equal(shaper.curve.length, 4096);
  assert.equal(shaper.curve[0], Math.fround(softClip(-4)));
  assert.equal(shaper.curve[4095], Math.fround(softClip(4)));
  const outlet = log.gains.find((g) => g.next === shaper);
  assert.ok(outlet, '出口的入口是一个增益节点');
  assert.equal(outlet.gain.value, 0.25);
  const [beep1, thump, beep2] = log.oscillators;
  assert.equal(beep1.next.next, outlet, '滴接到出口');
  assert.equal(beep2.next.next, outlet);
  assert.equal(thump.next.next, outlet, '咚的三角波接到出口');
  assert.equal(log.sources[0].next.next.next, outlet, '敲击噪声经低通、增益接到出口');
});

test('咚: 三角波峰值增益 2.1、敲击噪声增益 1.5，都是原来的 3 倍', () => {
  assert.equal(THUMP_GAIN, 2.1);
  assert.equal(CLICK_GAIN, 1.5);
  const { Ctx, log } = fakeAudio();
  createBeeper({ AudioContextClass: Ctx }).thump();
  const [o] = log.oscillators;
  assert.deepEqual(o.next.gain.ramps, [[THUMP_GAIN, 0.004], [0.001, 0.3]]);
  assert.equal(log.sources[0].next.next.gain.value, CLICK_GAIN);
});
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `node --test test/beep.test.js 2>&1 | grep -E "^not ok|SyntaxError|ℹ (pass|fail)"`
Expected: 失败，`softClip`、`THUMP_GAIN`、`CLICK_GAIN` 没有导出

- [ ] **Step 4: 改 `beep.js` 的常量**

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

改为：

```js
// 停表那一拍的低音「咚」，参数见 docs/superpowers/specs/2026-10-29-stop-burst-design.md 第 4 节，
// 音量后来放大到 3 倍，见 2026-10-29-thump-loud-design.md。
// 手机喇叭放不出真正的低音，所以从中频往下滑，小喇叭也听得出分量
export const THUMP_FROM = 300; // Hz
export const THUMP_TO = 70; // Hz
const THUMP_SWEEP = 0.14; // 音高滑下去用的时间，s
export const THUMP_GAIN = 2.1; // 超过满幅，由共用出口软压下来
const THUMP_LENGTH = 0.32; // s
// 敲击声：一小段快速衰减的白噪声，经低通去掉刺耳的高频
const CLICK_LENGTH = 0.03; // s
const CLICK_LOWPASS = 2500; // Hz
export const CLICK_GAIN = 1.5;

// 共用出口：滴和咚都先经过它再送到喇叭。幅度在 KNEE 以内原样通过，滴的峰值就是 0.5，所以滴一点不变；
// 超过的部分用 tanh 软压，最高趋近 KNEE + SOFT = 0.95，咚放大以后、和滴叠在一起都不会被硬削顶
const KNEE = 0.5;
const SOFT = 0.45;
const CURVE_RANGE = 4; // 曲线覆盖输入 −4～4
const CURVE_POINTS = 4096;

/** 共用出口的软限幅曲线 */
export function softClip(x) {
  const a = Math.abs(x);
  return Math.sign(x) * (a <= KNEE ? a : KNEE + SOFT * Math.tanh((a - KNEE) / SOFT));
}
```

- [ ] **Step 5: 改 `createBeeper`，建共用出口**

```js
  let ctx = null;
  let wave = null;
  let current = null; // 正在响的那一声：{ osc, amp }
```

改为：

```js
  let ctx = null;
  let wave = null;
  let outlet = null; // 共用出口的入口
  let current = null; // 正在响的那一声：{ osc, amp }
```

在 `context()` 函数之后插入：

```js
  // 共用出口，第一次发声时建，之后一直复用。WaveShaper 把输入的 −1～1 映射到整条曲线，
  // 曲线覆盖 −4～4，所以先乘 1/4 再送进去。不做过采样：过采样的滤波会让峰值冲过 0.95，出「咔」声
  function output() {
    if (!outlet) {
      const curve = new Float32Array(CURVE_POINTS);
      for (let i = 0; i < CURVE_POINTS; i++) curve[i] = softClip(((i / (CURVE_POINTS - 1)) * 2 - 1) * CURVE_RANGE);
      const shaper = ctx.createWaveShaper();
      shaper.curve = curve;
      shaper.oversample = 'none';
      outlet = ctx.createGain();
      outlet.gain.value = 1 / CURVE_RANGE;
      outlet.connect(shaper).connect(ctx.destination);
    }
    return outlet;
  }
```

`beep()` 里：

```js
      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(rest.at(-1)[0]);
```

改为：

```js
      osc.connect(amp).connect(output());
      osc.start(t);
      osc.stop(rest.at(-1)[0]);
```

`thump()` 里：

```js
      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + THUMP_LENGTH);
```

改为：

```js
      osc.connect(amp).connect(output());
      osc.start(t);
      osc.stop(t + THUMP_LENGTH);
```

```js
      click.connect(lowpass).connect(clickAmp).connect(ctx.destination);
```

改为：

```js
      click.connect(lowpass).connect(clickAmp).connect(output());
```

检查：`grep -n "ctx.destination" beep.js` 只剩 `output()` 里那一处。

- [ ] **Step 6: 跑测试，确认通过**

Run: `node --test test/beep.test.js 2>&1 | grep -E "^not ok|ℹ (tests|pass|fail)"`
Expected: 全部 pass（原有 11 个 + 新增 4 个）

- [ ] **Step 7: 提交**

```bash
git add beep.js test/beep.test.js
git commit -m "feat: 停表的咚放大到 3 倍，滴和咚经同一个软限幅出口"
```

（提交信息末尾都带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，下同）

---

### Task 2: 缓存版本与旧文档

**Files:**
- Modify: `sw.js`
- Modify: `docs/superpowers/specs/2026-10-29-stop-burst-design.md`

- [ ] **Step 1: 升缓存版本**

`sw.js`：

```js
const CACHE = 'slap-stopwatch-v22';
```

改为：

```js
const CACHE = 'slap-stopwatch-v23';
```

- [ ] **Step 2: 爆裂设计第 4 节加注**

`docs/superpowers/specs/2026-10-29-stop-burst-design.md`：

```markdown
## 4. 低音「咚」

与「滴」同一时刻开始，各响各的，互不打断。用 Web Audio 实时合成：
```

改为：

```markdown
## 4. 低音「咚」

> 2026-10-29 起「咚」的音量放大到 3 倍（三角波 2.1、敲击 1.5），「滴」和「咚」经同一个软限幅出口，
> 见 `2026-10-29-thump-loud-design.md`。下文的音量数值是改动前的。

与「滴」同一时刻开始，各响各的，互不打断。用 Web Audio 实时合成：
```

- [ ] **Step 3: 跑全部测试**

Run: `npm test 2>&1 | grep -E "^not ok|ℹ (tests|pass|fail)"`
Expected: 全部 pass，0 fail

- [ ] **Step 4: 提交**

```bash
git add sw.js docs/superpowers/specs/2026-10-29-stop-burst-design.md
git commit -m "chore: 咚放大升离线缓存版本并更新设计"
```

---

### Task 3: 用真的 `beep.js` 离线渲染核对

前提：`$S/phone-audition` 由 8765 上的临时服务提供，headless Chrome 开着 9222。

- [ ] **Step 1: 把新旧 `beep.js` 放到 8765 下**

```bash
cp /Users/wx.su/study/timer/beep.js $S/phone-audition/beep-new.js
git -C /Users/wx.su/study/timer show main:beep.js > $S/phone-audition/beep-old.js
```

- [ ] **Step 2: 写 `$S/thump-render-check.mjs`**

```js
// 用真的 beep.js 离线渲染核对「咚」放大：滴与改动前逐采样一致；滴+咚峰值不超过 0.95；
// 咚模拟手机喇叭（>380 Hz）并 A 计权后的有效值与试听页「现在·爆表」一致（约 −21.4 / −25.6 dB）
const CDP = 'http://127.0.0.1:9222';
setTimeout(() => process.exit(2), 60000).unref();
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails.exception?.description) : r.result.result.value; };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: 'http://localhost:8765/' });
await new Promise((r) => setTimeout(r, 1200));
const res = await ev(`(async () => {
  const neu = await import('/beep-new.js?' + Date.now()), old = await import('/beep-old.js?' + Date.now());
  const SR = 48000;
  const render = async (mod, play) => {
    let ctx;
    class Off { constructor() { ctx = new OfflineAudioContext(1, SR, SR); return ctx; } }
    const b = mod.createBeeper({ AudioContextClass: Off });
    play(b);
    return (await ctx.startRendering()).getChannelData(0);
  };
  // 模拟手机喇叭 + A 计权（48 kHz 系数），量 0～0.15 s 与 0～0.4 s 的有效值
  const AB = [0.234301792299513, -0.468603584599026, -0.234301792299513, 0.937207168598052, -0.234301792299513, -0.468603584599026, 0.234301792299513];
  const AA = [1, -4.113043408775871, 6.553121752655047, -4.990849294163381, 1.785737302937573, -0.246190595319487, 0.011224250033231];
  const loud = async (data) => {
    const c = new OfflineAudioContext(1, SR, SR), buf = c.createBuffer(1, data.length, SR);
    buf.copyToChannel(data, 0);
    const s = c.createBufferSource(); s.buffer = buf;
    const h1 = c.createBiquadFilter(), h2 = c.createBiquadFilter(), l = c.createBiquadFilter(), aw = c.createIIRFilter(AB, AA);
    h1.type = h2.type = 'highpass'; h1.frequency.value = h2.frequency.value = 380; l.type = 'lowpass'; l.frequency.value = 9000;
    s.connect(h1).connect(h2).connect(l).connect(aw).connect(c.destination); s.start();
    const d = (await c.startRendering()).getChannelData(0);
    const rms = (sec) => { const n = Math.floor(SR * sec); let x = 0; for (let i = 0; i < n; i++) x += d[i] * d[i]; return +(10 * Math.log10(x / n)).toFixed(1); };
    return [rms(0.15), rms(0.4)];
  };
  const peak = (d) => d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const beepNew = await render(neu, (b) => b.beep()), beepOld = await render(old, (b) => b.beep());
  let diff = 0; for (let i = 0; i < beepNew.length; i++) diff = Math.max(diff, Math.abs(beepNew[i] - beepOld[i]));
  const both = await render(neu, (b) => { b.beep(); b.thump(); });
  return {
    beepDiff: diff, beepPeak: +peak(beepNew).toFixed(4),
    bothPeak: +peak(both).toFixed(4),
    thumpNew: await loud(await render(neu, (b) => b.thump())),
    thumpOld: await loud(await render(old, (b) => b.thump())),
    beep: await loud(beepNew),
  };
})()`);
console.log(res);
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} · ${info}`); };
check('滴与改动前一致', res.beepDiff < 1e-6, `最大差 ${res.beepDiff}`);
check('滴+咚不超过 0.95', res.bothPeak <= 0.95, `峰值 ${res.bothPeak}`);
check('咚的响度与试听页一致', Math.abs(res.thumpNew[0] + 21.4) < 1 && Math.abs(res.thumpNew[1] + 25.6) < 1,
  `改后 ${res.thumpNew.join(' / ')} dB · 改前 ${res.thumpOld.join(' / ')} dB · 滴 ${res.beep.join(' / ')} dB`);
console.log(failed ? `\n${failed} 条 FAIL` : '\n全部 OK');
await fetch(`${CDP}/json/close/${t.id}`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: 跑核对**

Run: `cd $S && node thump-render-check.mjs`
Expected: 三条全部 OK

- [ ] **Step 4: 若有 FAIL**

用 superpowers:systematic-debugging 找原因，修好后从 Task 1 Step 6 重跑。

---

### Task 4: 重启 8080，收尾

- [ ] **Step 1: 重启 8080**

停掉正在跑的 8080 后台任务（TaskStop），在 `/Users/wx.su/study/timer` 后台重新跑 `exec python3 -m http.server 8080`，然后：

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/ && curl -s http://localhost:8080/sw.js | grep "const CACHE"`
Expected: `200`，`const CACHE = 'slap-stopwatch-v23';`

- [ ] **Step 2: 在本计划末尾记下执行中的调整**

在本文件末尾加「## 执行中的调整」一节，逐条写下与计划不同的地方（没有就写「无」），附上 Task 3 的核对数字。

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/plans/2026-10-29-thump-loud.md
git commit -m "docs: 咚放大计划记下执行中的调整"
```

- [ ] **Step 4: 最后跑一遍全部测试**

Run: `npm test 2>&1 | grep -E "^not ok|ℹ (tests|pass|fail)"`
Expected: 全部 pass，0 fail

---

## 执行中的调整

无，按计划逐步完成。

- 单元测试：`test/beep.test.js` 15 个全部 pass（原有 11 + 新增 4），全部 104 个 pass。
- Task 3 离线渲染核对（48 kHz，真的 `beep.js`）：
  - 「滴」与改动前逐采样最大差 4.8e-7（Float32 曲线插值的舍入），峰值仍为 0.5
  - 「滴」+「咚」峰值 0.9497，不超过 0.95
  - 「咚」模拟手机喇叭 + A 计权：改前 −27.6 / −31.8 dB，改后 −21.6 / −25.9 dB（0～0.15 s / 0～0.4 s），
    与试听页「现在·爆表」的 −21.4 / −25.6 dB 一致；「滴」为 −11.6 / −9.4 dB
- 8080 已重启，提供 v23。
