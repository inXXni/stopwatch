/**
 * 停表爆裂：停表那一刻画面先顿一下（数字放大、镜头推近、色散拉开），
 * 随后整屏抖动、放射线与两道冲击环扩散。普通模式与 PK 模式共用，
 * 参数见 docs/superpowers/specs/2026-10-29-stop-burst-design.md 第 3 节。
 * 尺寸都用 vmin，各种屏幕上比例一致。
 */

// 顿帧：前 70 ms 画面定格在被打中的那一下，之后各部分一齐放开
export const HITSTOP_MS = 70;

// 整屏抖动：形状与砸入撞击后的抖动相同，幅度 1.6 倍
const SHAKE_FRAMES = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-3.04vmin, 1.76vmin)', offset: 0.14 },
  { transform: 'translate(2.74vmin, -1.76vmin)', offset: 0.31 },
  { transform: 'translate(-1.76vmin, 0.97vmin)', offset: 0.52 },
  { transform: 'translate(0.97vmin, -0.48vmin)', offset: 0.74 },
  { transform: 'translate(0, 0)' },
];

// 数字顿在 1.15 倍，回落时略缩到 0.97 倍，再落定。只缩放，读数不变
const PUNCH_FRAMES = [
  { transform: 'scale(1.15)' },
  { transform: 'scale(0.97)', offset: 0.45 },
  { transform: 'scale(1.02)', offset: 0.7 },
  { transform: 'scale(1)' },
];

// 色散：数字两侧各拖一份偏色的影子，向数字收拢并淡出。
// 最后一层是数字原有的光晕（index.html 里 .display 的 filter），前后不变
const GLOW = 'drop-shadow(0 0 0.4vmin currentColor)';
const SPLIT_FRAMES = [
  { filter: `drop-shadow(-1.9vmin 0.3vmin 0 rgba(0, 229, 255, 0.95)) drop-shadow(1.9vmin -0.3vmin 0 rgba(255, 43, 214, 0.95)) ${GLOW}` },
  { filter: `drop-shadow(0 0 0 rgba(0, 229, 255, 0)) drop-shadow(0 0 0 rgba(255, 43, 214, 0)) ${GLOW}` },
];

// 镜头：以数字中心为原点，整页推近再拉回
const ZOOM_FRAMES = [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }];

// 放射线整组放大并淡出。translate 让 SVG 的中心对准 left、top
const LINES_FRAMES = [
  { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 1 },
  { transform: 'translate(-50%, -50%) scale(1.35)', opacity: 0 },
];

// 两道冲击环从数字中心出现，边扩散边变细变淡；第二道晚 90 ms、更细更小
const RING_FRAMES = [
  { width: '8.3vmin', height: '8.3vmin', borderWidth: '2.8vmin', opacity: 0.9 },
  { width: '138vmin', height: '138vmin', borderWidth: '0.3vmin', opacity: 0 },
];
const RING2_FRAMES = [
  { width: '7.2vmin', height: '7.2vmin', borderWidth: '1.7vmin', opacity: 0.8 },
  { width: '106vmin', height: '106vmin', borderWidth: '0.3vmin', opacity: 0 },
];

/**
 * 14 根放射线的端点，单位 vmin，以数字中心为原点。长短交替：
 * 偶数根从半径 22.2 画到 59.7，奇数根从 26.4 画到 47.2。
 */
export const BURST_LINES = Array.from({ length: 14 }, (_, k) => {
  const angle = (k * 2 * Math.PI) / 14 + 0.11;
  const [from, to] = k % 2 ? [26.4, 47.2] : [22.2, 59.7];
  const at = (r) => [Math.cos(angle) * r, Math.sin(angle) * r].map((v) => Math.round(v * 100) / 100);
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  return { x1, y1, x2, y2 };
});

/**
 * 对停表那一格播一次爆裂。digits 是这一格的数字（.display），rings 是这一格的两道冲击环，
 * lines 是这一格的放射线，camera 是推近时缩放的元素（整页）。
 * 浏览器不支持 element.animate 时什么都不做。
 */
export function stopHit({ digits, rings, lines, stage, camera }) {
  if (typeof digits?.animate !== 'function') return;
  // 数字中心。各矩形同受整屏抖动的平移，相减后与抖动无关
  const d = digits.getBoundingClientRect();
  const cx = d.left + d.width / 2;
  const cy = d.top + d.height / 2;
  const s = stage.getBoundingClientRect();
  for (const el of [...rings, lines]) {
    el.style.left = `${cx - s.left}px`;
    el.style.top = `${cy - s.top}px`;
  }
  const c = camera.getBoundingClientRect();
  camera.style.transformOrigin = `${cx - c.left}px ${cy - c.top}px`;

  // 顿帧期间要定格的几段停在第一帧；其余的顿帧之后才出现
  const held = { delay: HITSTOP_MS, fill: 'backwards', easing: 'ease-out' };
  digits.animate(PUNCH_FRAMES, { ...held, duration: 320 });
  digits.animate(SPLIT_FRAMES, { ...held, duration: 200 });
  camera.animate(ZOOM_FRAMES, { ...held, duration: 300 });
  stage.animate(SHAKE_FRAMES, { delay: HITSTOP_MS, duration: 380 });
  lines.animate(LINES_FRAMES, { delay: HITSTOP_MS, duration: 280, easing: 'ease-out' });
  rings[0].animate(RING_FRAMES, { delay: HITSTOP_MS, duration: 500, easing: 'ease-out' });
  rings[1].animate(RING2_FRAMES, { delay: HITSTOP_MS + 90, duration: 420, easing: 'ease-out' });
}
