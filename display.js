import { formatTime, ghostOf } from './timer-core.js';

/**
 * 把一个 <svg> 包装成独立的显示单元。
 *
 * 两层文字右对齐叠放：幽灵层固定是全 8（七段全亮）显示为暗色，读数层盖在上面。
 * 读数不足两位秒时左边自然露出一个全暗的 8，正是 LED 牌没通电那一位的样子。
 *
 * onFit：每次重新设定 viewBox 之后调用，数字的渲染尺寸此时可能变了。
 */
export function createDisplay(svg, { onFit } = {}) {
  const ghost = svg.querySelector('.ghost');
  const value = svg.querySelector('.value');

  let lastText = null;
  let lastGhost = null;

  // 字号写死在 CSS 里只是个基准值，真实大小由 viewBox 决定。
  // 这里按幽灵层量出来的实际墨水范围设 viewBox，SVG 自己等比缩放填满容器，
  // 不用手算 vw/vh，各种屏幕比例都能占满。
  function fit() {
    let box;
    try {
      box = ghost.getBBox();
    } catch {
      return; // 元素不可见时部分浏览器会抛错（普通模式下第二格是 display:none）
    }
    if (!box.width) return; // 字体还没加载完，量不出东西
    const pad = box.height * 0.06;
    svg.setAttribute(
      'viewBox',
      `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`
    );
    onFit?.();
  }

  function render(text) {
    if (text === lastText) return;
    lastText = text;
    svg.dataset.value = text; // 挂一份明文，方便测试和调试读取
    value.textContent = text;

    const g = ghostOf(text);
    if (g !== lastGhost) { // 只有位数变了才需要重新量
      lastGhost = g;
      ghost.textContent = g;
      fit();
    }
  }

  render(formatTime(0));

  return { render, fit };
}
