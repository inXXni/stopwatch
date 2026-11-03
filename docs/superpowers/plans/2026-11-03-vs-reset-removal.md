# 撤掉点 VS 清零 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PK 模式下点 VS 不再清零，与点屏幕别处一样都是拍击。

**Architecture:** `timer-core.js` 的 `Event` 去掉 `RESET`、`nextPkState` 去掉对应分支；`app.js` 删掉 `resetPk()`、`vsBox`、`onVs()`，`onPointerDown` 认定第一根手指后一律 `slap()`。不留开关或死代码。

**Tech Stack:** 原生 JavaScript（ES module）、Node 内置 `node:test`；集成核对用 headless Chrome + CDP 触摸事件。

**Spec:** `docs/superpowers/specs/2026-11-03-vs-reset-removal-design.md`

---

## 文件

| 文件 | 动作 |
|---|---|
| `timer-core.js` | 去掉 `Event.RESET`、`nextPkState` 的 RESET 分支与注释 |
| `test/timer-core.test.js` | 三个 RESET 测试换成一个「`Event` 只有 SLAP 与 UNLOCK」 |
| `app.js` | 删 `resetPk()`、`vsBox`、`onVs()`，简化 `onPointerDown`，改写 VS 时机的注释 |
| `index.html` | `.vs-box` 注释 |
| `sw.js` | v24 |
| 四份旧设计文档 | 加注 |

scratchpad（下称 `$S`）里新写核对脚本 `vs-tap-check.mjs`，不进仓库。

---

### Task 1: 状态机去掉 RESET

**Files:**
- Modify: `timer-core.js`
- Test: `test/timer-core.test.js`

- [ ] **Step 1: 测试换成新的**

`test/timer-core.test.js` 里这三个测试：

```js
test('PK 状态机: 锁定期以外收到 RESET 都回到等红方拍', () => {
  for (const s of [PkState.WAIT_P1, PkState.RUN_P1, PkState.WAIT_P2, PkState.RUN_P2, PkState.RESULT]) {
    assert.equal(nextPkState(s, Event.RESET), PkState.WAIT_P1, s);
  }
});

test('PK 状态机: 锁定期内收到 RESET 不变，挡住手掌弹起再落到 VS 上', () => {
  assert.equal(nextPkState(PkState.LOCK_P1, Event.RESET), PkState.LOCK_P1);
  assert.equal(nextPkState(PkState.LOCK_P2, Event.RESET), PkState.LOCK_P2);
});

test('状态机: 普通模式不认 RESET', () => {
  for (const s of Object.values(State)) {
    assert.equal(nextState(s, Event.RESET), s, s);
  }
});
```

换成：

```js
test('事件: 只有拍击与锁定期结束，点 VS 清零已撤掉', () => {
  assert.deepEqual(Object.keys(Event), ['SLAP', 'UNLOCK']);
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/timer-core.test.js 2>&1 | grep -E "^not ok|ℹ (pass|fail)"`
Expected: 1 fail（`Event` 还有 `RESET`）

- [ ] **Step 3: 改 `timer-core.js`**

`Event` 里删掉这一行：

```js
  RESET: 'RESET',   // 点 VS 清零，只有 PK 模式认
```

`nextPkState` 上方注释里删掉这三行（连同前面的空注释行）：

```js
 *
 * RESET 是点 VS 清零：锁定期以外，不管在哪一步都回到 WAIT_P1。
 * 锁定期照样挡住，停表那一拍的手掌弹起再落到 VS 上，不能把刚停下的成绩清掉。
```

`nextPkState` 里删掉：

```js
  if (event === Event.RESET) {
    return state === PkState.LOCK_P1 || state === PkState.LOCK_P2 ? state : PkState.WAIT_P1;
  }
```

