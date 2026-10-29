/**
 * 停表冲击：停表那一刻整屏抖一下，停表那一格的数字弹大再落回，
 * 并从数字中心扩散出一圈浅色环。普通模式与 PK 模式共用，
 * 参数见 docs/superpowers/specs/2026-10-29-stop-hit-design.md 第 3 节。
 * 尺寸都用 vmin，各种屏幕上比例一致。
 */

export const HIT_MS = 380;
// 环比抖动多留一点时间散开，仍在停表后 500 ms 的锁定期内播完
export const RING_MS = 500;

// 形状与砸入撞击后的抖动相同，幅度 1.6 倍；停表时立刻开抖，不等
const SHAKE_FRAMES = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-3.04vmin, 1.76vmin)', offset: 0.14 },
  { transform: 'translate(2.74vmin, -1.76vmin)', offset: 0.31 },
  { transform: 'translate(-1.76vmin, 0.97vmin)', offset: 0.52 },
  { transform: 'translate(0.97vmin, -0.48vmin)', offset: 0.74 },
  { transform: 'translate(0, 0)' },
];

// 弹大到 1.112 倍，回落时略缩到 0.98 倍，再落定。只缩放，读数不变
const PUNCH_FRAMES = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.112)', offset: 0.18 },
  { transform: 'scale(0.98)', offset: 0.5 },
  { transform: 'scale(1)' },
];

// 从数字中心出现，边扩散边变细变淡
const RING_FRAMES = [
  { width: '8.3vmin', height: '8.3vmin', borderWidth: '2.8vmin', opacity: 0.9 },
  { width: '138vmin', height: '138vmin', borderWidth: '0.3vmin', opacity: 0 },
];

/**
 * 对停表那一格播一次冲击。digits 是这一格的数字（.display），ring 是这一格的冲击环。
 * 浏览器不支持 element.animate 时什么都不做。
 */
export function stopHit({ digits, ring, stage }) {
  if (typeof digits?.animate !== 'function') return;
  // 环以数字中心为圆心。两个矩形同受整屏抖动的平移，相减后与抖动无关；
  // 数字的缩放以中心为原点，也不改变中心
  const d = digits.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  ring.style.left = `${d.left + d.width / 2 - s.left}px`;
  ring.style.top = `${d.top + d.height / 2 - s.top}px`;
  stage.animate(SHAKE_FRAMES, { duration: HIT_MS });
  digits.animate(PUNCH_FRAMES, { duration: HIT_MS, easing: 'ease-out' });
  ring.animate(RING_FRAMES, { duration: RING_MS, easing: 'ease-out' });
}
