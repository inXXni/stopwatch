# PK 模式 VS 色条脊柱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 宽屏横屏把 VS 移到左侧，与两根色条连成一根竖脊，两行靠拢、数字变大；竖屏 VS 留在中间放大；其余横屏不变。

**Architecture:** 三种排法全部由 CSS 媒体查询切换，DOM 只多一层包住「VS」的 `<span>`。脊柱排法要把「脊柱列 + 数字框」整组居中，数字框宽度取决于字体量出的 viewBox，CSS 算不出来：由纯函数 `spineDigitsWidth` 计算，`app.js` 写进 CSS 变量 `--w`（每格）与 `--digits-w`（两格中较宽的），与现有的色条高度同步放在一个函数里。

**Tech Stack:** 原生 HTML/CSS/JavaScript（ES module）、Node 内置 `node:test`；外观用 headless Chrome + CDP 检查。

**Spec:** `docs/superpowers/specs/2026-10-28-pk-vs-spine-design.md`

---

## 约定

- 下文 `$SCRATCH` 指一个不在仓库里的临时目录（会话的 scratchpad），临时脚本、截图都放这里，不提交。
- 本机 8080 端口上常驻着用户的本地服务（项目目录下 `python3 -m http.server 8080`），
  外观检查直接用它。**不要停它，也不要另起服务占 8080。** 开工前确认它在跑：
  `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/` 应输出 `200`；
  不在跑就在项目目录下后台重新起一个。
- 所有提交在分支 `feat/pk-vs-spine` 上进行（设计文档已提交在这个分支上）。

## 文件结构

| 文件 | 改动 |
|---|---|
| `display.js` | 新增导出纯函数 `spineDigitsWidth` |
| `test/display.test.js` | 新建，覆盖 `spineDigitsWidth` |
| `index.html` | VS 文字包一层 `<span>`；CSS 加竖屏放大、宽屏脊柱两段媒体查询 |
| `app.js` | `syncStripe` 改为 `syncLayout`：先算数字框宽度写回变量，再同步色条高度 |
| `sw.js` | `CACHE` 升到 v13 |
| `docs/superpowers/specs/2026-10-28-pk-red-blue-design.md` | 第 6 节加注 |
| `docs/superpowers/specs/2026-10-27-pk-mode-design.md` | 第 5 节同步 |
| `docs/superpowers/specs/2026-10-28-pk-vs-spine-design.md` | 补两处实现细节（黑底宽度、两格位数不同时右对齐） |

---

### Task 0: 记录改动前的尺寸

**Files:**
- Create: `$SCRATCH/spine-check.mjs`（临时脚本，不提交）

- [ ] **Step 1: 确认分支与本地服务**

```bash
git branch --show-current
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
```

Expected: `feat/pk-vs-spine`、`200`

- [ ] **Step 2: 后台启动 headless Chrome（9222 调试端口）**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9222 --user-data-dir="$SCRATCH/chrome-spine" \
  --no-first-run --hide-scrollbars about:blank
