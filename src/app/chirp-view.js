// Chirp mode: the gravitational-wave signal of two merging holes, drawn as
// a strain plot and played as sound.

import { waveform, chirpMass, cyclesBetween } from '../physics/chirp.js';
import { CHIRPS } from './presets.js';
import { el, slider, chips, stats, fmt } from './ui.js';

export class ChirpMode {
  constructor(app) {
    this.app = app;
    this.id = 'chirp';
    this.label = 'Chirp';
    this.params = { ...CHIRPS[0] };
    this.pn = 2;
    this.pitch = 4;
    this.speed = 0.25;
    this.wf = null;
    this.play = null;
  }

  enter() {
    if (!this.wf) this.compute();
  }

  exit() {
    this.stop();
  }

  compute() {
    const p = this.params;
    this.wf = waveform({ m1: p.m1, m2: p.m2, z: p.z, distanceMpc: p.distanceMpc, pn: this.pn, fLow: 20, fs: 4096 });
  }

  stop() {
    try {
      this.play?.src.stop();
    } catch {
      // Already stopped.
    }
    this.play = null;
  }

  start() {
    this.stop();
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = this.ctx ?? new Ctx();
    const ctx = this.ctx;
    ctx.resume?.();
    const wf = this.wf;
    const T = wf.t[wf.t.length - 1];
    const dur = T / this.speed + 0.3;
    const sr = ctx.sampleRate;
    const n = Math.floor(dur * sr);
    const buf = ctx.createBuffer(1, n, sr);
    const out = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < wf.amp.length; i++) peak = Math.max(peak, wf.amp[i]);
    for (let i = 0; i < n; i++) {
      const t = (i / sr) * this.speed;
      const x = t * wf.fs;
      const j = Math.floor(x);
      if (j >= wf.amp.length - 1) break;
      const f = x - j;
      const A = wf.amp[j] * (1 - f) + wf.amp[j + 1] * f;
      const P = wf.phase[j] * (1 - f) + wf.phase[j + 1] * f;
      const fade = Math.min(1, i / (0.05 * sr));
      out[i] = 0.8 * fade * (A / peak) * Math.cos((this.pitch * P) / this.speed);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    this.play = { src, t0: ctx.currentTime, dur };
    src.onended = () => {
      if (this.play?.src === src) this.play = null;
    };
  }

  frame() {
    this.draw();
  }

