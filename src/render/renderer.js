// Picks WebGPU when the browser offers it and falls back to WebGL2. WebGPU
// has to survive one test frame first; some browsers hand out an adapter
// whose device cannot present to a canvas.

import { createWebGPU } from './webgpu.js';
import { createWebGL2 } from './webgl2.js';

const TEST_FRAME = {
  a: 0.5, cam: [30, 1.4, 0], right: [0, 0, 1], up: [0, -1, 0], fwd: [-1, 0, 0], beta: [0, 0, 0],
  tanHalfFov: 0.5, pix: 0.01, time: 0, disk: [4, 10, 5500, 1], flags: 3, maxSteps: 50, eps: 0.1, rEsc: 60,
};

async function survives(r) {
  try {
    r.rayTrace(TEST_FRAME);
    const ok = await Promise.race([
      Promise.resolve(r.finish()).then(() => true),
      new Promise((res) => setTimeout(() => res(false), 4000)),
    ]);
    return ok && r.errors.length === 0;
  } catch {
    return false;
  }
}

// A fresh canvas in place of one that already holds another context type.
export function freshCanvas(canvas) {
  const c = canvas.cloneNode();
  canvas.replaceWith(c);
  return c;
}

export async function createRenderer(canvas, { prefer = 'auto' } = {}) {
  const notes = [];
  let target = canvas;
  if (prefer !== 'webgl2') {
    try {
      const r = await createWebGPU(canvas);
      if (r && (await survives(r))) return { renderer: r, notes, canvas };
      notes.push(r ? 'WebGPU could not draw to the page; using WebGL2.' : 'WebGPU is not available here.');
      if (r) target = freshCanvas(canvas);
    } catch (e) {
      notes.push(`WebGPU failed: ${e.message}`);
      target = freshCanvas(canvas);
    }
  }
  try {
    const r = createWebGL2(target);
    if (r) return { renderer: r, notes, canvas: target };
  } catch (e) {
    notes.push(`WebGL2 failed: ${e.message}`);
  }
  return { renderer: null, notes, canvas: target };
}