```

（用后台任务运行，不要阻塞。）

- [ ] **Step 3: 写外观检查脚本 `$SCRATCH/spine-check.mjs`**

```js
// PK 色条脊柱的外观检查。用法：
//   node spine-check.mjs <输出目录> baseline   改代码前量一次，存到 <输出目录>/baseline.json
//   node spine-check.mjs <输出目录>            改代码后逐项检查，截图存到 <输出目录>
// 前提：项目的本地服务在 http://localhost:8080；headless Chrome 开着 9222 调试端口。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [OUT, MODE] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:8080';
// mode：设计文档第 3 节的三种排法
const VIEWPORTS = [
  { name: '800x360', w: 800, h: 360, mode: 'spine' },
  { name: '1920x1080', w: 1920, h: 1080, mode: 'spine' },
  { name: '360x708', w: 360, h: 708, mode: 'portrait' },
  { name: '1180x820', w: 1180, h: 820, mode: 'same' },
  { name: '1024x768', w: 1024, h: 768, mode: 'same' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.error('超时'); process.exit(2); }, 180000).unref();
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${CDP}/json/version`)).ok) break; } catch {}
  await sleep(200);
}

async function open(path, w, h) {
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
  const resize = async (rw, rh) => {
    await send('Emulation.setDeviceMetricsOverride', { width: rw, height: rh, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
  };
  await resize(w, h);
  await send('Page.enable');
  await send('Page.navigate', { url: BASE + path });
  await sleep(1200);
  await evaluate('document.fonts.ready.then(() => true)');
  await sleep(300);
  return {
    evaluate,
    resize,
    close: () => fetch(`${CDP}/json/close/${t.id}`),
    slap: async (wait) => {
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`);
      await sleep(wait);
    },
    shot: async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, file), Buffer.from(r.result.data, 'base64'));
    },
  };
}

