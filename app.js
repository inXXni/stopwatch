import { formatTime, nextState, State, Event, ghostOf } from './timer-core.js';

const LOCK_MS = 500; // 停表后的封锁时长，防手掌反弹与多指造成的二次触发

// 默认全程红色。带 ?green 参数访问时停表变绿，便于一眼看出表已经停了。
// 在 iPhone 上用带参数的地址「添加到主屏幕」，那个图标就固定是绿色版。
if (new URLSearchParams(location.search).has('green')) {
  document.documentElement.dataset.greenStop = '';
}

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

// ---- 显示 ----
// 两层文字右对齐叠放：幽灵层固定是全 8（七段全亮）显示为暗色，读数层盖在上面。
// 读数不足两位秒时左边自然露出一个全暗的 8，正是 LED 牌没通电那一位的样子。

const ghost = document.getElementById('ghost');
const value = document.getElementById('value');

let lastText = null;
let lastGhost = null;

// 字号写死在 CSS 里只是个基准值，真实大小由 viewBox 决定。
// 这里按幽灵层量出来的实际墨水范围设 viewBox，SVG 自己等比缩放填满容器，
// 不用手算 vw/vh，各种屏幕比例都能占满。
function fitViewBox() {
  const box = ghost.getBBox();
  if (!box.width) return; // 字体还没加载完，量不出东西
  const pad = box.height * 0.06;
  display.setAttribute(
    'viewBox',
    `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`
  );
}

function render(text) {
  if (text === lastText) return;
  lastText = text;
  display.dataset.value = text; // 挂一份明文，方便测试和调试读取
  value.textContent = text;

  const g = ghostOf(text);
  if (g !== lastGhost) { // 只有位数变了才需要重新量，常规使用下只跑一次
    lastGhost = g;
    ghost.textContent = g;
    fitViewBox();
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

render(formatTime(0));
// 字体是异步加载的，加载完字形尺寸才确定，必须重新量一次 viewBox
if (document.fonts) document.fonts.ready.then(fitViewBox);

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
