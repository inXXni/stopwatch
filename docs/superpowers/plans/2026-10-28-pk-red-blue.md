# PK 模式红蓝对阵 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PK 模式上格红方、下格蓝方，中间 VS 分隔，左侧色条闪烁提示轮到谁；PK 模式下忽略 `?green`。

**Architecture:** 每格的视觉状态仍由纯函数 `pkSlotStates` 从 PK 状态推导，新增一种 `next`（轮到这一格），写进 `data-slot-state` 由 CSS 取用。颜色从 `.display` 上移到 `.slot`，色条用 `currentColor` 跟着阵营色走。`?pk&green` 在页面头部选 manifest 时按 `?pk` 处理，`manifest-pk-green.json` 删除。

**Tech Stack:** 原生 HTML/CSS/JavaScript（ES module）、Node 内置 `node:test`；外观用 headless Chrome + CDP 检查。

**Spec:** `docs/superpowers/specs/2026-10-28-pk-red-blue-design.md`

---

## 约定

- 下文 `$SCRATCH` 指一个不在仓库里的临时目录，临时脚本、截图都放这里，不提交。
- 本机 8080 端口上常驻着用户的本地服务（项目目录下 `python3 -m http.server 8080`），
  外观检查直接用它。**不要停它，也不要另起服务占 8080。** 开工前确认它在跑：
  `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/` 应输出 `200`。
- 所有提交在分支 `feat/pk-red-blue` 上进行，最后合并回 `main`。

## 文件结构

| 文件 | 改动 |
|---|---|
| `timer-core.js` | `SlotState` 加 `NEXT`；`pkSlotStates` 在 `WAIT_P1`、`WAIT_P2` 返回 `next` |
| `test/timer-core.test.js` | 槽位映射测试按新表格改 |
| `index.html` | 头部脚本 PK 时一律选 `manifest-pk.json`；CSS 加红蓝配色、VS 分隔条、色条；HTML 每格加色条、两格间加 VS |
| `app.js` | PK 模式下不设 `data-green-stop` |
| `tools/make-manifests.mjs` | 删去 `manifest-pk-green.json` 变体 |
| `manifest-pk-green.json` | 删除 |
| `sw.js` | `ASSETS` 去掉 `manifest-pk-green.json`；`CACHE` 升到 v11 |
| `test/manifest.test.js` | 改为直接执行 `index.html` 头部脚本来验证选 manifest 的规则 |
| `docs/superpowers/specs/2026-10-27-pk-mode-design.md` | 同步被推翻的条款 |
| `docs/superpowers/specs/2026-10-27-slap-stopwatch-design.md` | 「安装与参数」改为三份 manifest |

---

### Task 0: 建分支，记录改动前的数字宽度

**Files:**
- Create: `$SCRATCH/pk-check.mjs`（临时脚本，不提交）

- [ ] **Step 1: 建分支**

```bash
git switch -c feat/pk-red-blue
```

- [ ] **Step 2: 写外观检查脚本 `$SCRATCH/pk-check.mjs`**

```js
// PK 红蓝对阵的外观检查。用法：
//   node pk-check.mjs <输出目录> baseline   改代码前量一次数字宽，存到 <输出目录>/baseline.json
//   node pk-check.mjs <输出目录>            改代码后逐项检查，截图存到 <输出目录>
// 前提：项目的本地服务在 http://localhost:8080；headless Chrome 开着 9222 调试端口。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [OUT, MODE] = process.argv.slice(2);
const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:8080';
// expect：设计文档第 6 节估算的「改后 / 改前」数字宽比例
const VIEWPORTS = [
  { name: '手机 800×360', w: 800, h: 360, expect: 0.913 },
  { name: 'iPad Air 1180×820', w: 1180, h: 820, expect: 0.927 },
  { name: 'iPad 4:3 1024×768', w: 1024, h: 768, expect: 0.968 },
];
const RED = 'rgb(255, 45, 45)';
const BLUE = 'rgb(61, 139, 255)';
const GREEN = 'rgb(45, 255, 106)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Page.navigate', { url: BASE + path });
  await sleep(1200);
  await evaluate('document.fonts.ready.then(() => true)');
  await sleep(200);
  return {
    evaluate,
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
  const slots = [...document.querySelectorAll('.slot')];
  const vs = document.querySelector('.vs');
  const stripe = (s) => {
    const b = s.querySelector('.stripe');
    if (!b) return '无';
    const cs = getComputedStyle(b);
    if (cs.display === 'none' || getComputedStyle(s).display === 'none') return '隐藏';
    if (cs.animationName !== 'none') return '闪烁';
    return Number(cs.opacity) < 0.5 ? '暗' : '亮';
  };
  return {
    宽: slots.map((s) => Math.round(s.querySelector('.ghost').getBoundingClientRect().width)),
    色: slots.map((s) => getComputedStyle(s.querySelector('.display')).color),
    态: slots.map((s) => s.dataset.slotState),
    条: slots.map(stripe),
    VS: vs ? getComputedStyle(vs).display !== 'none' : false,
    manifest: document.querySelector('link[rel=manifest]').getAttribute('href'),
  };
})()`;

