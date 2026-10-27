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
