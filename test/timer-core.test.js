import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime, State, Event, nextState, ghostOf,
  PkState, nextPkState, SlotState, pkSlotStates, slotStateOf, slapBeeps,
} from '../timer-core.js';

test('formatTime: 零值显示 00.00，所有位都点亮', () => {
  assert.equal(formatTime(0), '00.00');
});

test('formatTime: 不足一个百分秒的毫秒被截断', () => {
  assert.equal(formatTime(5), '00.00');
  assert.equal(formatTime(9), '00.00');
});

test('formatTime: 百分秒补零', () => {
  assert.equal(formatTime(10), '00.01');
  assert.equal(formatTime(1050), '01.05');
});

test('formatTime: 秒数始终补足两位，个位数成绩左边不会熄灭', () => {
  assert.equal(formatTime(1234), '01.23');
  assert.equal(formatTime(9870), '09.87');
  assert.equal(formatTime(12345), '12.34');
});

test('formatTime: 向下截断而非四舍五入', () => {
  assert.equal(formatTime(12999), '12.99');
  assert.equal(formatTime(999), '00.99');
});

test('formatTime: 一分钟边界', () => {
  assert.equal(formatTime(59999), '59.99');
  assert.equal(formatTime(60000), '60.00');
});

test('formatTime: 超过一分钟继续累加秒数，不切分钟格式', () => {
  assert.equal(formatTime(75210), '75.21');
  assert.equal(formatTime(123450), '123.45');
});

test('formatTime: 非法输入兜底为 00.00', () => {
  assert.equal(formatTime(-5), '00.00');
  assert.equal(formatTime(NaN), '00.00');
  assert.equal(formatTime(Infinity), '00.00');
  assert.equal(formatTime(undefined), '00.00');
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

test('状态机: 已停止时拍击只清零，不直接开跑', () => {
  const next = nextState(State.STOPPED, Event.SLAP);
  assert.equal(next, State.IDLE);
  assert.notEqual(next, State.RUNNING);
});

test('状态机: 三拍一轮，清零后再拍才开始新一轮', () => {
  let s = State.IDLE;
  s = nextState(s, Event.SLAP);   // 第一拍：开始
  assert.equal(s, State.RUNNING);
  s = nextState(s, Event.SLAP);   // 第二拍：停表
  assert.equal(s, State.LOCKED);
  s = nextState(s, Event.UNLOCK); // 锁定期满
  assert.equal(s, State.STOPPED);
  s = nextState(s, Event.SLAP);   // 第三拍：清零
  assert.equal(s, State.IDLE);
  s = nextState(s, Event.SLAP);   // 再拍：新一轮
  assert.equal(s, State.RUNNING);
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

test('幽灵层: 读数已补足两位秒，幽灵层与之等长', () => {
  assert.equal(ghostOf('09.87'), '88.88');
  assert.equal(ghostOf('00.00'), '88.88');
});

test('幽灵层: 超过 99 秒时跟着加宽', () => {
  assert.equal(ghostOf('123.45'), '888.88');
});

test('幽灵层: 长度不短于读数，否则右对齐叠放时会露出来', () => {
  for (const text of ['00.00', '09.87', '12.34', '60.00', '123.45']) {
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

test('PK 状态机: 锁定期以外收到 RESET 都回到等红方拍', () => {
  for (const s of [PkState.WAIT_P1, PkState.RUN_P1, PkState.WAIT_P2, PkState.RUN_P2, PkState.RESULT]) {
    assert.equal(nextPkState(s, Event.RESET), PkState.WAIT_P1, s);
  }
});

test('PK 状态机: 锁定期内收到 RESET 不变，挡住手掌弹起再落到 VS 上', () => {
  assert.equal(nextPkState(PkState.LOCK_P1, Event.RESET), PkState.LOCK_P1);
  assert.equal(nextPkState(PkState.LOCK_P2, Event.RESET), PkState.LOCK_P2);
});

test('状态机: 普通模式不认 RESET', () => {
  for (const s of Object.values(State)) {
    assert.equal(nextState(s, Event.RESET), s, s);
  }
});

test('PK 状态机: 未知事件与未知状态原样返回', () => {
  assert.equal(nextPkState(PkState.RUN_P1, 'BOGUS'), PkState.RUN_P1);
  assert.equal(nextPkState('BOGUS', Event.SLAP), 'BOGUS');
});

test('槽位映射: 普通模式三种状态', () => {
  assert.equal(slotStateOf(State.IDLE), SlotState.EMPTY);
  assert.equal(slotStateOf(State.RUNNING), SlotState.RUNNING);
  assert.equal(slotStateOf(State.LOCKED), SlotState.DONE);
  assert.equal(slotStateOf(State.STOPPED), SlotState.DONE);
});

test('槽位映射: 普通模式不会出现「轮到这一格」', () => {
  for (const s of Object.values(State)) {
    assert.notEqual(slotStateOf(s), SlotState.NEXT, `${s} 映射成了 next`);
  }
});

test('槽位映射: PK 空场时轮到上格，下格空', () => {
  assert.deepEqual(pkSlotStates(PkState.WAIT_P1), [SlotState.NEXT, SlotState.EMPTY]);
});

test('槽位映射: 上格计时中，下格仍空', () => {
  assert.deepEqual(pkSlotStates(PkState.RUN_P1), [SlotState.RUNNING, SlotState.EMPTY]);
});

test('槽位映射: 上格锁定期内下格仍空，不提前提示下格', () => {
  // 锁定期内拍击无效，这时提示下格「该你了」会误导
  assert.deepEqual(pkSlotStates(PkState.LOCK_P1), [SlotState.DONE, SlotState.EMPTY]);
});

test('槽位映射: 上格锁定期满后轮到下格', () => {
  assert.deepEqual(pkSlotStates(PkState.WAIT_P2), [SlotState.DONE, SlotState.NEXT]);
});

test('槽位映射: 下格计时期间上格保持定格', () => {
  assert.deepEqual(pkSlotStates(PkState.RUN_P2), [SlotState.DONE, SlotState.RUNNING]);
});

test('槽位映射: 结果态两格皆定格', () => {
  assert.deepEqual(pkSlotStates(PkState.LOCK_P2), [SlotState.DONE, SlotState.DONE]);
  assert.deepEqual(pkSlotStates(PkState.RESULT), [SlotState.DONE, SlotState.DONE]);
});

test('槽位映射: PK 全部状态都返回两格', () => {
  for (const s of Object.values(PkState)) {
    const cells = pkSlotStates(s);
    assert.equal(cells.length, 2, `${s} 没有返回两格`);
    for (const c of cells) {
      assert.ok(Object.values(SlotState).includes(c), `${s} 返回了非法槽位状态 ${c}`);
    }
  }
});

test('提示音: 开始、停表、锁定期内被吞掉的拍都响', () => {
  for (const s of [State.IDLE, State.RUNNING, State.LOCKED]) {
    assert.equal(slapBeeps(s), true, `普通模式 ${s} 时拍一下应该响`);
  }
  for (const s of [PkState.WAIT_P1, PkState.RUN_P1, PkState.LOCK_P1, PkState.WAIT_P2, PkState.RUN_P2, PkState.LOCK_P2]) {
    assert.equal(slapBeeps(s), true, `PK 模式 ${s} 时拍一下应该响`);
  }
});

test('提示音: 清屏那一拍不响', () => {
  assert.equal(slapBeeps(State.STOPPED), false, '普通模式成绩出来后那一拍是清零');
  assert.equal(slapBeeps(PkState.RESULT), false, 'PK 模式两人都停后那一拍是清场');
});
