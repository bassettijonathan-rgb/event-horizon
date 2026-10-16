// Orbits mode: test particles around the hole, seen from outside.
// Tracked particles are integrated on the CPU in double precision with
// trails; the swarm is integrated on the GPU, thousands at a time.

import {
  horizonRadius, iscoRadius, photonOrbitRadius, fromLocalVelocity, circularSpeed, toCartesian,
} from '../physics/kerr.js';
import { Orbit, equatorialOrbit, separatrixPeriapsis } from '../physics/orbits.js';
import { el, slider, stats, fmt } from './ui.js';

const COLORS = ['#f0a55c', '#86b9ff', '#7fd4a4', '#e98bd1', '#f2e27a', '#ff8270'];

function lookAt(eye, target, up) {
  const f = norm(sub(target, eye));
  const s = norm(cross(f, up));
  const u = cross(s, f);
  return [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1];
}
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

function gauss() {
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());
}

export class OrbitsMode {
  constructor(app) {
    this.app = app;
    this.id = 'orbits';
    this.label = 'Orbits';
    this.usesParticles = true;
    this.yaw = -0.6;
    this.pitch = 0.75;
    this.dist = 55;
    this.particles = [];
    this.t = 0;
    this.rate = 60;
    this.launch = 1;
    this.swarmInfo = null;
    this.selected = null;
  }

