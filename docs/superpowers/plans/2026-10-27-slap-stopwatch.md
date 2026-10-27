# 手拍秒表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个在手机/平板浏览器打开即用的全屏大字秒表，拍一下开始、拍一下停止，精度 0.01 秒，可离线。

**Architecture:** 纯静态 PWA，无构建步骤、无第三方依赖。纯逻辑（时间格式化、状态机）抽取到 `timer-core.js` 作为 ES module，便于用 `node --test` 单独测试；DOM 绑定、渲染循环与 Wake Lock 放在 `app.js`；`sw.js` 做 cache-first 离线缓存。图标用一个零依赖的 Node 脚本直接生成 PNG。

**Tech Stack:** 原生 HTML/CSS/JavaScript（ES module）、Node 内置 `node:test` / `node:assert` / `node:zlib`、Service Worker、Web Wake Lock API。

**Spec:** `docs/superpowers/specs/2026-10-27-slap-stopwatch-design.md`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `timer-core.js` | 纯函数：`formatTime` 与状态机。不碰 DOM，可单独测试 |
| `app.js` | DOM 绑定、pointer 事件、rAF 渲染循环、锁定定时器、Wake Lock |
| `index.html` | 结构与样式（LED 外观、自适应字号、禁用浏览器默认手势） |
| `manifest.json` | PWA 清单 |
| `sw.js` | Service Worker，cache-first 离线 |
| `icon-192.png` / `icon-512.png` | PWA 图标，由脚本生成 |
| `tools/make-icons.mjs` | 零依赖 PNG 生成脚本 |
| `test/timer-core.test.js` | `timer-core.js` 的单元测试 |
| `package.json` | 仅用于声明 `"type": "module"` 和若干 npm script |

---

### Task 1: 项目骨架

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "slap-stopwatch",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "魔方速拧比赛现场用的全屏大字手拍秒表",
  "scripts": {
    "test": "node --test test/",
    "icons": "node tools/make-icons.mjs",
    "serve": "python3 -m http.server 8080"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**

```
.DS_Store
node_modules/
```

注意：`icon-192.png` 与 `icon-512.png` 是部署产物，**必须提交**，不要加进 .gitignore。

- [ ] **Step 3: 验证 Node 版本支持内置测试运行器**

Run: `node --version`
Expected: `v18.0.0` 或更高。若低于 v18，`node --test` 不可用，需先升级 Node。

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: 初始化项目骨架"
```

---

### Task 2: formatTime 纯函数

把毫秒转换成显示字符串。按 WCA 惯例向下截断到百分位——`12.999` 秒要显示 `12.99`，因为还没到 13 秒。

**Files:**
- Create: `timer-core.js`
- Test: `test/timer-core.test.js`

- [ ] **Step 1: 写失败的测试**

创建 `test/timer-core.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime } from '../timer-core.js';

test('formatTime: 零值显示 0.00', () => {
  assert.equal(formatTime(0), '0.00');
});

test('formatTime: 不足一个百分秒的毫秒被截断', () => {
  assert.equal(formatTime(5), '0.00');
  assert.equal(formatTime(9), '0.00');
});

test('formatTime: 百分秒补零', () => {
  assert.equal(formatTime(10), '0.01');
  assert.equal(formatTime(1050), '1.05');
});

test('formatTime: 常规成绩', () => {
  assert.equal(formatTime(1234), '1.23');
  assert.equal(formatTime(12345), '12.34');
  assert.equal(formatTime(9870), '9.87');
});

test('formatTime: 向下截断而非四舍五入', () => {
  assert.equal(formatTime(12999), '12.99');
  assert.equal(formatTime(999), '0.99');
});

test('formatTime: 一分钟边界', () => {
  assert.equal(formatTime(59999), '59.99');
  assert.equal(formatTime(60000), '60.00');
});

test('formatTime: 超过一分钟继续累加秒数，不切分钟格式', () => {
  assert.equal(formatTime(75210), '75.21');
  assert.equal(formatTime(123450), '123.45');
});