const MEASURE = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, l: b.left, r: b.right, t: b.top, b: b.bottom }; };
  const stage = getComputedStyle(document.getElementById('stage'));
  const vs = document.querySelector('.vs');
  // 改动前 VS 是裸文字，改动后包在 span 里；用 Range 量文字本身，前后可比
  const range = document.createRange(); range.selectNodeContents(vs);
  const box = vs.querySelector('span');
  return {
    vmin: Math.min(innerWidth, innerHeight) / 100,
    content: { l: parseFloat(stage.paddingLeft), r: innerWidth - parseFloat(stage.paddingRight) },
    slots: [...document.querySelectorAll('.slot')].map((s) => {
      const cs = getComputedStyle(s);
      return { ...r(s), pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight) };
    }),
    ghosts: [...document.querySelectorAll('.ghost')].map(r),
    svgs: [...document.querySelectorAll('.display')].map(r),
    stripes: [...document.querySelectorAll('.stripe')].map(r),
    vsText: r(range),
    vsBox: box ? r(box) : null,
    vsFont: parseFloat(getComputedStyle(vs).fontSize),
    vsShown: getComputedStyle(vs).display !== 'none',
  };
})()`;

// 走到「红方已停、蓝方计时中」，两格都有读数
async function midRound(p) { await p.slap(700); await p.slap(800); await p.slap(300); }

if (MODE === 'baseline') {
  const base = {};
  for (const v of VIEWPORTS) {
    const pk = await open('/?pk', v.w, v.h);
    const m = await pk.evaluate(MEASURE);
    await pk.close();
    const nm = await open('/', v.w, v.h);
    const n = await nm.evaluate(MEASURE);
    await nm.close();
    base[v.name] = { pkDigit: m.ghosts[0].w, vsText: m.vsText, vsFont: m.vsFont, normalDigit: n.ghosts[0].w };
    console.log(`${v.name}  PK 数字宽 ${m.ghosts[0].w.toFixed(1)}  VS 字号 ${m.vsFont.toFixed(1)}  普通模式数字宽 ${n.ghosts[0].w.toFixed(1)}`);
  }
  writeFileSync(join(OUT, 'baseline.json'), JSON.stringify(base, null, 2));
  process.exit(0);
}

const base = JSON.parse(readFileSync(join(OUT, 'baseline.json'), 'utf8'));
let failed = 0;
const check = (name, pass, detail) => {
  if (!pass) failed++;
  console.log(`${pass ? 'OK  ' : 'FAIL'}  ${name}\n      ${detail}`);
};
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const cx = (b) => b.x + b.w / 2;
const cy = (b) => b.y + b.h / 2;
const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const f1 = (n) => n.toFixed(1);

function checkStripes(name, m) {
  check(`${name} · 色条与数字一样高`, m.stripes.every((s, i) => near(s.h, m.ghosts[i].h)),
    `色条高 ${m.stripes.map((s) => f1(s.h)).join(' / ')}，数字高 ${m.ghosts.map((g) => f1(g.h)).join(' / ')}`);
}

function checkSpine(name, m) {
  const [red, blue] = m.stripes;
  const mid = (m.slots[0].b + m.slots[1].t) / 2;
  check(`${name} · 两根色条在同一竖线上`, near(cx(red), cx(blue)), `${f1(cx(red))} / ${f1(cx(blue))}`);
  check(`${name} · VS 在色条轴线上`, near(cx(m.vsBox), cx(red)), `VS 中心 ${f1(cx(m.vsBox))}，轴线 ${f1(cx(red))}`);
  check(`${name} · VS 在两行正中`, near(cy(m.vsBox), mid), `VS 中心 ${f1(cy(m.vsBox))}，两行正中 ${f1(mid)}`);
  check(`${name} · VS 截断两根色条`, m.vsBox.t < red.b && m.vsBox.b > blue.t,
    `VS 上下 ${f1(m.vsBox.t)}–${f1(m.vsBox.b)}，红条下端 ${f1(red.b)}，蓝条上端 ${f1(blue.t)}`);
  check(`${name} · 整组左右留白相等`, m.slots.every((s) => near(s.pl, s.pr)),
    m.slots.map((s) => `${f1(s.pl)} / ${f1(s.pr)}`).join('，'));
  check(`${name} · 两行数字右缘对齐`, near(m.svgs[0].r, m.svgs[1].r), `${f1(m.svgs[0].r)} / ${f1(m.svgs[1].r)}`);
  check(`${name} · 数字不溢出`, m.svgs.every((s) => s.l >= m.content.l - 1 && s.r <= m.content.r + 1),
    `数字框 ${m.svgs.map((s) => `${f1(s.l)}–${f1(s.r)}`).join(' / ')}，可用 ${f1(m.content.l)}–${f1(m.content.r)}`);
  check(`${name} · VS 与数字不重叠`, !m.ghosts.some((g) => hit(g, m.vsBox)), `VS ${f1(m.vsBox.l)}–${f1(m.vsBox.r)}`);
  check(`${name} · VS 字号 18vmin`, near(m.vsFont, 18 * m.vmin, 0.5), `${f1(m.vsFont)}px`);
  checkStripes(name, m);
}

function checkPortrait(name, m, b) {
  check(`${name} · 数字宽与改前相同`, near(m.ghosts[0].w, b.pkDigit, 0.5), `${f1(m.ghosts[0].w)}，改前 ${f1(b.pkDigit)}`);
  check(`${name} · VS 字号 11vmin`, near(m.vsFont, 11 * m.vmin, 0.5), `${f1(m.vsFont)}px`);
  check(`${name} · 色条在屏幕最左边`, m.stripes.every((s) => near(s.l, m.content.l)),
    `色条左缘 ${m.stripes.map((s) => f1(s.l)).join(' / ')}，可用区左缘 ${f1(m.content.l)}`);
  checkStripes(name, m);
}

for (const v of VIEWPORTS) {
  const b = base[v.name];
  const p = await open('/?pk', v.w, v.h);
  await midRound(p);
  const m = await p.evaluate(MEASURE);
  await p.shot(`${v.name}.png`);
  await p.close();

  if (v.mode === 'spine') {
    checkSpine(v.name, m);
    check(`${v.name} · 数字不比改前小`, m.ghosts[0].w >= b.pkDigit - 0.5, `${f1(m.ghosts[0].w)}，改前 ${f1(b.pkDigit)}`);
  } else if (v.mode === 'portrait') {
    checkPortrait(v.name, m, b);
  } else {
    check(`${v.name} · 数字宽与改前相同`, near(m.ghosts[0].w, b.pkDigit, 0.5), `${f1(m.ghosts[0].w)}，改前 ${f1(b.pkDigit)}`);
    const same = ['x', 'y', 'w', 'h'].every((k) => near(m.vsText[k], b.vsText[k], 0.5));
    check(`${v.name} · VS 位置大小与改前相同`, same && near(m.vsFont, b.vsFont, 0.1),
      `文字框 ${['x', 'y', 'w', 'h'].map((k) => f1(m.vsText[k])).join(',')}，改前 ${['x', 'y', 'w', 'h'].map((k) => f1(b.vsText[k])).join(',')}`);
    checkStripes(v.name, m);
  }

  const nm = await open('/', v.w, v.h);
  const n = await nm.evaluate(MEASURE);
  await nm.close();
  check(`${v.name} · 普通模式不变`, near(n.ghosts[0].w, b.normalDigit, 0.5) && !n.vsShown,
    `数字宽 ${f1(n.ghosts[0].w)}，改前 ${f1(b.normalDigit)}，VS ${n.vsShown ? '显示' : '不显示'}`);
}

// 同一页面转屏：横屏脊柱 → 竖屏放大 → 回到横屏脊柱
{
  const p = await open('/?pk', 800, 360);
  await midRound(p);
  await p.resize(360, 708);
  checkPortrait('转到竖屏', await p.evaluate(MEASURE), base['360x708']);
  await p.shot('转到竖屏.png');
  await p.resize(800, 360);
  checkSpine('转回横屏', await p.evaluate(MEASURE));
  await p.close();
}

// 红方读数超过 99 秒，数字框变宽，两格位数不同。
// 把 performance.now 往后拨 101 秒，计时中每帧的读数就跳到 101 秒多。停表用的是事件自带的
// 时间戳，不受这里影响，所以要趁红方还在计时时量。
{
  const p = await open('/?pk', 800, 360);
  await p.slap(300); // 红方开始计时
  await p.evaluate(`(() => { const now = performance.now.bind(performance); performance.now = () => now() + 101000; return true; })()`);
  await sleep(300);
  const m = await p.evaluate(MEASURE);
  await p.shot('超过99秒.png');
  await p.close();
  check('超过 99 秒 · 红方数字框比蓝方宽', m.svgs[0].w > m.svgs[1].w + 10,
    `${f1(m.svgs[0].w)} / ${f1(m.svgs[1].w)}`);
  checkSpine('超过 99 秒', m);
}

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 4: 量改动前的尺寸**

```bash
node "$SCRATCH/spine-check.mjs" "$SCRATCH/spine-shots" baseline
```

Expected（数字可能有零点几像素出入）：

```
800x360  PK 数字宽 441.x  VS 字号 18.0  普通模式数字宽 ...
1920x1080  PK 数字宽 ...  VS 字号 54.0  普通模式数字宽 ...
360x708  PK 数字宽 306.x  VS 字号 18.0  普通模式数字宽 ...
1180x820  PK 数字宽 1002.x  VS 字号 41.0  普通模式数字宽 ...
1024x768  PK 数字宽 899.x  VS 字号 38.4  普通模式数字宽 ...
```

---

### Task 1: 数字框宽度的纯函数

**Files:**
- Modify: `display.js`（文件末尾追加）
- Create: `test/display.test.js`

- [ ] **Step 1: 写失败的测试 `test/display.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spineDigitsWidth } from '../display.js';