  enter() {
    const s = this.app.dom.screen;
    this.handlers = {
      pointerdown: (e) => {
        s.setPointerCapture?.(e.pointerId);
        this.drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId };
      },
      pointermove: (e) => {
        if (!this.drag || this.drag.id !== e.pointerId) return;
        this.yaw -= (e.clientX - this.drag.x) * 0.008;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - this.drag.y) * 0.008));
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      },
      pointerup: (e) => {
        if (this.drag && Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0) < 6) this.dropAt(e);
        this.drag = null;
      },
      wheel: (e) => {
        e.preventDefault();
        this.dist = Math.max(8, Math.min(200, this.dist * Math.exp(e.deltaY * 0.001)));
      },
    };
    for (const [k, f] of Object.entries(this.handlers)) s.addEventListener(k, f, { passive: k !== 'wheel' });
    if (this.particles.length === 0) this.preset('precess');
  }

  exit() {
    const s = this.app.dom.screen;
    for (const [k, f] of Object.entries(this.handlers)) s.removeEventListener(k, f);
    this.app.renderer?.clear?.();
  }

  onHole() {
    this.particles = [];
    this.app.renderer?.clearParticles?.();
    this.swarmInfo = null;
    if (this.app.mode === this) {
      this.preset('precess');
      this.app.renderPanel();
    }
  }

  get a() {
    return this.app.state.a;
  }

  matrices() {
    const cv = this.app.dom.plot;
    const eye = [
      this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
      this.dist * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.dist * Math.sin(this.pitch),
    ];
    const view = lookAt(eye, [0, 0, 0], [0, 0, 1]);
    const proj = perspective((40 * Math.PI) / 180, cv.width / cv.height, 0.1, 1000);
    return { eye, viewProj: mul(proj, view) };
  }

  project(m, p) {
    const v = m.viewProj;
    const x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
    const y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
    const w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
    const cv = this.app.dom.plot;
    return [(x / w * 0.5 + 0.5) * cv.width, (0.5 - y / w * 0.5) * cv.height, w];
  }

  // Tap: find where the view ray meets the equatorial plane, launch there.
  dropAt(e) {
    const rect = this.app.dom.screen.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    const { eye } = this.matrices();
    const f = norm(sub([0, 0, 0], eye));
    const s = norm(cross(f, [0, 0, 1]));
    const u = cross(s, f);
    const t = Math.tan((20 * Math.PI) / 180);
    const aspect = rect.width / rect.height;
    const d = norm([
      f[0] + t * (nx * aspect * s[0] + ny * u[0]),
      f[1] + t * (nx * aspect * s[1] + ny * u[1]),
      f[2] + t * (nx * aspect * s[2] + ny * u[2]),
    ]);
    if (Math.abs(d[2]) < 1e-6) return;
    const k = -eye[2] / d[2];
    if (k <= 0) return;
    const p = [eye[0] + k * d[0], eye[1] + k * d[1]];
    const rho = Math.hypot(p[0], p[1]);
    const r = Math.sqrt(Math.max(rho * rho - this.a * this.a, 0));
    if (r < horizonRadius(this.a) * 1.3) return;
    const vc = circularSpeed(r, this.a, true) ?? 0.9;
    const v = Math.min(0.99, vc * this.launch);
    this.add(fromLocalVelocity(this.a, r, Math.PI / 2, Math.atan2(p[1], p[0]), [0, 0, v], true), 'Dropped');
  }

  add(g, label) {
    if (!g) return;
    const o = new Orbit(g.c, g.s);
    o.s[3] = this.t;
    o.label = label;
    o.color = COLORS[this.particles.length % COLORS.length];
    this.particles.push(o);
    if (this.particles.length > 6) this.particles.shift();
    this.selected = o;
  }

  preset(id) {
    const a = this.a;
    const rI = iscoRadius(a, true);
    if (id !== 'swarm') {
      this.particles = [];
      this.app.renderer?.clearParticles?.();
      this.swarmInfo = null;
    }
    if (id === 'precess') {
      this.add(equatorialOrbit(a, 9, 22, true), 'Precessing orbit');
    } else if (id === 'whirl') {
      const rs = separatrixPeriapsis(a, 22, true);
      this.add(rs ? equatorialOrbit(a, rs * 1.0015, 22, true) : null, 'Zoom-whirl');
    } else if (id === 'isco') {
      const kick = (r) => {
        const v = circularSpeed(r, a, true);
        return fromLocalVelocity(a, r, Math.PI / 2, 0, [-0.002, 0, v], true);
      };
      this.add(kick(rI * 1.06), 'Just outside the ISCO');
      const g = kick(rI * 0.94);
      g.s[2] = Math.PI;
      this.add(g, 'Just inside the ISCO');
    } else if (id === 'plunge') {
      const r = Math.max(rI * 1.8, 6);
      this.add(fromLocalVelocity(a, r, Math.PI / 2, 0, [0, 0, circularSpeed(r, a, true) * 0.75], true), 'Plunge');
    } else if (id === 'tilt') {
      const r = 9;
      const v = circularSpeed(r, a, true) ?? 0.4;
      const i = (35 * Math.PI) / 180;
      this.add(fromLocalVelocity(a, r, Math.PI / 2, 0, [0, -v * Math.sin(i), v * Math.cos(i)], true), 'Tilted orbit');
    } else if (id === 'swarm') {
      this.releaseSwarm();
    }
    this.app.renderPanel?.();
  }

  releaseSwarm() {
    const R = this.app.renderer;
    if (!R?.supportsSwarm) {
      this.swarmInfo = { error: 'This GPU cannot render to float textures, so the swarm is off.' };
      return;
    }
    const phone = Math.min(screen.width, screen.height) < 700;
    const n = phone ? 4096 : 16384;
    const data = new Float32Array(n * 12);
    const a = this.a;
    for (let i = 0; i < n; i++) {
      const r = Math.max(horizonRadius(a) * 1.6, 11 + 2.2 * gauss());
      const th = Math.PI / 2 + 0.06 * gauss();
      const ph = 0.35 * gauss();
      const vc = circularSpeed(r, a, true) ?? 0.5;
      const v = [0.03 * gauss(), 0.03 * gauss(), Math.min(0.97, vc * (0.92 + 0.08 * gauss()))];
      const { c, s } = fromLocalVelocity(a, r, th, ph, v, true);
      data.set([s[0], s[1], s[2], this.t, s[4], s[5], 1, 0, c.E, c.L, c.Q, c.e2m1], i * 12);
    }
    R.setParticles(data, n);
    this.swarmInfo = { total: n, alive: n, at: 0 };
  }

  frame(dt) {
    const app = this.app;
    const dtM = dt * this.rate;
    this.t += dtM;
    for (const o of this.particles) {
      if (o.status === 'free') o.advanceTo(this.t, 0.01, 20000);
      o.record(2000);
    }
    const m = this.matrices();
    const R = app.renderer;
    R?.clear();
    if (R && this.swarmInfo && !this.swarmInfo.error) {
      R.stepParticles({ a: this.a, target: this.t, eps: 0.03, maxSteps: 200 });
      R.drawParticles({ viewProj: new Float32Array(m.viewProj), eye: m.eye, a: this.a, rH: horizonRadius(this.a), pointSize: 2.2 * Math.min(devicePixelRatio || 1, 2) });
      if (performance.now() - this.swarmInfo.at > 1000) {
        this.swarmInfo.at = performance.now();
        R.readParticles?.()?.then((d) => {
          if (!d || !this.swarmInfo) return;
          let alive = 0;
          for (let i = 0; i < d.count; i++) if (d.s1[i * 4 + 2] > 0.5) alive++;
          this.swarmInfo.alive = alive;
        });
      }
    } else if (R) {
      R.drawParticles({ viewProj: new Float32Array(m.viewProj), eye: m.eye, a: this.a, rH: horizonRadius(this.a), pointSize: 2 });
    }
    this.draw(m);
    this.updateReadout();
  }

  draw(m) {
    const cv = this.app.dom.plot;
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#06070b';
    g.fillRect(0, 0, W, H);
    const a = this.a;
    const ring = (r, style, dash = [], width = 1) => {
      g.beginPath();
      for (let i = 0; i <= 128; i++) {
        const p = this.project(m, toCartesian(a, r, Math.PI / 2, (i / 128) * 2 * Math.PI));
        if (i === 0) g.moveTo(p[0], p[1]);
        else g.lineTo(p[0], p[1]);
      }
      g.setLineDash(dash.map((d) => d * dpr));
      g.lineWidth = width * dpr;
      g.strokeStyle = style;
      g.stroke();
      g.setLineDash([]);
    };
    for (let r = 5; r <= 40; r += 5) ring(r, 'rgba(134,185,255,0.10)');
    ring(photonOrbitRadius(a, true), 'rgba(134,185,255,0.55)', [2, 3]);
    ring(iscoRadius(a, true), 'rgba(240,165,92,0.85)', [6, 4], 1.4);
    ring(2, 'rgba(236,230,216,0.35)', [1, 3]);
    // Spin axis.
    const top = this.project(m, [0, 0, 6]);
    const bot = this.project(m, [0, 0, -6]);
    g.strokeStyle = 'rgba(236,230,216,0.25)';
    g.lineWidth = dpr;
    g.beginPath();
    g.moveTo(bot[0], bot[1]);
    g.lineTo(top[0], top[1]);
    g.stroke();

    const eyeDir = norm(m.eye);
    const behind = (p) => dot(p, eyeDir) < 0;
    const trails = (wantBehind) => {
      for (const o of this.particles) {
        const tr = o.trail;
        g.strokeStyle = o.color;
        g.lineWidth = (o === this.selected ? 1.8 : 1.2) * dpr;
        g.beginPath();
        let open = false;
        for (let i = 0; i < tr.length; i++) {
          const p = tr[i];
          if (behind(p) !== wantBehind) {
            open = false;
            continue;
          }
          const q = this.project(m, p);
          if (!open) g.moveTo(q[0], q[1]);
          else g.lineTo(q[0], q[1]);
          open = true;
        }
        g.globalAlpha = 0.8;
        g.stroke();
        g.globalAlpha = 1;
      }
    };
    trails(true);
    // The horizon, drawn as the sphere's outline seen from the eye.
    const c0 = this.project(m, [0, 0, 0]);
    const rH = Math.hypot(horizonRadius(a), a);
    const right = norm(cross(eyeDir, [0, 0, 1]));
    const edge = this.project(m, [right[0] * rH, right[1] * rH, right[2] * rH]);
    const rad = Math.hypot(edge[0] - c0[0], edge[1] - c0[1]);
    g.fillStyle = '#000';
    g.strokeStyle = 'rgba(236,230,216,0.6)';
    g.lineWidth = dpr;
    g.beginPath();
    g.arc(c0[0], c0[1], rad, 0, 2 * Math.PI);
    g.fill();
    g.stroke();
    trails(false);
    for (const o of this.particles) {
      const p = this.project(m, o.xyz());
      g.fillStyle = o.status === 'free' ? o.color : 'rgba(236,230,216,0.4)';
      g.beginPath();
      g.arc(p[0], p[1], 3.5 * dpr, 0, 2 * Math.PI);
      g.fill();
    }
    g.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
    g.fillStyle = 'rgba(240,165,92,0.9)';
    const ip = this.project(m, toCartesian(a, iscoRadius(a, true), Math.PI / 2, -Math.PI / 2));
    g.fillText('ISCO', ip[0] + 4 * dpr, ip[1]);
    g.fillStyle = 'rgba(134,185,255,0.8)';
    const pp = this.project(m, toCartesian(a, photonOrbitRadius(a, true), Math.PI / 2, Math.PI / 2));
    g.fillText('photon orbit', pp[0] + 4 * dpr, pp[1]);
  }

  updateReadout() {
    const o = this.selected;
    const pairs = [['t', `${this.t.toFixed(0)} M`], ['spin', this.a.toFixed(3)]];
    if (this.swarmInfo?.total) pairs.push(['swarm', `${this.swarmInfo.alive} of ${this.swarmInfo.total} in orbit`]);
    if (this.swarmInfo?.error) pairs.push(['swarm', this.swarmInfo.error]);
    if (o) pairs.push([o.label, o.status === 'free' ? `r ${o.r.toFixed(2)} M` : o.status === 'plunged' ? 'fell in' : 'escaped']);
    this.app.setReadout(pairs);
    this.tick = (this.tick ?? 0) + 1;
    if (this.tick % 15 === 0 && this.statsNode) this.statsNode.replaceChildren(this.selectedStats());
  }

  selectedStats() {
    const o = this.selected;
    if (!o) return el('p', {}, 'Tap the plane to drop a particle.');
    const peri = o.periapses;
    let advance = '—';
    if (peri.length >= 2) {
      const n = peri.length - 1;
      const dphi = (peri[n].phi - peri[0].phi) / n - 2 * Math.PI;
      advance = `${((dphi * 180) / Math.PI).toFixed(1)}°`;
    }
    const rs = o.trail.map((p) => Math.hypot(p[0], p[1], p[2]));
    return stats([
      ['Particle', o.label],
      ['Energy E', o.c.E.toFixed(5)],
      ['Angular momentum L', `${o.c.L.toFixed(4)} M`],
      ['Carter constant Q', `${fmt(o.c.Q, 3)} M²`],
      ['Closest / farthest', rs.length ? `${Math.min(...rs).toFixed(2)} / ${Math.max(...rs).toFixed(2)} M` : '—'],
      ['Periapsis advance per orbit', advance],
      ['Own clock τ', `${o.tau.toFixed(0)} M`],
      ['Status', o.status === 'free' ? 'in orbit' : o.status === 'plunged' ? 'crossed the horizon' : 'escaped'],
    ]);
  }

  panel() {
    const app = this.app;
    const presets = el('div', { class: 'row' },
      ...[
        ['precess', 'Precessing'],
        ['whirl', 'Zoom-whirl'],
        ['isco', 'ISCO pair'],
        ['plunge', 'Plunge'],
        ['tilt', 'Tilted (spin)'],
        ['swarm', 'Swarm on GPU'],
      ].map(([id, label]) => el('button', { class: 'chip', type: 'button', onclick: () => this.preset(id) }, label)));
    const spin = slider({ id: 'ospin', label: 'Spin a/M', min: 0, max: 0.998, step: 0.001, value: app.state.a, format: (v) => v.toFixed(3), oninput: (v) => app.setSpin(v) });
    const speed = slider({ id: 'orate', label: 'Time speed', min: 5, max: 300, step: 5, value: this.rate, format: (v) => `${v} M/s`, oninput: (v) => { this.rate = v; } });
    const launch = slider({ id: 'olaunch', label: 'Launch speed for taps', min: 0.5, max: 1.4, step: 0.01, value: this.launch, format: (v) => `${(v * 100).toFixed(0)}% of circular`, oninput: (v) => { this.launch = v; } });
    this.statsNode = el('div', {}, this.selectedStats());
    return el('div', { class: 'panel' },
      el('h2', {}, 'Orbits'),
      el('p', {}, 'Tap the plane to drop a particle; drag to turn the view, scroll to zoom. Every path is an exact Kerr geodesic.'),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Start from'), presets),
      el('div', { class: 'group' }, spin.node, speed.node, launch.node),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Selected particle'), this.statsNode),
    );
  }
}