test('formatTime: 非法输入兜底为 0.00', () => {
  assert.equal(formatTime(-5), '0.00');
  assert.equal(formatTime(NaN), '0.00');
  assert.equal(formatTime(Infinity), '0.00');
  assert.equal(formatTime(undefined), '0.00');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错信息为 `Cannot find module '.../timer-core.js'`

- [ ] **Step 3: 写最小实现**

创建 `timer-core.js`：

```js
/**
 * 把经过的毫秒数转成显示字符串，例如 12345 -> "12.34"。
 * 按 WCA 惯例向下截断到百分位，不四舍五入。
 * 不足一分钟不显示分钟；超过一分钟秒数继续累加（75.21），这是兜底而非常规路径。
 */
export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalCentis = Math.floor(ms / 10);
  const seconds = Math.floor(totalCentis / 100);
  const centis = totalCentis % 100;
  return `${seconds}.${String(centis).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS，8 个 formatTime 测试全部通过

- [ ] **Step 5: Commit**

```bash
git add timer-core.js test/timer-core.test.js
git commit -m "feat: 添加 formatTime 时间格式化函数"
```

---

### Task 3: 状态机

四个状态。`LOCKED` 是防二次触发的关键：停表那一拍之后的 500ms 内，任何拍击都被吞掉。

**Files:**
- Modify: `timer-core.js`
- Modify: `test/timer-core.test.js`

- [ ] **Step 1: 写失败的测试**

先把 `test/timer-core.test.js` 顶部的 import 改成：

```js
import { formatTime, State, Event, nextState } from '../timer-core.js';
```

然后在文件末尾追加：

```js
test('状态机: 空闲时拍击开始计时', () => {
  assert.equal(nextState(State.IDLE, Event.SLAP), State.RUNNING);
});

test('状态机: 计时中拍击进入锁定', () => {
  assert.equal(nextState(State.RUNNING, Event.SLAP), State.LOCKED);
});

test('状态机: 锁定期内的拍击被忽略', () => {
  assert.equal(nextState(State.LOCKED, Event.SLAP), State.LOCKED);
});

test('状态机: 锁定期结束后进入已停止', () => {
  assert.equal(nextState(State.LOCKED, Event.UNLOCK), State.STOPPED);
});

test('状态机: 已停止时拍击开始新一轮', () => {
  assert.equal(nextState(State.STOPPED, Event.SLAP), State.RUNNING);
});

test('状态机: 非锁定状态收到 UNLOCK 时保持原状态', () => {
  assert.equal(nextState(State.IDLE, Event.UNLOCK), State.IDLE);
  assert.equal(nextState(State.RUNNING, Event.UNLOCK), State.RUNNING);
  assert.equal(nextState(State.STOPPED, Event.UNLOCK), State.STOPPED);
});

test('状态机: 未知事件不改变状态', () => {
  assert.equal(nextState(State.RUNNING, 'BOGUS'), State.RUNNING);
});

test('状态机: 未知状态原样返回', () => {
  assert.equal(nextState('BOGUS', Event.SLAP), 'BOGUS');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报错信息包含 `State` 或 `nextState` 未导出（`SyntaxError: The requested module ... does not provide an export named 'State'`）

- [ ] **Step 3: 写最小实现**

在 `timer-core.js` 末尾追加：

```js
export const State = {
  IDLE: 'IDLE',       // 未开始，显示 0.00
  RUNNING: 'RUNNING', // 计时中
  LOCKED: 'LOCKED',   // 刚停表，吞掉一切输入，防手掌反弹和多指造成的二次触发
  STOPPED: 'STOPPED', // 显示成绩，等待下一轮
};

export const Event = {
  SLAP: 'SLAP',     // 拍击
  UNLOCK: 'UNLOCK', // 锁定期结束
};

/**
 * 纯函数形式的状态转移。不做任何副作用，时间戳记录由调用方负责。
 */
export function nextState(state, event) {
  if (event === Event.SLAP) {
    switch (state) {
      case State.IDLE:
      case State.STOPPED:
        return State.RUNNING;
      case State.RUNNING:
        return State.LOCKED;
      case State.LOCKED:
        return State.LOCKED;
      default:
        return state;
    }
  }
  if (event === Event.UNLOCK) {
    return state === State.LOCKED ? State.STOPPED : state;
  }
  return state;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS，全部 16 个测试通过

- [ ] **Step 5: Commit**

```bash
git add timer-core.js test/timer-core.test.js
git commit -m "feat: 添加计时器状态机"
```

---

### Task 4: HTML 结构与 LED 样式

**Files:**
- Create: `index.html`

- [ ] **Step 1: 创建 index.html**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>手拍秒表</title>
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="秒表">
<style>
  :root {
    --ink-idle: #4a1414;
    --ink-running: #ff2d2d;
    --ink-done: #2dff6a;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    height: 100%;
    overflow: hidden;
    background: #000;
    /* 以下五项缺一不可：拍击时任何一个默认行为被触发都会毁掉这一次计时 */
    touch-action: none;
    overscroll-behavior: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  #stage {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  #display {
    /* 等宽数字：比例字形下 1 比 8 窄，计时过程中数字会持续左右抖动 */
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
    /* 按 5 个等宽字符（12.34）占满约 90% 宽度反推字号，同时限制高度不溢出 */
    font-size: min(30vw, 55vh);
    color: var(--ink-idle);
    text-shadow: 0 0 0.12em currentColor, 0 0 0.3em currentColor;
    transition: color 80ms linear;
  }

  #stage[data-state="RUNNING"] #display { color: var(--ink-running); }
  #stage[data-state="LOCKED"]  #display,
  #stage[data-state="STOPPED"] #display { color: var(--ink-done); }
</style>
</head>
<body>
  <div id="stage" data-state="IDLE">
    <div id="display">0.00</div>
  </div>
  <script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 起本地服务器查看**

Run: `npm run serve`
然后在浏览器打开 `http://localhost:8080`
Expected: 全黑页面，中央一个暗红色的大号 `0.00`。此时点击无反应（app.js 还没写）。

> 必须通过 http 访问，不能直接双击打开 index.html。`file://` 协议下 ES module 会被 CORS 拦截，Service Worker 也无法注册。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: 添加 LED 风格全屏显示界面"
```

---

### Task 5: 交互绑定与渲染循环

**Files:**
- Create: `app.js`

- [ ] **Step 1: 创建 app.js**

```js
import { formatTime, nextState, State, Event } from './timer-core.js';

const LOCK_MS = 500; // 停表后的封锁时长，防手掌反弹与多指造成的二次触发

const stage = document.getElementById('stage');
const display = document.getElementById('display');

let state = State.IDLE;
let startAt = 0;
let rafId = null;
let unlockTimer = null;
let activePointerId = null;

function setState(next) {
  if (next === state) return;
  state = next;
  stage.dataset.state = state;
}

function render(text) {
  if (display.textContent !== text) display.textContent = text;
}

function tick() {
  render(formatTime(performance.now() - startAt));
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/**
 * 处理一次拍击。
 * timeStamp 取自事件本身而非 performance.now()，
 * 以排除事件派发和 JS 执行的延迟——两者同为相对 performance.timeOrigin 的高精度时间戳。
 */
function handleSlap(timeStamp) {
  const next = nextState(state, Event.SLAP);
  if (next === state) return; // LOCKED 状态下被吞掉

  if (next === State.RUNNING) {
    startAt = timeStamp;
    setState(next);
    render(formatTime(0));
    startLoop();
    return;
  }

  if (next === State.LOCKED) {
    stopLoop();
    setState(next);
    render(formatTime(timeStamp - startAt));
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => setState(nextState(state, Event.UNLOCK)), LOCK_MS);
  }
}

function onPointerDown(e) {
  // 只认第一根落下的手指，同时落下的其余手指一律忽略
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  e.preventDefault();
  handleSlap(e.timeStamp);
}

function onPointerEnd(e) {
  if (e.pointerId === activePointerId) activePointerId = null;
}

stage.addEventListener('pointerdown', onPointerDown, { passive: false });
stage.addEventListener('pointerup', onPointerEnd);
stage.addEventListener('pointercancel', onPointerEnd);

// 键盘空格同样可以触发，方便接蓝牙小键盘或在电脑上测试
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  e.preventDefault();
  handleSlap(e.timeStamp);
});

// 兜底：阻止双击缩放与长按菜单
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
```

- [ ] **Step 2: 在浏览器中手动验证**

Run: `npm run serve`，打开 `http://localhost:8080`，用鼠标点击或按空格键。

Expected:
1. 第一次点击：数字变亮红并开始快速走动
2. 第二次点击：数字立刻停住并变绿
3. 停住后**立刻**连续快速点击若干次：500ms 内的点击全部无效，数字纹丝不动
4. 等半秒后再点：归零，重新开始走

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: 添加拍击交互与计时渲染循环"
```

---

### Task 6: 屏幕常亮

计时过程中屏幕熄灭会直接毁掉这一次比赛，但 Wake Lock 在部分浏览器不可用，必须静默降级。

**Files:**
- Modify: `app.js`

- [ ] **Step 1: 在 app.js 末尾追加 Wake Lock 逻辑**

```js
// ---- 屏幕常亮 ----
// 不支持 Wake Lock 的浏览器静默降级为不保持常亮，不能抛错影响计时。

let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

// 切出页面时系统会自动释放 wake lock，切回来必须重新申请
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquireWakeLock();
});

