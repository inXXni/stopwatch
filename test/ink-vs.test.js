import test from 'node:test';
import assert from 'node:assert/strict';
import { STROKES, DOTS, WRITE_MS, writeIn } from '../ink-vs.js';

// 假元素：只记下 animate 收到的关键帧与参数
function fakeEl() {
  const calls = [];
  return { calls, animate(frames, options) { calls.push({ frames, options }); return {}; } };
}
function writeOnce() {
  const parts = {
    svg: fakeEl(),
    lines: STROKES.map((_, i) => ({ line: fakeEl(), from: 100 + i })),
    dots: DOTS.map(() => fakeEl()),
  };
  writeIn(parts);
  return parts;
}

test('写出来: 全程 620 ms，三笔、11 个墨点', () => {
  assert.equal(WRITE_MS, 620);
  assert.equal(STROKES.length, 3);
  assert.equal(DOTS.length, 11);
});

test('写出来: 三笔按 V 左笔、V 右笔、S 的时间表展开，开始前不露', () => {
  const want = [
    [0, 115, 'cubic-bezier(.55, 0, .85, 1)'],
    [125, 85, 'cubic-bezier(.4, 0, .8, 1)'],
    [220, 200, 'cubic-bezier(.35, .1, .6, 1)'],
  ];
  writeOnce().lines.forEach(({ line }, i) => {
    assert.equal(line.calls.length, 1);
    const { frames, options } = line.calls[0];
    assert.deepEqual(frames, [{ strokeDashoffset: `${100 + i}px` }, { strokeDashoffset: '0px' }]);
    const [delay, duration, easing] = want[i];
    assert.deepEqual(options, { delay, duration, easing, fill: 'backwards' });
  });
});

test('写出来: 墨点在所属那一笔写到的位置弹出', () => {
  const want = [5.75, 11.5, 11.5, 17.25, 210, 210, 220, 220, 220, 420, 420];
  writeOnce().dots.forEach((dot, i) => {
    assert.equal(dot.calls.length, 1);
    const { frames, options } = dot.calls[0];
    assert.ok(Math.abs(options.delay - want[i]) < 1e-9, `第 ${i} 个墨点 delay=${options.delay}`);
    assert.equal(options.duration, 140);
    assert.equal(options.easing, 'ease-out');
    assert.equal(options.fill, 'backwards');
    assert.deepEqual(frames.map((f) => f.transform), ['scale(0)', 'scale(1.5)', 'scale(1)']);
    assert.equal(frames[1].offset, 0.6);
  });
});

test('写出来: 写完整个字顿一下，结束后回到静止样式', () => {
  const { calls } = writeOnce().svg;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].frames.map((f) => f.transform), ['scale(1)', 'scale(1.07)', 'scale(1)']);
  assert.equal(calls[0].frames[1].offset, 0.35);
  assert.deepEqual(calls[0].options, { delay: 420, duration: 200, easing: 'ease-out' });
  assert.equal(calls[0].options.delay + calls[0].options.duration, WRITE_MS);
});

test('写出来: 浏览器不支持 element.animate 时什么都不做', () => {
  assert.doesNotThrow(() => writeIn({
    svg: {}, lines: STROKES.map(() => ({ line: {}, from: 1 })), dots: DOTS.map(() => ({})),
  }));
});
