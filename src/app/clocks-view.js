// Clocks mode: the probe's clock against a clock far from the hole.

import { ViewMode } from './view.js';
import { horizonRadius } from '../physics/kerr.js';
import { massTime, formatDuration } from '../physics/units.js';
import { el, slider, chips, stats, fmt } from './ui.js';

export class ClocksMode extends ViewMode {
  constructor(app) {
    super(app);
    this.id = 'clocks';
    this.label = 'Clocks';
    this.tFar = 0;
    this.tProbe = 0;
  }

  enter() {
    super.enter();
    this.tFar = 0;
    this.tProbe = 0;
  }

  exit() {
    super.exit();
    const h = this.app.dom.hud;
    h.getContext('2d').clearRect(0, 0, h.width, h.height);
  }

  onHole() {
    this.tFar = 0;
    this.tProbe = 0;
    if (this.app.mode === this) this.app.renderPanel();
  }

  frame(dt) {
    super.frame(dt);
    const dtM = Math.min(dt, 0.1) * this.app.state.timeRate;
    this.tFar += dtM;
    this.tProbe += dtM * this.probeRate();
    this.drawClocks();
    this.tick = (this.tick ?? 0) + 1;
    if (this.tick % 10 === 0) this.refresh();
  }

  drawClocks() {
    const cv = this.app.dom.hud;
    const g = cv.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    g.clearRect(0, 0, cv.width, cv.height);
    const R = Math.min(cv.width, cv.height) * 0.07;
    const y = cv.height - R - 18 * dpr;
    const dial = (x, t, label, color) => {
      g.fillStyle = 'rgba(6,7,11,0.7)';
      g.strokeStyle = color;
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.arc(x, y, R, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * 2 * Math.PI;
        g.beginPath();
        g.moveTo(x + Math.sin(a) * R * 0.82, y - Math.cos(a) * R * 0.82);
        g.lineTo(x + Math.sin(a) * R * 0.95, y - Math.cos(a) * R * 0.95);
        g.stroke();
      }
      // One turn of the hand per 100 M of that clock's time.
      const a = ((t / 100) % 1) * 2 * Math.PI;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(a) * R * 0.78, y - Math.cos(a) * R * 0.78);
      g.lineWidth = 2 * dpr;
      g.stroke();
      g.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
      g.fillStyle = color;
      g.textAlign = 'center';
      g.fillText(label, x, y - R - 6 * dpr);
    };
    dial(R + 18 * dpr, this.tFar, 'far away', '#86b9ff');
    dial(3 * R + 36 * dpr, this.tProbe, 'probe', '#f0a55c');
    g.textAlign = 'left';
  }

  refresh() {
    if (!this.statsNode) return;
    const rate = this.probeRate();
    const tM = massTime(this.app.state.hole.mass);
    this.bigNode.replaceChildren(
      `1 hour on the probe = ${formatDuration(3600 / rate)} far away`,
      el('small', {}, `The probe’s clock runs at ${fmt(rate, 4)} of the far-away rate.`));
    this.statsNode.replaceChildren(stats([
      ['Far-away clock', formatDuration(this.tFar * tM)],
      ['Probe clock', formatDuration(this.tProbe * tM)],
      ['Difference', formatDuration((this.tFar - this.tProbe) * tM)],
    ]));
  }

  panel() {
    const app = this.app;
    const a = app.state.a;
    const rH = horizonRadius(a);
    const [r] = this.camera.bl;
    const toX = (rr) => Math.log10(Math.max(rr - rH, 1e-6));
    const radius = slider({
      id: 'hover',
      label: 'Hover height above the horizon',
      min: -5,
      max: 2,
      step: 0.01,
      value: Math.min(2, toX(r)),
      format: (x) => `${(rH + 10 ** x).toFixed(x < -2 ? 6 : 3)} M`,
      oninput: (x) => {
        const [, th, ph] = this.camera.bl;
        this.camera.place(rH + 10 ** x, th, ph);
        this.refresh();
      },
    });
    const motion = chips([
      { id: 'hover', label: 'Hover', on: this.camera.motion === 'hover' },
      { id: 'orbit', label: 'Orbit', on: this.camera.motion === 'orbit' },
    ], { exclusive: true, onchange: (id) => { this.camera.motion = id; this.refresh(); } });
    this.bigNode = el('p', { class: 'big' });
    this.statsNode = el('div');
    const node = el('div', { class: 'panel' },
      el('h2', {}, 'Clocks'),
      el('p', {}, 'Hovering means firing the probe’s engines to stay put. Close to the horizon that takes enormous thrust; the clock readings are what you would get.'),
      el('div', { class: 'group' }, radius.node, motion.node),
      this.bigNode,
      this.statsNode,
      el('button', { class: 'btn', type: 'button', onclick: () => { this.tFar = 0; this.tProbe = 0; this.refresh(); } }, 'Reset clocks'),
      el('p', {}, 'Hovering here is the zero angular momentum observer: it hovers at fixed r and θ while being swept around by the spinning space.'),
    );
    queueMicrotask(() => this.refresh());
    return node;
  }
}
