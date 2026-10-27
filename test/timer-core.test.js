import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, State, Event, nextState, SEGMENTS, toDisplayCells } from '../timer-core.js';

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

test('状态机: 空闲时拍击开始计时', () => {
  assert.equal(nextState(State.IDLE, Event.SLAP), State.RUNNING);
});

test('状态机: 计时中拍击进入锁定', () => {
  assert.equal(nextState(State.RUNNING, Event.SLAP), State.LOCKED);
});

test('状态机: 锁定期内的拍击被忽略', () => {
  assert.equal(nextState(State.LOCKED, Event.SLAP), State.LOCKED);
});

test('状态机: 锁定期结束后进入已停止', () => {
  assert.equal(nextState(State.LOCKED, Event.UNLOCK), State.STOPPED);
});

test('状态机: 已停止时拍击开始新一轮', () => {
  assert.equal(nextState(State.STOPPED, Event.SLAP), State.RUNNING);
});

test('状态机: 非锁定状态收到 UNLOCK 时保持原状态', () => {
  assert.equal(nextState(State.IDLE, Event.UNLOCK), State.IDLE);
  assert.equal(nextState(State.RUNNING, Event.UNLOCK), State.RUNNING);
  assert.equal(nextState(State.STOPPED, Event.UNLOCK), State.STOPPED);
});

test('状态机: 未知事件不改变状态', () => {
  assert.equal(nextState(State.RUNNING, 'BOGUS'), State.RUNNING);
});

test('状态机: 未知状态原样返回', () => {
  assert.equal(nextState('BOGUS', Event.SLAP), 'BOGUS');
});

test('七段映射: 每个数字点亮的段数正确', () => {
  const 段数 = (ch) => SEGMENTS[ch].length;
  assert.equal(段数('0'), 6);
  assert.equal(段数('1'), 2);
  assert.equal(段数('7'), 3);
  assert.equal(段数('8'), 7);
  assert.equal(段数(' '), 0);
});

test('七段映射: 0-9 与空位全部有定义', () => {
  for (const ch of '0123456789 ') {
    assert.equal(typeof SEGMENTS[ch], 'string', `字符 "${ch}" 缺少段定义`);
  }
});

test('七段映射: 只使用 a-g 七个段名', () => {
  for (const [ch, segs] of Object.entries(SEGMENTS)) {
    assert.match(segs, /^[a-g]*$/, `字符 "${ch}" 含有非法段名`);
    assert.equal(new Set(segs).size, segs.length, `字符 "${ch}" 有重复段`);
  }
});

test('显示位拆分: 两位秒数原样拆开', () => {
  assert.deepEqual(toDisplayCells('12.34'), ['1', '2', '.', '3', '4']);
});

test('显示位拆分: 一位秒数前面补熄灭位，布局不跳动', () => {
  assert.deepEqual(toDisplayCells('9.87'), [' ', '9', '.', '8', '7']);
  assert.deepEqual(toDisplayCells('0.00'), [' ', '0', '.', '0', '0']);
});

test('显示位拆分: 超过 99 秒时扩展位数', () => {
  assert.deepEqual(toDisplayCells('123.45'), ['1', '2', '3', '.', '4', '5']);
});

test('显示位拆分: 拆出的每一位都能在七段表里查到', () => {
  for (const text of ['0.00', '9.87', '12.34', '60.00', '123.45']) {
    for (const cell of toDisplayCells(text)) {
      if (cell === '.') continue;
      assert.ok(SEGMENTS[cell] !== undefined, `"${text}" 拆出的 "${cell}" 没有段定义`);
    }
  }
});
