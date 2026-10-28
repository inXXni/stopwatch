/**
 * 把经过的毫秒数转成显示字符串，例如 12345 -> "12.34"。
 * 按 WCA 惯例向下截断到百分位，不四舍五入：12.999 秒还没到 13 秒，显示 12.99。
 * 不足一分钟不显示分钟；超过一分钟秒数继续累加（75.21），这是兜底而非常规路径。
 */
export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalCentis = Math.floor(ms / 10);
  const seconds = Math.floor(totalCentis / 100);
  const centis = totalCentis % 100;
  return `${seconds}.${String(centis).padStart(2, '0')}`;
}

export const State = {
  IDLE: 'IDLE',       // 未开始，显示 0.00
  RUNNING: 'RUNNING', // 计时中
  LOCKED: 'LOCKED',   // 刚停表，吞掉一切输入，防手掌反弹和多指造成的二次触发
  STOPPED: 'STOPPED', // 显示成绩，等待下一轮
};

export const Event = {
  SLAP: 'SLAP',     // 拍击
  UNLOCK: 'UNLOCK', // 锁定期结束
};

/**
 * 纯函数形式的状态转移。不做任何副作用，时间戳记录由调用方负责。
 */
export function nextState(state, event) {
  if (event === Event.SLAP) {
    switch (state) {
      case State.IDLE:
      case State.STOPPED:
        return State.RUNNING;
      case State.RUNNING:
        return State.LOCKED;
      case State.LOCKED:
        return State.LOCKED;
      default:
        return state;
    }
  }
  if (event === Event.UNLOCK) {
    return state === State.LOCKED ? State.STOPPED : state;
  }
  return state;
}

/**
 * 生成幽灵层的文本：每一位都换成 8（七段全亮），整数部分至少两位。
 *
 * 幽灵层以暗色垫在读数下面，模拟 LED 显示屏上没通电的段——这是 LED 牌最有
 * 辨识度的细节。两层右对齐叠放，所以读数不足两位秒时，左边会自然空出一个
 * 全暗的 8，布局也因此始终固定，数字不会因为位数变化而整体缩放跳动。
 */
export function ghostOf(text) {
  const [intPart, fracPart] = String(text).split('.');
  return '8'.repeat(Math.max(2, intPart.length)) + '.' + '8'.repeat(fracPart.length);
}

/**
 * PK 模式的状态机。不复用普通模式的四状态机：两者在「停表后再拍一下」
 * 这个转移上语义不同——普通模式是清零重开，PK 模式是换人或清场。
 *
 * WAIT_P1 → RUN_P1 → LOCK_P1 → WAIT_P2 → RUN_P2 → LOCK_P2 → RESULT → WAIT_P1
 *
 * 两个 LOCK 状态各自在 500ms 后由 UNLOCK 事件推进，用途与普通模式一致：
 * 挡掉手掌反弹与多指造成的二次触发。
 */
export const PkState = {
  WAIT_P1: 'WAIT_P1', // 两格皆空，等上格开始
  RUN_P1: 'RUN_P1',   // 上格计时中
  LOCK_P1: 'LOCK_P1', // 上格刚停，吞掉一切输入
  WAIT_P2: 'WAIT_P2', // 上格定格，等下格开始
  RUN_P2: 'RUN_P2',   // 下格计时中
  LOCK_P2: 'LOCK_P2', // 下格刚停，吞掉一切输入
  RESULT: 'RESULT',   // 两格皆定格，等清场
};

export function nextPkState(state, event) {
  if (event === Event.SLAP) {
    switch (state) {
      case PkState.WAIT_P1: return PkState.RUN_P1;
      case PkState.RUN_P1: return PkState.LOCK_P1;
      case PkState.LOCK_P1: return PkState.LOCK_P1;
      case PkState.WAIT_P2: return PkState.RUN_P2;
      case PkState.RUN_P2: return PkState.LOCK_P2;
      case PkState.LOCK_P2: return PkState.LOCK_P2;
      // 只清场，不开跑：现场刚宣布完胜负，一拍就重来会把没记录的成绩抹掉
      case PkState.RESULT: return PkState.WAIT_P1;
      default: return state;
    }
  }
  if (event === Event.UNLOCK) {
    if (state === PkState.LOCK_P1) return PkState.WAIT_P2;
    if (state === PkState.LOCK_P2) return PkState.RESULT;
    return state;
  }
  return state;
}

/**
 * 每一格的视觉状态。两种模式都归一到这三个值，CSS 只认它们，
 * 着色规则因此只需写一套。
 */
export const SlotState = {
  EMPTY: 'empty',     // 尚未轮到，只显示暗色幽灵层
  RUNNING: 'running', // 计时中
  DONE: 'done',       // 已定格
};

/** 普通模式：只有一格，锁定与停止在视觉上都是「已定格」。 */
export function slotStateOf(state) {
  if (state === State.RUNNING) return SlotState.RUNNING;
  if (state === State.LOCKED || state === State.STOPPED) return SlotState.DONE;
  return SlotState.EMPTY;
}

/** PK 模式：返回 [上格, 下格]。 */
export function pkSlotStates(state) {
  switch (state) {
    case PkState.RUN_P1:
      return [SlotState.RUNNING, SlotState.EMPTY];
    case PkState.LOCK_P1:
    case PkState.WAIT_P2:
      return [SlotState.DONE, SlotState.EMPTY];
    case PkState.RUN_P2:
      return [SlotState.DONE, SlotState.RUNNING];
    case PkState.LOCK_P2:
    case PkState.RESULT:
      return [SlotState.DONE, SlotState.DONE];
    default:
      return [SlotState.EMPTY, SlotState.EMPTY];
  }
}
