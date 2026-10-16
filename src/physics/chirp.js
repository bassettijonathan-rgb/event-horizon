// Gravitational-wave chirp of two merging black holes.
//
// Inspiral: post-Newtonian energy balance (TaylorT4) to 2PN order,
//   dv/dt = (32/5)(η/M) v⁹ [1 − (743/336 + 11η/4) v² + 4π v³
//                          + (34103/18144 + 13661η/2016 + 59η²/18) v⁴]
//   dΦ/dt = v³/M,   f_GW = v³/(πM),   h = (4ηM/D) v² cos 2Φ
// with v = (πM f_GW)^(1/3). Merger and ringdown are an approximation: the
// frequency rises to the fundamental quasinormal mode of the final hole and
// the amplitude decays with its damping time (Berti, Cardoso & Will 2006
// fits). A numerical-relativity merger is out of scope.

import { M_SUN_TIME, M_SUN_LENGTH, MPC } from './units.js';

export function chirpMass(m1, m2) {
  return Math.pow(m1 * m2, 0.6) / Math.pow(m1 + m2, 0.2);
}

export function symmetricMassRatio(m1, m2) {
  return (m1 * m2) / ((m1 + m2) * (m1 + m2));
}

// Final mass and spin of a non-spinning binary (fits to numerical relativity).
export function remnant(m1, m2) {
  const M = m1 + m2;
  const eta = symmetricMassRatio(m1, m2);
  const spin = 2 * Math.sqrt(3) * eta - 3.5171 * eta * eta + 2.5763 * eta * eta * eta;
  const mass = M * (1 + (Math.sqrt(8 / 9) - 1) * eta - 0.4333 * eta * eta - 0.4392 * eta * eta * eta);
  return { mass, spin };
}

// l = m = 2 fundamental ringdown mode of a hole of mass Mf (solar masses,
// detector frame) and spin af: frequency (Hz) and damping time (s).
export function ringdown(Mf, af) {
  const w = 1.5251 - 1.1568 * Math.pow(1 - af, 0.1292);
  const q = 0.7 + 1.4187 * Math.pow(1 - af, -0.499);
  const omega = w / (Mf * M_SUN_TIME);
  return { f: omega / (2 * Math.PI), tau: (2 * q) / omega };
}

// Inspiral time from GW frequency f to coalescence at Newtonian order (s).
export function newtonianTimeToMerger(mcSolar, f) {
  const mc = mcSolar * M_SUN_TIME;
  return (5 / 256) * Math.pow(mc, -5 / 3) * Math.pow(Math.PI * f, -8 / 3);
}

// Number of GW cycles between f1 and f2 at Newtonian order.
export function newtonianCycles(mcSolar, f1, f2) {
  const mc = mcSolar * M_SUN_TIME;
  return (Math.pow(mc, -5 / 3) * (Math.pow(f1, -5 / 3) - Math.pow(f2, -5 / 3))) / (32 * Math.pow(Math.PI, 8 / 3));
}

