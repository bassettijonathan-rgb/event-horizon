import test from 'node:test';
import assert from 'node:assert/strict';
import { runValidation } from '../src/physics/validation.js';
import { Orbit, schwarzschildOrbit, equatorialOrbit, separatrixPeriapsis } from '../src/physics/orbits.js';
import { fromLocalVelocity, iscoRadius } from '../src/physics/kerr.js';

test('every Validation panel check is within 1% of its textbook value', () => {
  const rows = runValidation();
  assert.ok(rows.length >= 8);
  for (const row of rows) {
    console.log(`${row.pass ? 'ok  ' : 'FAIL'} ${row.title}: ${row.value.toFixed(row.digits + 2)} vs ${row.expected.toFixed(row.digits + 2)} ${row.unit} (${(row.relErr * 100).toFixed(4)}%)`);
    assert.ok(row.pass, `${row.title}: ${row.value} vs ${row.expected}`);
    assert.ok(row.relErr <= 0.01);
  }
});

test('a weak-field orbit precesses by 6π/p per revolution', () => {
  const p = 1000;
  const { c, s } = schwarzschildOrbit(p, 0.3);
  const o = new Orbit(c, s);
  const period = 2 * Math.PI * Math.pow(p / (1 - 0.09), 1.5);
  o.advanceTo(3.2 * period, 0.002, 1e7);
  assert.equal(o.status, 'free');
  assert.ok(o.periapses.length >= 3);
  const shift = o.periapses[1].phi - o.periapses[0].phi - 2 * Math.PI;
  assert.ok(Math.abs(shift / (6 * Math.PI / p) - 1) < 0.02, `shift ${shift}`);
});

test('a particle dropped from rest falls in, a circular orbit outside the ISCO does not', () => {
  const drop = fromLocalVelocity(0, 10, Math.PI / 2, 0, [0, 0, 0], true);
  const o1 = new Orbit(drop.c, drop.s);
  o1.advanceTo(500, 0.01, 1e6);
  assert.equal(o1.status, 'plunged');

  const circ = fromLocalVelocity(0, 8, Math.PI / 2, 0, [0, 0, 1 / Math.sqrt(6)], true);
  const o2 = new Orbit(circ.c, circ.s);
  o2.advanceTo(2000, 0.01, 1e6);
  assert.equal(o2.status, 'free');
  assert.ok(Math.abs(o2.r - 8) < 1e-4, `r drifted to ${o2.r}`);
});

test('proper time runs slower than coordinate time on a bound orbit', () => {
  const circ = fromLocalVelocity(0, 8, Math.PI / 2, 0, [0, 0, 1 / Math.sqrt(6)], true);
  const o = new Orbit(circ.c, circ.s);
  o.advanceTo(1000, 0.01, 1e6);
  // dτ/dt = √(1 − 3/r) for a circular Schwarzschild orbit.
  assert.ok(Math.abs(o.tau / o.t - Math.sqrt(1 - 3 / 8)) < 1e-6, `${o.tau / o.t}`);
});

test('zoom-whirl orbits exist just outside the separatrix', () => {
  for (const a of [0, 0.9]) {
    const rs = separatrixPeriapsis(a, 20, true);
    assert.ok(rs < iscoRadius(a, true), `separatrix ${rs}`);
    if (a === 0) assert.ok(Math.abs(rs - 40 / 9) < 1e-6);
    const orbit = equatorialOrbit(a, rs * 1.0005, 20, true);
    assert.ok(orbit, 'orbit exists');
    const o = new Orbit(orbit.c, orbit.s);
    o.advanceTo(3000, 0.005, 2e6);
    assert.equal(o.status, 'free');
    // The whirl: φ advances by far more than 2π between periapses.
    if (o.periapses.length >= 2) assert.ok(o.periapses[1].phi - o.periapses[0].phi > 4 * Math.PI);
  }
});
