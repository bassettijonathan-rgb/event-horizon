// Physical constants (SI) and conversions to geometric units (G = c = 1).
// Inside the physics modules lengths and times are measured in units of the
// black hole mass M, so a hole of mass m has GM/c^2 = 1 and GM/c^3 = 1.

export const C = 299792458; // m/s
export const G = 6.6743e-11; // m^3 kg^-1 s^-2
export const GM_SUN = 1.32712440018e20; // m^3/s^2 (IAU nominal)
export const M_SUN_KG = GM_SUN / G;
export const M_SUN_LENGTH = GM_SUN / (C * C); // 1476.6 m
export const M_SUN_TIME = GM_SUN / (C * C * C); // 4.9255 microseconds

export const AU = 1.495978707e11; // m
export const PC = 3.0856775814913673e16; // m
export const MPC = 1e6 * PC;
export const R_SUN = 6.957e8; // m (IAU nominal)
export const R_EARTH = 6.371e6; // m
export const M_EARTH_KG = 5.9722e24;
export const G_EARTH = 9.80665; // m/s^2

export const DAY = 86400; // s
export const YEAR = 365.25 * DAY;
export const CENTURY = 36525 * DAY;

export const ARCSEC = Math.PI / (180 * 3600);
export const MICROARCSEC = 1e-6 * ARCSEC;

// Length and time of 1 M for a hole of `solarMasses` solar masses.
export function massLength(solarMasses) {
  return solarMasses * M_SUN_LENGTH;
}

export function massTime(solarMasses) {
  return solarMasses * M_SUN_TIME;
}

// Human-readable duration, e.g. "3.2 years" or "41 minutes".
export function formatDuration(seconds) {
  const s = Math.abs(seconds);
  if (!Number.isFinite(s)) return 'forever';
  if (s < 1e-6) return `${(seconds * 1e9).toPrecision(3)} ns`;
  if (s < 1e-3) return `${(seconds * 1e6).toPrecision(3)} µs`;
  if (s < 1) return `${(seconds * 1e3).toPrecision(3)} ms`;
  if (s < 120) return `${seconds.toPrecision(3)} s`;
  if (s < 7200) return `${(seconds / 60).toPrecision(3)} minutes`;
  if (s < 2 * DAY) return `${(seconds / 3600).toPrecision(3)} hours`;
  if (s < 2 * YEAR) return `${(seconds / DAY).toPrecision(3)} days`;
  const y = seconds / YEAR;
  if (Math.abs(y) < 1e6) return `${y.toPrecision(3)} years`;
  if (Math.abs(y) < 1e9) return `${(y / 1e6).toPrecision(3)} million years`;
  if (Math.abs(y) < 1e12) return `${(y / 1e9).toPrecision(3)} billion years`;
  return `${y.toExponential(2)} years`;
}

// Human-readable length.
export function formatLength(m) {
  const s = Math.abs(m);
  if (s < 1) return `${(m * 100).toPrecision(3)} cm`;
  if (s < 1e4) return `${m.toPrecision(3)} m`;
  if (s < 1e9) return `${(m / 1e3).toPrecision(3)} km`;
  if (s < 0.1 * PC) return `${(m / AU).toPrecision(3)} AU`;
  return `${(m / PC).toPrecision(3)} pc`;
}
