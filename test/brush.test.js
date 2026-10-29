import test from 'node:test';
import assert from 'node:assert/strict';
import { samplePath, centerlineD, bristles, random } from '../brush.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('中心线取点: 直线上按弧长等距，控制点挤在一端也一样', () => {
  const { points, length } = samplePath({ from: [0, 0], curves: [[0, 0, 0, 0, 30, 0]] }, 3);
  assert.ok(close(length, 30), `总长 ${length}`);
  assert.equal(points.length, 4);
  points.forEach(([x, y], i) => {
    assert.ok(close(x, i * 10), `第 ${i} 点 x=${x}`);
    assert.ok(close(y, 0));
  });
});

test('中心线取点: 多段曲线首尾就是给定的起点与终点', () => {
  const s = { from: [134, 18], curves: [[120, 6, 90, 12, 92, 34], [94, 54, 132, 48, 130, 72], [128, 94, 96, 99, 78, 86]] };
  const { points } = samplePath(s, 80);
  assert.equal(points.length, 81);
  assert.deepEqual(points[0], [134, 18]);
  assert.ok(close(points[80][0], 78) && close(points[80][1], 86), `终点 ${points[80]}`);
});

test('中心线的 d: 起点加每段三次贝塞尔', () => {
  assert.equal(centerlineD({ from: [14, 8], curves: [[26, 34, 40, 62, 58, 92]] }), 'M14 8 C26 34 40 62 58 92');
  assert.equal(centerlineD({ from: [0, 0], curves: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]] }),
    'M0 0 C1 2 3 4 5 6 C7 8 9 10 11 12');
});

test('随机数: 同一种子序列相同，都在 0～1 之间', () => {
  const a = random(7), b = random(7);
  for (let i = 0; i < 20; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(random(7)(), random(19)());
});

// V 的左笔，参数与 ink-vs.js 一致
const V_LEFT = { from: [14, 8], curves: [[26, 34, 40, 62, 58, 92]], w: [29, 27, 6], a: 0.1, b: 0.55, dry: 0.2, tail: 0.04, seed: 7 };
const pointsOf = (d) => d.slice(1, -1).split('L');

test('笔毛: 每笔 12 根，每根是 98 个点的闭合路径，坐标落在框外扩 20 以内', () => {
  const paths = bristles(V_LEFT);
  assert.equal(paths.length, 12);
  for (const d of paths) {
    assert.match(d, /^M.*Z$/);
    const pts = pointsOf(d).map((p) => p.split(' ').map(Number));
    assert.equal(pts.length, 98);
    for (const [x, y] of pts) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(x >= -20 && x <= 168 && y >= -20 && y <= 120, `${x},${y}`);
    }
  }
});

test('笔毛: 同样的输入画出同样的结果，换种子就不同', () => {
  assert.deepEqual(bristles(V_LEFT), bristles(V_LEFT));
  assert.notDeepEqual(bristles({ ...V_LEFT, seed: 8 }), bristles(V_LEFT));
});

test('笔毛: 起笔处收尖，两条边线从同一点出发', () => {
  for (const d of bristles(V_LEFT)) {
    const pts = pointsOf(d);
    assert.equal(pts[0], pts[97]); // 左边线第一点与右边线第一点（右边线倒着接在后面）
  }
});
