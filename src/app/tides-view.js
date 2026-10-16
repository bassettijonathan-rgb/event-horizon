// Tides mode: a person, a star or a planet dropped straight into the hole.

import { BODIES, tidalTensor, disruptionRadius, FallingBody, fallTime } from '../physics/tidal.js';
import { massLength, massTime, formatLength, formatDuration, G_EARTH } from '../physics/units.js';
import { HOLES } from './presets.js';
import { el, chips, stats, fmt } from './ui.js';

const FALL_SECONDS = 14;

export class TidesMode {
  constructor(app) {
    this.app = app;
    this.id = 'tides';
    this.label = 'Tides';
    this.bodyId = 'human';
    this.holeId = null;
    this.body = null;
    this.eta = 0;
    this.running = true;
  }

  get hole() {
    return HOLES.find((h) => h.id === this.holeId) ?? this.app.state.hole;
  }

  enter() {
    if (!this.holeId) this.holeId = 'stellar';
    if (!this.body) this.reset();
  }

  exit() {}

  reset() {
    const M = this.hole.mass;
    const b = BODIES[this.bodyId];
    const rd = disruptionRadius(b, M) / massLength(M);
    this.r0 = Math.max(12, 1.8 * rd);
    this.rMin = 0.02;
    this.body = new FallingBody(b, M, this.r0);
    this.eta = 0;
    this.running = true;
  }

  frame(dt) {
    const fb = this.body;
    if (this.running && !fb.atSingularity) {
      // Step the cycloid parameter evenly: fast far out, slow motion at the end.
      const k = Math.sqrt((this.r0 ** 3) / 8);
      const eta1 = Math.min(Math.PI, this.eta + (Math.PI / FALL_SECONDS) * dt);
      const tau1 = k * (eta1 + Math.sin(eta1));
      fb.advance(Math.max(0, tau1 - fb.tau));
      this.eta = eta1;
    }
    this.draw();
    this.tick = (this.tick ?? 0) + 1;
    if (this.tick % 6 === 0) this.refresh();
  }

  x(r, W) {
    const lo = Math.log(this.rMin);
    const hi = Math.log(this.r0 * 1.15);
    const t = (Math.log(Math.max(r, this.rMin)) - lo) / (hi - lo);
    return W * 0.06 + t * W * 0.88;
  }

  draw() {
    const cv = this.app.dom.plot;
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const M = this.hole.mass;
    const fb = this.body;
    g.fillStyle = '#06070b';
    g.fillRect(0, 0, W, H);
    const cy = H * 0.5;
    // The hole, from the singularity (left edge) out to the horizon.
    const xh = this.x(2, W);
    const grad = g.createLinearGradient(0, 0, xh, 0);
    grad.addColorStop(0, '#000');
    grad.addColorStop(1, '#0b0c12');
    g.fillStyle = grad;
    g.fillRect(0, 0, xh, H);
    g.strokeStyle = 'rgba(236,230,216,0.7)';
    g.lineWidth = dpr;
    g.beginPath();
    g.moveTo(xh, H * 0.12);
    g.lineTo(xh, H * 0.88);
    g.stroke();
    g.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
    g.fillStyle = 'rgba(236,230,216,0.8)';
    g.textAlign = 'right';
    g.fillText('horizon', xh - 6 * dpr, H * 0.12 + 12 * dpr);
    g.textAlign = 'left';
    g.fillText('singularity', 6 * dpr, H * 0.12 + 12 * dpr);

    const rd = disruptionRadius(fb.body, M) / massLength(M);
    if (rd > this.rMin) {
      const xd = this.x(rd, W);
      g.strokeStyle = 'rgba(255,130,112,0.8)';
      g.setLineDash([5 * dpr, 4 * dpr]);
      g.beginPath();
      g.moveTo(xd, H * 0.2);
      g.lineTo(xd, H * 0.8);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,130,112,0.9)';
      g.textAlign = xd > W * 0.7 ? 'right' : 'left';
      g.fillText('tides beat cohesion', xd + (xd > W * 0.7 ? -6 : 6) * dpr, H * 0.8);
      g.textAlign = 'left';
    }
    // Distance ticks in M.
    g.fillStyle = 'rgba(155,152,168,0.8)';
    g.textAlign = 'center';
    for (let e = -1; e <= 7; e++) {
      const r = 10 ** e;
      if (r < this.rMin || r > this.r0 * 1.15) continue;
      const xx = this.x(r, W);
      g.fillRect(xx, H * 0.9, dpr, 5 * dpr);
      g.fillText(`${e >= 0 && e < 4 ? r : `10${sup(e)}`} M`, xx, H * 0.9 + 18 * dpr);
    }
    g.textAlign = 'left';