检查：`grep -n "RESET" timer-core.js` 没有输出。

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/timer-core.test.js 2>&1 | grep -E "^not ok|ℹ (tests|pass|fail)"`
Expected: 全部 pass

- [ ] **Step 5: 提交**

```bash
git add timer-core.js test/timer-core.test.js
git commit -m "refactor: PK 状态机去掉点 VS 清零"
```

（提交信息末尾都带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，下同）

---

### Task 2: 页面里点 VS 当作拍击

**Files:**
- Modify: `app.js`、`index.html`

- [ ] **Step 1: 改写 VS 时机的注释**

`app.js`：

```js
// VS 是程序画的毛笔字，只有 PK 模式才画。新一轮开始时一笔笔写出来：
// 打开页面一次、每次清场一次、点 VS 清零一次
```

改为：

```js
// VS 是程序画的毛笔字，只有 PK 模式才画。新一轮开始时一笔笔写出来：
// 打开页面一次、每次清场一次
```

- [ ] **Step 2: 删掉 `resetPk()`**

删掉这一整段（连同后面的空行）：

```js
// 点 VS 清零：不出声，计时中的那一格不停表、不播爆裂，直接归零。
// 已经在等红方拍时状态不变，照样写一次，让人知道点到了
function resetPk() {
  const next = nextPkState(pkState, Event.RESET);
  if (next !== PkState.WAIT_P1) return; // 锁定期内被挡住
  pkState = next;
  stopTicking();
  displays.forEach((d) => d.render(formatTime(0)));
  paintSlots(pkSlotStates(pkState));
  writeVs();
}

```

- [ ] **Step 3: 删掉 VS 判定，按下一律拍击**

删掉这一整段（连同后面的空行）：

```js
// 按落点位置判断，不看事件落在哪个元素上：VS 的墨点与光晕画到框外，写完那一下整个字还会放大，
// 按元素判断的话，清场后紧跟的那一拍落在 VS 附近，会被当成点 VS
const vsBox = stage.querySelector('.vs-box');
function onVs(e) {
  const r = vsBox.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
}

```

`onPointerDown` 里：

```js
  e.preventDefault();
  if (isPk && onVs(e)) resetPk();
  else slap(e.timeStamp);
```

改为：

```js
  e.preventDefault();
  slap(e.timeStamp);
