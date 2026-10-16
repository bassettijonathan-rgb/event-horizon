// Kerr spacetime in Boyer–Lindquist coordinates, units G = c = M = 1.
//
// Geodesics are integrated in Mino time λ (dτ = Σ dλ), where Carter's
// separation gives smooth second-order equations for r and θ:
//
//   (dr/dλ)^2 = R(r),   d²r/dλ² = R'(r)/2
//   (dθ/dλ)^2 = Θ(θ),   d²θ/dλ² = Θ'(θ)/2
//
// with the conserved energy E, axial angular momentum L and Carter constant Q.
// The second-order form has no square roots, so turning points need no sign
// bookkeeping. The same equations run in the GPU shaders (src/render).
//
// The state vector is [r, θ, φ, t, dr/dλ, dθ/dλ, τ]; τ is proper time for a
// massive particle and the affine parameter for light.

export const R = 0;
export const TH = 1;
export const PH = 2;
export const T = 3;
export const RD = 4;
export const THD = 5;
export const TAU = 6;

export function horizonRadius(a) {
  return 1 + Math.sqrt(Math.max(0, 1 - a * a));
}

export function innerHorizonRadius(a) {
  return 1 - Math.sqrt(Math.max(0, 1 - a * a));
}

export function ergosphereRadius(a, theta) {
  const c = Math.cos(theta);
  return 1 + Math.sqrt(Math.max(0, 1 - a * a * c * c));
}

// Circular photon orbit in the equatorial plane (Bardeen, Press & Teukolsky 1972).
export function photonOrbitRadius(a, prograde = true) {
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(prograde ? -a : a)));
}

// Innermost stable circular orbit, closed form (Bardeen, Press & Teukolsky 1972).
export function iscoRadius(a, prograde = true) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  const root = Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return prograde ? 3 + z2 - root : 3 + z2 + root;
}

// Equatorial circular geodesic at radius r: energy, angular momentum,
// angular velocity Ω = dφ/dt and u^t = dt/dτ. Null when no timelike circular
// orbit exists there (inside the photon orbit).
export function circularOrbit(r, a, prograde = true) {
  const s = prograde ? 1 : -1;
  const sq = Math.sqrt(r);
  const k = r * sq - 3 * sq + 2 * s * a;
  if (k <= 0) return null;
  const den = Math.pow(r, 0.75) * Math.sqrt(k);
  return {
    E: (r * sq - 2 * sq + s * a) / den,
    L: (s * (r * r - 2 * s * a * sq + a * a)) / den,
    Omega: s / (r * sq + s * a),
    ut: (r * sq + s * a) / den,
  };
}

// Metric functions at (r, θ) used for the ZAMO (zero angular momentum
// observer) frame: lapse α, frame-dragging rate ω, cylindrical radius ϖ.
export function metric(r, theta, a) {
  const sn = Math.sin(theta);
  const cs = Math.cos(theta);
  const a2 = a * a;
  const sigma = r * r + a2 * cs * cs;
  const delta = r * r - 2 * r + a2;
  const A = (r * r + a2) * (r * r + a2) - a2 * delta * sn * sn;
  return {
    sigma,
    delta,
    A,
    alpha: Math.sqrt(Math.max(0, (sigma * delta) / A)),
    omega: (2 * a * r) / A,
    varpi: Math.sqrt(A / sigma) * Math.abs(sn),
    sin: sn,
    cos: cs,
  };
}

// Conserved quantities of a geodesic. mu2 = 1 for a massive particle, 0 for
// light. e2m1 = E² − μ² is stored separately because for nearly Newtonian
// orbits (Mercury) it is tiny and must not be formed as E*E − 1.
export function constants({ a, E, L, Q, mu2 = 1, e2m1 }) {
  return { a, E, L, Q, mu2, e2m1: e2m1 ?? (E - Math.sqrt(mu2)) * (E + Math.sqrt(mu2)) };
}

// Radial potential R(r), expanded so that every term keeps its precision.
export function radialPotential(c, r) {
  const { a, E, L, Q, mu2, e2m1 } = c;
  const K = (L - a * E) * (L - a * E) + Q;
  return ((e2m1 * r + 2 * mu2) * r + (a * a * e2m1 - L * L - Q)) * r * r + 2 * K * r - a * a * Q;
}

