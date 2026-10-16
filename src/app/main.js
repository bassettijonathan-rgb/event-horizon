// App shell: modes, the render loop and adaptive resolution.

import { createRenderer, freshCanvas } from '../render/renderer.js';
import { Camera } from '../render/camera.js';
import { iscoRadius } from '../physics/kerr.js';
import { HOLES } from './presets.js';
import { CARDS, MODE_CARDS } from './cards.js';
import { el } from './ui.js';
import { ViewMode } from './view.js';
import { OrbitsMode } from './orbits-view.js';
import { TidesMode } from './tides-view.js';
import { ClocksMode } from './clocks-view.js';
import { ChirpMode } from './chirp-view.js';
import { ValidationMode } from './validation-view.js';

const DEG = Math.PI / 180;
const phone = Math.min(screen.width, screen.height) < 700;

class App {
  constructor() {
    this.dom = {
      modes: document.getElementById('modes'),
      screen: document.getElementById('screen'),
      gl: document.getElementById('gl'),
      plot: document.getElementById('plot'),
      hud: document.getElementById('hud'),
      readout: document.getElementById('readout'),
      flypad: document.getElementById('flypad'),
      board: document.getElementById('board'),
      fallback: document.getElementById('fallback'),
      strip: document.getElementById('strip'),
      panel: document.getElementById('panel'),
      cards: document.getElementById('cards'),
    };
    this.state = {
      hole: HOLES[2],
      a: HOLES[2].spin,
      diskOuter: HOLES[2].disk.outer,
      flags: { disk: true, stars: true, grid: false, doppler: true },
      quality: { low: phone, scale: phone ? 0.3 : 0.5 },
      time: 0,
      timeRate: 25, // M of coordinate time per real second
    };
    this.camera = new Camera();
    this.renderer = null;
    this.frameTimes = [];
  }

