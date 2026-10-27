import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime } from '../timer-core.js';

test('formatTime: 零值显示 0.00', () => {
  assert.equal(formatTime(0), '0.00');
});

test('formatTime: 不足一个百分秒的毫秒被截断', () => {
  assert.equal(formatTime(5), '0.00');
  assert.equal(formatTime(9), '0.00');
});

test('formatTime: 百分秒补零', () => {
  assert.equal(formatTime(10), '0.01');
  assert.equal(formatTime(1050), '1.05');
});

test('formatTime: 常规成绩', () => {
  assert.equal(formatTime(1234), '1.23');
  assert.equal(formatTime(12345), '12.34');
  assert.equal(formatTime(9870), '9.87');
});

test('formatTime: 向下截断而非四舍五入', () => {
  assert.equal(formatTime(12999), '12.99');
  assert.equal(formatTime(999), '0.99');
});

test('formatTime: 一分钟边界', () => {
  assert.equal(formatTime(59999), '59.99');
  assert.equal(formatTime(60000), '60.00');
});

test('formatTime: 超过一分钟继续累加秒数，不切分钟格式', () => {
  assert.equal(formatTime(75210), '75.21');
  assert.equal(formatTime(123450), '123.45');
});

test('formatTime: 非法输入兜底为 0.00', () => {
  assert.equal(formatTime(-5), '0.00');
  assert.equal(formatTime(NaN), '0.00');
  assert.equal(formatTime(Infinity), '0.00');
  assert.equal(formatTime(undefined), '0.00');
});