  draw() {
    const cv = this.app.dom.plot;
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    g.fillStyle = '#06070b';
    g.fillRect(0, 0, W, H);
    const wf = this.wf;
    const T = wf.t[wf.t.length - 1];
    const tShow = Math.min(T, 0.5);
    const t0 = T - tShow;
    const L = 52 * dpr;
    const Rm = 14 * dpr;
    const top1 = 34 * dpr;
    const h1 = H * 0.46;
    const top2 = top1 + h1 + 34 * dpr;
    const h2 = H - top2 - 34 * dpr;
    const X = (t) => L + ((t - t0) / tShow) * (W - L - Rm);
    let hmax = 0;
    for (let i = 0; i < wf.h.length; i++) hmax = Math.max(hmax, Math.abs(wf.h[i]));
    const scaleExp = Math.floor(Math.log10(hmax));
    const unit = 10 ** scaleExp;
    const yMax = Math.ceil((hmax / unit) * 1.1 * 2) / 2;

    g.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
    g.fillStyle = 'rgba(155,152,168,0.9)';
    g.fillText(`strain h  (×10${sup(scaleExp)})`, L, top1 - 12 * dpr);
    g.fillText('frequency (Hz)', L, top2 - 12 * dpr);
    // Axes and grid.
    g.strokeStyle = 'rgba(38,42,59,1)';
    g.lineWidth = dpr;
    for (const v of [-yMax, 0, yMax]) {
      const y = top1 + h1 / 2 - (v / yMax) * (h1 / 2);
      g.beginPath();
      g.moveTo(L, y);
      g.lineTo(W - Rm, y);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(v.toFixed(1), L - 6 * dpr, y + 4 * dpr);
    }
    const fTicks = [20, 50, 100, 200, 300];
    const fY = (f) => top2 + h2 - ((Math.log(f) - Math.log(20)) / (Math.log(320) - Math.log(20))) * h2;
    for (const f of fTicks) {
      const y = fY(f);
      g.beginPath();
      g.moveTo(L, y);
      g.lineTo(W - Rm, y);
      g.stroke();
      g.fillText(String(f), L - 6 * dpr, y + 4 * dpr);
    }
    g.textAlign = 'center';
    for (let k = 0; k <= 5; k++) {
      const t = t0 + (k / 5) * tShow;
      const lbl = ((t - wf.tPeak) * 1000).toFixed(0);
      g.fillText(`${lbl} ms`, X(t), H - 12 * dpr);
    }
    g.textAlign = 'left';
    // Strain.
    g.strokeStyle = '#f0a55c';
    g.lineWidth = 1.2 * dpr;
    g.beginPath();
    let started = false;
    for (let i = 0; i < wf.t.length; i++) {
      if (wf.t[i] < t0) continue;
      const x = X(wf.t[i]);
      const y = top1 + h1 / 2 - (wf.h[i] / unit / yMax) * (h1 / 2);
      if (!started) g.moveTo(x, y);
      else g.lineTo(x, y);
      started = true;
    }
    g.stroke();
    // Frequency.
    g.strokeStyle = '#86b9ff';
    g.lineWidth = 1.6 * dpr;
    g.beginPath();
    started = false;
    for (let i = 0; i < wf.t.length; i += 4) {
      if (wf.t[i] < t0) continue;
      const x = X(wf.t[i]);
      const y = fY(Math.min(320, Math.max(20, wf.f[i])));
      if (!started) g.moveTo(x, y);
      else g.lineTo(x, y);
      started = true;
    }
    g.stroke();
    // Merger marker and playback cursor.
    g.strokeStyle = 'rgba(236,230,216,0.35)';
    g.setLineDash([3 * dpr, 3 * dpr]);
    g.beginPath();
    g.moveTo(X(wf.tPeak), top1);
    g.lineTo(X(wf.tPeak), top2 + h2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(236,230,216,0.7)';
    g.fillText('merger', X(wf.tPeak) + 4 * dpr, top1 + 12 * dpr);
    if (this.play && this.ctx) {
      const t = (this.ctx.currentTime - this.play.t0) * this.speed;
      if (t >= t0 && t <= T) {
        g.strokeStyle = '#ece6d8';
        g.lineWidth = dpr;
        g.beginPath();
        g.moveTo(X(t), top1);
        g.lineTo(X(t), top2 + h2);
        g.stroke();
      }
    }
    this.app.setReadout([
      ['signal', `${T.toFixed(2)} s from 20 Hz`],
      ['peak strain', fmt(wf.hPeak, 2)],
    ]);
  }

  panel() {
    const p = this.params;
    const wf = this.wf ?? (this.compute(), this.wf);
    const recompute = () => {
      this.stop();
      this.compute();
      this.app.renderPanel();
    };
    const presets = chips(CHIRPS.map((c) => ({ id: c.id, label: c.name, on: c.id === p.id })), {
      exclusive: true,
      onchange: (id) => { this.params = { ...CHIRPS.find((c) => c.id === id) }; recompute(); },
    });
    const m1 = slider({ id: 'm1', label: 'Mass 1', min: 5, max: 80, step: 0.1, value: p.m1, format: (v) => `${v.toFixed(1)} M☉`, oninput: (v) => { p.m1 = v; p.id = 'custom'; } });
    const m2 = slider({ id: 'm2', label: 'Mass 2', min: 5, max: 80, step: 0.1, value: p.m2, format: (v) => `${v.toFixed(1)} M☉`, oninput: (v) => { p.m2 = v; p.id = 'custom'; } });
    m1.node.querySelector('input').addEventListener('change', recompute);
    m2.node.querySelector('input').addEventListener('change', recompute);
    const order = chips([
      { id: '0', label: 'Newtonian', on: this.pn === 0 },
      { id: '2', label: '2PN', on: this.pn === 2 },
    ], { exclusive: true, onchange: (id) => { this.pn = Number(id); recompute(); } });
    const pitch = chips([
      { id: '1', label: 'True pitch', on: this.pitch === 1 },
      { id: '4', label: '4× higher', on: this.pitch === 4 },
    ], { exclusive: true, onchange: (id) => { this.pitch = Number(id); } });
    const speed = chips([
      { id: '1', label: 'Real time', on: this.speed === 1 },
      { id: '0.25', label: '¼ speed', on: this.speed === 0.25 },
    ], { exclusive: true, onchange: (id) => { this.speed = Number(id); } });
    return el('div', { class: 'panel' },
      el('h2', {}, 'Merger chirp'),
      el('p', {}, p.note ?? 'Your own pair of holes.'),
      el('div', { class: 'group' }, presets.node, m1.node, m2.node),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Inspiral physics'), order.node),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Sound'), pitch.node, speed.node,
        el('div', { class: 'row' },
          el('button', { class: 'btn primary', type: 'button', onclick: () => this.start() }, 'Play the chirp'),
          el('button', { class: 'btn', type: 'button', onclick: () => this.stop() }, 'Stop'))),
      stats([
        ['Chirp mass', `${chirpMass(p.m1, p.m2).toFixed(2)} M☉`],
        ['Total mass', `${(p.m1 + p.m2).toFixed(1)} M☉`],
        ['Final hole', `${wf.remnant.mass.toFixed(1)} M☉, spin ${wf.remnant.spin.toFixed(2)}`],
        ['Radiated as waves', `${(p.m1 + p.m2 - wf.remnant.mass).toFixed(1)} M☉`],
        ['Ringdown', `${wf.ring.f.toFixed(0)} Hz, damping ${(wf.ring.tau * 1000).toFixed(1)} ms`],
        ['Cycles 35–150 Hz', cyclesBetween(wf, 35, 150).toFixed(1)],
        ['Distance', `${p.distanceMpc} Mpc (z = ${p.z})`],
      ]),
      el('p', {}, 'Strain is for a face-on source. The inspiral is post-Newtonian; the merger and ringdown are a smooth approximation, not numerical relativity.'),
    );
  }
}

function sup(e) {
  const map = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(e).split('').map((c) => map[c] ?? c).join('');
}