// 数字取自手机横屏 800×360：格子宽 771、高 160，脊柱列加间距约 103
test('脊柱排法: 放得下时数字框与格子等高', () => {
  assert.equal(spineDigitsWidth({ slotWidth: 771, slotHeight: 160, aspect: 3, reserved: 103 }), 480);
});

test('脊柱排法: 放不下时取扣掉脊柱后剩下的宽度', () => {
  // 读数超过 99 秒，viewBox 变宽
  assert.equal(spineDigitsWidth({ slotWidth: 771, slotHeight: 160, aspect: 4.5, reserved: 103 }), 668);
});

test('脊柱排法: 格子比脊柱还窄时为 0，不会是负数', () => {
  assert.equal(spineDigitsWidth({ slotWidth: 80, slotHeight: 160, aspect: 3, reserved: 103 }), 0);
});

test('脊柱排法: 结果永不超过可用宽度', () => {
  for (const aspect of [1, 2, 3, 4, 5, 6]) {
    const w = spineDigitsWidth({ slotWidth: 771, slotHeight: 160, aspect, reserved: 103 });
    assert.ok(w <= 771 - 103, `宽高比 ${aspect} 得到 ${w}`);
  }
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/display.test.js`
Expected: FAIL，报 `does not provide an export named 'spineDigitsWidth'`

- [ ] **Step 3: 在 `display.js` 末尾追加实现**

```js
/**
 * 宽屏 PK 的色条脊柱排法里，一格数字框应占的宽度（CSS 像素）。
 *
 * 数字框与格子等高时最大，即「格子高度 × viewBox 宽高比」；格子宽度扣掉脊柱列与
 * 间距（reserved）后放不下时，取剩下的宽度，数字随之按宽度缩小。
 */
export function spineDigitsWidth({ slotWidth, slotHeight, aspect, reserved }) {
  return Math.max(0, Math.min(slotHeight * aspect, slotWidth - reserved));
}
```

- [ ] **Step 4: 运行全部测试**

Run: `npm test`
Expected: 全部通过（原 51 项 + 新 4 项 = 55 项）

- [ ] **Step 5: 提交**

```bash
git add display.js test/display.test.js
git commit -m "feat: 色条脊柱排法的数字框宽度计算"
```

---

### Task 2: 竖屏 VS 放大、宽屏色条脊柱

**Files:**
- Modify: `index.html`（`<style>` 末尾追加两段媒体查询；`.vs` 的 HTML）
- Modify: `app.js`（`syncStripe` 一段）

- [ ] **Step 1: `index.html` 里 VS 文字包一层 span**

把

```html
    <div class="vs" aria-hidden="true">VS</div>
```

改为

```html
    <div class="vs" aria-hidden="true"><span>VS</span></div>
```

span 在原有的分隔条里只是一个普通的 flex 项，iPad 横屏的外观不变；脊柱排法要给 VS 单独加黑底，必须有这层元素。

- [ ] **Step 2: `index.html` 的 `<style>` 末尾（`@keyframes stripe-pulse { … }` 之后）追加**

```css
  /* ---- PK 的 VS 按屏幕分三种排法 ----
     宽屏横屏：VS 移到左侧，与两根色条连成一根竖脊，两行之间只留窄缝。手机横屏受高度限制，
     两侧本来空着，VS 放在那里不占数字的地方，两行靠拢后数字反而更大。
     竖屏：数字受宽度限制，上下本来空着，VS 留在中间放大。
     其余横屏（iPad 等接近方形的屏幕）：两侧没有空白，保持上面的原样。 */

  @media (orientation: portrait), (orientation: landscape) and (min-aspect-ratio: 16/9) {
    :root[data-pk] .vs span { text-shadow: 0 0 1.2vmin rgba(255, 176, 32, 0.5); }
  }

  @media (orientation: portrait) {
    :root[data-pk] .vs {
      height: 15vmin;
      gap: 4vmin;
      font: italic 900 11vmin/1 system-ui, sans-serif;
    }
    :root[data-pk] .vs::before,
    :root[data-pk] .vs::after { height: 0.5vmin; }
  }

  /* 色条脊柱：每行是「脊柱列 26vmin + 间距 2.5vmin + 数字框」，整组水平居中。
     数字框宽度由 app.js 按字体量出的 viewBox 算好：每格的 --w 写在各自的 SVG 上，
     两格中较宽的 --digits-w 写在 #stage 上。两格与 VS 这一行用同一份左右留白，
     色条和 VS 才落在同一条竖线上；数字靠右，两格位数不同时小数点仍上下对齐。 */
  @media (orientation: landscape) and (min-aspect-ratio: 16/9) {
    :root[data-pk] :is(.slot, .vs) {
      justify-content: flex-start;
      padding-inline: max(0px, calc((100% - 28.5vmin - var(--digits-w, 0px)) / 2));
    }
    :root[data-pk] .stripe { margin-left: 12.25vmin; margin-right: 14.75vmin; }
    :root[data-pk] .display { flex: none; width: var(--w, 0px); margin-left: auto; }

    /* 两行之间的窄缝就是 VS 这一行。VS 比它高，上下溢出，正好压在两根色条的接缝上 */
    :root[data-pk] .vs {
      height: 3vmin;
      gap: 0;
      font: italic 900 18vmin/1 system-ui, sans-serif;
    }
    :root[data-pk] .vs::before,
    :root[data-pk] .vs::after { display: none; }
    /* 黑底把两根色条在接缝处截断；提到格子上层，否则会被下一格盖住 */
    :root[data-pk] .vs span {
      flex: none;
      width: 26vmin;
      padding-block: 1vmin;
      text-align: center;
      background: #000;
      position: relative;
      z-index: 1;
    }
  }
```

说明：
- `padding-inline` 的百分比相对 `#stage` 的内容宽度，`.slot` 与 `.vs` 都是它的子元素，算出的留白相同。
- 色条左右外边距 12.25 + 1.5 + 14.75 = 28.5vmin，正好是「脊柱列 26 + 间距 2.5」，色条在 26vmin 列的正中。
- `--w`、`--digits-w` 在测量之前取 `0px`，此时数字框宽 0、不显示，避免先闪一下错误的排版。

- [ ] **Step 3: `app.js` 改为一并同步数字框宽度与色条高度**

把文件开头的 import

```js
import { createDisplay } from './display.js';
```

改为

```js
import { createDisplay, spineDigitsWidth } from './display.js';
```

把从 `// PK 模式的色条和数字一样高。` 开始，到 `ResizeObserver` 那段结束的整块：

```js
// PK 模式的色条和数字一样高。数字的实际高度由格子宽高与 viewBox 共同决定：
// 横屏时受格子高度限制，竖屏时受宽度限制会变矮，色条若按格子高度算就会比数字长。
// 所以直接量幽灵层的渲染高度写给色条：viewBox 变了（字体加载完、超过 99 秒加宽）
// 或格子尺寸变了（转屏、窗口缩放）都重新量一次。
function syncStripe(slot) {
  if (!isPk) return;
  const h = slot.querySelector('.ghost').getBoundingClientRect().height;
  if (h) slot.querySelector('.stripe').style.height = `${h}px`;
}

const displays = slots.map((slot) =>
  createDisplay(slot.querySelector('.display'), { onFit: () => syncStripe(slot) }));

if (isPk && 'ResizeObserver' in window) {
  const ro = new ResizeObserver((entries) => entries.forEach((e) => syncStripe(e.target)));
  slots.forEach((slot) => ro.observe(slot));
}
```

替换为：

```js
// PK 模式的排版要按数字的实际渲染尺寸来定，CSS 算不出来，由这里量好写回：
// - 色条和数字一样高。数字的实际高度由格子宽高与 viewBox 共同决定，
//   竖屏时受宽度限制会变矮，色条若按格子高度算就会比数字长。
// - 宽屏横屏的色条脊柱排法要把「脊柱列 + 数字框」整组居中，需要知道数字框宽度：
//   每格的 --w 写在各自的 SVG 上，两格中较宽的 --digits-w 写在 #stage 上。
//   其余排法的 CSS 不读这两个变量。
// viewBox 变了（字体加载完、超过 99 秒加宽）或格子尺寸变了（转屏、窗口缩放）都重新算一次。
function syncLayout() {
  if (!isPk) return;
  const widths = slots.map((slot) => {
    const svg = slot.querySelector('.display');
    const vb = svg.viewBox.baseVal;
    if (!vb || !vb.width) return 0; // 还没量出 viewBox
    const box = slot.getBoundingClientRect();
    const stripe = getComputedStyle(slot.querySelector('.stripe'));
    const w = spineDigitsWidth({
      slotWidth: box.width,
      slotHeight: box.height,
      aspect: vb.width / vb.height,
      // 色条连同左右外边距，就是脊柱列加间距
      reserved: parseFloat(stripe.width) + parseFloat(stripe.marginLeft) + parseFloat(stripe.marginRight),
    });
    svg.style.setProperty('--w', `${w}px`);
    return w;
  });
  stage.style.setProperty('--digits-w', `${Math.max(...widths)}px`);
  // 宽度写好之后再量高度，读取时浏览器会先按新宽度排版
  for (const slot of slots) {
    const h = slot.querySelector('.ghost').getBoundingClientRect().height;
    if (h) slot.querySelector('.stripe').style.height = `${h}px`;
  }
}

const displays = slots.map((slot) =>
  createDisplay(slot.querySelector('.display'), { onFit: syncLayout }));

if (isPk && 'ResizeObserver' in window) {
  // 盯边框盒：脊柱排法会改格子的左右内边距，盯内容盒的话，写回变量又会触发自己
  const ro = new ResizeObserver(syncLayout);
  slots.forEach((slot) => ro.observe(slot, { box: 'border-box' }));
}
```

- [ ] **Step 4: 跑单元测试**

Run: `npm test`
Expected: 55 项全部通过

- [ ] **Step 5: 跑外观检查**

```bash
node "$SCRATCH/spine-check.mjs" "$SCRATCH/spine-shots"
```

Expected: 最后一行 `全部通过`。800x360 的「数字不比改前小」一项里，数字宽应约为 467（改前约 441）。

- [ ] **Step 6: 看截图**

打开 `$SCRATCH/spine-shots/800x360.png`、`360x708.png`、`1180x820.png`、`超过99秒.png`，确认：
- 800×360：左侧一根竖脊，红条、VS、蓝条从上到下排成一列，VS 黑底截断色条；整组居中；两行之间没有分隔线
- 360×708：VS 在两行正中，比原来大，粗斜体带光晕，两侧细线还在
- 1180×820：与改动前一样（VS 小字、常规字重）
- 超过 99 秒：红方 `1xx.xx` 比蓝方多一位，两行数字右缘对齐，VS 仍在色条线上

- [ ] **Step 7: 提交**

```bash
git add index.html app.js
git commit -m "feat: PK 宽屏 VS 与色条连成脊柱，竖屏 VS 放大"
```

---

### Task 3: 同步设计文档

**Files:**
- Modify: `docs/superpowers/specs/2026-10-28-pk-red-blue-design.md`
- Modify: `docs/superpowers/specs/2026-10-27-pk-mode-design.md`
- Modify: `docs/superpowers/specs/2026-10-28-pk-vs-spine-design.md`

- [ ] **Step 1: 红蓝设计第 6 节加注**

在 `## 6. 布局` 标题下一行插入：

```markdown
> 2026-10-28 起 VS 与色条的排法按屏幕区分：宽屏横屏改为色条脊柱，竖屏 VS 放大，
> 其余横屏不变，详见 `2026-10-28-pk-vs-spine-design.md`。本节描述的是改动前的样子，
> 「字号代价」表格是当时的实测。
```

- [ ] **Step 2: PK 设计第 5 节「每格的视觉状态」**

把

```markdown
上格是红方，下格是蓝方，两格之间有带「VS」的分隔条，每格左侧有一根同色色条提示轮次。
```

改为

```markdown
上格是红方，下格是蓝方，每格左侧有一根同色色条提示轮次，两格之间有「VS」。
VS 与色条的排法按屏幕区分（宽屏横屏为色条脊柱），见 `2026-10-28-pk-vs-spine-design.md`。
```

- [ ] **Step 3: PK 设计第 5 节「字号代价」末段**

在

```markdown
红蓝对阵加入的 VS 分隔条与色条会让数字再小一些：手机横屏约 8.5%，iPad 横屏约 3%–7%，
见 `2026-10-28-pk-red-blue-design.md` 第 6 节。
```

之后追加一段（467 换成 Task 2 Step 5 实测的值）：

```markdown
之后的 VS 色条脊柱改动让宽屏横屏的两行靠拢，手机横屏数字从 441 回升到 467，
iPad 横屏不变，见 `2026-10-28-pk-vs-spine-design.md`。
```

- [ ] **Step 4: 脊柱设计补两处实现细节**

第 4 节「布局」中 VS 那一条，把

```markdown
- **VS**：中心点落在脊柱轴线上、两行的正中。背后衬一块黑底，四周比 VS 字形各大
  `1vmin`，把两根色条在接缝处截断，看起来是两根色条插进 VS
```

改为

```markdown
- **VS**：中心点落在脊柱轴线上、两行的正中。背后衬一块黑底，宽同脊柱列，上下比字形
  各多 `1vmin`，把两根色条在接缝处截断，看起来是两根色条插进 VS
```

第 4 节「数字框宽度由 JS 计算」末尾（「读数超过 99 秒…」一段之后）追加：

```markdown
两格读数位数不同时（一方超过 99 秒），两格的数字框宽度不同。两格都按较宽的那格留白，
数字靠右，色条仍在同一条竖线上，小数点仍上下对齐。
```

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/
git commit -m "docs: 同步 VS 色条脊柱后的布局说明"
```

---

### Task 4: Service Worker 缓存升版

**Files:**
- Modify: `sw.js:2`

- [ ] **Step 1: 改版本号**

```js
const CACHE = 'slap-stopwatch-v13';
```

- [ ] **Step 2: 跑测试并提交**

```bash
npm test
git add sw.js
git commit -m "chore: SW 升到 v13"
```

Expected: 55 项全部通过

---

### Task 5: 手机真机验证

- [ ] **Step 1: 确认手机连着**

```bash
adb devices
adb reverse tcp:8080 tcp:8080
```

Expected: 列出一台 `device`。没有的话请用户插线并允许 USB 调试。

- [ ] **Step 2: 请用户在手机 Chrome 打开 `http://localhost:8080/?pk`**

（之前打开过的话刷新两次，让新的 Service Worker 接管。）请用户横屏、竖屏各拍一轮：
横屏看竖脊（红条、VS、蓝条）是否连成一体、VS 是否够醒目、数字是否比之前大；
竖屏看中间的 VS 是否放大。只看秒表的标签页，不碰用户的其他标签页。

---

### Task 6: 收尾

- [ ] **Step 1: 按 superpowers:finishing-a-development-branch 处理分支**

用户上次的选择是「合并回 main、删掉功能分支、先不推送」。推送到 GitHub 等于发布线上版本，
必须等用户明确同意后才推送。

## 执行中的调整

1. **外观检查要绕过 Service Worker**：Task 0 跑 baseline 时 headless Chrome 装上了 v12 的
   Service Worker，改完代码后它仍按 cache-first 返回旧页面。`spine-check.mjs` 的 `open()`
   在导航前加了 `Network.enable`、`Network.setBypassServiceWorker({ bypass: true })` 与
   `Network.setCacheDisabled({ cacheDisabled: true })`。
2. **实测结果**：68 项外观检查全部通过。手机横屏 800×360 数字宽 440.6 → 466.9，
   1920×1080 为 1322.0 → 1400.6；竖屏与 iPad 横屏的数字宽、VS 位置与改前完全相同。
