import test from 'node:test';
import assert from 'node:assert/strict';
import { waveform, chirpMass, remnant, ringdown, GW150914 } from '../src/physics/chirp.js';
import { BODIES, disruptionRadius, FallingBody, fallTime, radialFall } from '../src/physics/tidal.js';
import { M_SUN_LENGTH } from '../src/physics/units.js';

test('GW150914 remnant and ringdown match the published values', () => {
  const rem = remnant(GW150914.m1, GW150914.m2);
  assert.ok(Math.abs(rem.mass - 63.1) < 1.5, `final mass ${rem.mass}`);
  assert.ok(Math.abs(rem.spin - 0.69) < 0.03, `final spin ${rem.spin}`);
  const ring = ringdown(rem.mass * (1 + GW150914.z), rem.spin);
  assert.ok(ring.f > 230 && ring.f < 270, `ringdown ${ring.f} Hz`);
  assert.ok(Math.abs(chirpMass(30, 30) - 60 * Math.pow(0.25, 0.6)) < 1e-12);
});

test('the full waveform chirps up and peaks near 1e-21', () => {
  const w = waveform({ ...GW150914 });
  assert.ok(w.f[0] < 25 && Math.max(...w.f) > 200);
  assert.ok(w.hPeak > 5e-22 && w.hPeak < 3e-21, `peak ${w.hPeak}`);
  for (let i = 1; i < w.f.length; i++) assert.ok(w.f[i] >= w.f[i - 1] - 1e-9);
});

test('radial free fall reaches the singularity in π√(r0³/8)', () => {
  const r0 = 20;
  const total = fallTime(r0, 0);
  assert.ok(Math.abs(total - Math.PI * Math.sqrt(r0 ** 3 / 8)) < 1e-12);
  assert.ok(Math.abs(radialFall(r0, fallTime(r0, 5)) - 5) < 1e-9);
});

test('a person is torn apart outside a stellar-mass hole but not a supermassive one', () => {
  const rs10 = 2 * 10 * M_SUN_LENGTH;
  assert.ok(disruptionRadius(BODIES.human, 10) > 10 * rs10);
  const rsBig = 2 * 4.3e6 * M_SUN_LENGTH;
  assert.ok(disruptionRadius(BODIES.human, 4.3e6) < rsBig);
  // A Sun-like star is disrupted outside Sgr A* but swallowed whole by M87*.
  assert.ok(disruptionRadius(BODIES.star, 4.3e6) > rsBig);
  assert.ok(disruptionRadius(BODIES.star, 6.5e9) < 2 * 6.5e9 * M_SUN_LENGTH);

  const fb = new FallingBody(BODIES.human, 10, 200);
  while (!fb.atSingularity) fb.advance(1);
  const rTear = disruptionRadius(BODIES.human, 10) / (10 * M_SUN_LENGTH);
  assert.ok(Math.abs(fb.tornAt - rTear) / rTear < 0.01, `torn at ${fb.tornAt}, expected ${rTear}`);
  assert.ok(fb.sr > 100);
});
