import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stopHit, HITSTOP_MS, BURST_LINES } from '../hit.js';

// 假元素：记下 animate 收到的关键帧与参数，getBoundingClientRect 返回给定的矩形
function fakeEl(rect = { left: 0, top: 0, width: 0, height: 0 }) {
  const calls = [];
  return {
    calls,
    style: {},
    getBoundingClientRect: () => rect,
    animate(frames, options) { calls.push({ frames, options }); return {}; },
  };
}
function hitOnce({ digitsRect, stageRect, cameraRect } = {}) {
  const parts = {
    digits: fakeEl(digitsRect),
    rings: [fakeEl(), fakeEl()],
    lines: fakeEl(),
    stage: fakeEl(stageRect),
    camera: fakeEl(cameraRect),
  };
  stopHit(parts);
  return parts;
}
// 数字上有两段动画：缩放与色散
const punch = (p) => p.digits.calls.find((c) => 'transform' in c.frames[0]);
const split = (p) => p.digits.calls.find((c) => 'filter' in c.frames[0]);
const allCalls = (p) => [p.digits, p.camera, p.stage, p.lines, ...p.rings].flatMap((el) => el.calls);
// [时长, 延迟, 顿帧期间是否停在第一帧]
const timing = (c) => [c.options.duration, c.options.delay, c.options.fill === 'backwards'];
// 数字中心 (320, 80)
const DIGITS = { left: 120, top: 30, width: 400, height: 100 };
const SCREEN = { left: 0, top: 0, width: 800, height: 360 };

test('停表爆裂: 顿帧 70 ms', () => {
  assert.equal(HITSTOP_MS, 70);
});

test('停表爆裂: 各段的时长、延迟，以及顿帧期间是否停在第一帧', () => {
  const p = hitOnce();
  assert.deepEqual(timing(punch(p)), [320, 70, true]);
  assert.deepEqual(timing(split(p)), [200, 70, true]);
  assert.deepEqual(timing(p.camera.calls[0]), [300, 70, true]);
  assert.deepEqual(timing(p.stage.calls[0]), [380, 70, false]);
  assert.deepEqual(timing(p.lines.calls[0]), [280, 70, false]);
  assert.deepEqual(timing(p.rings[0].calls[0]), [500, 70, false]);
  assert.deepEqual(timing(p.rings[1].calls[0]), [420, 160, false]);
});

test('停表爆裂: 一共七段，全部 0.6 秒内结束', () => {
  const calls = allCalls(hitOnce());
  assert.equal(calls.length, 7);
  for (const c of calls) assert.ok(c.options.delay + c.options.duration <= 600);
});

test('停表爆裂: 数字顿在 1.15 倍，回落后回到原样', () => {
  const { frames, options } = punch(hitOnce());
  assert.equal(frames[0].transform, 'scale(1.15)');
  assert.equal(frames.at(-1).transform, 'scale(1)');
  assert.equal(options.easing, 'ease-out');
});

test('停表爆裂: 色散从两侧偏色影子收拢到透明', () => {
  const f = split(hitOnce()).frames;
  assert.ok(f[0].filter.includes('drop-shadow(-1.9vmin 0.3vmin 0 rgba(0, 229, 255, 0.95))'));
  assert.ok(f[0].filter.includes('drop-shadow(1.9vmin -0.3vmin 0 rgba(255, 43, 214, 0.95))'));
  assert.ok(f.at(-1).filter.includes('drop-shadow(0 0 0 rgba(0, 229, 255, 0))'));
  assert.ok(f.at(-1).filter.includes('drop-shadow(0 0 0 rgba(255, 43, 214, 0))'));
});

test('停表爆裂: 色散的每一帧都保留数字原有的光晕（与 index.html 一致）', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const glow = html.match(/\.display \{[^}]*filter: ([^;]+);/)[1];
  for (const k of split(hitOnce()).frames) assert.ok(k.filter.endsWith(glow), k.filter);
});

test('停表爆裂: 镜头从 1.08 倍拉回，原点在数字中心', () => {
  const p = hitOnce({ digitsRect: DIGITS, cameraRect: SCREEN });
  assert.deepEqual(p.camera.calls[0].frames.map((k) => k.transform), ['scale(1.08)', 'scale(1)']);
  assert.equal(p.camera.style.transformOrigin, '320px 80px');
});

test('停表爆裂: 放射线从 0.6 倍放大到 1.35 倍并淡出，始终以 left、top 为中心', () => {
  const f = hitOnce().lines.calls[0].frames;
  assert.equal(f[0].transform, 'translate(-50%, -50%) scale(0.6)');
  assert.equal(f[0].opacity, 1);
  assert.equal(f.at(-1).transform, 'translate(-50%, -50%) scale(1.35)');
  assert.equal(f.at(-1).opacity, 0);
});

test('停表爆裂: 第一道环 8.3 → 138 vmin，第二道 7.2 → 106 vmin，最后都看不见', () => {
  const [r1, r2] = hitOnce().rings.map((r) => r.calls[0].frames);
  assert.equal(r1[0].width, '8.3vmin');
  assert.equal(r1.at(-1).width, '138vmin');
  assert.equal(r2[0].width, '7.2vmin');
  assert.equal(r2[0].opacity, 0.8);
  assert.equal(r2.at(-1).width, '106vmin');
  for (const f of [r1, r2]) assert.equal(f.at(-1).opacity, 0);
});

test('停表爆裂: 两道环与放射线都落在数字中心', () => {
  const p = hitOnce({ digitsRect: DIGITS, stageRect: SCREEN });
  for (const el of [...p.rings, p.lines]) {
    assert.equal(el.style.left, '320px');
    assert.equal(el.style.top, '80px');
  }
});

test('停表爆裂: 整屏正在抖（数字与 #stage 一起平移）时，位置不变', () => {
  const p = hitOnce({
    digitsRect: { left: 113, top: 34, width: 400, height: 100 },
    stageRect: { left: -7, top: 4, width: 800, height: 360 },
  });
  for (const el of [...p.rings, p.lines]) {
    assert.equal(el.style.left, '320px');
    assert.equal(el.style.top, '80px');
  }
});

test('停表爆裂: 14 根放射线长短交替，都画在 viewBox 内', () => {
  assert.equal(BURST_LINES.length, 14);
  const len = ({ x1, y1, x2, y2 }) => Math.hypot(x2 - x1, y2 - y1);
  BURST_LINES.forEach((l, k) => {
    if (k % 2) assert.ok(Math.abs(len(l) - 20.8) < 0.1, `第 ${k} 根应当是短线`);
    else assert.ok(Math.abs(len(l) - 37.5) < 0.1, `第 ${k} 根应当是长线`);
    for (const v of Object.values(l)) assert.ok(Math.abs(v) <= 60);
  });
});

test('停表爆裂: 每段关键帧的进度逐个递增', () => {
  for (const c of allCalls(hitOnce())) {
    const offsets = c.frames.map((k) => k.offset).filter((o) => o !== undefined);
    for (let i = 1; i < offsets.length; i++) assert.ok(offsets[i] > offsets[i - 1]);
  }
});

test('停表爆裂: 浏览器不支持 element.animate 时什么都不做', () => {
  assert.doesNotThrow(() => stopHit({ digits: {}, rings: [{}, {}], lines: {}, stage: {}, camera: {} }));
});
