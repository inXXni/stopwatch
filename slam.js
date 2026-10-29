/**
 * PK 模式的 VS 砸入：VS 从屏幕外砸下来，撞击时放出一圈冲击环，整屏抖一下。
 * 每开始新的一轮播一次，参数见 docs/superpowers/specs/2026-10-29-vs-slam-design.md 第 3 节。
 * 尺寸都用 vmin，各种屏幕上比例一致。
 */

export const SLAM_MS = 560;

// 撞击时刻在整段动画里的位置
const HIT = 0.42;

// 加速落下，撞击时压扁到 0.8 倍，回弹到 1.12 倍，再落定
const TEXT_FRAMES = [
  { transform: 'scale(3.4) rotate(-12deg)', opacity: 0, easing: 'cubic-bezier(.55, 0, 1, .45)' },
  { transform: 'scale(0.8) rotate(3deg)', opacity: 1, offset: HIT, easing: 'ease-out' },
  { transform: 'scale(1.12) rotate(-1deg)', opacity: 1, offset: 0.66, easing: 'ease-in-out' },
  { transform: 'scale(1) rotate(0deg)', opacity: 1 },
];

// 撞击时从 VS 中心出现，边扩散边变细变淡
const RING_FRAMES = [
  { width: '2.2vmin', height: '2.2vmin', borderWidth: '3.3vmin', opacity: 0 },
  { width: '2.2vmin', height: '2.2vmin', borderWidth: '3.3vmin', opacity: 1, offset: HIT },
  { width: '106vmin', height: '106vmin', borderWidth: '0.3vmin', opacity: 0 },
];

// 撞击之后整屏抖几下，幅度逐渐变小
const SHAKE_FRAMES = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(0, 0)', offset: HIT },
  { transform: 'translate(-1.9vmin, 1.1vmin)', offset: 0.5 },
  { transform: 'translate(1.7vmin, -1.1vmin)', offset: 0.6 },
  { transform: 'translate(-1.1vmin, 0.6vmin)', offset: 0.72 },
  { transform: 'translate(0.6vmin, -0.3vmin)', offset: 0.85 },
  { transform: 'translate(0, 0)' },
];

/**
 * 从头播放一次砸入。上一次还没播完时再调用，新的盖过旧的。
 * 浏览器不支持 element.animate 时什么都不做，VS 静止显示。
 */
export function slamIn({ text, ring, stage }) {
  if (typeof text?.animate !== 'function') return;
  text.animate(TEXT_FRAMES, { duration: SLAM_MS });
  ring.animate(RING_FRAMES, { duration: SLAM_MS, easing: 'ease-out' });
  stage.animate(SHAKE_FRAMES, { duration: SLAM_MS });
}
