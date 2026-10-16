// The Validation panel: each check runs the simulation's own integrators and
// compares the result with the textbook or published value.

import { AU, DAY, CENTURY, ARCSEC, MICROARCSEC, M_SUN_LENGTH, R_SUN, MPC } from './units.js';
import { iscoRadius } from './kerr.js';
import {
  schwarzschildOrbit, periapsisAdvance, lightDeflection, criticalImpactParameter,
  iscoFromEnergy, survivesNudge,
} from './orbits.js';
import {
  GW150914, waveform, chirpMass, measureChirpMass, sweepTime, cyclesBetween, newtonianTimeToMerger,
} from './chirp.js';

export const MERCURY = { a: 0.387098 * AU, e: 0.20563, periodDays: 87.9691 };
export const M87 = { solarMasses: 6.5e9, distanceMpc: 16.8, ringMicroarcsec: 42, ringError: 3 };

function check(fields) {
  const relErr = Math.abs(fields.value - fields.expected) / Math.abs(fields.expected);
  return { tolerance: 0.01, ...fields, relErr, pass: relErr <= (fields.tolerance ?? 0.01) };
}

export function mercuryCheck() {
  const p = (MERCURY.a * (1 - MERCURY.e * MERCURY.e)) / M_SUN_LENGTH;
  const { c, s } = schwarzschildOrbit(p, MERCURY.e);
  const perOrbit = periapsisAdvance(c, s, { orbits: 2 });
  const orbitsPerCentury = CENTURY / (MERCURY.periodDays * DAY);
  const value = (perOrbit * orbitsPerCentury) / ARCSEC;
  return check({
    id: 'mercury',
    title: 'Mercury’s perihelion shift',
    value,
    expected: 42.98,
    unit: '″ per century',
    digits: 2,
    how: 'Mercury’s orbit around the Sun integrated as a Schwarzschild geodesic through two revolutions; the shift is where each perihelion lands.',
    source: 'GR prediction 42.98″/century (Einstein 1915; observed 43.1 ± 0.5″)',
  });
}

export function shadowCheck() {
  const bc = criticalImpactParameter(0, 1);
  // Shadow diameter 2·b_c, in Schwarzschild radii (2M).
  const value = bc;
  const thetaM87 = (2 * bc * M87.solarMasses * M_SUN_LENGTH) / (M87.distanceMpc * MPC) / MICROARCSEC;
  return check({
    id: 'shadow',
    title: 'Shadow diameter',
    value,
    expected: 3 * Math.sqrt(3),
    unit: 'Schwarzschild radii',
    digits: 3,
    how: 'Light rays fired at the hole with a range of impact parameters; bisection finds the one that just escapes.',
    source: 'Textbook 3√3 ≈ 5.196 Rₛ',
    extra: `For M87* (6.5 billion M☉ at 16.8 Mpc) this gives ${thetaM87.toFixed(1)} µas. The EHT measured a ring of ${M87.ringMicroarcsec} ± ${M87.ringError} µas (2019); the bright ring sits just outside the shadow edge.`,
    m87: thetaM87,
  });
}

export function iscoChecks() {
  const rows = [];
  for (const a of [0, 0.5, 0.9, 0.998]) {
    const value = iscoFromEnergy(a, true);
    rows.push(check({
      id: `isco-${a}`,
      title: a === 0 ? 'Innermost stable orbit, no spin' : `Innermost stable orbit, spin ${a}`,
      value,
      expected: a === 0 ? 6 : iscoRadius(a, true),
      unit: 'M',
      digits: 3,
      how: 'Minimum of the circular-orbit energy along the equator, found numerically.',
      source: a === 0 ? 'Textbook 6M' : 'Bardeen, Press & Teukolsky (1972) closed form',
    }));
  }
  const outside = survivesNudge(0, 6.3);
  const inside = survivesNudge(0, 5.7);
  rows[0].extra = `Integrator test: a nudged orbit at 6.3M ${outside ? 'stays in orbit' : 'falls in'}; at 5.7M it ${inside ? 'stays in orbit' : 'falls in'}.`;
  rows[0].pass = rows[0].pass && outside && !inside;
  return rows;
}

export function deflectionCheck() {
  const b = R_SUN / M_SUN_LENGTH;
  const value = lightDeflection(b) / ARCSEC;
  return check({
    id: 'deflection',
    title: 'Starlight bent by the Sun',
    value,
    expected: 1.75,
    unit: '″',
    digits: 3,
    how: 'A light ray grazing the Sun’s edge integrated as a null geodesic from closest approach outward.',
    source: 'GR prediction 1.75″, confirmed in the 1919 eclipse expedition (Dyson, Eddington & Davidson 1920)',
  });
}

export function chirpChecks() {
  const g = GW150914;
  // Leading order isolates what the chirp mass controls.
  const w = waveform({ ...g, pn: 0, merger: false, fs: 16384, fLow: 25, fStop: 200 });
  const measured = measureChirpMass(w, 30, 60);
  const mcSource = measured.chirpMass / (1 + g.z);
  const mcDet = chirpMass(g.m1, g.m2) * (1 + g.z);
  const sweep = sweepTime(w, 35, 150);
  const sweepFormula = newtonianTimeToMerger(mcDet, 35) - newtonianTimeToMerger(mcDet, 150);
  const cycles = cyclesBetween(w, 35, 150);
  return [
    check({
      id: 'chirp-mass',
      title: 'GW150914 chirp mass',
      value: mcSource,
      expected: g.chirpMass,
      unit: 'M☉',
      digits: 2,
      how: `Waveform generated for ${g.m1} + ${g.m2} M☉ at z = ${g.z}; the chirp mass is read back from how fast its frequency rises between 30 and 60 Hz, as in the discovery paper.`,
      source: 'GWTC-1 (LIGO/Virgo 2019): 28.6 M☉ (+1.6/−1.5)',
    }),
    check({
      id: 'chirp-sweep',
      title: 'GW150914 frequency sweep 35 → 150 Hz',
      value: sweep,
      expected: sweepFormula,
      unit: 's',
      digits: 4,
      how: 'Time the integrated waveform takes to sweep from 35 to 150 Hz, against the closed-form leading-order chirp.',
      source: 'Peters (1964) quadrupole formula',
      extra: `That is ${cycles.toFixed(1)} cycles; the discovery paper describes about 8 cycles from 35 to 150 Hz over about 0.2 s.`,
    }),
  ];
}

export function runValidation() {
  return [mercuryCheck(), shadowCheck(), ...iscoChecks(), deflectionCheck(), ...chirpChecks()];
}
