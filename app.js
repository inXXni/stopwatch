import { formatTime, nextState, State, Event, SEGMENTS, toDisplayCells } from './timer-core.js';

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

// ---- 七段数码管渲染 ----
// 一个数字单元 72x128，段粗 12，段两端削成斜角，相邻段在拐角处正好咬合。

const DIGIT_W = 72;
const DIGIT_H = 128;
const T = 12;      // 段粗细
const H = T / 2;   // 斜角长度
const GAP = 6;     // 数字间距
const DOT_W = 26;  // 小数点占位宽度

const hseg = (x0, y0, x1) =>
  `M${x0 + H},${y0}L${x1 - H},${y0}L${x1},${y0 + H}L${x1 - H},${y0 + T}L${x0 + H},${y0 + T}L${x0},${y0 + H}Z`;
const vseg = (x0, y0, y1) =>
  `M${x0},${y0 + H}L${x0 + H},${y0}L${x0 + T},${y0 + H}L${x0 + T},${y1 - H}L${x0 + H},${y1}L${x0},${y1 - H}Z`;

// 段之间留 3px 黑缝，和实物一致。缝隙不能省：段端是斜角，挨在一起会重叠，
// 半透明的幽灵段叠起来会在四角显出更亮的小三角。
const SEG_PATHS = {
  a: hseg(2, 2, 70),      // y 2..14
  b: vseg(58, 17, 55),    // y 17..55
  c: vseg(58, 73, 111),   // y 73..111
  d: hseg(2, 114, 70),    // y 114..126
  e: vseg(2, 73, 111),
  f: vseg(2, 17, 55),
  g: hseg(2, 58, 70),     // y 58..70
};

const SVG_NS = 'http://www.w3.org/2000/svg';

let cellSegs = [];     // 每个显示位的段元素；小数点位存 null
let lastText = null;
let lastCellCount = 0;

// 只在位数变化时重建 DOM。常规成绩恒为 5 位，所以这里几乎只跑一次。
function buildDisplay(cells) {
  display.replaceChildren();
  cellSegs = [];
  let x = 0;

  for (const cell of cells) {
    if (cell === '.') {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', x + DOT_W / 2);
      dot.setAttribute('cy', DIGIT_H - H - 2);
      dot.setAttribute('r', H);
      dot.setAttribute('class', 'seg on');
      display.appendChild(dot);
      cellSegs.push(null);
      x += DOT_W;
    } else {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('transform', `translate(${x},0)`);
      const segs = [];
      for (const name of 'abcdefg') {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', SEG_PATHS[name]);
        path.setAttribute('class', 'seg');
        group.appendChild(path);
        segs.push([name, path]);
      }
      display.appendChild(group);
      cellSegs.push(segs);
      x += DIGIT_W + GAP;
    }
  }

  display.setAttribute('viewBox', `0 0 ${x - GAP} ${DIGIT_H}`);
  lastCellCount = cells.length;
}

function render(text) {
  if (text === lastText) return;
  lastText = text;
  display.dataset.value = text; // 段的亮灭读不出数值，挂一份明文方便测试和调试

  const cells = toDisplayCells(text);
  if (cells.length !== lastCellCount) buildDisplay(cells);

  for (let i = 0; i < cells.length; i++) {
    const segs = cellSegs[i];
    if (!segs) continue; // 小数点，始终亮着
    const lit = SEGMENTS[cells[i]] ?? '';
    for (const [name, path] of segs) {
      path.classList.toggle('on', lit.includes(name));
    }
  }
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
    acquireWakeLock(); // 拍击是明确的用户手势，此时申请必定成功
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

render(formatTime(0)); // SVG 在 HTML 里是空的，首屏由这里画出来

stage.addEventListener('pointerdown', onPointerDown, { passive: false });
stage.addEventListener('pointerup', onPointerEnd);
stage.addEventListener('pointercancel', onPointerEnd);

// Enter 键同样可以触发，方便接蓝牙小键盘或在电脑上测试。
// 这里判断 e.key 而不是 e.code：主键盘的 Enter 和小键盘的 Enter
// 对应 'Enter' 与 'NumpadEnter' 两个不同的 code，但 key 都是 'Enter'。
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.repeat) return;
  e.preventDefault();
  handleSlap(e.timeStamp);
});

// 兜底：阻止双击缩放与长按菜单
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

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

// ---- 离线支持 ----
// 注册失败不影响计时功能，静默降级为普通网页。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
