// View mode: the ray-traced picture from the probe, with free flight.

import { Camera } from '../render/camera.js';
import { horizonRadius, iscoRadius, photonOrbitRadius, circularOrbit, metric } from '../physics/kerr.js';
import { massLength, formatLength } from '../physics/units.js';
import { HOLES } from './presets.js';
import { el, slider, chips, stats, fmt } from './ui.js';

export class ViewMode {
  constructor(app) {
    this.app = app;
    this.id = 'view';
    this.label = 'View';
    this.usesRayTrace = true;
    this.camera = app.camera;
    this.keys = new Set();
    this.held = null;
    this.drag = null;
    this.pinch = null;
  }

  enter() {
    const { screen } = this.app.dom;
    this.handlers = {
      pointerdown: (e) => this.onDown(e),
      pointermove: (e) => this.onMove(e),
      pointerup: (e) => this.onUp(e),
      pointercancel: (e) => this.onUp(e),
      wheel: (e) => {
        e.preventDefault();
        this.camera.fly(-Math.sign(e.deltaY) * 0.06);
      },
    };
    for (const [k, f] of Object.entries(this.handlers)) screen.addEventListener(k, f, { passive: k !== 'wheel' });
    this.keyDown = (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if ('wasdqerf'.includes(k) || k.startsWith('arrow')) {
        this.keys.add(k);
        if (k === 'f') this.camera.lookAtHole();
        e.preventDefault();
      }
    };
    this.keyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.release = (e) => this.onUp(e);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('pointerup', this.release);
    this.app.dom.flypad.hidden = false;
  }

  exit() {
    const { screen } = this.app.dom;
    for (const [k, f] of Object.entries(this.handlers)) screen.removeEventListener(k, f);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('pointerup', this.release);
    this.keys.clear();
    this.app.dom.flypad.hidden = true;
  }

