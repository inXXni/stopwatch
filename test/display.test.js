import test from 'node:test';
import assert from 'node:assert/strict';
import { spineDigitsWidth } from '../display.js';

// 数字取自手机横屏 800×360：格子宽 771、高 160，脊柱列加间距约 103
test('脊柱排法: 放得下时数字框与格子等高', () => {
  assert.equal(spineDigitsWidth({ slotWidth: 771, slotHeight: 160, aspect: 3, reserved: 103 }), 480);
});

test('脊柱排法: 放不下时取扣掉脊柱后剩下的宽度', () => {
  // 读数超过 99 秒，viewBox 变宽
  assert.equal(spineDigitsWidth({ slotWidth: 771, slotHeight: 160, aspect: 4.5, reserved: 103 }), 668);
});

test('脊柱排法: 格子比脊柱还窄时为 0，不会是负数', () => {
  assert.equal(spineDigitsWidth({ slotWidth: 80, slotHeight: 160, aspect: 3, reserved: 103 }), 0);
});

test('脊柱排法: 结果永不超过可用宽度', () => {
  for (const aspect of [1, 2, 3, 4, 5, 6]) {
    const w = spineDigitsWidth({ slotWidth: 771, slotHeight: 160, aspect, reserved: 103 });
    assert.ok(w <= 771 - 103, `宽高比 ${aspect} 得到 ${w}`);
  }
});