    // The body.
    const xb = this.x(fb.r, W);
    const base = Math.min(W, H) * 0.09;
    const len = base * (fb.sr < 3 ? fb.sr : 3 + 3 * Math.log10(fb.sr / 3));
    const wid = Math.max(1.5 * dpr, base * 0.45 * Math.max(fb.st, 0.02));
    const id = fb.body.id;
    const color = id === 'human' ? '#ece6d8' : id === 'star' ? '#ffd27a' : '#6fa8ff';
    g.save();
    g.translate(xb, cy);
    if (!fb.torn || fb.sr < 1.6) {
      g.fillStyle = color;
      if (id === 'human') {
        roundRect(g, -len / 2, -wid / 2, len, wid, wid / 2);
        g.fill();
        g.beginPath();
        g.arc(-len / 2 - wid * 0.45, 0, wid * 0.42, 0, 2 * Math.PI);
        g.fill();
      } else {
        const glow = g.createRadialGradient(0, 0, 0, 0, 0, len / 2);
        glow.addColorStop(0, color);
        glow.addColorStop(1, id === 'star' ? 'rgba(255,170,80,0.15)' : 'rgba(80,140,255,0.2)');
        g.fillStyle = glow;
        g.beginPath();
        g.ellipse(0, 0, len / 2, Math.max(wid, len * 0.5 * fb.st) / 1, 0, 0, 2 * Math.PI);
        g.fill();
      }
    } else {
      // Torn: a stream of pieces strung out along the fall line.
      const n = 40;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1) - 0.5;
        g.fillStyle = color;
        g.globalAlpha = 0.85 - 0.5 * Math.abs(f);
        g.beginPath();
        g.ellipse(f * len, 0, Math.max(1.2 * dpr, (len / n) * 0.6), Math.max(1.2 * dpr, wid / 2), 0, 0, 2 * Math.PI);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    g.restore();
    // Arrows: stretch along, squeeze across.
    g.strokeStyle = 'rgba(240,165,92,0.7)';
    g.lineWidth = 1.2 * dpr;
    arrow(g, xb + len / 2 + 8 * dpr, cy, xb + len / 2 + 28 * dpr, cy, dpr);
    arrow(g, xb - len / 2 - 14 * dpr, cy, xb - len / 2 - 34 * dpr, cy, dpr);
    arrow(g, xb, cy - base * 0.9, xb, cy - base * 0.45, dpr);
    arrow(g, xb, cy + base * 0.9, xb, cy + base * 0.45, dpr);
  }

  refresh() {
    const M = this.hole.mass;
    const fb = this.body;
    const rm = fb.r * massLength(M);
    this.app.setReadout([
      ['body', fb.body.name],
      ['hole', this.hole.name],
      ['r', `${fb.r.toPrecision(3)} M · ${formatLength(rm)}`],
      ['state', fb.torn ? 'torn apart' : 'in one piece'],
    ]);
    if (!this.statsNode) return;
    const T = tidalTensor(rm, M);
    const dA = T.radial * fb.body.length;
    const left = (fallTime(this.r0, 0) - fb.tau) * massTime(M);
    let status;
    if (fb.atSingularity) status = fb.torn ? 'Reached the singularity in pieces.' : 'Reached the singularity.';
    else if (fb.torn) status = fb.tornAt > 2 ? `Torn apart ${(fb.tornAt / 2).toFixed(1)} horizon radii out, before reaching the horizon.` : 'Crossed the horizon whole, then torn apart inside.';
    else if (fb.crossed) status = 'Crossed the horizon in one piece. Nothing marks the moment locally.';
    else status = 'Falling, still in one piece.';
    this.statusNode.textContent = status;
    this.statsNode.replaceChildren(stats([
      ['Distance', `${fb.r.toPrecision(3)} M · ${formatLength(rm)}`],
      ['Pull difference across the body', `${fmt(dA, 3)} m/s² · ${fmt(dA / G_EARTH, 3)} g`],
      ['Length now', `${fmt(fb.sr, 3)}× rest length`],
      ['Proper time left', formatDuration(left)],
    ]));
    const v = (x) => fmt(x, 2);
    this.tensorNode.replaceChildren(
      el('span', { class: 'on' }, `+${v(T.radial)}`), el('span', {}, '0'), el('span', {}, '0'),
      el('span', {}, '0'), el('span', { class: 'on' }, v(T.transverse)), el('span', {}, '0'),
      el('span', {}, '0'), el('span', {}, '0'), el('span', { class: 'on' }, v(T.transverse)));
  }

  panel() {
    const M = this.hole.mass;
    const bodyChips = chips(Object.values(BODIES).map((b) => ({ id: b.id, label: b.name, on: b.id === this.bodyId })), {
      exclusive: true,
      onchange: (id) => { this.bodyId = id; this.reset(); this.app.renderPanel(); },
    });
    const holeChips = chips(HOLES.map((h) => ({ id: h.id, label: h.name, on: h.id === this.hole.id })), {
      exclusive: true,
      onchange: (id) => { this.holeId = id; this.reset(); this.app.renderPanel(); },
    });
    const b = BODIES[this.bodyId];
    const rd = disruptionRadius(b, M);
    const rs = 2 * massLength(M);
    this.statusNode = el('p', { class: 'big' }, '');
    this.statsNode = el('div', {});
    this.tensorNode = el('div', { class: 'tensor', 'aria-label': 'Tidal tensor in the falling frame, per second squared' });
    const node = el('div', { class: 'panel' },
      el('h2', {}, 'Tides'),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Drop'), bodyChips.node),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Into'), holeChips.node),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => { this.reset(); this.refresh(); } }, 'Drop again'),
        el('button', { class: 'btn', type: 'button', onclick: (e) => { this.running = !this.running; e.target.textContent = this.running ? 'Pause' : 'Resume'; } }, 'Pause')),
      this.statusNode,
      this.statsNode,
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Tidal tensor (s⁻², falling frame: along, across, across)'), this.tensorNode),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Where tides win'),
        stats([
          ['Held together by', b.cohesionLabel],
          ['Tides win at', formatLength(rd)],
          ['Horizon radius', formatLength(rs)],
          ['Verdict', rd > rs ? 'torn apart outside the horizon' : 'crosses the horizon intact'],
        ])),
      el('p', {}, 'Tides here use the non-spinning formula; the person’s breaking point is an order-of-magnitude figure.'),
    );
    queueMicrotask(() => this.refresh());
    return node;
  }
}

function sup(e) {
  const map = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(e).split('').map((c) => map[c] ?? c).join('');
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function arrow(g, x0, y0, x1, y1, dpr) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.lineTo(x1 - 6 * dpr * Math.cos(a - 0.5), y1 - 6 * dpr * Math.sin(a - 0.5));
  g.moveTo(x1, y1);
  g.lineTo(x1 - 6 * dpr * Math.cos(a + 0.5), y1 - 6 * dpr * Math.sin(a + 0.5));
  g.stroke();
}