  async start() {
    const { renderer, notes, canvas } = await createRenderer(this.dom.gl);
    if (canvas) this.dom.gl = canvas;
    this.renderer = renderer;
    this.backendNotes = notes;
    renderer?.lost?.then((info) => {
      if (info?.reason !== 'destroyed') this.switchToWebGL2();
    });
    if (!renderer) {
      this.dom.fallback.hidden = false;
      this.dom.fallback.textContent = 'This browser offers neither WebGPU nor WebGL2, so the ray-traced view cannot run. The Tides, Chirp and Validation modes still work.';
    }
    this.modes = [new ViewMode(this), new OrbitsMode(this), new TidesMode(this), new ClocksMode(this), new ChirpMode(this), new ValidationMode(this)];
    for (const m of this.modes) {
      const b = el('button', { role: 'tab', type: 'button', id: `tab-${m.id}`, 'aria-selected': 'false' }, m.label);
      b.addEventListener('click', () => this.setMode(m.id));
      this.dom.modes.append(b);
    }
    this.loadHole(HOLES.find((h) => h.id === 'gargantua'));
    const hash = location.hash.slice(1);
    this.setMode(this.modes.some((m) => m.id === hash) ? hash : 'view');
    new ResizeObserver(() => this.resize()).observe(this.dom.screen);
    this.resize();
    this.last = performance.now();
    const loop = (now) => {
      const raw = (now - this.last) / 1000;
      const dt = Math.min(0.1, raw);
      this.last = now;
      this.adapt(raw);
      try {
        this.mode.frame(dt);
      } catch (e) {
        console.error(e);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    globalThis.__eventHorizon = this;
  }

  // The WebGPU device was lost mid-session: carry on with WebGL2.
  async switchToWebGL2() {
    const { renderer, canvas } = await createRenderer(freshCanvas(this.dom.gl), { prefer: 'webgl2' });
    this.dom.gl = canvas;
    this.renderer = renderer;
    this.backendNotes.push('Switched to WebGL2 after the WebGPU device was lost.');
    this.setMode(this.mode.id);
  }

  loadHole(h) {
    const st = this.state;
    st.hole = h;
    st.a = h.spin;
    st.diskOuter = h.disk.outer;
    this.camera.a = h.spin;
    this.camera.motion = 'hover';
    this.camera.fov = h.camera.fov;
    this.camera.place(h.camera.r, h.camera.inclination * DEG, 0);
    this.mode?.onHole?.();
  }

  setSpin(a) {
    this.state.a = a;
    this.camera.setSpin(a);
    this.mode?.onHole?.();
  }

  setMode(id) {
    if (this.mode) this.mode.exit();
    this.mode = this.modes.find((m) => m.id === id);
    for (const b of this.dom.modes.children) b.setAttribute('aria-selected', b.id === `tab-${id}` ? 'true' : 'false');
    const usesGL = this.mode.usesRayTrace || this.mode.usesParticles;
    this.dom.gl.hidden = !usesGL;
    // Orbits draws the GPU swarm over its 2D plot; elsewhere the 2D layer is a HUD.
    this.dom.gl.style.zIndex = this.mode.usesParticles ? '2' : '0';
    this.dom.plot.style.zIndex = '1';
    this.dom.board.hidden = !this.mode.usesBoard;
    this.dom.readout.textContent = '';
    this.dom.strip.replaceChildren();
    this.dom.screen.classList.toggle('tall', !!this.mode.usesBoard);
    this.clear2d();
    this.mode.enter();
    this.renderPanel();
    this.resize();
    try {
      history.replaceState(null, '', `#${id}`);
    } catch {
      // History is not available in every frame.
    }
  }

  renderPanel() {
    this.dom.panel.replaceChildren(this.mode.panel());
    const ids = MODE_CARDS[this.mode.id] ?? [];
    this.dom.cards.parentElement.hidden = ids.length === 0;
    this.dom.cards.replaceChildren(...ids.map((id) => {
      const c = CARDS[id];
      return el('article', { class: 'card' },
        el('h3', {}, c.title),
        el('p', {}, c.text),
        c.action ? el('button', { class: 'linkish', type: 'button', onclick: () => this.mode.cardAction?.(c.action) }, c.actionLabel) : null);
    }));
  }

  setReadout(pairs) {
    this.dom.readout.replaceChildren(...pairs.map(([k, v]) => el('span', {}, el('b', {}, `${k} `), v)));
  }

  clear2d() {
    for (const c of [this.dom.plot, this.dom.hud]) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  // Canvas sizes: the ray tracer renders at a fraction of the screen's
  // pixels and the browser scales it up; everything else is full resolution.
  resize() {
    const r = this.dom.screen.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    for (const c of [this.dom.plot, this.dom.hud]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
    const s = this.mode?.usesRayTrace ? this.state.quality.scale : 1;
    const gw = Math.max(16, Math.round(w * s));
    const gh = Math.max(16, Math.round(h * s));
    if (this.dom.gl.width !== gw || this.dom.gl.height !== gh) {
      this.dom.gl.width = gw;
      this.dom.gl.height = gh;
    }
    this.mode?.onResize?.();
  }

  resetQuality() {
    this.state.quality.scale = this.state.quality.low ? 0.25 : 0.5;
    this.frameTimes = [];
    this.resize();
  }

  // Adaptive resolution: aim for 30–60 frames per second. `dt` is the raw
  // frame interval, so a very slow first frame shrinks the picture at once.
  adapt(dt) {
    if (!this.mode?.usesRayTrace) return;
    const q = this.state.quality;
    this.frameTimes.push(dt);
    const total = this.frameTimes.reduce((x, y) => x + y, 0);
    if (this.frameTimes.length < 3 || (total < 0.5 && this.frameTimes.length < 20)) return;
    const avg = total / this.frameTimes.length;
    this.frameTimes = [];
    const max = q.low ? 0.35 : 1;
    let next = q.scale;
    if (avg > 0.045) next = Math.max(0.12, q.scale * Math.max(0.4, Math.sqrt(0.03 / avg)));
    else if (avg < 0.022) next = Math.min(max, q.scale * 1.12);
    if (Math.abs(next - q.scale) > 0.005) {
      q.scale = next;
      this.resize();
    }
  }

  rayTrace() {
    if (!this.renderer) return;
    const st = this.state;
    const gl = this.dom.gl;
    const U = this.camera.uniforms(gl.height);
    const flags = (st.flags.disk ? 1 : 0) | (st.flags.stars ? 2 : 0) | (st.flags.grid ? 4 : 0) | (st.flags.doppler ? 8 : 0);
    const r = U.cam[0];
    this.renderer.rayTrace({
      a: st.a,
      ...U,
      time: st.time,
      disk: [iscoRadius(st.a, true), st.diskOuter, 5500, 1.3],
      flags,
      maxSteps: phone ? 400 : 700,
      eps: phone ? 0.06 : 0.045,
      rEsc: Math.max(80, 2.5 * r),
    });
  }

  backendLabel() {
    if (!this.renderer) return 'no GPU';
    const g = this.dom.gl;
    return `${this.renderer.kind} · ${g.width}×${g.height}`;
  }
}

const app = new App();
app.start().catch((e) => {
  console.error(e);
  const f = document.getElementById('fallback');
  f.hidden = false;
  f.textContent = `Could not start: ${e.message}`;
});
