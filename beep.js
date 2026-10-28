/**
 * 拍击提示音：每拍一下响一声「滴——」，复刻实体计时器压电蜂鸣片的声音。
 * 用 Web Audio 实时合成，不带音频文件，离线照样能响。
 * 参数来源见 docs/superpowers/specs/2026-10-28-slap-beep-design.md 第 2 节。
 */

export const BEEP_FREQ = 2461; // Hz，原声实测
export const BEEP_GAIN = 0.5; // 峰值增益，真机上听过再定

// 波形各分量的幅度（正弦项系数）：下标 1 是基频，2、3 是二次、三次谐波，
// 即比基频低 16.5 dB 与 27.7 dB。下标 0 是直流分量，不用。
const HARMONICS = [0, 1, 0.15, 0.041];

// 被下一拍打断时上一声的淡出时长。直接掐断会有「咔」的爆音
const CUT_FADE = 0.005;

/**
 * 一声提示音的音量包络：从 t 开始的 [时刻, 增益] 列表，按时间先后排列，相邻两点之间线性过渡。
 * 约 40 ms 响到六成，之后渐强到峰值，0.375 s 起 25 ms 收掉，整声 0.4 s。
 */
export function beepEnvelope(t, gain) {
  return [
    [t, 0],
    [t + 0.04, 0.6 * gain],
    [t + 0.34, gain],
    [t + 0.375, gain],
    [t + 0.4, 0],
  ];
}

/**
 * 返回 { beep() }。beep() 立即返回，声音交给浏览器的音频线程去播。
 * AudioContextClass 可注入，便于在 Node 里用假的音频环境测试。
 */
export function createBeeper({
  gain = BEEP_GAIN,
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
} = {}) {
  let ctx = null;
  let wave = null;
  let current = null; // 正在响的那一声：{ osc, amp }

  // 一拍一声：上一声没响完就淡出停掉，不叠在一起
  function cutCurrent(t) {
    if (!current) return;
    const { osc, amp } = current;
    current = null;
    try {
      amp.gain.cancelScheduledValues(t);
      amp.gain.setValueAtTime(amp.gain.value, t);
      amp.gain.linearRampToValueAtTime(0, t + CUT_FADE);
      osc.stop(t + CUT_FADE);
    } catch {
      // 上一声已经自然结束，不用管
    }
  }

  function beep() {
    try {
      if (!AudioContextClass) return;
      // 浏览器只允许在用户操作中启动音频。第一次发声发生在第一拍里，本身就是用户操作
      if (!ctx) ctx = new AudioContextClass();
      // 切到别的应用再回来时，音频环境可能被系统挂起
      if (ctx.state !== 'running') Promise.resolve(ctx.resume()).catch(() => {});
      if (!wave) {
        wave = ctx.createPeriodicWave(new Float32Array(HARMONICS.length), new Float32Array(HARMONICS));
      }

      const t = ctx.currentTime;
      cutCurrent(t);

      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.setPeriodicWave(wave);
      osc.frequency.value = BEEP_FREQ;
      const [[t0, v0], ...rest] = beepEnvelope(t, gain);
      amp.gain.setValueAtTime(v0, t0);
      for (const [time, value] of rest) amp.gain.linearRampToValueAtTime(value, time);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(rest.at(-1)[0]);

      const self = { osc, amp };
      current = self;
      osc.onended = () => { if (current === self) current = null; };
    } catch {
      // 提示音只是辅助，任何音频错误都不能影响计时
    }
  }

  return { beep };
}