acquireWakeLock();
```

- [ ] **Step 2: 在开始计时时再申请一次**

页面刚加载时还没有任何用户手势，部分浏览器会拒绝 Wake Lock 申请。
拍击是明确的用户手势，此时申请必定成功，所以在 `handleSlap` 的 `RUNNING`
分支里补一次调用。

把 `app.js` 中这一段：

```js
  if (next === State.RUNNING) {
    startAt = timeStamp;
    setState(next);
```

改为：

```js
  if (next === State.RUNNING) {
    startAt = timeStamp;
    acquireWakeLock();
    setState(next);
```

> `acquireWakeLock` 用的是函数声明，会被提升到模块顶部，
> 所以写在文件后半部分也能被前面的 `handleSlap` 正常调用。

- [ ] **Step 3: 在浏览器中验证未报错**

Run: `npm run serve`，打开 `http://localhost:8080`，打开开发者工具 Console。
Expected: Console 无任何红色报错。计时功能与 Task 5 完全一致。

> 真机上的常亮效果需要在手机上实测，见 Task 10。

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: 计时期间保持屏幕常亮"
```

---

### Task 7: 图标生成

PWA 需要 192 和 512 两个尺寸的 PNG。这个脚本用 Node 内置的 zlib 手写 PNG，不引入任何图像库。图案是一个秒表轮廓：黑底 + 红色圆环 + 顶部按钮。

**Files:**
- Create: `tools/make-icons.mjs`
- Create: `icon-192.png`（生成产物）
- Create: `icon-512.png`（生成产物）

- [ ] **Step 1: 创建 tools/make-icons.mjs**

```js
// 零依赖 PNG 生成器。生成 PWA 所需的两个尺寸的图标。
// 用法：npm run icons

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const BG = [10, 10, 10];
const FG = [255, 45, 45];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // 每行开头的 filter type
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y, size);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 图案全部落在中心 80% 的 maskable 安全区内，被裁成圆形也不会缺角
function isInk(x, y, size) {
  const cx = size / 2;
  const cy = size * 0.55;
  const radius = size * 0.28;
  const ring = size * 0.055;

  if (Math.abs(Math.hypot(x - cx, y - cy) - radius) < ring / 2) return true;

  const btnW = size * 0.13;
  const btnH = size * 0.075;
  const btnTop = cy - radius - ring / 2 - btnH;
  return Math.abs(x - cx) < btnW / 2 && y >= btnTop && y <= btnTop + btnH;
}

// 3x3 超采样做抗锯齿，否则圆环边缘锯齿很明显
function pixelAt(x, y, size) {
  const S = 3;
  let hits = 0;
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      if (isInk(x + (sx + 0.5) / S, y + (sy + 0.5) / S, size)) hits++;
    }
  }
  const t = hits / (S * S);
  return [
    Math.round(BG[0] + (FG[0] - BG[0]) * t),
    Math.round(BG[1] + (FG[1] - BG[1]) * t),
    Math.round(BG[2] + (FG[2] - BG[2]) * t),
  ];
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, pixelAt));
  console.log(`wrote ${file}`);
}
```

- [ ] **Step 2: 运行脚本生成图标**

Run: `npm run icons`
Expected:
```
wrote /Users/wx.su/study/timer/icon-192.png
wrote /Users/wx.su/study/timer/icon-512.png
```

- [ ] **Step 3: 验证生成的是合法 PNG**

Run: `file icon-192.png icon-512.png`
Expected:
```
icon-192.png: PNG image data, 192 x 192, 8-bit/color RGBA, non-interlaced
icon-512.png: PNG image data, 512 x 512, 8-bit/color RGBA, non-interlaced
```

用 Read 工具打开 `icon-512.png` 肉眼确认是一个黑底红色秒表轮廓，圆环闭合、顶部有按钮、边缘平滑无锯齿。

- [ ] **Step 4: Commit**

```bash
git add tools/make-icons.mjs icon-192.png icon-512.png
git commit -m "feat: 添加零依赖图标生成脚本与 PWA 图标"
```

---

### Task 8: PWA 清单

**Files:**
- Create: `manifest.json`
- Modify: `index.html`

- [ ] **Step 1: 创建 manifest.json**

```json
{
  "name": "手拍秒表",
  "short_name": "秒表",
  "description": "魔方速拧比赛现场用的全屏大字手拍秒表",
  "start_url": "./index.html",
  "scope": "./",
  "display": "fullscreen",
  "display_override": ["fullscreen", "standalone"],
  "orientation": "any",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: 在 index.html 的 head 中引用清单与 iOS 图标**

把 `index.html` 里这一行：

```html
<meta name="apple-mobile-web-app-title" content="秒表">
```

替换为：

```html
<meta name="apple-mobile-web-app-title" content="秒表">
<link rel="manifest" href="./manifest.json">
<link rel="apple-touch-icon" href="./icon-192.png">
```

> iOS 不读 manifest 里的 icons，必须单独给 `apple-touch-icon`，否则主屏幕图标会变成网页截图。

- [ ] **Step 3: 验证清单被正确识别**

Run: `npm run serve`，打开 `http://localhost:8080`，开发者工具 → Application → Manifest。
Expected: 名称显示「手拍秒表」，图标正常预览，无黄色警告。

- [ ] **Step 4: Commit**

```bash
git add manifest.json index.html
git commit -m "feat: 添加 PWA 清单与图标引用"
```

---

### Task 9: Service Worker 离线支持

资源全部是静态的，用 cache-first 即可：装好之后完全不碰网络，断网照常打开。

**Files:**
- Create: `sw.js`
- Modify: `app.js`

- [ ] **Step 1: 创建 sw.js**

```js
// 全部资源都是静态的，用 cache-first。改动文件后记得把 CACHE 版本号加一。
const CACHE = 'slap-stopwatch-v1';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './timer-core.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});
```

- [ ] **Step 2: 在 app.js 末尾追加注册代码**

```js
// ---- 离线支持 ----
// 注册失败不影响计时功能，静默降级为普通网页。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
```

- [ ] **Step 3: 验证离线可用**

Run: `npm run serve`，打开 `http://localhost:8080`。
1. 开发者工具 → Application → Service Workers，确认状态为 activated and is running
2. 切到 Network 面板，勾选 Offline
3. 刷新页面

Expected: 页面在离线状态下正常加载，计时功能完全可用。

- [ ] **Step 4: Commit**

```bash
git add sw.js app.js
git commit -m "feat: 添加 Service Worker 实现离线可用"
```

---

### Task 10: 整体验收

**Files:** 无改动，仅验证。

- [ ] **Step 1: 跑一遍全部单元测试**

Run: `npm test`
Expected: 16 个测试全部通过，0 失败。

- [ ] **Step 2: 用浏览器逐条核对 spec 的验收标准**

Run: `npm run serve`，打开 `http://localhost:8080`，逐条验证：

1. 点一下开始走表，再点一下停止并显示成绩
2. 停止那一下不会意外启动下一轮（停住后立刻狂点 5 次，数字必须纹丝不动）
3. 计时过程中数字不左右抖动（盯住小数点的横向位置，不能移动）
4. 窗口缩放到手机尺寸（开发者工具设备模拟），数字仍占满宽度且不溢出
5. 离线模式下刷新仍可用

- [ ] **Step 3: 对表验证计时精度**

打开页面，用手机秒表或在线秒表同时起停，计时约 60 秒。
Expected: 两者读数差距在 ±50ms 以内（即百分位差距不超过 5）。

> 人工起停本身就有一两百毫秒的反应误差，重点看的是**没有持续漂移**：
> 如果跑 60 秒差了好几秒，说明用了累加计时，是 bug。

- [ ] **Step 4: 真机验证（需要用户参与）**

把目录部署出去拿到 https 链接后，在 iPhone 上：

1. Safari 打开链接 → 分享 → 添加到主屏幕
2. 从主屏幕图标点开 → 确认全屏、无地址栏、图标是红色秒表
3. 用手掌拍屏幕 → 确认能正常起停、不会误触发两次
4. 计时放置 2 分钟 → 确认屏幕不自动熄灭
5. 开飞行模式 → 重新点开图标 → 确认仍可正常使用

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: 完成手拍秒表全部功能"
```

---

## 部署

全部任务完成后，把目录推到任意静态托管即可。GitHub Pages 的做法：

```bash
gh repo create slap-stopwatch --public --source=. --push
```

然后在仓库 Settings → Pages 中把 Source 设为 `main` 分支根目录，
几分钟后即可通过 `https://<用户名>.github.io/slap-stopwatch/` 访问。

Service Worker 与 Wake Lock 都要求 https，GitHub Pages 默认提供。
