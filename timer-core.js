/**
 * 把经过的毫秒数转成显示字符串，例如 12345 -> "12.34"。
 * 按 WCA 惯例向下截断到百分位，不四舍五入：12.999 秒还没到 13 秒，显示 12.99。
 * 不足一分钟不显示分钟；超过一分钟秒数继续累加（75.21），这是兜底而非常规路径。
 *
 * 秒数始终补足两位（0 -> "00.00"，9.87 -> "09.87"），四位数字全程点亮。
 * 不补零的话，待机的 "00.00" 一开始计时就会变成 "0.01"，最左那位突然熄灭。
 */
export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalCentis = Math.floor(ms / 10);
  const seconds = Math.floor(totalCentis / 100);
  const centis = totalCentis % 100;
  return `${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export const State = {
  IDLE: 'IDLE',       // 未开始，显示 00.00
  RUNNING: 'RUNNING', // 计时中
  LOCKED: 'LOCKED',   // 刚停表，吞掉一切输入，防手掌反弹和多指造成的二次触发
  STOPPED: 'STOPPED', // 显示成绩，等待清零
};

export const Event = {
  SLAP: 'SLAP',     // 拍击
  UNLOCK: 'UNLOCK', // 锁定期结束
  RESET: 'RESET',   // 点 VS 清零，只有 PK 模式认
};

/**
 * 纯函数形式的状态转移。不做任何副作用，时间戳记录由调用方负责。
 *
 * 三拍一轮：IDLE → RUNNING → LOCKED → STOPPED → IDLE。
 * 停表后那一拍只清零、不开跑，成绩出来后手快多拍一下不会直接把成绩抹掉。
 */
export function nextState(state, event) {
  if (event === Event.SLAP) {
    switch (state) {
      case State.IDLE:
        return State.RUNNING;
      case State.RUNNING:
        return State.LOCKED;
      case State.LOCKED:
        return State.LOCKED;
      case State.STOPPED:
        return State.IDLE;
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
 * 辨识度的细节。两层右对齐叠放；读数已补足两位秒，所以两层通常等长，
 * 超过 99 秒时幽灵层跟着加宽，布局始终由幽灵层决定，数字不会整体缩放跳动。
 */
export function ghostOf(text) {
  const [intPart, fracPart] = String(text).split('.');
  return '8'.repeat(Math.max(2, intPart.length)) + '.' + '8'.repeat(fracPart.length);
}

/**
 * PK 模式的状态机。不复用普通模式的四状态机：两者在「停表后再拍一下」
 * 这个转移上语义不同——普通模式总是清零，PK 模式第一次停表后是换下一个人。
 *
 * WAIT_P1 → RUN_P1 → LOCK_P1 → WAIT_P2 → RUN_P2 → LOCK_P2 → RESULT → WAIT_P1
 *
 * 两个 LOCK 状态各自在 500ms 后由 UNLOCK 事件推进，用途与普通模式一致：
 * 挡掉手掌反弹与多指造成的二次触发。
 *
 * RESET 是点 VS 清零：锁定期以外，不管在哪一步都回到 WAIT_P1。
 * 锁定期照样挡住，停表那一拍的手掌弹起再落到 VS 上，不能把刚停下的成绩清掉。
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
  if (event === Event.RESET) {
    return state === PkState.LOCK_P1 || state === PkState.LOCK_P2 ? state : PkState.WAIT_P1;
  }
  return state;
}

/**
 * 每一格的视觉状态。两种模式都归一到这几个值，CSS 只认它们，
 * 着色规则因此只需写一套。NEXT 只在 PK 模式出现，用来让色条提示轮到谁。
 */
export const SlotState = {
  EMPTY: 'empty',     // 尚未轮到，显示 00.00
  NEXT: 'next',       // 轮到这一格，下一拍就从这里开始计时
  RUNNING: 'running', // 计时中
  DONE: 'done',       // 已定格
};

/** 普通模式：只有一格，锁定与停止在视觉上都是「已定格」。 */
export function slotStateOf(state) {
  if (state === State.RUNNING) return SlotState.RUNNING;
  if (state === State.LOCKED || state === State.STOPPED) return SlotState.DONE;
  return SlotState.EMPTY;
}

/**
 * PK 模式：返回 [上格, 下格]。
 * 锁定期内拍击无效，所以 LOCK_P1 时下格还是 EMPTY，锁定结束进入 WAIT_P2 才轮到它。
 */
export function pkSlotStates(state) {
  switch (state) {
    case PkState.WAIT_P1:
      return [SlotState.NEXT, SlotState.EMPTY];
    case PkState.RUN_P1:
      return [SlotState.RUNNING, SlotState.EMPTY];
    case PkState.LOCK_P1:
      return [SlotState.DONE, SlotState.EMPTY];
    case PkState.WAIT_P2:
      return [SlotState.DONE, SlotState.NEXT];
    case PkState.RUN_P2:
      return [SlotState.DONE, SlotState.RUNNING];
    case PkState.LOCK_P2:
    case PkState.RESULT:
      return [SlotState.DONE, SlotState.DONE];
    default:
      return [SlotState.EMPTY, SlotState.EMPTY];
  }
}

/**
 * 这一拍要不要响提示音，传入拍击之前的状态。普通模式与 PK 模式的状态名互不重复，共用一个函数。
 *
 * 每拍都响，包括锁定期内被吞掉的拍——响声表示设备收到了这一拍。
 * 只有清屏那一拍不响：普通模式成绩出来后的清零、PK 模式两人都停后的清场。
 */
export function slapBeeps(state) {
  return state !== State.STOPPED && state !== PkState.RESULT;
}
