#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dsh-startup-elisa · v0.3.0 — 程序化声轨合成（B audio-v3）
================================================================================
按 _p5/design-spec-v3.md §4 合成两条音频，全部原创程序化生成，无任何外部素材：

  lib/assets/audio/boot.wav   44.1kHz / 16bit / stereo / 7.8s
                              时间轴 0s = 动画 t0（spec §1 / §4.2 cue map）
  lib/assets/audio/chime.wav  44.1kHz / 16bit / mono  / 1.35s
                              减弱动态（reduced）分支用

确定性：numpy default_rng(SEED) 固定种子，重跑字节级一致（SHA256 可复核）。
电平：峰值 ≤ -1.0 dBFS，整体 RMS -22 ~ -15 dBFS，无削波，
      开头 0.0-0.2s 数字静音，7.4s 后自然衰减到 -60dB 以下 / 结尾数字静音。

spec 内部冲突的处理（§4.1 电平约束 vs §4.2 cue map）：
  §4.1 要求「开头 0.0–0.2s 静音」，§4.2 要求「0.02 电源 thump」，两者互斥。
  默认按 §4.1 执行（用户明确要求数值自检证明 0.2s 静音），电源 cue 顺延到
  --power-at 0.20（落在 ACT0 电源点窗口 0.00–0.22 内，听觉仍与开场对齐）。
  如需严格 §4.2：`--power-at 0.02 --head-silence 0`（二者同时给出才有效）。

用法：
  python scripts/make-audio.py                 # 默认输出 lib/assets/audio/
  python scripts/make-audio.py --out DIR --power-at 0.20
