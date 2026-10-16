// The orbit integrator: test particles and light rays on Kerr geodesics,
// plus the classic tests that are computed with it (perihelion precession,
// light bending, the shadow edge and the innermost stable orbit).

import {
  R, TH, PH, T, RD, TAU,
  constants, derivatives, rk4Step, project, stepSize, radialPotential, radialForce,
  horizonRadius, iscoRadius, circularOrbit, photonOrbitRadius, fromLocalVelocity, metric, toCartesian,
} from './kerr.js';

const scratch = new Float64Array(7);

// A test particle (or photon) followed in coordinate time t, the time of a
// distant observer, or in its own proper time τ.
export class Orbit {
  constructor(c, s, { clock = 't' } = {}) {
    this.c = c;
    this.s = Float64Array.from(s);
    this.clock = clock === 'tau' ? TAU : T;
    this.status = 'free';
    this.rH = horizonRadius(c.a);
    this.rEscape = 400;
    this.trail = [];
    this.periapses = [];
    this.lastRd = this.s[RD];
  }

  get r() { return this.s[R]; }
  get theta() { return this.s[TH]; }
  get phi() { return this.s[PH]; }
  get t() { return this.s[T]; }
  get tau() { return this.s[TAU]; }

  xyz() {
    return toCartesian(this.c.a, this.s[R], this.s[TH], this.s[PH]);
  }

  // Advance until the chosen clock reaches `target`. Returns steps taken.
  advanceTo(target, eps = 0.02, maxSteps = 4000) {
    const k = this.clock;
    let n = 0;
    while (this.status === 'free' && this.s[k] < target && n < maxSteps) {
      let h = stepSize(this.c, this.s, eps);
      derivatives(this.c, this.s, scratch);
      const rate = scratch[k];
      if (rate > 0) h = Math.min(h, Math.max((target - this.s[k]) / rate, 1e-9 * h) * 1.000001);
      this.step(h);
      n++;
    }
    return n;
  }

  step(h) {
    rk4Step(this.c, this.s, h);
    project(this.c, this.s);
    const rd = this.s[RD];
    if (this.lastRd < 0 && rd >= 0) this.periapses.push({ r: this.s[R], phi: this.s[PH], t: this.s[T] });
    this.lastRd = rd;
    if (this.s[R] < this.rH * 1.01) this.status = 'plunged';
    else if (this.s[R] > this.rEscape && rd > 0 && this.c.e2m1 >= 0) this.status = 'escaped';
    else if (!Number.isFinite(this.s[R])) this.status = 'lost';
  }

  // Remember the current position for drawing a trail.
  record(maxPoints = 1500) {
    this.trail.push(this.xyz());
    if (this.trail.length > maxPoints) this.trail.splice(0, this.trail.length - maxPoints);
  }
}

// Schwarzschild bound orbit from its semi-latus rectum p and eccentricity e
// (in units of M). E² − 1 and L² are exact closed forms, which keeps full
// precision even for Mercury, where E − 1 ≈ −10⁻⁸.
export function schwarzschildOrbit(p, e) {
  const d = p - 3 - e * e;
  const L = Math.sqrt((p * p) / d);
  const e2m1 = (-(1 - e * e) * (p - 4)) / (p * d);
  const c = constants({ a: 0, E: Math.sqrt(1 + e2m1), L, Q: 0, mu2: 1, e2m1 });
  const s = new Float64Array([p / (1 + e), Math.PI / 2, 0, 0, 0, 0, 0]);
  return { c, s };
}

