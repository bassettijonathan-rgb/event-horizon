// Validation mode: every check, its number, the textbook value and the gap.

import { runValidation } from '../physics/validation.js';
import { Camera } from '../render/camera.js';
import { el } from './ui.js';

// Renders a non-spinning hole against a white sky on the GPU and measures
// the shadow's angular radius along the middle row of pixels. For a static
// observer at r, sin α = (b_c / r) √(1 − 2/r) (Synge 1966), so the image
// gives back the critical impact parameter b_c = 3√3 M.
export function measureGpuShadow(app, size = 480) {
  const R = app.renderer;
  if (!R) return null;
  const gl = app.dom.gl;
  const keep = { w: gl.width, h: gl.height };
  gl.width = size;
  gl.height = size;
  const cam = new Camera();
  cam.a = 0;
  cam.fov = 20;
  const r = 50;
  cam.place(r, Math.PI / 2, 0);
  const U = cam.uniforms(size);
  R.rayTrace({ a: 0, ...U, time: 0, disk: [6, 20, 5500, 1], flags: 16, maxSteps: 2000, eps: 0.01, rEsc: 200 });
  const c2 = document.createElement('canvas');
  c2.width = size;
  c2.height = size;
  const g = c2.getContext('2d', { willReadFrequently: true });
  g.drawImage(gl, 0, 0);
  const row = g.getImageData(0, size / 2, size, 1).data;
  gl.width = keep.w;
  gl.height = keep.h;
  let first = -1;
  let last = -1;
  for (let i = 0; i < size; i++) {
    if (row[i * 4] < 64) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  // Pixel edges to angle: x = (2(i + 0.5) − size)/size · tan(fov/2).
  const t = U.tanHalfFov;
  const xL = ((2 * first - size) / size) * t;
  const xR = ((2 * (last + 1) - size) / size) * t;
  const alpha = 0.5 * (Math.atan(-xL) + Math.atan(xR));
  const bc = (r * Math.sin(alpha)) / Math.sqrt(1 - 2 / r);
  const pixel = (2 * t) / size;
  return { bc, pixelError: (r * pixel) / Math.sqrt(1 - 2 / r) };
}

export class ValidationMode {
  constructor(app) {
    this.app = app;
    this.id = 'validation';
    this.label = 'Validation';
    this.usesBoard = true;
    this.rows = null;
  }

  enter() {
    this.render();
    if (!this.rows) setTimeout(() => this.run(), 30);
  }

  exit() {}

  frame() {}

  run() {
    const t0 = performance.now();
    const rows = runValidation();
    const gpu = measureGpuShadow(this.app);
    if (gpu) {
      const expected = 3 * Math.sqrt(3);
      const relErr = Math.abs(gpu.bc - expected) / expected;
      rows.splice(2, 0, {
        id: 'gpu-shadow',
        title: 'Shadow edge in the GPU picture',
        value: gpu.bc,
        expected,
        unit: 'M (critical impact parameter)',
        digits: 3,
        relErr,
        pass: relErr <= 0.01,
        how: `The ${this.app.renderer.kind} ray tracer renders a non-spinning hole against a white sky; the width of the black disk, through Synge’s formula, gives the impact parameter of the shadow edge.`,
        source: 'Textbook 3√3 M ≈ 5.196 M',
        extra: `One pixel is worth ±${gpu.pixelError.toFixed(3)} M here.`,
      });
    }
    this.rows = rows;
    this.ms = performance.now() - t0;
    this.render();
    if (this.app.mode === this) this.app.renderPanel();
  }

  render() {
    const board = this.app.dom.board;
    const rows = this.rows;
    const passed = rows ? rows.filter((r) => r.pass).length : 0;
    board.replaceChildren(
      el('div', { class: 'vhead' },
        el('h2', {}, 'Validation'),
        rows
          ? el('span', { class: `pill ${passed === rows.length ? 'ok' : 'no'}` }, `${passed} of ${rows.length} within 1%`)
          : el('span', { class: 'pill wait' }, 'Running…')),
      el('div', { class: 'vlist' }, ...(rows ?? []).map((r) => el('article', { class: 'vrow' },
        el('h3', {}, r.title, el('span', { class: `pill ${r.pass ? 'ok' : 'no'}` }, r.pass ? 'pass' : 'off')),
        el('div', { class: 'vnum' }, `${r.value.toFixed(r.digits)} `, el('span', {}, r.unit)),
        el('p', {}, `Expected ${r.expected.toFixed(r.digits)}; off by ${(r.relErr * 100).toFixed(r.relErr < 1e-4 ? 4 : 2)}%.`),
        el('p', {}, r.how),
        r.extra ? el('p', {}, r.extra) : null,
        el('p', {}, el('em', {}, r.source))))),
    );
  }

  panel() {
    return el('div', { class: 'panel' },
      el('h2', {}, 'Checked against the textbook'),
      el('p', {}, 'Each number on the left is computed live, in your browser, by the same integrators that draw the other modes. Nothing is looked up.'),
      el('button', { class: 'btn primary', type: 'button', onclick: () => { this.rows = null; this.render(); setTimeout(() => this.run(), 30); } }, 'Run the checks again'),
      this.ms ? el('p', {}, `Last run took ${(this.ms / 1000).toFixed(2)} s.`) : null,
      el('p', {}, 'Simplifications: the disk is thin and its colours are illustrative, there is no plasma physics, tides use the non-spinning formula, and the merger is an approximation.'),
    );
  }
}
