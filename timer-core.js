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
