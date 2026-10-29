import test from 'node:test';
import assert from 'node:assert/strict';
import { stopHit, HIT_MS, RING_MS } from '../hit.js';

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
function hitOnce({ digitsRect, stageRect } = {}) {
  const parts = { digits: fakeEl(digitsRect), ring: fakeEl(), stage: fakeEl(stageRect) };
  stopHit(parts);
  return parts;
}

test('停表冲击: 整屏与数字各播一段 380 ms，冲击环播 500 ms', () => {
  assert.equal(HIT_MS, 380);
  assert.equal(RING_MS, 500);
  const { stage, digits, ring } = hitOnce();
  for (const [name, el, ms] of [['stage', stage, HIT_MS], ['digits', digits, HIT_MS], ['ring', ring, RING_MS]]) {
    assert.equal(el.calls.length, 1, `${name} 应当播一段动画`);
    assert.equal(el.calls[0].options.duration, ms);
  }
});

test('停表冲击: 整屏立刻开抖，第一下就是最大位移，最后回到原位', () => {
  const f = hitOnce().stage.calls[0].frames;
  assert.equal(f[0].transform, 'translate(0, 0)');
  assert.equal(f[1].transform, 'translate(-3.04vmin, 1.76vmin)');
  assert.equal(f[1].offset, 0.14);
  assert.equal(f.at(-1).transform, 'translate(0, 0)');
});

test('停表冲击: 数字弹到 1.112 倍再落回原样，整段 ease-out', () => {
  const { frames, options } = hitOnce().digits.calls[0];
  assert.equal(frames[0].transform, 'scale(1)');
  assert.equal(frames.find((k) => k.offset === 0.18).transform, 'scale(1.112)');
  assert.equal(frames.at(-1).transform, 'scale(1)');
  assert.equal(options.easing, 'ease-out');
});

test('停表冲击: 冲击环从 8.3 vmin 扩散到 138 vmin，最后看不见', () => {
  const { frames, options } = hitOnce().ring.calls[0];
  assert.equal(frames[0].width, '8.3vmin');
  assert.equal(frames[0].opacity, 0.9);
  assert.equal(frames.at(-1).width, '138vmin');
  assert.equal(frames.at(-1).opacity, 0);
  assert.equal(options.easing, 'ease-out');
});

test('停表冲击: 冲击环的圆心落在数字中心', () => {
  const { ring } = hitOnce({
    digitsRect: { left: 120, top: 30, width: 400, height: 100 },
    stageRect: { left: 0, top: 0, width: 800, height: 360 },
  });
  assert.equal(ring.style.left, '320px');
  assert.equal(ring.style.top, '80px');
});

test('停表冲击: 整屏正在抖（两个矩形一起平移）时，圆心位置不变', () => {
  const { ring } = hitOnce({
    digitsRect: { left: 113, top: 34, width: 400, height: 100 },
    stageRect: { left: -7, top: 4, width: 800, height: 360 },
  });
  assert.equal(ring.style.left, '320px');
  assert.equal(ring.style.top, '80px');
});

test('停表冲击: 每段关键帧的进度逐个递增', () => {
  for (const [name, el] of Object.entries(hitOnce())) {
    const offsets = el.calls[0].frames.map((k) => k.offset).filter((o) => o !== undefined);
    for (let i = 1; i < offsets.length; i++) {
      assert.ok(offsets[i] > offsets[i - 1], `${name} 的第 ${i} 个进度没有递增`);
    }
  }
});

test('停表冲击: 浏览器不支持 element.animate 时什么都不做', () => {
  assert.doesNotThrow(() => stopHit({ digits: {}, ring: {}, stage: {} }));
});
