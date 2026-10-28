import {
  formatTime, nextState, nextPkState, State, PkState, Event,
  SlotState, pkSlotStates, slotStateOf,
} from './timer-core.js';
import { createDisplay, spineDigitsWidth } from './display.js';

const LOCK_MS = 500; // 停表后的封锁时长，防手掌反弹与多指造成的二次触发

const params = new URLSearchParams(location.search);
const isPk = params.has('pk');

// ?green：停表变绿，便于一眼看出表已经停了。只对普通模式生效——
// PK 模式下红蓝是阵营色，停表变绿会把阵营抹掉。
// 在 iPhone 上用带参数的地址「添加到主屏幕」，那个图标就固定带该设置。
if (params.has('green') && !isPk) document.documentElement.dataset.greenStop = '';
if (isPk) document.documentElement.dataset.pk = '';

const stage = document.getElementById('stage');
const slots = [...stage.querySelectorAll('.slot')];

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

function paintSlots(states) {
  states.forEach((s, i) => { slots[i].dataset.slotState = s; });
}

// ---- 计时核心 ----
// 只负责时间，显示交给当前绑定的那一格。PK 模式下同时只有一格在跑，
// 已定格的那格不会被碰到。

let startAt = 0;
let rafId = null;
let activeDisplay = null;
let unlockTimer = null;
let activePointerId = null;

function tick() {
  activeDisplay.render(formatTime(performance.now() - startAt));
  rafId = requestAnimationFrame(tick);
}

function startTiming(timeStamp, display) {
  startAt = timeStamp;
  activeDisplay = display;
  acquireWakeLock(); // 拍击是明确的用户手势，此时申请必定成功
  display.render(formatTime(0));
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function stopTiming(timeStamp) {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  activeDisplay.render(formatTime(timeStamp - startAt));
}

// ---- 模式控制 ----
// 时间戳取自事件本身而非 performance.now()，以排除事件派发和 JS 执行的延迟
// ——两者同为相对 performance.timeOrigin 的高精度时间戳。

let state = State.IDLE;

function handleSlapSingle(timeStamp) {
  const next = nextState(state, Event.SLAP);
  if (next === state) return; // LOCKED 状态下被吞掉
  state = next;

  if (next === State.RUNNING) {
    startTiming(timeStamp, displays[0]);
  } else if (next === State.LOCKED) {
    stopTiming(timeStamp);
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      state = nextState(state, Event.UNLOCK);
      paintSlots([slotStateOf(state), SlotState.EMPTY]);
    }, LOCK_MS);
  } else if (next === State.IDLE) {
    displays[0].render(formatTime(0)); // 清零，不开跑
  }

  paintSlots([slotStateOf(state), SlotState.EMPTY]);
}

let pkState = PkState.WAIT_P1;

function handleSlapPk(timeStamp) {
  const next = nextPkState(pkState, Event.SLAP);
  if (next === pkState) return; // 锁定期内被吞掉
  pkState = next;

  if (next === PkState.RUN_P1) {
    startTiming(timeStamp, displays[0]);
  } else if (next === PkState.RUN_P2) {
    startTiming(timeStamp, displays[1]);
  } else if (next === PkState.LOCK_P1 || next === PkState.LOCK_P2) {
    stopTiming(timeStamp);
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      pkState = nextPkState(pkState, Event.UNLOCK);
      paintSlots(pkSlotStates(pkState));
    }, LOCK_MS);
  } else if (next === PkState.WAIT_P1) {
    displays.forEach((d) => d.render(formatTime(0))); // 清场
  }

  paintSlots(pkSlotStates(pkState));
}

const handleSlap = isPk ? handleSlapPk : handleSlapSingle;

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

paintSlots(isPk ? pkSlotStates(pkState) : [slotStateOf(state), SlotState.EMPTY]);
// 字体是异步加载的，加载完字形尺寸才确定，必须重新量一次 viewBox
if (document.fonts) document.fonts.ready.then(() => displays.forEach((d) => d.fit()));

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
