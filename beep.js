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

// 停表那一拍的低音「咚」，参数见 docs/superpowers/specs/2026-10-29-stop-burst-design.md 第 4 节。
// 手机喇叭放不出真正的低音，所以从中频往下滑，小喇叭也听得出分量
export const THUMP_FROM = 300; // Hz
export const THUMP_TO = 70; // Hz
const THUMP_SWEEP = 0.14; // 音高滑下去用的时间，s
const THUMP_GAIN = 0.7;
const THUMP_LENGTH = 0.32; // s
// 敲击声：一小段快速衰减的白噪声，经低通去掉刺耳的高频
const CLICK_LENGTH = 0.03; // s
const CLICK_LOWPASS = 2500; // Hz
const CLICK_GAIN = 0.5;

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
 * 返回 { beep(), thump() }。两者都立即返回，声音交给浏览器的音频线程去播。
 * AudioContextClass 可注入，便于在 Node 里用假的音频环境测试。
 */
export function createBeeper({
  gain = BEEP_GAIN,
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
} = {}) {
  let ctx = null;
  let wave = null;
  let current = null; // 正在响的那一声：{ osc, amp }

  // 浏览器只允许在用户操作中启动音频。第一次发声发生在拍击里，本身就是用户操作
  function context() {
    if (!ctx) ctx = new AudioContextClass();
    // 切到别的应用再回来时，音频环境可能被系统挂起
    if (ctx.state !== 'running') Promise.resolve(ctx.resume()).catch(() => {});
    return ctx;
  }

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
      context();
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

  // 停表那一拍的「咚」，与「滴」同时响、各响各的，不经过 cutCurrent
  function thump() {
    try {
      if (!AudioContextClass) return;
      context();
      const t = ctx.currentTime;

      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(THUMP_FROM, t);
      osc.frequency.exponentialRampToValueAtTime(THUMP_TO, t + THUMP_SWEEP);
      // 指数渐变不能从 0 开始，用一个听不见的小值起步
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(THUMP_GAIN, t + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + THUMP_LENGTH);

      const n = Math.floor(ctx.sampleRate * CLICK_LENGTH);
      const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
      const click = ctx.createBufferSource();
      click.buffer = buffer;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = CLICK_LOWPASS;
      const clickAmp = ctx.createGain();
      clickAmp.gain.value = CLICK_GAIN;
      click.connect(lowpass).connect(clickAmp).connect(ctx.destination);
      click.start(t);
    } catch {
      // 同 beep：任何音频错误都不能影响计时
    }
  }

  return { beep, thump };
}
