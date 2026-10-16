import test from 'node:test';
import assert from 'node:assert/strict';
import {
  horizonRadius, iscoRadius, photonOrbitRadius, circularOrbit, constants, radialPotential, polarPotential,
  fromLocalVelocity, rk4Step, stepSize, project, toCartesian, fromCartesian, circularSpeed, metric,
} from '../src/physics/kerr.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('horizon, photon orbit and ISCO limits', () => {
  close(horizonRadius(0), 2, 1e-15);
  close(horizonRadius(1), 1, 1e-15);
  close(photonOrbitRadius(0), 3, 1e-12);
  close(photonOrbitRadius(1, true), 1, 1e-9);
  close(photonOrbitRadius(1, false), 4, 1e-9);
  close(iscoRadius(0), 6, 1e-12);
  close(iscoRadius(1, true), 1, 1e-6);
  close(iscoRadius(1, false), 9, 1e-9);
});

test('circular orbits sit at a double root of the radial potential', () => {
  for (const a of [0, 0.6, 0.95]) {
    for (const r of [5, 8, 20]) {
      const o = circularOrbit(r, a, true);
      const c = constants({ a, E: o.E, L: o.L, Q: 0, mu2: 1 });
      close(radialPotential(c, r) / r ** 4, 0, 1e-12, `R a=${a} r=${r}`);
      const d = 1e-5;
      close((radialPotential(c, r + d) - radialPotential(c, r - d)) / (2 * d) / r ** 3, 0, 1e-8, `R' a=${a} r=${r}`);
    }
  }
});

test('local velocity initial data satisfies the geodesic constraints', () => {
  for (const massive of [true, false]) {
    const v = massive ? [0.2, -0.3, 0.4] : [0.3, 0.5, -0.8];
    const { c, s } = fromLocalVelocity(0.9, 7, 1.1, 0.3, v, massive);
    close(s[4] ** 2 / radialPotential(c, s[0]), 1, 1e-12, 'radial');
    close(s[5] ** 2 / polarPotential(c, s[1]), 1, 1e-12, 'polar');
  }
});

test('E, L and Q stay on the constraint surface during integration', () => {
  const { c, s } = fromLocalVelocity(0.7, 12, 1.2, 0, [0.05, 0.12, 0.3], true);
  for (let i = 0; i < 20000; i++) rk4Step(c, s, stepSize(c, s, 0.02));
  const scale = s[0] ** 4;
  close((s[4] ** 2 - radialPotential(c, s[0])) / scale, 0, 1e-8, 'radial constraint');
  close(s[5] ** 2 - polarPotential(c, s[1]), 0, 1e-6, 'polar constraint');
  assert.ok(s[0] > 2 && s[0] < 40, `still bound at r=${s[0]}`);
});

test('constraint projection keeps a long infall accurate', () => {
  const c = constants({ a: 0, E: 1, L: 3, Q: 0, mu2: 0 });
  const s = new Float64Array([1000, Math.PI / 2, 0, 0, -Math.sqrt(radialPotential(c, 1000)), 0, 0]);
  while (s[0] > 3) {
    rk4Step(c, s, stepSize(c, s, 0.004));
    project(c, s);
  }
  close(s[4] ** 2 / radialPotential(c, s[0]), 1, 1e-6);
});

test('drawing coordinates round-trip', () => {
  for (const a of [0, 0.9]) {
    const [x, y, z] = toCartesian(a, 5.5, 0.8, 2.1);
    const [r, th, ph] = fromCartesian(a, x, y, z);
    close(r, 5.5, 1e-12);
    close(th, 0.8, 1e-12);
    close(ph, 2.1, 1e-12);
  }
});

test('circular orbit speed is below light speed and matches the Schwarzschild formula', () => {
  // Schwarzschild: v = 1/√(r − 2) relative to a static observer.
  close(circularSpeed(10, 0), 1 / Math.sqrt(8), 1e-12);
  close(circularSpeed(3.0000001, 0), 1, 1e-6);
  assert.ok(circularSpeed(2, 0.99) < 1);
  close(metric(10, Math.PI / 2, 0).alpha, Math.sqrt(1 - 0.2), 1e-14);
});