  onDown(e) {
    const pad = e.target.closest?.('[data-fly]');
    if (pad) {
      this.held = pad.dataset.fly;
      pad.classList.add('held');
      if (this.held === 'look') this.camera.lookAtHole();
      return;
    }
    this.app.dom.screen.setPointerCapture?.(e.pointerId);
    this.pointers = this.pointers ?? new Map();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [p, q] = [...this.pointers.values()];
      this.pinch = Math.hypot(p.x - q.x, p.y - q.y);
    }
  }

  onMove(e) {
    if (!this.pointers?.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 2 && this.pinch) {
      const [p, q] = [...this.pointers.values()];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      this.camera.fly(((d - this.pinch) / this.pinch) * 0.8);
      this.pinch = d;
      return;
    }
    const h = this.app.dom.screen.clientHeight || 1;
    const k = ((this.camera.fov * Math.PI) / 180) / h;
    this.camera.turn(-(cur.x - prev.x) * k, -(cur.y - prev.y) * k);
  }

  onUp(e) {
    if (this.held) {
      this.app.dom.flypad.querySelectorAll('.held').forEach((b) => b.classList.remove('held'));
      this.held = null;
    }
    this.pointers?.delete(e.pointerId);
    if (!this.pointers || this.pointers.size < 2) this.pinch = null;
  }

  frame(dt) {
    const c = this.camera;
    const k = this.keys;
    const s = Math.min(dt, 0.1);
    if (k.has('w') || this.held === 'in') c.fly(0.9 * s);
    if (k.has('s') || this.held === 'out') c.fly(-0.9 * s);
    if (k.has('a')) c.fly(0, -0.9 * s);
    if (k.has('d')) c.fly(0, 0.9 * s);
    if (k.has('r')) c.fly(0, 0, 0.9 * s);
    if (k.has('q')) c.roll(-1.2 * s);
    if (k.has('e')) c.roll(1.2 * s);
    if (k.has('arrowleft')) c.turn(1.2 * s, 0);
    if (k.has('arrowright')) c.turn(-1.2 * s, 0);
    if (k.has('arrowup')) c.turn(0, 1.2 * s);
    if (k.has('arrowdown')) c.turn(0, -1.2 * s);
    const app = this.app;
    const dtM = s * app.state.timeRate;
    if (c.motion === 'orbit') {
      const [r, th] = c.bl;
      const o = circularOrbit(r * Math.sin(th), app.state.a, true);
      c.advance(dtM, o ? o.Omega : 0);
    }
    app.state.time += dtM;
    this.updateReadout();
    app.rayTrace();
  }

  probeRate() {
    const c = this.camera;
    const [r, th] = c.bl;
    const v = c.velocity()[2];
    return metric(r, th, this.app.state.a).alpha * Math.sqrt(1 - v * v);
  }

  updateReadout() {
    const app = this.app;
    const [r, th] = this.camera.bl;
    const len = massLength(app.state.hole.mass);
    const v = this.camera.velocity()[2];
    app.setReadout([
      ['r', `${r.toFixed(2)} M · ${formatLength(r * len)}`],
      ['latitude', `${(90 - (th * 180) / Math.PI).toFixed(0)}°`],
      ['speed', v ? `${(v * 100).toFixed(0)}% c` : 'hovering'],
      ['clock rate', fmt(this.probeRate(), 3)],
    ]);
  }

  panel() {
    const app = this.app;
    const st = app.state;
    const holeChips = chips(HOLES.map((h) => ({ id: h.id, label: h.name, on: h.id === st.hole.id })), {
      exclusive: true,
      onchange: (id) => {
        app.loadHole(HOLES.find((h) => h.id === id));
        app.renderPanel();
      },
    });
    const spin = slider({
      id: 'spin',
      label: 'Spin a/M',
      min: 0,
      max: 0.998,
      step: 0.001,
      value: st.a,
      format: (v) => v.toFixed(3),
      oninput: (v) => app.setSpin(v),
    });
    const fov = slider({
      id: 'fov',
      label: 'Field of view',
      min: 10,
      max: 100,
      step: 1,
      value: this.camera.fov,
      format: (v) => `${v}°`,
      oninput: (v) => { this.camera.fov = v; },
    });
    const toggles = chips([
      { id: 'disk', label: 'Disk', on: st.flags.disk },
      { id: 'stars', label: 'Starfield', on: st.flags.stars },
      { id: 'grid', label: 'Grids', on: st.flags.grid, title: 'Lensed sky grid and rings on the equatorial plane' },
      { id: 'doppler', label: 'Doppler & redshift', on: st.flags.doppler },
    ], { onchange: (id, on) => { st.flags[id] = on; } });
    app.toggleChips = toggles;
    const motion = chips([
      { id: 'hover', label: 'Hover', on: this.camera.motion === 'hover' },
      { id: 'orbit', label: 'Orbit', on: this.camera.motion === 'orbit' },
    ], { exclusive: true, onchange: (id) => { this.camera.motion = id; } });
    const quality = chips([
      { id: 'low', label: 'Low resolution', on: st.quality.low, title: 'Render fewer pixels; smoother on phones' },
    ], { onchange: (_, on) => { st.quality.low = on; app.resetQuality(); } });

    const a = st.a;
    const len = massLength(st.hole.mass);
    return el('div', { class: 'panel' },
      el('div', { class: 'group' },
        el('p', { class: 'eyebrow' }, 'Black hole'),
        holeChips.node,
        el('p', {}, st.hole.blurb)),
      el('div', { class: 'group' }, spin.node, fov.node),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Show'), toggles.node),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'Probe'), motion.node,
        el('p', {}, 'Drag to look around. Scroll, pinch or hold Forward to fly; W A S D, Q E and arrows work too.')),
      el('div', { class: 'group' }, el('p', { class: 'eyebrow' }, 'This hole'),
        stats([
          ['Mass', `${fmt(st.hole.mass, 2)} M☉`],
          ['Horizon radius', `${horizonRadius(a).toFixed(3)} M · ${formatLength(horizonRadius(a) * len)}`],
          ['Photon orbit (with / against spin)', `${photonOrbitRadius(a, true).toFixed(2)} / ${photonOrbitRadius(a, false).toFixed(2)} M`],
          ['Innermost stable orbit', `${iscoRadius(a, true).toFixed(3)} M · ${formatLength(iscoRadius(a, true) * len)}`],
        ])),
      el('div', { class: 'group' }, quality.node,
        el('p', {}, 'Disk colours are blackbody colours for a 5,500 K inner disk, so the shifts show to the eye; real disks around these holes glow in ultraviolet or X-rays.')),
    );
  }

  cardAction(action) {
    const app = this.app;
    if (action === 'doppler') {
      app.state.flags.doppler = !app.state.flags.doppler;
      app.toggleChips?.set('doppler', app.state.flags.doppler);
    }
    if (action === 'einstein') {
      // The beacon sits in direction −x; look at it through the hole.
      this.camera.motion = 'hover';
      this.camera.place(30, Math.PI / 2, 0);
      this.camera.fov = 40;
      app.state.flags.stars = true;
      app.state.flags.disk = false;
      app.renderPanel();
    }
  }
}