// R'(r) / 2 = d²r/dλ².
export function radialForce(c, r) {
  const { a, E, L, Q, mu2, e2m1 } = c;
  const K = (L - a * E) * (L - a * E) + Q;
  return ((2 * e2m1 * r + 3 * mu2) * r + (a * a * e2m1 - L * L - Q)) * r + K;
}

// Θ(θ) = Q + cos²θ (a² (E² − μ²) − L² / sin²θ).
export function polarPotential(c, theta) {
  const { a, L, Q, e2m1 } = c;
  const sn = Math.sin(theta);
  const cs = Math.cos(theta);
  return Q + cs * cs * (a * a * e2m1 - (L * L) / (sn * sn));
}

// Θ'(θ) / 2 = d²θ/dλ².
export function polarForce(c, theta) {
  const { a, L, e2m1 } = c;
  const sn = Math.sin(theta);
  const cs = Math.cos(theta);
  const sn3 = sn * sn * sn;
  return -a * a * e2m1 * sn * cs + (L * L * cs) / (Math.abs(sn3) < 1e-300 ? 1e-300 : sn3);
}

// d/dλ of the state. Writes into `out` (length 7) and returns it.
export function derivatives(c, s, out = new Float64Array(7)) {
  const { a, E, L } = c;
  const r = s[R];
  const th = s[TH];
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const sn2 = Math.max(sn * sn, 1e-300);
  const a2 = a * a;
  const delta = r * r - 2 * r + a2;
  const P = E * (r * r + a2) - a * L;
  out[R] = s[RD];
  out[TH] = s[THD];
  out[PH] = -(a * E - L / sn2) + (a * P) / delta;
  out[T] = -a * (a * E * sn2 - L) + ((r * r + a2) * P) / delta;
  out[RD] = radialForce(c, r);
  out[THD] = polarForce(c, th);
  out[TAU] = r * r + a2 * cs * cs;
  return out;
}

const k1 = new Float64Array(7);
const k2 = new Float64Array(7);
const k3 = new Float64Array(7);
const k4 = new Float64Array(7);
const tmp = new Float64Array(7);