// Equatorial bound Kerr orbit with periapsis rp and apoapsis ra, solved for
// (E, L) with Newton's method. Returns null if no such orbit exists.
export function equatorialOrbit(a, rp, ra, prograde = true, guess = null) {
  const sgn = prograde ? 1 : -1;
  let E;
  let L;
  if (guess) ({ E, L } = guess);
  else {
    const p = (2 * rp * ra) / (rp + ra);
    const e = (ra - rp) / (ra + rp);
    const d = Math.max(p - 3 - e * e, 0.5);
    L = sgn * Math.sqrt((p * p) / d);
    E = Math.sqrt(Math.max(0.1, 1 - ((1 - e * e) * Math.abs(p - 4)) / (p * d)));
  }
  const f = (r, E, L) => {
    const x = L - a * E;
    return (E * E - 1) * r * r * r + 2 * r * r + (a * a * (E * E - 1) - L * L) * r + 2 * x * x;
  };
  const dE = (r, E, L) => 2 * E * r * r * r + 2 * a * a * E * r - 4 * a * (L - a * E);
  const dL = (r, E, L) => -2 * L * r + 4 * (L - a * E);
  for (let i = 0; i < 60; i++) {
    const f1 = f(rp, E, L);
    const f2 = f(ra, E, L);
    const j11 = dE(rp, E, L), j12 = dL(rp, E, L);
    const j21 = dE(ra, E, L), j22 = dL(ra, E, L);
    const det = j11 * j22 - j12 * j21;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
    const dx = (f1 * j22 - f2 * j12) / det;
    const dy = (j11 * f2 - j21 * f1) / det;
    E -= dx;
    L -= dy;
    if (Math.abs(dx) + Math.abs(dy) < 1e-15) break;
  }
  if (!(E > 0 && E < 1) || Math.sign(L) !== sgn) return null;
  const c = constants({ a, E, L, Q: 0, mu2: 1 });
  // A real periapsis turns the particle outward: R'(rp) > 0.
  if (!(radialForce(c, rp) > 0) || !(radialForce(c, ra) < 0)) return null;
  const s = new Float64Array([rp, Math.PI / 2, 0, 0, 0, 0, 0]);
  return { c, s };
}

// Smallest periapsis a bound equatorial orbit with apoapsis ra can have: the
// separatrix. Just outside it, orbits zoom out and whirl around many times.
export function separatrixPeriapsis(a, ra, prograde = true) {
  let hi = Math.min(ra * 0.999, iscoRadius(a, prograde));
  let good = equatorialOrbit(a, hi, ra, prograde);
  if (!good) return null;
  let lo = photonOrbitRadius(a, prograde);
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const o = equatorialOrbit(a, mid, ra, prograde, { E: good.c.E, L: good.c.L });
    if (o) {
      hi = mid;
      good = o;
    } else lo = mid;
  }
  return hi;
}

// Perihelion advance per orbit, in radians, measured by integrating the
// orbit through `orbits` revolutions and locating each periapsis.
export function periapsisAdvance(c, s0, { orbits = 1, stepsPerOrbit = 20000 } = {}) {
  const s = Float64Array.from(s0);
  const L = Math.abs(c.L);
  // For a = 0 in the equatorial plane dφ/dλ = L, so this is a fixed φ step.
  const h = (2 * Math.PI) / (Math.max(L, 1e-9) * stepsPerOrbit);
  const startPhi = s[PH];
  let found = 0;
  let phiPeri = startPhi;
  const prev = new Float64Array(7);
  let guard = 0;
  while (found < orbits && guard++ < stepsPerOrbit * (orbits + 2)) {
    prev.set(s);
    rk4Step(c, s, h);
    if (prev[RD] < 0 && s[RD] >= 0) {
      // Newton on dr/dλ = 0, integrating from the step start each time.
      let dl = -prev[RD] / radialForce(c, prev[R]);
      const probe = new Float64Array(7);
      for (let i = 0; i < 6; i++) {
        probe.set(prev);
        rk4Step(c, probe, dl);
        dl -= probe[RD] / radialForce(c, probe[R]);
      }
      probe.set(prev);
      rk4Step(c, probe, dl);
      phiPeri = probe[PH];
      found++;
    }
  }
  return (phiPeri - startPhi - 2 * Math.PI * found) / found;
}

