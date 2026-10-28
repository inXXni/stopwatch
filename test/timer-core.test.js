import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, State, Event, nextState, ghostOf, PkState, nextPkState } from '../timer-core.js';

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

test('幽灵层: 常规两位秒数垫 88.88', () => {
  assert.equal(ghostOf('12.34'), '88.88');
  assert.equal(ghostOf('60.00'), '88.88');
});

test('幽灵层: 一位秒数也垫两位，左边空出一个全暗的 8', () => {
  assert.equal(ghostOf('9.87'), '88.88');
  assert.equal(ghostOf('0.00'), '88.88');
});

test('幽灵层: 超过 99 秒时跟着加宽', () => {
  assert.equal(ghostOf('123.45'), '888.88');
});

test('幽灵层: 长度不短于读数，否则右对齐叠放时会露出来', () => {
  for (const text of ['0.00', '9.87', '12.34', '60.00', '123.45']) {
    assert.ok(ghostOf(text).length >= text.length, `"${text}" 的幽灵层太短`);
  }
});

test('PK 状态机: 空场拍击，上格开始', () => {
  assert.equal(nextPkState(PkState.WAIT_P1, Event.SLAP), PkState.RUN_P1);
});

test('PK 状态机: 上格计时中拍击进入锁定', () => {
  assert.equal(nextPkState(PkState.RUN_P1, Event.SLAP), PkState.LOCK_P1);
});

test('PK 状态机: 上格锁定期内拍击被忽略', () => {
  assert.equal(nextPkState(PkState.LOCK_P1, Event.SLAP), PkState.LOCK_P1);
});

test('PK 状态机: 上格锁定期满后等待下格', () => {
  assert.equal(nextPkState(PkState.LOCK_P1, Event.UNLOCK), PkState.WAIT_P2);
});

test('PK 状态机: 等待下格时拍击开始的是下格，不是重开上格', () => {
  const next = nextPkState(PkState.WAIT_P2, Event.SLAP);
  assert.equal(next, PkState.RUN_P2);
  assert.notEqual(next, PkState.RUN_P1);
});

test('PK 状态机: 下格计时中拍击进入锁定', () => {
  assert.equal(nextPkState(PkState.RUN_P2, Event.SLAP), PkState.LOCK_P2);
});

test('PK 状态机: 下格锁定期内拍击被忽略', () => {
  assert.equal(nextPkState(PkState.LOCK_P2, Event.SLAP), PkState.LOCK_P2);
});

test('PK 状态机: 下格锁定期满后进入结果态', () => {
  assert.equal(nextPkState(PkState.LOCK_P2, Event.UNLOCK), PkState.RESULT);
});

test('PK 状态机: 结果态拍击只清场，不直接开跑', () => {
  const next = nextPkState(PkState.RESULT, Event.SLAP);
  assert.equal(next, PkState.WAIT_P1);
  assert.notEqual(next, PkState.RUN_P1);
});

test('PK 状态机: 清场后再拍一下才开始新一轮', () => {
  let s = PkState.RESULT;
  s = nextPkState(s, Event.SLAP);
  assert.equal(s, PkState.WAIT_P1);
  s = nextPkState(s, Event.SLAP);
  assert.equal(s, PkState.RUN_P1);
});

test('PK 状态机: 非锁定状态收到 UNLOCK 时保持原状态', () => {
  for (const s of [PkState.WAIT_P1, PkState.RUN_P1, PkState.WAIT_P2, PkState.RUN_P2, PkState.RESULT]) {
    assert.equal(nextPkState(s, Event.UNLOCK), s);
  }
});

test('PK 状态机: 未知事件与未知状态原样返回', () => {
  assert.equal(nextPkState(PkState.RUN_P1, 'BOGUS'), PkState.RUN_P1);
  assert.equal(nextPkState('BOGUS', Event.SLAP), 'BOGUS');
});