```

检查：`grep -n "resetPk\|onVs\|vsBox\|RESET\|点 VS" app.js` 没有输出。

- [ ] **Step 4: 改 `index.html` 注释**

```css
  /* VS 是程序画的毛笔字：.vs-box 是黑底，也是点 VS 清零的判定范围；.vs-ink 里的笔画由 ink-vs.js 画出，
```

改为：

```css
  /* VS 是程序画的毛笔字：.vs-box 是黑底，.vs-ink 里的笔画由 ink-vs.js 画出，
```

- [ ] **Step 5: 跑全部测试**

Run: `npm test 2>&1 | grep -E "^not ok|ℹ (tests|pass|fail)"`
Expected: 全部 pass

- [ ] **Step 6: 提交**

```bash
git add app.js index.html
git commit -m "feat: PK 模式点 VS 不再清零，与点别处一样是拍击"
```

---

### Task 3: 缓存版本与旧文档

**Files:**
- Modify: `sw.js`
- Modify: `docs/superpowers/specs/2026-10-29-vs-reset-design.md`、`2026-10-27-pk-mode-design.md`、`2026-10-27-slap-stopwatch-design.md`、`2026-10-29-vs-ink-design.md`

- [ ] **Step 1: 升缓存版本**

`sw.js` 的 `const CACHE = 'slap-stopwatch-v23';` 改为 `const CACHE = 'slap-stopwatch-v24';`

- [ ] **Step 2: 旧文档加注**

```bash
cd /Users/wx.su/study/timer && python3 - <<'PY'
D = 'docs/superpowers/specs/'
NEW = '`2026-11-03-vs-reset-removal-design.md`'
def edit(f, old, new):
    p = D + f
    s = open(p, encoding='utf-8').read()
    assert s.count(old) == 1, (f, old[:40])
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))
# 清零设计：开头加注已撤销
edit('2026-10-29-vs-reset-design.md',
     '第 2 节按位置判断的理由现在是墨点与光晕画到框外，见 `2026-10-29-vs-ink-design.md` 第 5 节。\n',
     '第 2 节按位置判断的理由现在是墨点与光晕画到框外，见 `2026-10-29-vs-ink-design.md` 第 5 节。\n\n'
     '> **2026-11-03 起撤销**：iPad 上 VS 正好在屏幕正中，计时中拍到中间会把成绩静默清掉。'
     '点 VS 现在与点屏幕别处一样都是拍击，见 ' + NEW + '。本文只作记录。\n')
edit('2026-10-27-pk-mode-design.md',
     '（例外：后来加了点 VS 清零，用户接受误拍的风险，见 `2026-10-29-vs-reset-design.md`。）',
     '（2026-10-29 曾加过点 VS 清零作为例外，2026-11-03 因 iPad 上误触撤掉，见 ' + NEW + '。）')
edit('2026-10-27-slap-stopwatch-design.md',
     '- PK 模式下点一下 VS 清零：除停表后的锁定期外，两格归零、回到等红方拍，VS 一笔笔写出来（2026-10-29 之前是砸下来），不出声。\n'
     '  这是整块屏幕唯一不算拍击的地方。详见 `2026-10-29-vs-reset-design.md`。',
     '- PK 模式下点 VS 与点屏幕别处一样，都是拍击。2026-10-29 至 11-03 之间点 VS 曾是清零，已撤掉，见 ' + NEW + '。')
edit('2026-10-29-vs-ink-design.md',
     '| 点 VS 清零（包括已经在等红方拍时） | 写一次 |',
     '| 点 VS 清零（2026-11-03 起撤掉，见 ' + NEW + '） | — |')
edit('2026-10-29-vs-ink-design.md',
     '## 5. 点 VS 清零\n\n',
     '## 5. 点 VS 清零\n\n> 2026-11-03 起点 VS 清零已撤掉，点 VS 就是普通拍击，本节只作记录，见 ' + NEW + '。\n\n')
edit('2026-10-29-vs-ink-design.md',
     '2. 打开页面、清场、点 VS 清零时，',
     '2. 打开页面、清场（以及当时还有的点 VS 清零）时，')
edit('2026-10-29-vs-ink-design.md',
     '5. 点 VS 清零的行为与之前完全一致',
     '5. 点 VS 清零的行为与之前完全一致（2026-11-03 起该功能撤掉）')
PY
git diff --stat
```

Expected: 四份文档各有改动

- [ ] **Step 3: 跑全部测试并提交**

Run: `npm test 2>&1 | grep -E "^not ok|ℹ (tests|pass|fail)"`
Expected: 全部 pass

```bash
git add sw.js docs/superpowers/specs
git commit -m "chore: 撤掉点 VS 清零升离线缓存版本并更新设计"
```

---

### Task 4: 浏览器核对，收尾

- [ ] **Step 1: 重启 8080**

停掉正在跑的 8080 后台任务（TaskStop），在 `/Users/wx.su/study/timer` 后台重新跑 `exec python3 -m http.server 8080`，然后：

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/ && curl -s http://localhost:8080/sw.js | grep "const CACHE"`
Expected: `200`，`const CACHE = 'slap-stopwatch-v24';`

- [ ] **Step 2: 写 `$S/vs-tap-check.mjs`**

```js
// 撤掉点 VS 清零后的核对：iPad 横竖屏、手机横竖屏，用真触摸事件
// 1. 红格开始，第二拍点在 VS 上：停表出成绩，不清零
// 2. 等红方拍时点 VS：红格开始
// 3. 两人都停后点 VS：清场，VS 写一次
const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.error('超时'); process.exit(2); }, 150000).unref();
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} · ${info}`); };
const SPY = `window.__writes = 0; const a0 = Element.prototype.animate;
  Element.prototype.animate = function () { if (this.getAttribute('class') === 'vs-ink') window.__writes++; return a0.apply(this, arguments); };`;

async function open(w, h) {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); };
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'ERR ' + r.result.exceptionDetails.exception?.description : r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
  await send('Page.navigate', { url: BASE + '/?pk' });
  for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(`document.querySelector('.slot').dataset.slotState === 'next' && document.fonts.status === 'loaded'`) === true) break; }
  await sleep(800);
  const tap = async ([x, y]) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await sleep(50);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const read = async () => ({
    slots: await ev(`[...document.querySelectorAll('.slot')].map((s) => s.dataset.slotState).join(',')`),
    values: await ev(`[...document.querySelectorAll('.display .value')].map((s) => s.textContent).join(',')`),
    writes: await ev('__writes'),
  });
  const geo = await ev(`(() => { const c = (el) => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    return { vs: c(document.querySelector('.vs-box')), red: c(document.querySelectorAll('.slot')[0]), blue: c(document.querySelectorAll('.slot')[1]) }; })()`);
  return { tap, read, geo, errors, close: () => fetch(`${CDP}/json/close/${t.id}`) };
}

for (const [label, w, h] of [['iPad 横屏', 1180, 820], ['iPad 竖屏', 820, 1180], ['手机横屏', 800, 360], ['手机竖屏', 360, 708]]) {
  // 1. 红格开始，VS 上停表
  let p = await open(w, h);
  await p.tap(p.geo.red); await sleep(400);
  await p.tap(p.geo.vs); await sleep(100);
  let a = await p.read();
  check(`${label} · 计时中点 VS 是停表`, a.slots === 'done,empty' && a.values.split(',')[0] !== '00.00', `${a.slots} · ${a.values}`);
  await p.close();
  // 2. 等红方拍时点 VS 开始
  p = await open(w, h);
  await p.tap(p.geo.vs); await sleep(300);
  a = await p.read();
  check(`${label} · 等红方拍时点 VS 是开始`, a.slots === 'running,empty', `${a.slots} · ${a.values}`);
  // 3. 接着在 VS 上停表、蓝方开始停表，两人都停后点 VS 清场
  await p.tap(p.geo.vs); await sleep(650);
  await p.tap(p.geo.vs); await sleep(300);
  await p.tap(p.geo.vs); await sleep(650);
  const before = await p.read();
  await p.tap(p.geo.vs); await sleep(100);
  a = await p.read();
  check(`${label} · 两人都停后点 VS 是清场`,
    before.slots === 'done,done' && a.slots === 'next,empty' && a.values === '00.00,00.00' && a.writes === before.writes + 1,
    `点之前 ${before.slots} ${before.values} → 点之后 ${a.slots} ${a.values} · VS 写 +${a.writes - before.writes}`);
  check(`${label} · 无脚本错误`, p.errors.length === 0, p.errors.join(' | ') || '无');
  await p.close();
}
console.log(failed ? `\n${failed} 条 FAIL` : '\n全部 OK');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: 跑核对**

确认 headless Chrome 的 9222 在（`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9222/json/version` 得 200），然后：

Run: `cd $S && node vs-tap-check.mjs`
Expected: 16 条全部 OK

若有 FAIL：用 superpowers:systematic-debugging 找原因，修好后从 Task 2 Step 5 重跑。

- [ ] **Step 4: 记下执行中的调整并提交**

在本文件末尾加「## 执行中的调整」一节（没有就写「无」），附核对结果，然后：

```bash
git add docs/superpowers/plans/2026-11-03-vs-reset-removal.md
git commit -m "docs: 撤掉点 VS 清零计划记下执行中的调整"
```

- [ ] **Step 5: 最后跑一遍全部测试**

Run: `npm test 2>&1 | grep -E "^not ok|ℹ (tests|pass|fail)"`
Expected: 全部 pass