// One classical Runge–Kutta step of size h in Mino time, in place.
export function rk4Step(c, s, h) {
  derivatives(c, s, k1);
  for (let i = 0; i < 7; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
  derivatives(c, tmp, k2);
  for (let i = 0; i < 7; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
  derivatives(c, tmp, k3);
  for (let i = 0; i < 7; i++) tmp[i] = s[i] + h * k3[i];
  derivatives(c, tmp, k4);
  for (let i = 0; i < 7; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return s;
}

// The second-order equations conserve ṙ² − R(r) only up to round-off and
// truncation error, and for a ray falling in from far away that drift grows
// like r⁻⁴. Away from turning points, put ṙ and θ̇ back on the constraint.
export function project(c, s) {
  const r = s[R];
  const Rr = radialPotential(c, r);
  const scale = r * r * r * r * (Math.abs(c.e2m1) + (2 * c.mu2) / r) + c.L * c.L * r * r;
  if (Rr > 1e-3 * scale) s[RD] = Math.sign(s[RD]) * Math.sqrt(Rr);
  const Th = polarPotential(c, s[TH]);
  const tscale = c.Q + c.L * c.L + c.a * c.a * Math.abs(c.e2m1);
  if (Th > 1e-3 * tscale) s[THD] = Math.sign(s[THD]) * Math.sqrt(Th);
  return s;
}

// Step size that moves r by about eps·r and the angles by about eps radians.
export function stepSize(c, s, eps) {
  derivatives(c, s, tmp);
  // The acceleration terms matter only from rest, where every velocity is 0.
  const rate = Math.abs(tmp[R]) / s[R] + Math.abs(tmp[TH]) + Math.abs(tmp[PH])
    + Math.sqrt(Math.abs(tmp[RD]) / s[R]) + Math.sqrt(Math.abs(tmp[THD]));
  return eps / (rate + 1e-12);
}

// Builds a geodesic from a position and a velocity measured by the local ZAMO
// (zero angular momentum observer), in its orthonormal (r̂, θ̂, φ̂) frame.
// For light, v is the unit propagation direction.
export function fromLocalVelocity(a, r, theta, phi, v, massive = true) {
  const m = metric(r, theta, a);
  const v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  let gamma = 1;
  let dir = v;
  if (massive) {
    if (v2 >= 1) throw new Error('speed must be below c');
    gamma = 1 / Math.sqrt(1 - v2);
  } else {
    const n = Math.sqrt(v2);
    dir = [v[0] / n, v[1] / n, v[2] / n];
  }
  const L = m.varpi * gamma * dir[2];
  const E = m.alpha * gamma + m.omega * L;
  const rd = Math.sqrt(m.sigma * m.delta) * gamma * dir[0];
  const thd = Math.sqrt(m.sigma) * gamma * dir[1];
  const mu2 = massive ? 1 : 0;
  // Weak-field orbits that need E² − 1 to full precision (Mercury) are built
  // from their orbital elements instead, see orbits.js.
  const c0 = constants({ a, E, L, Q: 0, mu2 });
  const sn = m.sin;
  const Q = thd * thd + m.cos * m.cos * ((L * L) / (sn * sn) - a * a * c0.e2m1);
  const c = constants({ a, E, L, Q, mu2, e2m1: c0.e2m1 });
  const s = new Float64Array([r, theta, phi, 0, rd, thd, 0]);
  return { c, s };
}

// Boyer–Lindquist to the flat "Cartesian" picture used for drawing:
// x = √(r²+a²) sinθ cosφ, y = √(r²+a²) sinθ sinφ, z = r cosθ. Spin along +z.
export function toCartesian(a, r, theta, phi) {
  const rho = Math.sqrt(r * r + a * a);
  const sn = Math.sin(theta);
  return [rho * sn * Math.cos(phi), rho * sn * Math.sin(phi), r * Math.cos(theta)];
}

export function fromCartesian(a, x, y, z) {
  const a2 = a * a;
  const w = x * x + y * y + z * z - a2;
  const r = Math.sqrt(0.5 * (w + Math.sqrt(w * w + 4 * a2 * z * z)));
  const theta = Math.acos(Math.max(-1, Math.min(1, r > 0 ? z / r : 0)));
  return [r, theta, Math.atan2(y, x)];
}

// Orthonormal local axes (r̂, θ̂, φ̂) at a point, expressed in the drawing frame.
export function localAxes(a, r, theta, phi) {
  const rho = Math.sqrt(r * r + a * a);
  const sn = Math.sin(theta);
  const cs = Math.cos(theta);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const er = norm([(r / rho) * sn * cp, (r / rho) * sn * sp, cs]);
  let eth = [rho * cs * cp, rho * cs * sp, -r * sn];
  // Gram–Schmidt keeps the triad orthonormal when a ≠ 0.
  const d = dot(eth, er);
  eth = norm([eth[0] - d * er[0], eth[1] - d * er[1], eth[2] - d * er[2]]);
  const eph = [-sp, cp, 0];
  return { er, eth, eph };
}

function dot(u, v) {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

function norm(u) {
  const n = Math.hypot(u[0], u[1], u[2]) || 1;
  return [u[0] / n, u[1] / n, u[2] / n];
}

// Time dilation dτ/dt of the zero angular momentum observer ("hovering").
export function hoverRate(r, theta, a) {
  return metric(r, theta, a).alpha;
}

// dτ/dt for an observer moving at local speed v relative to the ZAMO.
export function movingRate(r, theta, a, v) {
  return metric(r, theta, a).alpha * Math.sqrt(Math.max(0, 1 - v * v));
}

// Local orbital speed (relative to the ZAMO) of the circular orbit at r.
export function circularSpeed(r, a, prograde = true) {
  const o = circularOrbit(r, a, prograde);
  if (!o) return null;
  const m = metric(r, Math.PI / 2, a);
  // u^(φ) = L/ϖ and u^(t) = (E − ωL)/α; v = u^(φ)/u^(t).
  return (o.L / m.varpi) / ((o.E - m.omega * o.L) / m.alpha);
}