"""
import argparse
import hashlib
import json
import math
import os
import sys
import wave

import numpy as np

SR = 44100
SEED = 20261101
BOOT_DUR = 7.8
CHIME_DUR = 1.35
HEAD_SILENCE = 0.20          # §4.1
TAIL_START = 7.40            # §4.1 7.4 后衰减到静音
PEAK_TARGET_DB = -1.2        # §4.1 峰值 ≤ -1.0 dBFS（留 0.2dB 余量）
RMS_TARGET_DB = -19.0        # §4.1 整体 RMS -22 ~ -15 dBFS
CHIME_RMS_TARGET_DB = -19.0
TWO_PI = 2.0 * math.pi

# ---------------------------------------------------------------- cue map（§4.2）
CUE = {
    'power': 0.20,                 # §4.2 写 0.02，见文件头冲突说明
    'decode_start': 0.22,
    'decode_step': 0.0655,         # 12 次 tick 覆盖 0.22 ~ 0.94
    'decode_count': 12,
    'ignite': 0.98,
    'riser': (1.02, 1.15),
    'impact': 1.15,
    'bgm_in': 1.15,
    'whoosh1': 1.95,               # HUD 光扫
    'whoosh2': 2.45,               # 百叶窗揭幕
    'tick2': [2.72, 2.90, 3.08, 3.26, 3.44, 4.05],   # 6 次遥测行锁定
    'clunk': 3.65,                 # LOCKED 金属 clunk + 环形余音
    'handshake': (4.30, 5.35),
    'cut': 5.35,                   # 剑光 shing
    'cut_impact': 5.40,            # 冲击低频
    'online': 5.77,
    'chord1': 5.80,                # Am add9
    'chord2': 6.15,                # Fmaj7
    'ready': 6.05,                 # 双音 ready chime
    'exit': (6.62, 7.20),
    'shutter': 6.82,               # 机械合幕 thud
    'tail': (7.20, 7.80),
}

MIX = None  # 立体声总线 (2, N)
RNG = None  # 确定性随机源


# ================================================================ 基础设施
def n_of(seconds):
    return int(round(seconds * SR))


def tt(n):
    return np.arange(n, dtype=np.float64) / SR


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def db(x):
    """线性幅度 → dBFS；x<=0 时返回 None（JSON 里为 null）。"""
    if x is None or x <= 0 or not np.isfinite(x):
        return None
    return round(20.0 * math.log10(x), 3)


def rms(x):
    x = np.asarray(x, dtype=np.float64)
    if x.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(x * x)))


def peak(x):
    x = np.asarray(x, dtype=np.float64)
    return float(np.max(np.abs(x))) if x.size else 0.0


def raised_cos_env(n, attack):
    """0→1 升余弦攻击（避免切头爆音）。"""
    t = tt(n)
    if attack <= 0:
        return np.ones(n)
    a = np.clip(t / attack, 0.0, 1.0)
    return 0.5 - 0.5 * np.cos(np.pi * a)


def env_ad(n, attack, tau):
    """升余弦攻击 + 指数衰减。"""
    t = tt(n)
    dec = np.exp(-np.maximum(t - attack, 0.0) / max(tau, 1e-6))
    return raised_cos_env(n, attack) * dec


def glide(n, f0, f1, curve='exp'):
    """频率滑移正弦（相位连续）。"""
    t = tt(n)
    dur = max(t[-1], 1e-9) if n > 1 else 0.0
    if curve == 'exp' and f0 > 0 and f1 > 0 and dur > 0:
        ratio = (f1 / f0) ** (1.0 / dur)
        freq = f0 * ratio ** t
    elif dur > 0:
        freq = f0 + (f1 - f0) * (t / dur)
    else:
        freq = np.full(n, f0)
    phase = np.cumsum(freq) * (TWO_PI / SR)
    return np.sin(phase)


def norm_peak(x, target=1.0):
    p = peak(x)
    if p <= 0:
        return np.zeros_like(x)
    return x * (target / p)


def pan_stereo(sig, p0=0.0, p1=None):
    """等功率声像；p1 给出时做声像扫移。"""
    n = len(sig)
    if p1 is None:
        pan = np.full(n, p0, dtype=np.float64)
    else:
        pan = np.linspace(p0, p1, n)
    pan = np.clip(pan, -1.0, 1.0)
    ang = (pan + 1.0) * math.pi / 4.0
    return np.vstack([sig * np.cos(ang), sig * np.sin(ang)])


def add_at(start_s, sig, pan=0.0, pan1=None, gain=1.0):
    """把（单声道或已立体声的）事件叠加到总线。"""
    sig = np.asarray(sig, dtype=np.float64)
    if sig.ndim == 1:
        st = pan_stereo(sig, pan, pan1)
    else:
        st = sig
    i0 = n_of(start_s)
    if i0 < 0:
        st = st[:, -i0:]
        i0 = 0
    if i0 >= MIX.shape[1]:
        return
    n = min(st.shape[1], MIX.shape[1] - i0)
    if n <= 0:
        return
    MIX[:, i0:i0 + n] += st[:, :n] * gain


# ================================================================ 滤波器 / 音色
def svf_bp(x, fc, q=1.4):
    """TPT 状态变量滤波器带通（fc 可为标量或逐样本数组）。确定性。"""
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    out = np.empty(n, dtype=np.float64)
    if np.isscalar(fc):
        fc_arr = np.full(n, float(fc))
    else:
        fc_arr = np.asarray(fc, dtype=np.float64)
    k = 1.0 / max(q, 0.5)
    ic1 = 0.0
    ic2 = 0.0
    for i in range(n):
        f = clamp(float(fc_arr[i]), 30.0, SR * 0.45)
        g = math.tan(math.pi * f / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        out[i] = v1
    return out


def fft_bandpass(x, fc, bw_oct):
    """FFT 高斯带通（静态带通，用于噪声床/氛围层）。"""
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    if n == 0:
        return x
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    with np.errstate(divide='ignore'):
        logf = np.log2(np.maximum(freqs, 1e-6))
    mask = np.exp(-0.5 * ((logf - math.log2(fc)) / max(bw_oct, 1e-3)) ** 2)
    return np.fft.irfft(spec * mask, n)


def svf_lp(x, fc, q=0.707):
    """TPT 低通（用于冲击 body / boom）。"""
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    out = np.empty(n, dtype=np.float64)
    k = 1.0 / max(q, 0.5)
    ic1 = 0.0
    ic2 = 0.0
    for i in range(n):
        f = clamp(float(fc), 30.0, SR * 0.45)
        g = math.tan(math.pi * f / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        out[i] = v2  # 低通输出
    return out


def metallic(n, f0, ratios, decays, amps, phase_seed=0.0):
    """非谐波金属音：分音按 ratios 排列，逐分音指数衰减。"""
    t = tt(n)
    out = np.zeros(n, dtype=np.float64)
    attack = raised_cos_env(n, 0.0025)
    for idx, (ratio, dec, amp) in enumerate(zip(ratios, decays, amps)):
        if f0 * ratio >= SR * 0.45:
            continue
        ph = TWO_PI * f0 * ratio * t + phase_seed + idx * 1.37
        out += amp * np.sin(ph) * np.exp(-t / max(dec, 1e-4)) * attack
    return out


def whoosh(n, f0, f1, q=1.6, shape='rise', rise_power=2.2):
    """扫频带通噪声 whoosh。"""
    noise = RNG.standard_normal(n)
    fcs = f0 * (f1 / f0) ** np.linspace(0.0, 1.0, n)
    y = svf_bp(noise, fcs, q)
    y = norm_peak(y)
    t = tt(n)
    dur = max(t[-1], 1e-9) if n > 1 else 1.0
    pos = np.clip(t / dur, 0.0, 1.0)
    if shape == 'rise':
        env = pos ** rise_power
    elif shape == 'swell':
        env = np.sin(np.pi * pos) ** 1.2
    else:
        env = np.exp(-pos * 3.0) * (pos > 0)
    return y * env


def bell(n, f0, ratios=(1.0, 2.01, 3.02, 4.21, 5.43), amps=(1.0, 0.55, 0.32, 0.18, 0.1),
         taus=(0.45, 0.32, 0.24, 0.16, 0.11)):
    return metallic(n, f0, ratios, taus, amps)


# ================================================================ 音效事件
def ev_power(t0):
    """0.20 电源：60→35Hz 次低频 thump 250ms + 极轻电流 tick。"""
    n = n_of(0.32)
    body = glide(n, 60.0, 35.0, 'exp') * env_ad(n, 0.004, 0.062)
    body = norm_peak(body) * 0.24
    sub = glide(n, 42.0, 30.0, 'exp') * env_ad(n, 0.003, 0.11) * 0.05
    thump = body + sub
    # 极轻电流 tick：3ms 带通噪声
    nt = n_of(0.012)
    tick = norm_peak(svf_bp(RNG.standard_normal(nt), 4200.0, 2.2)) * \
        np.exp(-tt(nt) / 0.0028) * raised_cos_env(nt, 0.0004) * 0.035
    add_at(t0, thump, pan=0.0)
    add_at(t0 + 0.004, tick, pan=0.22)
    add_at(t0 + 0.006, glide(n_of(0.05), 120.0, 90.0) * env_ad(n_of(0.05), 0.002, 0.02) * 0.02, pan=-0.18)


def ev_noise_bed():
    """0.22–1.02 噪声床微升（解码段底噪）。"""
    dur = 1.02 - 0.22
    n = n_of(dur)
    bed = fft_bandpass(RNG.standard_normal(n), 1900.0, 1.1)
    bed = norm_peak(bed)
    t = tt(n)
    env = np.clip(t / dur, 0, 1) ** 1.8 * 0.008 + 0.0015
    add_at(0.22, bed * env, pan=0.0)


def ev_decode_ticks(t0, count, step):
    """12 次数字 tick（每 ~60ms，轻）。"""
    for i in range(count):
        nt = n_of(0.030)
        t = tt(nt)
        click = norm_peak(svf_bp(RNG.standard_normal(nt), 2600.0 + 140.0 * (i % 3), 1.8))
        click = click * np.exp(-t / 0.0035) * raised_cos_env(nt, 0.0004)
        tone = np.sin(TWO_PI * (1900.0 + 90.0 * (i % 4)) * t) * np.exp(-t / 0.005) * 0.5
        sig = norm_peak(click + tone) * (0.070 + 0.010 * (i % 3))
        add_at(t0 + i * step, sig, pan=(-0.22 if i % 2 == 0 else 0.22))


def ev_ignite(t0):
    """0.98 字标点火：金属 ping + 短促回升。"""
    n = n_of(0.42)
    ping = bell(n, 1180.0,
                ratios=(1.0, 1.68, 2.51, 3.83, 5.12),
                amps=(1.0, 0.62, 0.36, 0.2, 0.11),
                taus=(0.14, 0.11, 0.08, 0.06, 0.05))
    ping = norm_peak(ping) * 0.09
    rise_n = n_of(0.22)
    rise = glide(rise_n, 320.0, 960.0, 'exp') * raised_cos_env(rise_n, 0.02) * \
        np.exp(-tt(rise_n) / 0.16) * 0.022
    add_at(t0, ping, pan=-0.16)
    add_at(t0 + 0.01, rise, pan=0.1, pan1=0.32)


def ev_opening_riser(a, b):
    """1.02 → 1.15 上升 whoosh（滤波噪声 + 音高上扬）。"""
    dur = b - a
    n = n_of(dur)
    w = whoosh(n, 500.0, 4200.0, q=1.8, shape='rise', rise_power=2.0)
    add_at(a, w * 0.38, pan=-0.45, pan1=0.35)
    # 音高上扬的窄带共鸣
    rise = glide(n, 260.0, 1300.0, 'exp') * raised_cos_env(n, 0.05)
    rise = rise * np.linspace(0.0, 1.0, n) ** 1.6 * 0.018
    add_at(a, rise, pan=0.0)


def ev_impact(t0):
    """1.15 软冲击 + 低频 boom（开幕落定）。"""
    n = n_of(1.2)
    t = tt(n)
    boom = glide(n, 58.0, 34.0, 'exp') * env_ad(n, 0.006, 0.32)
    boom = norm_peak(boom) * 0.18
    # 软冲击 body：低通噪声 + 低频正弦
    nb = n_of(0.25)
    body_noise = svf_lp(RNG.standard_normal(nb), 420.0, 0.8)
    body_noise = norm_peak(body_noise) * env_ad(nb, 0.003, 0.075) * 0.16
    thud = glide(nb, 92.0, 55.0, 'exp') * env_ad(nb, 0.003, 0.09) * 0.10
    # 空气感：高频微尘
    air = fft_bandpass(RNG.standard_normal(n), 5200.0, 1.4)
    air = norm_peak(air) * np.exp(-t / 0.10) * raised_cos_env(n, 0.012) * 0.04
    add_at(t0, boom + air, pan=0.0)
    add_at(t0, body_noise + thud, pan=0.0)


def ev_drone(t_in, t_out):
    """BGM：55Hz + 五度 drone + 稀疏金属铺底，1.15–7.20。"""
    dur = t_out - t_in
    n = n_of(dur)
    t = tt(n)
    layers = [(55.0, 0.34), (82.5, 0.22), (110.0, 0.32), (130.81, 0.22), (164.81, 0.18), (220.0, 0.10)]

    def channel(detune):
        out = np.zeros(n, dtype=np.float64)
        for idx, (f, amp) in enumerate(layers):
            lfo = 1.0 + 0.13 * np.sin(TWO_PI * (0.09 + 0.017 * idx) * t + idx * 1.1)
            out += amp * np.sin(TWO_PI * (f + detune) * t + idx * 0.7) * lfo
        return out

    left = channel(-0.07)
    right = channel(0.07)
    left = np.tanh(left * 0.6) / 0.6
    right = np.tanh(right * 0.6) / 0.6
    # 包络：0.55s 淡入 / 中段微涌 / 0.6s 淡出（结束于 7.20）
    env = raised_cos_env(n, 0.55)
    pos = np.clip((t - 0.6) / 6.0, 0.0, 1.0)
    env *= 0.92 + 0.16 * np.sin(np.pi * pos)
    rel = np.clip((dur - t) / 0.62, 0.0, 1.0)
    env *= 0.5 - 0.5 * np.cos(np.pi * rel)
    st = np.vstack([left, right]) * env
    add_at(t_in, st, gain=0.090)

    # 稀疏金属音色铺底（A 小调五声，长衰减，低频密度）
    sparse = [
        (1.55, 440.00, 0.030, -0.30), (2.08, 523.25, 0.024, 0.28),
        (3.12, 659.25, 0.022, -0.22), (3.90, 783.99, 0.021, 0.24),
        (4.62, 493.88, 0.024, -0.26), (5.02, 587.33, 0.021, 0.20),
    ]
    for at, f, amp, pan in sparse:
        nn = n_of(1.4)
        note = bell(nn, f, ratios=(1.0, 2.02, 3.01, 4.18),
                    amps=(1.0, 0.4, 0.2, 0.1), taus=(0.8, 0.5, 0.33, 0.2))
        add_at(at, norm_peak(note) * amp, pan=pan)


def ev_hud_whooshes():
    """1.90–2.60 两次轻 whoosh（光扫 1.90 / 揭幕 2.30），结束于 2.58 不与遥测 tick 撞车。"""
    n1 = n_of(0.30)
    w1 = whoosh(n1, 700.0, 2600.0, q=1.5, shape='swell')
    add_at(1.90, w1 * 0.16, pan=-0.3, pan1=0.3)
    n2 = n_of(0.28)
    w2 = whoosh(n2, 1100.0, 3600.0, q=1.4, shape='swell')
    add_at(2.30, w2 * 0.14, pan=0.35, pan1=-0.25)


def ev_telemetry_ticks():
    """2.70–4.30 六次软数字 tick。"""
    for i, at in enumerate(CUE['tick2']):
        nt = n_of(0.05)
        t = tt(nt)
        click = norm_peak(svf_bp(RNG.standard_normal(nt), 2300.0 + 140.0 * (i % 3), 1.6))
        click = click * np.exp(-t / 0.0045) * raised_cos_env(nt, 0.0005)
        tone = np.sin(TWO_PI * 1560.0 * t) * np.exp(-t / 0.01) * 0.45
        sig = norm_peak(click + tone) * 0.060
        add_at(at, sig, pan=(-0.18 if i % 2 == 0 else 0.18))


def ev_lock_clunk(t0):
    """3.65 金属 clunk + 环形余音。"""
    n = n_of(1.0)
    t = tt(n)
    thud = glide(n, 150.0, 88.0, 'exp') * env_ad(n, 0.003, 0.075)
    thud = norm_peak(thud) * 0.17
    click_n = n_of(0.06)
    click = norm_peak(svf_bp(RNG.standard_normal(click_n), 2400.0, 1.4)) * \
        np.exp(-tt(click_n) / 0.008) * raised_cos_env(click_n, 0.0005) * 0.10
    ring = bell(n, 880.0, ratios=(1.0, 1.51, 2.02, 3.02, 4.04),
                amps=(1.0, 0.62, 0.42, 0.2, 0.1),
                taus=(0.55, 0.4, 0.28, 0.18, 0.12))
    ring = norm_peak(ring) * 0.075
    add_at(t0, thud + ring, pan=0.0)
    add_at(t0 + 0.002, click, pan=0.12)


def ev_handshake(a, b):
    """4.30–5.35 心跳 kick 加速（~4.5 拍/秒）+ 进度细高音。"""
    times = []
    t = a + 0.02
    interval = 0.28
    while t < b - 0.03:
        times.append(t)
        t += interval
        interval = max(0.19, interval - 0.022)
    for i, at in enumerate(times):
        n = n_of(0.30)
        kick = glide(n, 72.0, 44.0, 'exp') * env_ad(n, 0.003, 0.085)
        kick = norm_peak(kick) * (0.100 + 0.018 * i)
        nt = n_of(0.02)
        click = norm_peak(svf_bp(RNG.standard_normal(nt), 1600.0, 1.2)) * \
            np.exp(-tt(nt) / 0.004) * raised_cos_env(nt, 0.0004) * 0.028
        add_at(at, kick, pan=0.0)
        add_at(at, click, pan=0.0)

    # 进度细高音：音高上扬 + 颤音加速
    dur = b - a
    n = n_of(dur)
    tvec = tt(n)
    freq = 2400.0 + 900.0 * (tvec / dur) ** 1.5
    trem = 0.6 + 0.4 * np.sin(TWO_PI * (6.0 + 9.0 * tvec / dur) * tvec)
    tone = np.sin(TWO_PI * np.cumsum(freq) / SR) * trem
    env = raised_cos_env(n, 0.25) * np.clip((dur - tvec) / 0.18, 0.0, 1.0)
    add_at(a, tone * env * 0.026, pan=-0.2, pan1=0.2)

    # 上行噪声床：制造张力累积
    bed = fft_bandpass(RNG.standard_normal(n), 3000.0, 1.6)
    bed = norm_peak(bed) * (tvec / dur) ** 2.0 * 0.018
    add_at(a, bed, pan=0.0)


def ev_cut(t_sword, t_impact):
    """5.35 剑光切场：白噪扫频 shing + 金属泛音 + 5.40 冲击低频。"""
    n = n_of(0.75)
    t = tt(n)
    # 剑光本体：白噪 2000→11500Hz 在 90ms 内极速上扬，之后保持高频衰减
    nsw = n_of(0.75)
    sweep_pos = np.clip(tt(nsw) / 0.09, 0.0, 1.0)
    fcs = 3000.0 * (13000.0 / 3000.0) ** sweep_pos
    swords = norm_peak(svf_bp(RNG.standard_normal(nsw), fcs, q=2.0))
    swords = swords * raised_cos_env(nsw, 0.0015) * np.exp(-tt(nsw) / 0.16)
    swords = swords * (0.36 / max(peak(swords), 1e-9))
    # 金属泛音
    metal = metallic(n, 1400.0,
                     ratios=(1.0, 1.73, 2.61, 3.47, 5.03, 6.79),
                     decays=(0.55, 0.44, 0.33, 0.25, 0.17, 0.12),
                     amps=(1.0, 0.78, 0.52, 0.34, 0.2, 0.12))
    metal = norm_peak(metal) * 0.22
    # 高频闪烁
    shimmer = fft_bandpass(RNG.standard_normal(n), 8000.0, 1.2)
    shimmer = norm_peak(shimmer) * np.exp(-t / 0.22) * raised_cos_env(n, 0.004) * 0.13
    shing = swords + metal + shimmer
    add_at(t_sword, shing, pan=-0.25, pan1=0.25)

    # 5.40 冲击：sub boom + 低频 punch
    ni = n_of(1.4)
    ti = tt(ni)
    sub = glide(ni, 62.0, 31.0, 'exp') * env_ad(ni, 0.004, 0.42)
    sub = norm_peak(sub) * 0.24
    nb = n_of(0.30)
    punch = svf_lp(RNG.standard_normal(nb), 300.0, 0.8)
    punch = norm_peak(punch) * env_ad(nb, 0.002, 0.09) * 0.19
    tail = glide(ni, 46.0, 40.0, 'exp') * env_ad(ni, 0.05, 0.55) * 0.03
    add_at(t_impact, sub + tail, pan=0.0)
    add_at(t_impact, punch, pan=0.0)


def ev_online_chords():
    """5.77–6.65 暖色解决和弦 Am add9 → Fmaj7 + 6.05 双音 ready chime。"""
    chord1 = [(220.00, -0.35), (261.63, -0.12), (329.63, 0.12), (493.88, 0.35)]
    chord2 = [(174.61, -0.4), (220.00, -0.15), (261.63, 0.1), (329.63, 0.35)]

    def chord_at(at, notes, dur, attack, release, amp):
        n = n_of(dur)
        t = tt(n)
        env = raised_cos_env(n, attack) * np.clip((dur - t) / release, 0.0, 1.0)
        for idx, (f, pan) in enumerate(notes):
            det = 1.0 + 0.0007 * (idx - 1.5)
            voice = np.sin(TWO_PI * f * det * t) + 0.45 * np.sin(TWO_PI * 2.003 * f * t + idx) + \
                0.18 * np.sin(TWO_PI * 3.001 * f * t + idx * 0.6)
            voice = voice * env * amp * (0.32 if idx < 2 else 0.24)
            add_at(at, voice, pan=pan)

    chord_at(CUE['chord1'], chord1, 0.62, 0.14, 0.28, 0.28)
    chord_at(CUE['chord2'], chord2, 0.52, 0.16, 0.26, 0.24)

    # 6.05 双音 ready chime：E5 → B5
    n = n_of(0.62)
    e5 = bell(n, 659.25, ratios=(1.0, 2.0, 3.01, 4.2), amps=(1, 0.5, 0.26, 0.12),
              taus=(0.42, 0.3, 0.2, 0.12))
    b5 = bell(n, 987.77, ratios=(1.0, 2.0, 3.0, 4.2), amps=(1, 0.45, 0.22, 0.1),
              taus=(0.4, 0.28, 0.18, 0.1))
    add_at(CUE['ready'], norm_peak(e5) * 0.10, pan=-0.18)
    add_at(CUE['ready'] + 0.09, norm_peak(b5) * 0.08, pan=0.2)


def ev_exit(t0, t1):
    """6.62–7.20 下行 sweep + 机械合幕 thud + 低频余韵。"""
    dur = t1 - t0
    n = n_of(dur)
    t = tt(n)
    # 下行滤波噪声扫频
    sweep = whoosh(n, 3400.0, 300.0, q=1.7, shape='swell')
    add_at(t0, sweep * 0.065, pan=0.3, pan1=-0.3)
    # 下行音高
    desc = glide(n, 880.0, 160.0, 'exp') * raised_cos_env(n, 0.02) * \
        np.clip((dur - t) / 0.5, 0.0, 1.0) * 0.030
    add_at(t0, desc, pan=0.0)
    # 6.82 机械合幕 thud
    nt = n_of(0.35)
    shutter = glide(nt, 130.0, 58.0, 'exp') * env_ad(nt, 0.003, 0.09)
    shutter = norm_peak(shutter) * 0.16
    nc = n_of(0.07)
    clack = norm_peak(svf_bp(RNG.standard_normal(nc), 1700.0, 1.3)) * \
        np.exp(-tt(nc) / 0.010) * raised_cos_env(nc, 0.0004) * 0.11
    add_at(CUE['shutter'], shutter, pan=0.0)
    add_at(CUE['shutter'], clack, pan=0.12)
    # 低频余韵：7.0 起衰减到 7.8
    ntail = n_of(0.8)
    tail = glide(ntail, 48.0, 42.0, 'exp') * env_ad(ntail, 0.06, 0.36)
    add_at(7.00, norm_peak(tail) * 0.075, pan=0.0)


# ================================================================ 母带 / 写盘
def crest_shape(x, mode, param):
    """峰值归一化信号上的动态塑形。
    mode='sat'：tanh 软饱和（收紧峰值、抬高 RMS）；mode='expand'：幂次扩展（拉开峰值）。"""
    if mode == 'sat':
        denom = math.tanh(param)
        return np.tanh(param * x) / denom
    return np.sign(x) * np.abs(x) ** param


def shape_to_crest(x, target_ratio):
    """把 x 的动态（RMS/峰值比）调到 target_ratio，输出峰值仍为 1。
    返回 (y, mode, param)。"""
    xn = x / peak(x)
    r0 = rms(xn)
    if abs(r0 - target_ratio) < 1e-4:
        return xn, 'none', 1.0
    if r0 < target_ratio:
        lo, hi = 1e-6, 8.0
        for _ in range(60):
            mid = 0.5 * (lo + hi)
            y = crest_shape(xn, 'sat', mid)
            if rms(y) < target_ratio:
                lo = mid
            else:
                hi = mid
        param = 0.5 * (lo + hi)
        return crest_shape(xn, 'sat', param), 'sat', param
    lo, hi = 1.0, 3.0
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        y = crest_shape(xn, 'expand', mid)
        if rms(y) > target_ratio:
            lo = mid
        else:
            hi = mid
    param = 0.5 * (lo + hi)
    return crest_shape(xn, 'expand', param), 'expand', param


LAST_MASTER = {}


def ensure_loudness(data, target_db=-18.5, loud_max_db=-16.0, quiet_min_db=-20.0, peak_cap_db=-1.2):
    """成品电平兜底：RMS 越界时整体调整（首尾静音为 0，不受影响）。"""
    r_now = db(rms(data))
    p_now = peak(data)
    if r_now is None or p_now <= 0:
        return data
    if r_now > loud_max_db:
        return data * (10.0 ** (target_db / 20.0) / rms(data))
    if r_now < quiet_min_db:
        need = 10.0 ** (target_db / 20.0) / rms(data)
        cap = 10.0 ** (peak_cap_db / 20.0) / p_now
        return data * min(need, cap)
    return data


def master(mix, head_silence, tail_start, rms_target_db, peak_target_db, tail_power=2.5):
    """母带链：去直流/高通 → 峰值归一 → 必要时电平修正 → 硬性首尾静音。

    默认不做压缩/限幅（保留自然动态）；仅当峰值归一后 RMS 越界时才介入：
      - RMS 过响（> -16 dBFS）→ 整体降到 -19 dBFS（峰值随之下降，仍满足 ≤ -1dBFS）
      - RMS 过轻（< -22 dBFS）→ 动态塑形（tanh）抬到 -19 dBFS
    首尾静音放在最后，保证 §4.1 约束不受任何处理影响。"""
    global LAST_MASTER
    # 去直流 + 22Hz 高通（保 sub 低频，除 DC）
    mix = mix - np.mean(mix, axis=1, keepdims=True)
    n = mix.shape[1]
    spec = np.fft.rfft(mix, axis=1)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    hp = np.clip((freqs - 14.0) / 10.0, 0.0, 1.0)  # 14–24Hz 平滑高通
    mix = np.fft.irfft(spec * hp[np.newaxis, :], n, axis=1)

    raw_peak = peak(mix)
    raw_rms = rms(mix)
    peak_linear = 10.0 ** (peak_target_db / 20.0)
    rms_linear = 10.0 ** (rms_target_db / 20.0)
    ratio = rms_linear / peak_linear

    out = mix * (peak_linear / raw_peak)  # 峰值归一到 -1.2dBFS
    db_now = db(rms(out))
    action = 'peak-normalize'
    param = 1.0
    if db_now is not None and db_now > -16.0:
        out = out * (rms_linear / rms(out))       # 过响：降到目标 RMS
        action = 'scale-to-rms'
    elif db_now is not None and db_now < -22.0:
        shaped, mode, param = shape_to_crest(out, ratio)
        out = shaped * peak_linear
        action = 'compress-' + mode

    # 开头数字静音（§4.1）
    n_head = n_of(head_silence)
    if n_head > 0:
        out[:, :n_head] = 0.0
    # 尾部自然衰减（§4.1）：7.4 → 7.8 平滑归零，最后 30ms 数字静音
    i_tail = n_of(tail_start)
    tail_n = n - i_tail
    if tail_n > 0:
        pos = np.linspace(0.0, 1.0, tail_n)
        out[:, i_tail:] *= (1.0 - pos) ** tail_power
    n_zero = n_of(0.03)
    out[:, n - n_zero:] = 0.0

    # 最终电平兜底：把成品整体 RMS 收到安全区间（不影响首尾静音）
    out = ensure_loudness(out, target_db=-18.5, loud_max_db=-16.0, quiet_min_db=-20.0,
                          peak_cap_db=peak_target_db)

    LAST_MASTER = {
        'raw_peak_dbfs': db(raw_peak),
        'raw_rms_dbfs': db(raw_rms),
        'raw_crest_db': round(20.0 * math.log10(raw_peak / raw_rms), 3) if raw_rms > 0 else None,
        'action': action,
        'shape_param': round(param, 4),
        'final_peak_dbfs': db(peak(out)),
        'final_rms_dbfs': db(rms(out)),
    }
    return out


def to_int16(data):
    """(ch, n) float → (n, ch) int16；四舍五入、无削波。"""
    pcm = np.round(np.asarray(data, dtype=np.float64).T * 32767.0)
    return np.clip(pcm, -32768, 32767).astype('<i2')


def write_wav(path, data, sr, channels):
    pcm = to_int16(data)
    with wave.open(path, 'wb') as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sr)
        wav.writeframes(pcm.tobytes())


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ================================================================ 合成
def synth_boot(power_at, head_silence):
    global MIX, RNG
    RNG = np.random.default_rng(SEED)
    MIX = np.zeros((2, n_of(BOOT_DUR)), dtype=np.float64)

    ev_power(power_at)
    ev_noise_bed()
    ev_decode_ticks(CUE['decode_start'], CUE['decode_count'], CUE['decode_step'])
    ev_ignite(CUE['ignite'])
    ev_opening_riser(*CUE['riser'])
    ev_impact(CUE['impact'])
    ev_drone(CUE['bgm_in'], CUE['tail'][0])
    ev_hud_whooshes()
    ev_telemetry_ticks()
    ev_lock_clunk(CUE['clunk'])
    ev_handshake(*CUE['handshake'])
    ev_cut(CUE['cut'], CUE['cut_impact'])
    ev_online_chords()
    ev_exit(*CUE['exit'])

    return master(MIX, head_silence, TAIL_START, RMS_TARGET_DB, PEAK_TARGET_DB, tail_power=3.0)


def synth_chime(head_silence):
    global RNG
    RNG = np.random.default_rng(SEED + 1)
    n = n_of(CHIME_DUR)
    t = tt(n)
    sig = np.zeros(n, dtype=np.float64)

    # 暖色低频垫：A3 + E4 缓慢起落
    pad = (np.sin(TWO_PI * 220.0 * t) * 0.5 + np.sin(TWO_PI * 329.63 * t) * 0.32 +
           np.sin(TWO_PI * 110.0 * t) * 0.22)
    pad_env = raised_cos_env(n, 0.12) * np.exp(-t / 0.75)
    sig += pad * pad_env * 0.10

    # 双音钟：A5 → E6（错开 0.18s）
    n_a = n_of(0.95)
    a5 = bell(n_a, 880.0, ratios=(1.0, 2.0, 3.01, 4.2, 5.4),
              amps=(1.0, 0.5, 0.28, 0.14, 0.07), taus=(0.55, 0.4, 0.28, 0.18, 0.12))
    add = norm_peak(a5) * 0.34
    sig[:len(add)] += add

    n_e = n_of(0.8)
    e6 = bell(n_e, 1318.51, ratios=(1.0, 2.0, 3.0, 4.2),
              amps=(1.0, 0.45, 0.22, 0.1), taus=(0.48, 0.34, 0.22, 0.14))
    off = n_of(0.18)
    add2 = norm_peak(e6) * 0.28
    sig[off:off + len(add2)] += add2

    # 结尾轻"落定"低频
    sig += glide(n, 180.0, 120.0, 'exp') * env_ad(n, 0.05, 0.30) * 0.02

    data = np.vstack([sig, sig])  # 先按单声道处理，母带后取左声道写 mono
    out = master(data, head_silence, CHIME_DUR - 0.22, CHIME_RMS_TARGET_DB, PEAK_TARGET_DB, tail_power=3.0)
    # 单声道资产：取左右平均（母带在双通道上运算，保持一致）
    return out.mean(axis=0, keepdims=True)


# ================================================================ 入口
def main(argv=None):
    ap = argparse.ArgumentParser(description='合成 dsh-startup-elisa v0.3.0 声轨')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                                  'lib', 'assets', 'audio'))
    ap.add_argument('--power-at', type=float, default=CUE['power'],
                    help='电源 thump 起点（秒）。默认 0.20 以兼容 §4.1 开头静音；严格 §4.2 用 0.02')
    ap.add_argument('--head-silence', type=float, default=HEAD_SILENCE,
                    help='开头数字静音秒数，默认 0.20（§4.1）')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args(argv)

    if args.power_at < 0.0 or args.power_at > 1.0:
        ap.error('--power-at 需在 0..1 之间')
    if args.head_silence < 0.0 or args.head_silence > 0.5:
        ap.error('--head-silence 需在 0..0.5 之间')
    if args.power_at < args.head_silence and args.head_silence > 0:
        print('[make-audio] WARN: power-at %.3f 落在开头静音内，该 cue 会被静音；'
              '如需严格 §4.2 请同时 --head-silence 0' % args.power_at, file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    boot_path = os.path.join(args.out, 'boot.wav')
    chime_path = os.path.join(args.out, 'chime.wav')

    boot = synth_boot(args.power_at, args.head_silence)
    boot_master = dict(LAST_MASTER)
    chime = synth_chime(args.head_silence)
    chime_master = dict(LAST_MASTER)
    write_wav(boot_path, boot, SR, 2)
    write_wav(chime_path, chime, SR, 1)

    report = {
        'generated_by': 'scripts/make-audio.py',
        'seed': SEED,
        'sample_rate': SR,
        'power_at_s': args.power_at,
        'head_silence_s': args.head_silence,
        'boot': {
            'path': os.path.relpath(boot_path, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            'bytes': os.path.getsize(boot_path),
            'duration_s': BOOT_DUR,
            'channels': 2,
            'bits': 16,
            'peak_dbfs': db(peak(boot)),
            'rms_dbfs': db(rms(boot)),
            'sha256': sha256_file(boot_path),
            'master': boot_master,
        },
        'chime': {
            'path': os.path.relpath(chime_path, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            'bytes': os.path.getsize(chime_path),
            'duration_s': CHIME_DUR,
            'channels': 1,
            'bits': 16,
            'peak_dbfs': db(peak(chime)),
            'rms_dbfs': db(rms(chime)),
            'sha256': sha256_file(chime_path),
            'master': chime_master,
        },
    }
    if not args.quiet:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
