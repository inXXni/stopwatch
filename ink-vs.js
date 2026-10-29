/**
 * PK 模式的水墨毛笔 VS：在 <svg viewBox="0 0 148 100"> 里画出三笔与墨点，新一轮开始时一笔笔写出来。
 * 笔形、滤镜与时间表见 docs/superpowers/specs/2026-10-29-vs-ink-design.md。
 */
import { bristles, centerlineD, samplePath } from './brush.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 三笔，坐标在 148×100 的框里：V 的左笔粗、起笔飞白；V 的右笔细、收笔出尖；S 一笔甩出，两头尖。
// w 是起笔、行笔、收笔的粗细，a / b 是起笔、收笔渐变段占笔长的比例，dry 是飞白，tail 是收笔参差。
// at / dur / ease 是写出来时这一笔的开始时间（ms）、时长与缓动
export const STROKES = [
  {
    from: [14, 8], curves: [[26, 34, 40, 62, 58, 92]],
    w: [29, 27, 6], a: 0.1, b: 0.55, dry: 0.2, tail: 0.04, seed: 7,
    at: 0, dur: 115, ease: 'cubic-bezier(.55, 0, .85, 1)',
  },
  {
    from: [60, 88], curves: [[66, 60, 74, 34, 86, 6]],
    w: [14, 17, 4], a: 0.15, b: 0.5, dry: 0.05, tail: 0.12, seed: 19,
    at: 125, dur: 85, ease: 'cubic-bezier(.4, 0, .8, 1)',
  },
  {
    from: [134, 18], curves: [[120, 6, 90, 12, 92, 34], [94, 54, 132, 48, 130, 72], [128, 94, 96, 99, 78, 86]],
    w: [3, 24, 2], a: 0.2, b: 0.3, dry: 0, tail: 0.1, seed: 31,
    at: 220, dur: 200, ease: 'cubic-bezier(.35, .1, .6, 1)',
  },
];

// 墨点：圆心、半径、跟着哪一笔、在那一笔写到哪里时弹出（0 是起笔，1 是收笔）
export const DOTS = [
  { x: 4, y: 2, r: 2.2, stroke: 0, at: 0.05 },
  { x: -2, y: 12, r: 1.3, stroke: 0, at: 0.1 },
  { x: 12, y: -3, r: 1.1, stroke: 0, at: 0.1 },
  { x: 22, y: 0, r: 0.9, stroke: 0, at: 0.15 },
  { x: 93, y: 0, r: 1.4, stroke: 1, at: 1 },
  { x: 97, y: -5, r: 0.8, stroke: 1, at: 1 },
  { x: 143, y: 9, r: 1.8, stroke: 2, at: 0 },
  { x: 148, y: 19, r: 1.1, stroke: 2, at: 0 },
  { x: 139, y: 1, r: 0.9, stroke: 2, at: 0 },
  { x: 70, y: 93, r: 1.3, stroke: 2, at: 1 },
  { x: 63, y: 98, r: 0.8, stroke: 2, at: 1 },
];

// 三笔写完（420 ms）后整个字顿一下
const PUNCH_AT = 420;
const PUNCH_MS = 200;
export const WRITE_MS = PUNCH_AT + PUNCH_MS;

const DOT_MS = 140;
const DOT_FRAMES = [
  { transform: 'scale(0)' },
  { transform: 'scale(1.5)', offset: 0.6 },
  { transform: 'scale(1)' },
];
const PUNCH_FRAMES = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.07)', offset: 0.35 },
  { transform: 'scale(1)' },
];

function add(parent, tag, attrs = {}) {
  const el = parent.ownerDocument.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
}

// 墨滤镜：噪声把笔画边缘扭毛，外面加一圈光晕。参数在 148×100 框的坐标里，随字一起缩放；
// 光晕颜色由样式表的 .vs-ink-flood 给出
function addGlowFilter(defs) {
  const f = add(defs, 'filter', {
    id: 'vs-ink-glow', x: '-25%', y: '-25%', width: '150%', height: '150%',
    'color-interpolation-filters': 'sRGB',
  });
  add(f, 'feTurbulence', { type: 'fractalNoise', baseFrequency: 0.25, numOctaves: 2, seed: 4, result: 'noise' });
  add(f, 'feDisplacementMap', {
    in: 'SourceGraphic', in2: 'noise', scale: 1.85, xChannelSelector: 'R', yChannelSelector: 'G', result: 'ink',
  });
  add(f, 'feMorphology', { in: 'ink', operator: 'dilate', radius: 0.53, result: 'fat' });
  add(f, 'feGaussianBlur', { in: 'fat', stdDeviation: 2.9, result: 'blur' });
  add(f, 'feFlood', { class: 'vs-ink-flood', 'flood-opacity': 0.55 });
  add(f, 'feComposite', { in2: 'blur', operator: 'in', result: 'glow' });
  const merge = add(f, 'feMerge');
  add(merge, 'feMergeNode', { in: 'glow' });
  add(merge, 'feMergeNode', { in: 'ink' });
}

/**
 * 在 svg 里画出 VS，返回写动画要用的元素。
 * 每笔的笔毛套一个遮罩，遮罩是沿中心线的白色粗线；虚线实段长 D、空段长 2D（D 比中心线长），
 * 偏移从 D + 1 动到 0，白线就从起笔一路展开到收笔。静止时偏移为 0，就是写完的样子。
 */
export function drawInkVs(svg) {
  const defs = add(svg, 'defs');
  addGlowFilter(defs);
  const ink = add(svg, 'g', { filter: 'url(#vs-ink-glow)', fill: 'currentColor' });
  const lines = STROKES.map((stroke, i) => {
    const d = Math.ceil(samplePath(stroke, 1).length) + 1;
    const mask = add(defs, 'mask', {
      id: `vs-ink-m${i}`, maskUnits: 'userSpaceOnUse', x: -50, y: -50, width: 250, height: 200,
    });
    const line = add(mask, 'path', {
      d: centerlineD(stroke), fill: 'none', stroke: '#fff', 'stroke-width': Math.max(...stroke.w) * 1.7,
      'stroke-linecap': 'round', 'stroke-dasharray': `${d} ${2 * d}`,
    });
    const group = add(ink, 'g', { mask: `url(#vs-ink-m${i})` });
    for (const p of bristles(stroke)) add(group, 'path', { d: p });
    return { line, from: d + 1 };
  });
  const dots = DOTS.map(({ x, y, r }) => add(ink, 'circle', { cx: x, cy: y, r }));
  return { svg, lines, dots };
}

/**
 * 从头写一次。上一次还没写完时再调用，新的盖过旧的。
 * 浏览器不支持 element.animate 时什么都不做，VS 静止显示。
 */
export function writeIn({ svg, lines, dots }) {
  if (typeof svg?.animate !== 'function') return;
  STROKES.forEach(({ at, dur, ease }, i) => {
    const { line, from } = lines[i];
    line.animate([{ strokeDashoffset: `${from}px` }, { strokeDashoffset: '0px' }],
      { delay: at, duration: dur, easing: ease, fill: 'backwards' });
  });
  DOTS.forEach(({ stroke, at }, i) => {
    const s = STROKES[stroke];
    dots[i].animate(DOT_FRAMES, { delay: s.at + s.dur * at, duration: DOT_MS, easing: 'ease-out', fill: 'backwards' });
  });
  svg.animate(PUNCH_FRAMES, { delay: PUNCH_AT, duration: PUNCH_MS, easing: 'ease-out' });
}