if (MODE === 'baseline') {
  const base = {};
  for (const v of VIEWPORTS) {
    const pk = await (await open('/?pk', v.w, v.h)).evaluate(MEASURE);
    const normal = await (await open('/', v.w, v.h)).evaluate(MEASURE);
    base[v.name] = { pk: pk.宽[0], normal: normal.宽[0] };
    console.log(`${v.name}  PK 数字宽 ${pk.宽[0]}  普通模式数字宽 ${normal.宽[0]}`);
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

const EXPECT = {
  等红方拍: [['next', 'empty'], ['闪烁', '暗']],
  红方计时中: [['running', 'empty'], ['亮', '暗']],
  红方锁定中: [['done', 'empty'], ['亮', '暗']],
  等蓝方拍: [['done', 'next'], ['亮', '闪烁']],
  蓝方计时中: [['done', 'running'], ['亮', '亮']],
  蓝方锁定中: [['done', 'done'], ['亮', '亮']],
  两人都已停: [['done', 'done'], ['亮', '亮']],
};

for (const v of VIEWPORTS) {
  const p = await open('/?pk', v.w, v.h);
  const seq = [];
  seq.push(['等红方拍', await p.evaluate(MEASURE)]);
  await p.slap(300); seq.push(['红方计时中', await p.evaluate(MEASURE)]);
  await p.slap(100); seq.push(['红方锁定中', await p.evaluate(MEASURE)]);
  await sleep(600); seq.push(['等蓝方拍', await p.evaluate(MEASURE)]);
  await p.shot(`${v.w}x${v.h}-等蓝方拍.png`);
  await p.slap(300); seq.push(['蓝方计时中', await p.evaluate(MEASURE)]);
  await p.slap(100); seq.push(['蓝方锁定中', await p.evaluate(MEASURE)]);
  await sleep(600); seq.push(['两人都已停', await p.evaluate(MEASURE)]);
  await p.shot(`${v.w}x${v.h}-两人都已停.png`);

  for (const [name, m] of seq) {
    const [states, stripes] = EXPECT[name];
    check(`${v.name} · ${name}`,
      same(m.态, states) && same(m.条, stripes) && same(m.色, [RED, BLUE]) && m.VS,
      `状态 ${m.态.join('/')}，色条 ${m.条.join('/')}，颜色 ${m.色.join(' / ')}，VS ${m.VS ? '显示' : '不显示'}`);
  }

  const [top, bottom] = seq[0][1].宽;
  const ratio = top / base[v.name].pk;
  // 只拦「缩得比估算多」：缩得少是好事，回头把实测值写进设计文档即可
  check(`${v.name} · 数字缩小幅度不超过估算`,
    ratio >= v.expect - 0.03 && top === bottom,
    `改前 ${base[v.name].pk}，改后上格 ${top}、下格 ${bottom}，为改前的 ${(ratio * 100).toFixed(1)}%，估算 ${(v.expect * 100).toFixed(1)}%`);

  const nm = await (await open('/', v.w, v.h)).evaluate(MEASURE);
  check(`${v.name} · 普通模式不变`,
    nm.宽[0] === base[v.name].normal && nm.宽[1] === 0 && same(nm.条, ['隐藏', '隐藏']) && !nm.VS && nm.色[0] === RED,
    `数字宽 ${nm.宽[0]}（改前 ${base[v.name].normal}），第二格宽 ${nm.宽[1]}，色条 ${nm.条.join('/')}，VS ${nm.VS ? '显示' : '不显示'}`);
}

const g = await open('/?green', 800, 360);
await g.slap(300); await g.slap(100);
const gm = await g.evaluate(MEASURE);
check('普通模式 ?green 停表照常变绿', gm.色[0] === GREEN, `停表后颜色 ${gm.色[0]}`);

const pg = await open('/?pk&green', 800, 360);
await pg.slap(300); await pg.slap(700);
const pgm = await pg.evaluate(MEASURE);
check('?pk&green 与 ?pk 一致，停表不变绿',
  same(pgm.色, [RED, BLUE]) && pgm.manifest === './manifest-pk.json',
  `红方停表后颜色 ${pgm.色.join(' / ')}，manifest ${pgm.manifest}`);

console.log(failed ? `\n${failed} 项不通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: 量改动前的数字宽**

```bash
rm -rf "$SCRATCH/chrome-pk" && mkdir -p "$SCRATCH/pk-shots"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222 --user-data-dir="$SCRATCH/chrome-pk" --no-first-run --no-default-browser-check about:blank > "$SCRATCH/chrome-pk.log" 2>&1 &
CHROME_PID=$!
node "$SCRATCH/pk-check.mjs" "$SCRATCH/pk-shots" baseline
kill $CHROME_PID
```

Expected：三行输出，每行给出一个视口下的 PK 数字宽与普通模式数字宽，并写出 `$SCRATCH/pk-shots/baseline.json`。

- [ ] **Step 4: 提交计划文档**

```bash
git add docs/superpowers/plans/2026-10-28-pk-red-blue.md
git commit -m "docs: PK 模式红蓝对阵实现计划"
```

---

### Task 1: 每格新增「轮到这一格」状态

**Files:**
- Modify: `timer-core.js`（`SlotState` 与 `pkSlotStates`）
- Test: `test/timer-core.test.js`（槽位映射部分）

- [ ] **Step 1: 改测试**

把 `test/timer-core.test.js` 里这两段：

```js
test('槽位映射: PK 空场两格皆空', () => {
  assert.deepEqual(pkSlotStates(PkState.WAIT_P1), [SlotState.EMPTY, SlotState.EMPTY]);
});
```

```js
test('槽位映射: 上格定格后下格仍空', () => {
  assert.deepEqual(pkSlotStates(PkState.LOCK_P1), [SlotState.DONE, SlotState.EMPTY]);
  assert.deepEqual(pkSlotStates(PkState.WAIT_P2), [SlotState.DONE, SlotState.EMPTY]);
});
```

分别替换为：

```js
test('槽位映射: PK 空场时轮到上格，下格空', () => {
  assert.deepEqual(pkSlotStates(PkState.WAIT_P1), [SlotState.NEXT, SlotState.EMPTY]);
});
```

```js
test('槽位映射: 上格锁定期内下格仍空，不提前提示下格', () => {
  // 锁定期内拍击无效，这时提示下格「该你了」会误导
  assert.deepEqual(pkSlotStates(PkState.LOCK_P1), [SlotState.DONE, SlotState.EMPTY]);
});

test('槽位映射: 上格锁定期满后轮到下格', () => {
  assert.deepEqual(pkSlotStates(PkState.WAIT_P2), [SlotState.DONE, SlotState.NEXT]);
});
```

并在 `test('槽位映射: 普通模式三种状态', ...)` 之后加：

```js
test('槽位映射: 普通模式不会出现「轮到这一格」', () => {
  for (const s of Object.values(State)) {
    assert.notEqual(slotStateOf(s), SlotState.NEXT, `${s} 映射成了 next`);
  }
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test`
Expected: FAIL。`PK 空场时轮到上格` 与 `上格锁定期满后轮到下格` 失败（`SlotState.NEXT` 是 `undefined`，实际值是 `'empty'`）。

- [ ] **Step 3: 改 `timer-core.js`**

把 `SlotState` 及其注释替换为：

```js
/**
 * 每一格的视觉状态。两种模式都归一到这几个值，CSS 只认它们，
 * 着色规则因此只需写一套。NEXT 只在 PK 模式出现，用来让色条提示轮到谁。
 */
export const SlotState = {
  EMPTY: 'empty',     // 尚未轮到，显示 00.00
  NEXT: 'next',       // 轮到这一格，下一拍就从这里开始计时
  RUNNING: 'running', // 计时中
  DONE: 'done',       // 已定格
};
```

把 `pkSlotStates` 替换为：

```js
/**
 * PK 模式：返回 [上格, 下格]。
 * 锁定期内拍击无效，所以 LOCK_P1 时下格还是 EMPTY，锁定结束进入 WAIT_P2 才轮到它。
 */
export function pkSlotStates(state) {
  switch (state) {
    case PkState.WAIT_P1:
      return [SlotState.NEXT, SlotState.EMPTY];
    case PkState.RUN_P1:
      return [SlotState.RUNNING, SlotState.EMPTY];
    case PkState.LOCK_P1:
      return [SlotState.DONE, SlotState.EMPTY];
    case PkState.WAIT_P2:
      return [SlotState.DONE, SlotState.NEXT];
    case PkState.RUN_P2:
      return [SlotState.DONE, SlotState.RUNNING];
    case PkState.LOCK_P2:
    case PkState.RESULT:
      return [SlotState.DONE, SlotState.DONE];
    default:
      return [SlotState.EMPTY, SlotState.EMPTY];
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test`
Expected: PASS，`tests 49`，`fail 0`（原 47 项，去掉 2 项、加 4 项）。

- [ ] **Step 5: 提交**

```bash
git add timer-core.js test/timer-core.test.js
git commit -m "feat: PK 模式每格新增「轮到这一格」状态"
```

---

### Task 2: PK 模式忽略 `?green`，删去 `manifest-pk-green.json`

**Files:**
- Modify: `test/manifest.test.js`
- Modify: `index.html:12-26`（头部选 manifest 的脚本）
- Modify: `tools/make-manifests.mjs`
- Delete: `manifest-pk-green.json`
- Modify: `sw.js`（`ASSETS`）
- Modify: `app.js:11-14`（`?green` 标记）

- [ ] **Step 1: 改测试**

在 `test/manifest.test.js` 里：

1. 把 `test('manifest: 文件名与 start_url 的参数一一对应', ...)` 整段替换为：

```js
// 把 index.html 头部那段选 manifest 的内联脚本取出来，在假的 location 与 document 上执行，
// 直接验证页面实际使用的规则，而不是在测试里再抄一遍
function runHeadScript(search) {
  const src = read('index.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  const link = { href: './manifest.json' };
  const meta = { content: '秒表' };
  const document = { querySelector: (sel) => (sel.startsWith('link') ? link : meta) };
  new Function('location', 'document', src)({ search }, document);
  return { manifest: link.href, title: meta.content };
}

test('index.html: 按地址参数选 manifest，PK 模式忽略 green', () => {
  assert.deepEqual(runHeadScript(''), { manifest: './manifest.json', title: '秒表' });
  assert.deepEqual(runHeadScript('?green'), { manifest: './manifest-green.json', title: '秒表 绿' });
  assert.deepEqual(runHeadScript('?pk'), { manifest: './manifest-pk.json', title: 'PK 秒表' });
  assert.deepEqual(runHeadScript('?pk&green'), { manifest: './manifest-pk.json', title: 'PK 秒表' });
});

test('manifest: 从每份的 start_url 打开，页面选回的正是这一份，iPhone 名字与图标名一致', () => {
  for (const { file, json } of manifests) {
    const search = json.start_url.includes('?') ? '?' + json.start_url.split('?')[1] : '';
    const { manifest, title } = runHeadScript(search);
    assert.equal(manifest, './' + file, `${json.start_url} 选到了 ${manifest}`);
    assert.equal(title, json.short_name);
  }
});

test('manifest: PK 模式不再有停表变绿的变体', () => {
  assert.equal(existsSync(join(ROOT, 'manifest-pk-green.json')), false);
});
```

2. 把 `test('manifest: 四种组合的 start_url 与名字各不相同，可以在桌面上并存', () => {`
   改为 `test('manifest: 各组合的 start_url 与名字各不相同，可以在桌面上并存', () => {`。

3. 在 `test('Service Worker: 缓存清单包含全部 manifest，且每个文件都存在', ...)` 里，
   `for (const { file } of manifests) {` 那段循环之前加：

```js
  const manifestAssets = assets.filter((a) => /manifest.*\.json$/.test(a)).sort();
  assert.deepEqual(manifestAssets, manifests.map((m) => './' + m.file).sort(),
    '缓存清单里的 manifest 与生成脚本不一致，删掉的变体要从 sw.js 里一起去掉');
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test`
Expected: FAIL。`按地址参数选 manifest` 失败（`?pk&green` 选到了 `./manifest-pk-green.json`，名字是 `PK 秒表 绿`）；`PK 模式不再有停表变绿的变体` 失败。

- [ ] **Step 3: 改 `index.html` 头部脚本**

把第 12–26 行的整个 `<script>...</script>` 替换为：

```html
<script>
  // 按地址参数选用对应的 manifest：每种组合一份，各自写明 start_url，
  // 安装到桌面的图标才会打开对应模式，名字也互不相同。文件由 npm run manifests 生成，
  // 文件名规则与名字必须和 tools/make-manifests.mjs 保持一致。
  // PK 模式忽略 green：红蓝是阵营色，停表变绿会把阵营抹掉，?pk&green 按 ?pk 处理。
  (() => {
    const q = new URLSearchParams(location.search);
    const pk = q.has('pk');
    const green = q.has('green');
    if (!pk && !green) return;
    document.querySelector('link[rel="manifest"]').href =
      pk ? './manifest-pk.json' : './manifest-green.json';
    document.querySelector('meta[name="apple-mobile-web-app-title"]').content =
      pk ? 'PK 秒表' : '秒表 绿';
  })();
</script>
```

- [ ] **Step 4: 改 `tools/make-manifests.mjs`**

文件开头的注释替换为：

```js
// 生成三份 manifest：普通 / 停表变绿 / PK。PK 模式不区分停表变绿（红蓝是阵营色）。
// 用法：npm run manifests
//
// 为什么要按参数各一份：安装到桌面的图标总是打开 manifest 里写的 start_url，
// 只有一份的话，从 ?pk 页面装出来的图标打开的也是普通模式，参数会丢；
// 而且 id 默认取 start_url，几种参数会被当成同一个应用，只能装一个。
//
// 为什么不干脆省略 start_url 让它跟随安装时的地址：Chrome 要求 manifest
// 显式写出 start_url 才允许安装，省略会报 start-url-not-valid。
```

把 `VARIANTS` 上方的注释改为：

```js
// 文件名规则与 index.html 里选用 manifest 的那段脚本一致：manifest[-green].json，PK 一律 manifest-pk.json
// short_name 显示在桌面图标下面，也与 index.html 里给 iPhone 设的名字一致。
```

并删掉 `VARIANTS` 里的最后一项：

```js
  {
    file: 'manifest-pk-green.json',
    start_url: './?pk&green',
    name: 'PK 秒表（停表变绿）',
    short_name: 'PK 秒表 绿',
    description: '双人 PK 模式：上下两格依次计时，各自停表后数字变绿',
  },
```

- [ ] **Step 5: 删文件、改 Service Worker 缓存清单、重新生成 manifest**

```bash
git rm manifest-pk-green.json
```

在 `sw.js` 的 `ASSETS` 里删掉这一行：

```js
  './manifest-pk-green.json',
```

然后：

```bash
npm run manifests
```

Expected：输出三行 `wrote manifest.json …`、`wrote manifest-green.json …`、`wrote manifest-pk.json …`；`git status` 里这三份文件没有变化。

- [ ] **Step 6: 改 `app.js`，PK 模式下不设停表变绿标记**

把：

```js
// ?green：停表变绿，便于一眼看出表已经停了。两种模式都吃这个参数。
// 在 iPhone 上用带参数的地址「添加到主屏幕」，那个图标就固定带该设置。
if (params.has('green')) document.documentElement.dataset.greenStop = '';
if (isPk) document.documentElement.dataset.pk = '';
```

替换为：

```js
// ?green：停表变绿，便于一眼看出表已经停了。只对普通模式生效——
// PK 模式下红蓝是阵营色，停表变绿会把阵营抹掉。
// 在 iPhone 上用带参数的地址「添加到主屏幕」，那个图标就固定带该设置。
if (params.has('green') && !isPk) document.documentElement.dataset.greenStop = '';
if (isPk) document.documentElement.dataset.pk = '';
```

- [ ] **Step 7: 跑测试，确认通过**

Run: `node --test`
Expected: PASS，`tests 51`，`fail 0`（Task 1 后 49 项，去掉 1 项、加 3 项）。

- [ ] **Step 8: 提交**

```bash
git add index.html tools/make-manifests.mjs sw.js app.js test/manifest.test.js
git commit -m "feat: PK 模式忽略 ?green，删去 manifest-pk-green.json"
```

---

### Task 3: 红蓝配色、VS 分隔条、左侧色条

**Files:**
- Modify: `index.html`（`<style>` 与 `<body>`）

- [ ] **Step 1: 改 `:root` 变量**

把 `:root { ... }` 整块替换为：

```css
  :root {
    /* 点亮的数字。待机、计时、定格三态同色——实物 LED 牌待机时 00.00 也是亮着的。
       PK 模式下是上格（红方）的颜色 */
    --ink: #ff2d2d;
    /* PK 模式下格（蓝方）的颜色。蓝色在黑底上天然显得比红色暗，两方亮度不等会削弱
       公平感，所以挑相对亮度接近的：#ff2d2d 为 0.233，#3d8bff 为 0.267 */
    --ink-blue: #3d8bff;
    /* 带 ?green 时定格后转成的颜色，只用于普通模式 */
    --ink-green: #2dff6a;
    /* PK 模式中间「VS」的颜色，与两侧细线的颜色 */
    --ink-vs: #ffb020;
    --rule: #3a3a3a;
    /* 没通电的段透出的暗色，LED 显示屏最有辨识度的细节 */
    --ghost-opacity: 0.12;
  }
```

- [ ] **Step 2: 改 `.slot`、隐藏规则与 `.display`**

把：

```css
  .slot {
    flex: 1;
    /* flex 子项默认 min-height:auto，内容会把容器撑破，必须显式归零 */
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 不带 ?pk 时只留一格，占满整屏，外观与单人模式完全一致 */
  :root:not([data-pk]) .slot:nth-child(2) { display: none; }

  /* viewBox 由 JS 按字体实际尺寸量出来，之后 SVG 自己等比缩放填满可用空间 */
  .display {
    width: 100%;
    height: 100%;
    color: var(--ink);
    filter: drop-shadow(0 0 0.4vmin currentColor);
    transition: color 80ms linear;
  }
```

替换为：

```css
  .slot {
    flex: 1;
    /* flex 子项默认 min-height:auto，内容会把容器撑破，必须显式归零 */
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 颜色挂在格子上，数字和色条都用 currentColor 跟着走 */
    color: var(--ink);
    transition: color 80ms linear;
  }

  /* 不带 ?pk 时只留一格，占满整屏，外观与单人模式完全一致 */
  :root:not([data-pk]) :is(.slot[data-side="blue"], .vs, .stripe) { display: none; }

  /* viewBox 由 JS 按字体实际尺寸量出来，之后 SVG 自己等比缩放填满可用空间。
     用 flex 占满色条以外的宽度；min-width 归零，否则 SVG 不肯收窄给色条让位 */
  .display {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    filter: drop-shadow(0 0 0.4vmin currentColor);
  }
```

- [ ] **Step 3: 改着色规则，加 PK 的红蓝、VS 与色条**

把：

```css
  /* 三态同色，所以不按 slot-state 分别着色。data-slot-state 仍要写在 DOM 上，
     下面那条 ?green 规则靠它认出「已定格」那一格。 */

  /* ?green：停表变绿。两种模式都吃这个参数，PK 下两格各自定格后分别变绿 */
  :root[data-green-stop] .slot[data-slot-state="done"] .display {
    color: var(--ink-green);
  }
```

替换为：

```css
  /* 数字三态同色，所以不按 slot-state 分别着色。data-slot-state 仍要写在 DOM 上，
     ?green 规则靠它认出「已定格」那一格，PK 的色条靠它决定亮、暗还是闪。 */

  /* ?green：停表变绿，只对普通模式生效（PK 模式下 app.js 不设 data-green-stop） */
  :root[data-green-stop] .slot[data-slot-state="done"] {
    color: var(--ink-green);
  }

  /* PK 模式：上格红方、下格蓝方，各状态下都是阵营色 */
  :root[data-pk] .slot[data-side="blue"] { color: var(--ink-blue); }

  /* 两格之间的 VS 分隔条 */
  .vs {
    flex: none;
    height: 8vmin;
    display: flex;
    align-items: center;
    gap: 3vmin;
    color: var(--ink-vs);
    font: 500 5vmin/1 system-ui, sans-serif;
  }

  .vs::before,
  .vs::after {
    content: '';
    flex: 1;
    height: 2px;
    background: var(--rule);
  }

  /* 左侧色条：轮到谁谁闪，计时中与已定格常亮，还没轮到的变暗 */
  .stripe {
    flex: none;
    width: 1.5vmin;
    height: 80%;
    margin-right: 2.5vmin;
    border-radius: 0.75vmin;
    background: currentColor;
  }

  .slot[data-slot-state="empty"] .stripe { opacity: 0.2; }

  .slot[data-slot-state="next"] .stripe {
    animation: stripe-pulse 0.8s ease-in-out infinite alternate;
  }

  @keyframes stripe-pulse {
    from { opacity: 1; }
    to { opacity: 0.15; }
  }
```

- [ ] **Step 4: 改 `<body>`**

把 `<div id="stage"> ... </div>` 整块替换为：

```html
  <div id="stage">
    <div class="slot" data-side="red" data-slot-state="empty">
      <div class="stripe"></div>
      <svg class="display" preserveAspectRatio="xMidYMid meet" aria-label="选手一计时">
        <text class="ghost" x="0" y="0" text-anchor="end">88.88</text>
        <text class="value" x="0" y="0" text-anchor="end">0.00</text>
      </svg>
    </div>
    <div class="vs" aria-hidden="true">VS</div>
    <div class="slot" data-side="blue" data-slot-state="empty">
      <div class="stripe"></div>
      <svg class="display" preserveAspectRatio="xMidYMid meet" aria-label="选手二计时">
        <text class="ghost" x="0" y="0" text-anchor="end">88.88</text>
        <text class="value" x="0" y="0" text-anchor="end">0.00</text>
      </svg>
    </div>
  </div>
```

`app.js` 用 `stage.querySelectorAll('.slot')` 取格子，中间插入的 `.vs` 不是 `.slot`，取到的仍是上下两格，不用改。

- [ ] **Step 5: 跑单元测试**

Run: `node --test`
Expected: PASS，`tests 51`，`fail 0`。

- [ ] **Step 6: 跑外观检查**

```bash
rm -rf "$SCRATCH/chrome-pk"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222 --user-data-dir="$SCRATCH/chrome-pk" --no-first-run --no-default-browser-check about:blank > "$SCRATCH/chrome-pk.log" 2>&1 &
CHROME_PID=$!
node "$SCRATCH/pk-check.mjs" "$SCRATCH/pk-shots"
kill $CHROME_PID
```

Expected：最后一行 `全部通过`。逐项含义：

- 三个视口下，PK 一轮 7 个状态的格子状态、色条（闪烁/亮/暗）都与设计文档第 7 节一致，颜色恒为红 / 蓝，VS 显示
- 数字缩小得不比估算多 3 个百分点以上，上下两格一样宽
- 普通模式数字宽与改前完全相同，第二格、色条、VS 都不显示
- 普通模式 `?green` 停表变绿；`?pk&green` 停表不变绿，用的是 `./manifest-pk.json`

如果「数字缩小幅度」不通过：把 `.vs` 的 `height` 从 `8vmin` 降到 `6vmin`，`font` 字号从 `5vmin` 降到 `4vmin`，再跑一次。

无论是否调整，都把三个视口的实测数字宽与缩小比例写进设计文档 `2026-10-28-pk-red-blue-design.md` 第 6 节的表格，替换估算值，表头的「估算」字样改为「实测」；Task 4 Step 2 里写给 PK 设计文档的百分比也按实测值写。该文档改动并入本任务 Step 8 的提交。

- [ ] **Step 7: 看截图**

打开 `$SCRATCH/pk-shots/800x360-等蓝方拍.png` 与 `$SCRATCH/pk-shots/1180x820-两人都已停.png`，确认：上红下蓝、VS 在两格正中、两段细线不顶到屏幕边、色条在数字左侧且与数字之间有空隙、数字没有被色条挤得偏离居中太多。

- [ ] **Step 8: 提交**

```bash
git add index.html docs/superpowers/specs/2026-10-28-pk-red-blue-design.md
git commit -m "feat: PK 模式红蓝对阵，VS 分隔条与轮次色条"
```

---

### Task 4: 同步旧设计文档

**Files:**
- Modify: `docs/superpowers/specs/2026-10-27-pk-mode-design.md`
- Modify: `docs/superpowers/specs/2026-10-27-slap-stopwatch-design.md`

- [ ] **Step 1: 改 PK 设计第 5 节「每格的视觉状态」**

把从 `### 每格的视觉状态` 到 `上格一停表就变绿，不必等下格跑完。` 的整段替换为：

```markdown
### 每格的视觉状态

> 2026-10-28 起改为红蓝对阵，详见 `2026-10-28-pk-red-blue-design.md`，本节已按改动后的规则更新。

上格是红方，下格是蓝方，两格之间有带「VS」的分隔条，每格左侧有一根同色色条提示轮次。

| 该格状态 | 数字 | 色条 |
|---|---|---|
| 尚未轮到 | 阵营色，显示 `00.00` | 暗 |
| 轮到这一格 | 阵营色，显示 `00.00` | 呼吸闪烁 |
| 计时中 | 阵营色，读数跳动 | 常亮 |
| 已定格 | 阵营色 | 常亮 |

数字在各状态下都是阵营色，待机那格不做暗显——实物 LED 牌待机时也是亮着的。

`?green` 只对普通模式生效。PK 模式下停表变绿会盖掉阵营色，因此忽略这个参数，
`?pk&green` 与 `?pk` 完全一致。
```

- [ ] **Step 2: 在 PK 设计第 5 节「字号代价」末尾加一段**

在 `设备以横屏平板为准，手机横屏可用但字会小一圈。` 之后加：

```markdown

红蓝对阵加入的 VS 分隔条与色条会让数字再小一些：手机横屏约 9%，iPad 横屏约 3%–7%，
见 `2026-10-28-pk-red-blue-design.md` 第 6 节。
```

- [ ] **Step 3: 改 PK 设计第 9 节验收标准第 7、8 条**

把：

```markdown
7. `?pk&green` 可叠加：两格各自定格后分别变绿，上格不必等下格跑完
8. iPad 横屏（4:3）下分屏前后数字尺寸一致，不因分屏而缩小
```

替换为：

```markdown
7. `?pk&green` 与 `?pk` 完全一致，停表不变绿（2026-10-28 起，原为两格各自变绿）
8. iPad 横屏（4:3）下数字只因 VS 分隔条与色条略微缩小（约 3%），不因上下分屏本身而缩小
```

- [ ] **Step 4: 改主设计文档「安装与参数」**

在 `docs/superpowers/specs/2026-10-27-slap-stopwatch-design.md` 里，把：

```markdown
URL 参数（`?pk`、`?green`）的每种组合都有一份独立的 manifest，各自写明 `start_url`：

| 文件 | 启动页 | 图标名 |
|---|---|---|
| `manifest.json` | `./` | 秒表 |
| `manifest-green.json` | `./?green` | 秒表 绿 |
| `manifest-pk.json` | `./?pk` | PK 秒表 |
| `manifest-pk-green.json` | `./?pk&green` | PK 秒表 绿 |

`index.html` 头部的一段内联脚本按地址参数选用对应文件，并同步 iOS 的
`apple-mobile-web-app-title`。四份文件由 `npm run manifests` 生成，不手改。
```

替换为：

```markdown
普通模式的两种参数组合与 PK 模式各有一份独立的 manifest，各自写明 `start_url`：

| 文件 | 启动页 | 图标名 |
|---|---|---|
| `manifest.json` | `./` | 秒表 |
| `manifest-green.json` | `./?green` | 秒表 绿 |
| `manifest-pk.json` | `./?pk` | PK 秒表 |

PK 模式忽略 `?green`（红蓝是阵营色，停表变绿会把阵营抹掉），`?pk&green` 用的也是
`manifest-pk.json`。

`index.html` 头部的一段内联脚本按地址参数选用对应文件，并同步 iOS 的
`apple-mobile-web-app-title`。三份文件由 `npm run manifests` 生成，不手改。
```

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-10-27-pk-mode-design.md docs/superpowers/specs/2026-10-27-slap-stopwatch-design.md
git commit -m "docs: 同步 PK 红蓝对阵后的配色、?green 与 manifest 规则"
```

---

### Task 5: Service Worker 缓存升版

**Files:**
- Modify: `sw.js:2`

- [ ] **Step 1: 升版本号**

把 `const CACHE = 'slap-stopwatch-v10';` 改为 `const CACHE = 'slap-stopwatch-v11';`。

- [ ] **Step 2: 跑全部测试**

Run: `node --test`
Expected: PASS，`tests 51`，`fail 0`。

- [ ] **Step 3: 提交**

```bash
git add sw.js
git commit -m "chore: SW 升到 v11"
```

---

### Task 6: 手机真机验证，确定蓝色

用户的 vivo 手机经 USB 连着 adb。手机 Chrome 通过 `adb reverse` 访问本机 8080 上的服务。

- [ ] **Step 1: 在手机 Chrome 打开 PK 页面**

```bash
adb reverse tcp:8080 tcp:8080
adb shell "am start -a android.intent.action.VIEW -d 'http://localhost:8080/?pk' -n com.android.chrome/com.google.android.apps.chrome.Main"
```

Service Worker 是 cache-first，如果手机以前打开过 `localhost:8080`，要刷新两次才是新版。

- [ ] **Step 2: 截图看效果**

```bash
adb exec-out screencap -p > "$SCRATCH/phone-pk.png"
```

确认上红下蓝、VS、色条与 headless 截图一致。

- [ ] **Step 3: 请用户看手机**

请用户把手机横过来，在正常观看距离看红蓝两色是否一样醒目，并拍几下（Enter 或屏幕）走一轮，看色条闪烁是否明显。

如果用户觉得蓝色偏暗或偏亮，改 `index.html` 里 `--ink-blue` 的色值，同时改：
- `index.html` 里 `--ink-blue` 上方注释中的相对亮度数值
- `$SCRATCH/pk-check.mjs` 里的 `BLUE` 常量（按新色值换算成 `rgb(r, g, b)`）
- 设计文档 `2026-10-28-pk-red-blue-design.md` 第 4 节的色值与相对亮度

重新跑 Task 3 Step 6 的外观检查，通过后提交：

```bash
git add index.html docs/superpowers/specs/2026-10-28-pk-red-blue-design.md
git commit -m "fix: 按真机效果调整蓝方颜色"
```

用户认可当前蓝色则跳过提交。

- [ ] **Step 4: 去掉端口转发**

```bash
adb reverse --remove tcp:8080
```

---

### Task 7: 合并回 main 并上线

- [ ] **Step 1: 合并**

```bash
git switch main
git merge --ff-only feat/pk-red-blue
node --test
```

Expected：快进合并成功；测试全部通过。

- [ ] **Step 2: 推送前征得用户同意**

推送到 `origin main` 会更新线上 `https://inxxni.github.io/stopwatch/`。先问用户，得到明确同意再执行：

```bash
git push origin main
```

- [ ] **Step 3: 确认线上已更新**

等 GitHub Pages 构建完成后：

```bash
curl -s https://inxxni.github.io/stopwatch/sw.js | grep "const CACHE"
curl -s -o /dev/null -w '%{http_code}\n' https://inxxni.github.io/stopwatch/manifest-pk-green.json
```

Expected：第一行是 `const CACHE = 'slap-stopwatch-v11';`；第二行是 `404`。

- [ ] **Step 4: 删除功能分支**

```bash
git branch -d feat/pk-red-blue
```
