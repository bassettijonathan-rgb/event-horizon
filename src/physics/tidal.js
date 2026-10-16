// Tides near a black hole. In the freely falling frame of a body dropped
// radially into a Schwarzschild hole, the tidal tensor is diagonal:
//
//   radial:      +2GM/r³  (stretch)
//   transverse:  −GM/r³   (squeeze, twice)
//
// so a body of length ℓ feels a head-to-foot pull difference of 2GMℓ/r³.
// The same form is used for spinning holes (see README, simplifications).

import { G, M_SUN_KG, R_SUN, R_EARTH, M_EARTH_KG, G_EARTH, massTime } from './units.js';

// Bodies, with the cohesion that holds them together, written as the
// restoring acceleration per unit stretch ω² (s⁻²). For a self-gravitating
// ball of uniform density, interior gravity is exactly −(Gm/R³)·x.
// For a person we assume tearing begins when the pull difference across
// the body exceeds about 100 g (an order-of-magnitude figure).
export const BODIES = {
  human: {
    id: 'human',
    name: 'Person',
    length: 1.8,
    mass: 70,
    cohesion: (100 * G_EARTH) / 1.8,
    cohesionLabel: 'body strength (≈100 g across the body)',
  },
  star: {
    id: 'star',
    name: 'Sun-like star',
    length: 2 * R_SUN,
    mass: M_SUN_KG,
    cohesion: (G * M_SUN_KG) / (R_SUN * R_SUN * R_SUN),
    cohesionLabel: 'its own gravity',
  },
  planet: {
    id: 'planet',
    name: 'Earth-like planet',
    length: 2 * R_EARTH,
    mass: M_EARTH_KG,
    cohesion: (G * M_EARTH_KG) / (R_EARTH * R_EARTH * R_EARTH),
    cohesionLabel: 'its own gravity',
  },
};

// Tidal tensor eigenvalues (s⁻²) at Schwarzschild radius r (metres) from a
// hole of `solarMasses`.
export function tidalTensor(rMeters, solarMasses) {
  const gm = G * solarMasses * M_SUN_KG;
  const k = gm / (rMeters * rMeters * rMeters);
  return { radial: 2 * k, transverse: -k };
}

// Radius (metres) where tides overcome the body's cohesion.
export function disruptionRadius(body, solarMasses) {
  const gm = G * solarMasses * M_SUN_KG;
  return Math.cbrt((2 * gm) / body.cohesion);
}

// Radial free fall from rest at r0 (units of M): the cycloid
// r = (r0/2)(1 + cos η), τ = √(r0³/8)(η + sin η). Returns r at proper time τ.
export function radialFall(r0, tau) {
  const k = Math.sqrt((r0 * r0 * r0) / 8);
  // Solve η + sin η = τ/k on [0, π] by Newton's method.
  const target = Math.min(tau / k, Math.PI);
  let eta = Math.min(target, Math.PI * 0.999);
  for (let i = 0; i < 40; i++) {
    const f = eta + Math.sin(eta) - target;
    const d = 1 + Math.cos(eta);
    if (d < 1e-12) break;
    eta = Math.min(Math.PI, Math.max(0, eta - f / d));
  }
  return (r0 / 2) * (1 + Math.cos(eta));
}

// Proper time (units of M) from rest at r0 down to radius r.
export function fallTime(r0, r) {
  const eta = Math.acos(Math.max(-1, Math.min(1, (2 * r) / r0 - 1)));
  return Math.sqrt((r0 * r0 * r0) / 8) * (eta + Math.sin(eta));
}

// A falling body, described by its stretch s_r along the fall line and its
// width s_t across it, both relative to its rest size. While the tide is
// weaker than the body's cohesion it holds together with a small elastic
// strain; once 2GM/r³ exceeds the cohesion the pieces move apart on their own
// geodesics, following the geodesic deviation equation
//   s_r'' = (2GM/r³) s_r,   s_t'' = −(GM/r³) s_t
// in the body's proper time. Everything here is in units of M.
export class FallingBody {
  constructor(body, solarMasses, r0) {
    this.body = body;
    this.mass = solarMasses;
    this.r0 = r0;
    this.tau = 0;
    this.r = r0;
    this.sr = 1;
    this.vr = 0;
    this.st = 1;
    this.vt = 0;
    this.torn = false;
    this.tornAt = null;
    this.total = fallTime(r0, 0);
    const tM = massTime(solarMasses);
    this.w2 = body.cohesion * tM * tM;
  }

  // Advance by dTau of proper time.
  advance(dTau) {
    let left = Math.min(dTau, this.total - this.tau);
    let guard = 0;
    while (left > 1e-12 && guard++ < 4000) {
      const r = Math.max(this.r, 1e-4);
      const k = 1 / (r * r * r);
      const h = Math.min(left, 0.05 / Math.sqrt(2 * k), 0.05 * r);
      if (!this.torn && 2 * k >= this.w2) {
        this.torn = true;
        this.tornAt = this.r;
      }
      if (!this.torn) {
        const strain = (2 * k) / this.w2;
        this.sr = 1 + 0.15 * strain;
        this.st = 1 - 0.075 * strain;
      } else {
        // Velocity Verlet on the free deviation equations.
        this.vr += 0.5 * h * 2 * k * this.sr;
        this.vt -= 0.5 * h * k * this.st;
        this.sr = Math.min(1e9, this.sr + h * this.vr);
        this.st = Math.max(1e-6, this.st + h * this.vt);
      }
      this.tau += h;
      left -= h;
      this.r = Math.max(radialFall(this.r0, this.tau), 0);
      if (this.torn) {
        const r2 = Math.max(this.r, 1e-4);
        const k2 = 1 / (r2 * r2 * r2);
        this.vr += 0.5 * h * 2 * k2 * this.sr;
        this.vt -= 0.5 * h * k2 * this.st;
      }
    }
  }

  get crossed() {
    return this.r <= 2;
  }

  get atSingularity() {
    return this.tau >= this.total - 1e-9;
  }
}
