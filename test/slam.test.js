import test from 'node:test';
import assert from 'node:assert/strict';
import { slamIn, SLAM_MS } from '../slam.js';

// 假元素：只记下 animate 收到的关键帧与参数
function fakeEl() {
  const calls = [];
  return { calls, animate(frames, options) { calls.push({ frames, options }); return {}; } };
}
function slamOnce() {
  const parts = { text: fakeEl(), ring: fakeEl(), stage: fakeEl() };
  slamIn(parts);
  return parts;
}
const HIT = 0.42; // 撞击时刻

test('砸入: 文字、冲击环、整屏各播一段 560 ms 的动画', () => {
  assert.equal(SLAM_MS, 560);
  const parts = slamOnce();
  for (const [name, el] of Object.entries(parts)) {
    assert.equal(el.calls.length, 1, `${name} 应当播一段动画`);
    assert.equal(el.calls[0].options.duration, SLAM_MS);
  }
});

test('砸入: 文字从 3.4 倍、透明开始，撞击时落到 0.8 倍，最后回到原样', () => {
  const f = slamOnce().text.calls[0].frames;
  assert.equal(f[0].transform, 'scale(3.4) rotate(-12deg)');
  assert.equal(f[0].opacity, 0);
  const hit = f.find((k) => k.offset === HIT);
  assert.equal(hit.transform, 'scale(0.8) rotate(3deg)');
  assert.equal(hit.opacity, 1);
  assert.equal(f.at(-1).transform, 'scale(1) rotate(0deg)');
  assert.equal(f.at(-1).opacity, 1);
});

test('砸入: 冲击环撞击时最亮，开始与结束时看不见', () => {
  const f = slamOnce().ring.calls[0].frames;
  assert.equal(f[0].opacity, 0);
  assert.equal(f.find((k) => k.offset === HIT).opacity, 1);
  assert.equal(f.at(-1).opacity, 0);
  assert.equal(f.at(-1).width, '106vmin');
});

test('砸入: 整屏在撞击前不动，最后回到原位', () => {
  const f = slamOnce().stage.calls[0].frames;
  assert.equal(f[0].transform, 'translate(0, 0)');
  assert.equal(f.find((k) => k.offset === HIT).transform, 'translate(0, 0)');
  assert.equal(f.at(-1).transform, 'translate(0, 0)');
});

test('砸入: 每段关键帧的进度逐个递增', () => {
  for (const [name, el] of Object.entries(slamOnce())) {
    const offsets = el.calls[0].frames.map((k) => k.offset).filter((o) => o !== undefined);
    for (let i = 1; i < offsets.length; i++) {
      assert.ok(offsets[i] > offsets[i - 1], `${name} 的第 ${i} 个进度没有递增`);
    }
  }
});

test('砸入: 浏览器不支持 element.animate 时什么都不做', () => {
  assert.doesNotThrow(() => slamIn({ text: {}, ring: {}, stage: {} }));
});
