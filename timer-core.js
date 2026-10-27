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