// Total bending angle of a light ray with impact parameter b (units of M)
// passing a Schwarzschild mass, from the integrated null geodesic.
export function lightDeflection(b, eps = 0.002) {
  // Closest approach: largest root of r³ − b² r + 2b² = 0.
  let r0 = b;
  for (let i = 0; i < 60; i++) r0 -= (r0 * r0 * r0 - b * b * r0 + 2 * b * b) / (3 * r0 * r0 - b * b);
  const c = constants({ a: 0, E: 1, L: b, Q: 0, mu2: 0 });
  const s = new Float64Array([r0, Math.PI / 2, 0, 0, 0, 0, 0]);
  const rEnd = 1e4 * b;
  let guard = 0;
  while (s[R] < rEnd && guard++ < 1e6) {
    let h = stepSize(c, s, eps);
    // Land exactly on rEnd once it is close.
    derivatives(c, s, scratch);
    if (scratch[R] > 0) h = Math.min(h, (rEnd - s[R]) / scratch[R] + 1e-30);
    rk4Step(c, s, h);
    if (rEnd - s[R] < 1e-9 * rEnd) break;
  }
  // Beyond rEnd the ray is a straight line to better than 1 part in 10⁹:
  // r sin(φ∞ − φ) = b.
  const phiInf = s[PH] + Math.asin(b / s[R]);
  return 2 * phiInf - Math.PI;
}

// Does a light ray coming in from far away in the equatorial plane with
// impact parameter b fall into the hole? sign = +1 for a ray orbiting with
// the spin, −1 against it.
export function photonCaptured(a, b, sign = 1, eps = 0.004) {
  const c = constants({ a, E: 1, L: sign * b, Q: 0, mu2: 0 });
  const r0 = 1000;
  const s = new Float64Array([r0, Math.PI / 2, 0, 0, -Math.sqrt(radialPotential(c, r0)), 0, 0]);
  const rH = horizonRadius(a);
  for (let i = 0; i < 200000; i++) {
    rk4Step(c, s, stepSize(c, s, eps));
    project(c, s);
    if (s[R] < rH * 1.001) return true;
    if (s[RD] > 0 && s[R] > r0) return false;
  }
  return true;
}

// Critical impact parameter (the shadow edge) by bisection on photonCaptured.
export function criticalImpactParameter(a = 0, sign = 1, tol = 1e-7) {
  let lo = 0.5;
  let hi = 12;
  while (hi - lo > tol) {
    const mid = 0.5 * (lo + hi);
    if (photonCaptured(a, mid, sign)) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ISCO found as the minimum of the circular-orbit energy E(r): inside it,
// a circular orbit is unstable because a slightly lower E would need a
// smaller radius.
export function iscoFromEnergy(a, prograde = true) {
  let lo = photonOrbitRadius(a, prograde) * 1.0001;
  let hi = 40;
  const E = (r) => circularOrbit(r, a, prograde)?.E ?? Infinity;
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let f1 = E(x1);
  let f2 = E(x2);
  while (hi - lo > 1e-10) {
    if (f1 < f2) {
      hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = E(x1);
    } else {
      lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = E(x2);
    }
  }
  return 0.5 * (lo + hi);
}

// Start a particle on the circular orbit at r with a small radial nudge
// (local speed `kick`, as a fraction of c) and report whether it survives
// `orbits` revolutions without plunging.
export function survivesNudge(a, r, { prograde = true, kick = 1e-3, orbits = 20 } = {}) {
  const o = circularOrbit(r, a, prograde);
  if (!o) return false;
  const m = metric(r, Math.PI / 2, a);
  const vphi = o.L / m.varpi / ((o.E - m.omega * o.L) / m.alpha);
  const v = [-kick, 0, vphi * Math.sqrt(1 - kick * kick)];
  const { c, s } = fromLocalVelocity(a, r, Math.PI / 2, 0, v, true);
  const orbit = new Orbit(c, s);
  const tEnd = (orbits * 2 * Math.PI) / Math.abs(o.Omega);
  orbit.advanceTo(tEnd, 0.01, 2e6);
  return orbit.status === 'free';
}