// Generates the strain h(t) seen from face-on at luminosity distance D.
// Masses are source-frame solar masses; redshift z stretches the signal.
// pn: 0 (Newtonian) or 2. merger: append the merger–ringdown approximation.
export function waveform({ m1, m2, z = 0, distanceMpc = 440, fLow = 20, fs = 4096, pn = 2, merger = true, fStop = null }) {
  const Msol = (m1 + m2) * (1 + z);
  const M = Msol * M_SUN_TIME; // seconds
  const eta = symmetricMassRatio(m1, m2);
  const D = distanceMpc * MPC;
  const ampScale = (4 * eta * Msol * M_SUN_LENGTH) / D;
  const c2 = -(743 / 336 + (11 / 4) * eta);
  const c3 = 4 * Math.PI;
  const c4 = 34103 / 18144 + (13661 / 2016) * eta + (59 / 18) * eta * eta;
  const vdot = (v) => {
    const v2 = v * v;
    let poly = 1;
    if (pn >= 2) poly += c2 * v2 + c3 * v2 * v + c4 * v2 * v2;
    return ((32 / 5) * eta * Math.pow(v, 9) * poly) / M;
  };
  const vIsco = 1 / Math.sqrt(6);
  const vEnd = fStop ? Math.cbrt(Math.PI * M * fStop) : vIsco;
  const dt = 1 / fs;
  let v = Math.cbrt(Math.PI * M * fLow);
  let phi = 0; // orbital phase
  const t = [];
  const h = [];
  const f = [];
  let time = 0;
  while (v < vEnd && t.length < 1e7) {
    t.push(time);
    h.push(ampScale * v * v * Math.cos(2 * phi));
    f.push((v * v * v) / (Math.PI * M));
    // RK4 on (v, φ).
    const k1v = vdot(v), k1p = (v * v * v) / M;
    const v2 = v + 0.5 * dt * k1v;
    const k2v = vdot(v2), k2p = (v2 * v2 * v2) / M;
    const v3 = v + 0.5 * dt * k2v;
    const k3v = vdot(v3), k3p = (v3 * v3 * v3) / M;
    const v4 = v + dt * k3v;
    const k4v = vdot(v4), k4p = (v4 * v4 * v4) / M;
    v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    phi += (dt / 6) * (k1p + 2 * k2p + 2 * k3p + k4p);
    time += dt;
  }
  const tInspiralEnd = time;
  const rem = remnant(m1, m2);
  const ring = ringdown(rem.mass * (1 + z), rem.spin);
  let hPeak = ampScale * v * v;
  if (merger) {
    // Frequency climbs from the ISCO value to the ringdown frequency over a
    // few M while the amplitude rises to its peak, then rings down.
    const fIsco = (v * v * v) / (Math.PI * M);
    const tRise = 12 * M;
    const aIsco = ampScale * v * v;
    const aPeak = 1.35 * aIsco;
    hPeak = aPeak;
    let gwPhase = 2 * phi;
    const tEnd = tInspiralEnd + tRise + 12 * ring.tau;
    while (time < tEnd) {
      const x = time - tInspiralEnd;
      const s = Math.min(1, x / tRise);
      const ease = s * s * (3 - 2 * s);
      const freq = fIsco + (ring.f - fIsco) * ease;
      const amp = x < tRise ? aIsco + (aPeak - aIsco) * ease : aPeak * Math.exp(-(x - tRise) / ring.tau);
      t.push(time);
      h.push(amp * Math.cos(gwPhase));
      f.push(freq);
      gwPhase += 2 * Math.PI * freq * dt;
      time += dt;
    }
  }
  return {
    t: Float64Array.from(t),
    h: Float64Array.from(h),
    f: Float64Array.from(f),
    fs,
    tInspiralEnd,
    tPeak: merger ? tInspiralEnd + 12 * M : tInspiralEnd,
    hPeak,
    remnant: rem,
    ring,
    chirpMass: chirpMass(m1, m2),
    eta,
  };
}

// Measures the chirp mass from a strain series the way the LIGO discovery
// paper did, from the frequency and its rate of change: at Newtonian order
// f^(−8/3) falls linearly in time with slope (256/5) π^(8/3) (GMc/c³)^(5/3).
// Frequencies come from zero crossings of h between f1 and f2.
export function measureChirpMass(series, f1, f2) {
  const { h, fs } = series;
  const crossings = [];
  for (let i = 1; i < h.length; i++) {
    if ((h[i - 1] < 0 && h[i] >= 0) || (h[i - 1] > 0 && h[i] <= 0)) {
      crossings.push((i - 1 + h[i - 1] / (h[i - 1] - h[i])) / fs);
    }
  }
  const xs = [];
  const ys = [];
  for (let i = 1; i < crossings.length; i++) {
    const freq = 1 / (2 * (crossings[i] - crossings[i - 1]));
    if (freq >= f1 && freq <= f2) {
      xs.push(0.5 * (crossings[i] + crossings[i - 1]));
      ys.push(Math.pow(freq, -8 / 3));
    }
  }
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const mc = Math.pow(-slope / ((256 / 5) * Math.pow(Math.PI, 8 / 3)), 3 / 5);
  return { chirpMass: mc / M_SUN_TIME, samples: n };
}

// Time between the waveform first reaching f1 and first reaching f2 (s).
export function sweepTime(series, f1, f2) {
  const { f, t } = series;
  let t1 = null;
  for (let i = 1; i < f.length; i++) {
    if (t1 === null && f[i] >= f1) t1 = t[i - 1] + ((f1 - f[i - 1]) / (f[i] - f[i - 1])) * (t[i] - t[i - 1]);
    if (f[i] >= f2) return t[i - 1] + ((f2 - f[i - 1]) / (f[i] - f[i - 1])) * (t[i] - t[i - 1]) - t1;
  }
  return null;
}

// GW cycles between f1 and f2 in a series.
export function cyclesBetween(series, f1, f2) {
  const { f, fs } = series;
  let n = 0;
  for (let i = 0; i < f.length; i++) if (f[i] >= f1 && f[i] <= f2) n += f[i] / fs;
  return n;
}

// GW150914 (GWTC-1, Abbott et al. 2019): source-frame masses, redshift and
// luminosity distance.
export const GW150914 = { m1: 35.6, m2: 30.6, z: 0.09, distanceMpc: 440, chirpMass: 28.6 };
