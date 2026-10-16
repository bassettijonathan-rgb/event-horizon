// The probe's camera: a position in the drawing frame (see kerr.toCartesian)
// and an orthonormal orientation. It converts to the uniforms the ray tracer
// needs: Boyer–Lindquist position and the camera axes in the local frame.

import { fromCartesian, toCartesian, localAxes, horizonRadius, circularSpeed } from '../physics/kerr.js';

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const scale = (u, s) => [u[0] * s, u[1] * s, u[2] * s];
const add = (u, v) => [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
const norm = (u) => scale(u, 1 / (Math.hypot(u[0], u[1], u[2]) || 1));

// Rotate v about unit axis k by angle t (Rodrigues).
export function rotate(v, k, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

export class Camera {
  constructor() {
    this.a = 0;
    this.pos = [30, 0, 4];
    this.fwd = [-1, 0, 0];
    this.up = [0, 0, 1];
    this.fov = 60;
    this.motion = 'hover'; // 'hover' or 'orbit'
    this.lookAtHole();
  }

  get bl() {
    return fromCartesian(this.a, ...this.pos);
  }

  get right() {
    return norm(cross(this.fwd, this.up));
  }

  // Place at Boyer–Lindquist (r, θ, φ), looking at the hole.
  place(r, theta, phi = 0) {
    this.pos = toCartesian(this.a, r, theta, phi);
    this.lookAtHole();
  }

  lookAtHole(roll = 0) {
    this.fwd = norm(scale(this.pos, -1));
    let up = [0, 0, 1];
    if (Math.abs(dot(up, this.fwd)) > 0.999) up = [1, 0, 0];
    const right = norm(cross(this.fwd, up));
    this.up = rotate(norm(cross(right, this.fwd)), this.fwd, roll);
  }

  // Turn the view: yaw about the camera's up, pitch about its right.
  turn(yaw, pitch) {
    const right = this.right;
    this.fwd = norm(rotate(this.fwd, this.up, yaw));
    this.fwd = norm(rotate(this.fwd, right, pitch));
    this.up = norm(rotate(this.up, right, pitch));
    // Re-orthonormalise.
    const r = norm(cross(this.fwd, this.up));
    this.up = norm(cross(r, this.fwd));
  }

  roll(angle) {
    this.up = norm(rotate(this.up, this.fwd, angle));
  }

  // Fly along the view direction (and sideways); distances scale with r so
  // the controls feel the same far out and close in.
  fly(forward, sideways = 0, upward = 0) {
    const r = this.bl[0];
    const step = Math.max(0.05, 0.6 * (r - horizonRadius(this.a)));
    let p = add(this.pos, scale(this.fwd, forward * step));
    p = add(p, scale(this.right, sideways * step));
    p = add(p, scale(this.up, upward * step));
    const [r2] = fromCartesian(this.a, ...p);
    const rMin = horizonRadius(this.a) + 0.15;
    if (r2 < rMin) p = scale(norm(p), Math.hypot(...toCartesian(this.a, rMin, Math.acos(norm(p)[2]), 0)));
    if (r2 > 400) p = scale(norm(p), 400);
    this.pos = p;
  }

  setSpin(a) {
    const [r, th, ph] = this.bl;
    this.a = a;
    this.pos = toCartesian(a, Math.max(r, horizonRadius(a) + 0.15), th, ph);
  }

  // Probe speed relative to the local ZAMO, in the local (r̂, θ̂, φ̂) frame.
  velocity() {
    if (this.motion !== 'orbit') return [0, 0, 0];
    const [r, th] = this.bl;
    // Circular orbits exist down to the photon orbit; the probe flies one
    // along its current circle of latitude, projected onto the equator.
    const v = circularSpeed(r * Math.sin(th) + 1e-9, this.a, true);
    return [0, 0, v && v < 0.999 ? v : 0];
  }

  // Advance the probe along its orbit by coordinate time dt (units of M).
  advance(dt, omega) {
    if (this.motion !== 'orbit' || !omega) return;
    const angle = omega * dt;
    const z = [0, 0, 1];
    this.pos = rotate(this.pos, z, angle);
    this.fwd = rotate(this.fwd, z, angle);
    this.up = rotate(this.up, z, angle);
  }

  uniforms(canvasHeight) {
    const [r, th, ph] = this.bl;
    const { er, eth, eph } = localAxes(this.a, r, th, ph);
    const local = (v) => [dot(v, er), dot(v, eth), dot(v, eph)];
    const tanHalfFov = Math.tan((this.fov * Math.PI) / 360);
    return {
      cam: [r, th, ph],
      right: local(this.right),
      up: local(this.up),
      fwd: local(this.fwd),
      beta: this.velocity(),
      tanHalfFov,
      pix: (2 * tanHalfFov) / Math.max(1, canvasHeight),
    };
  }
}
