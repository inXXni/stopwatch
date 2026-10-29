/**
 * 毛笔笔画的几何：中心线按弧长取点，沿中心线叠一束笔毛多边形。不碰 DOM。
 * 笔画参数的含义见 docs/superpowers/specs/2026-10-29-vs-ink-design.md 第 2 节。
 *
 * 中心线写作 { from: [x, y], curves: [[c1x, c1y, c2x, c2y, x, y], ...] }：起点加若干段三次贝塞尔。
 */

const FINE = 200;     // 量弧长时每段贝塞尔细分的小段数
const SEGMENTS = 80;  // 生成笔毛前，中心线按弧长等分的段数
const BRISTLES = 12;  // 每笔的笔毛根数
const STEPS = 48;     // 每根笔毛沿长度分的段数，一侧边线 49 个点

// 中心线的 SVG 路径
export function centerlineD({ from, curves }) {
  return `M${from.join(' ')}` + curves.map((c) => ` C${c.join(' ')}`).join('');
}

function bezier(p0, c, t) {
  const m = 1 - t;
  const k0 = m * m * m, k1 = 3 * m * m * t, k2 = 3 * m * t * t, k3 = t * t * t;
  return [k0 * p0[0] + k1 * c[0] + k2 * c[2] + k3 * c[4], k0 * p0[1] + k1 * c[1] + k2 * c[3] + k3 * c[5]];
}

/** 中心线按弧长等分成 n 段，返回 n + 1 个点与总长 */
export function samplePath({ from, curves }, n) {
  const fine = [from];
  let start = from;
  for (const c of curves) {
    for (let i = 1; i <= FINE; i++) fine.push(bezier(start, c, i / FINE));
    start = [c[4], c[5]];
  }
  const acc = [0];
  for (let i = 1; i < fine.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
  }
  const length = acc[acc.length - 1];
  const points = [];
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const s = (length * i) / n;
    while (j < acc.length - 1 && acc[j] < s) j++;
    const u = (s - acc[j - 1]) / (acc[j] - acc[j - 1] || 1);
    const a = fine[j - 1], b = fine[j];
    points.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return { points, length };
}

// 线性同余随机数：种子相同，序列就相同，每次画出来的笔形完全一样
export function random(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const smooth = (x) => x * x * (3 - 2 * x);

/**
 * 沿中心线生成一束笔毛，返回每根笔毛闭合多边形的 SVG 路径。
 * 边上的笔毛起笔晚、收笔早；有飞白的笔里一半笔毛起笔处骤然变细，叠起来出飞白和分叉。
 * 随机数的取用顺序决定笔形，不要调换。
 */
export function bristles(stroke) {
  const { w: [w0, w1, w2], a, b, dry, tail, seed } = stroke;
  const { points } = samplePath(stroke, SEGMENTS);
  // 笔宽：起笔段从 w0 渐变到 w1，收笔段从 w1 渐变到 w2
  const widthAt = (t) => (t < a ? w0 + (w1 - w0) * smooth(t / a)
    : t > 1 - b ? w1 + (w2 - w1) * smooth((t - 1 + b) / b)
      : w1);
  // 中心线上 t（0～1）处的点与走向
  const at = (t) => {
    const f = Math.min(SEGMENTS - 1e-6, t * SEGMENTS), i = Math.floor(f), u = f - i;
    const [px, py] = points[i], [qx, qy] = points[i + 1];
    return [px + (qx - px) * u, py + (qy - py) * u, qx - px, qy - py];
  };
  const r = random(seed);
  const paths = [];
  for (let k = 0; k < BRISTLES; k++) {
    const u = k / (BRISTLES - 1) - 0.5; // 横向位置 −0.5～0.5
    const edge = Math.abs(u) * 2;       // 离中心多远，0～1
    const ts = dry * r() * (0.3 + edge);
    const te = 1 - tail * r() * (0.4 + edge);
    const isDry = dry > 0 && r() < 0.5;
    const tD = 0.12 + 0.3 * r();
    const bw = 0.75 + 0.5 * r();
    const left = [], right = [];
    for (let j = 0; j <= STEPS; j++) {
      const t = ts + ((te - ts) * j) / STEPS;
      const [x, y, dx, dy] = at(t);
      const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      const w = widthAt(t);
      const tip = Math.min(1, (t - ts) / 0.04, (te - t) / 0.07);
      const thin = isDry && t < tD + 0.06 ? (t < tD ? 0.15 : 0.15 + (0.85 * (t - tD)) / 0.06) : 1;
      const half = ((w * 1.35) / BRISTLES) * bw * tip * thin;
      const off = u * w * 0.9;
      left.push([x + nx * (off - half), y + ny * (off - half)]);
      right.push([x + nx * (off + half), y + ny * (off + half)]);
    }
    paths.push('M' + left.concat(right.reverse()).map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z');
  }
  return paths;
}
