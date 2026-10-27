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
 * 七段数码管的段命名，与实物一致：
 *
 *    aaa
 *   f   b
 *   f   b
 *    ggg
 *   e   c
 *   e   c
 *    ddd
 *
 * 空格代表整位熄灭（只剩暗色的幽灵段），用于秒数不足两位时占位。
 */
export const SEGMENTS = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  ' ': '',
};

/**
 * 把 formatTime 的输出拆成逐位的显示单元，例如 "12.34" -> ['1','2','.','3','4']。
 * 秒数不足两位时前面补一个熄灭位（"9.87" -> [' ','9','.','8','7']），
 * 这样常规成绩的布局始终是固定的四位数字，数字不会因为位数变化而整体缩放跳动。
 */
export function toDisplayCells(text) {
  const [intPart, fracPart] = String(text).split('.');
  return [...intPart.padStart(2, ' '), '.', ...fracPart];
}
