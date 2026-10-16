// WebGPU shaders: a line-for-line translation of src/render/glsl.js.

export const RAYTRACE_WGSL = /* wgsl */ `
struct U {
  res: vec2f, a: f32, tanHalfFov: f32,
  cam: vec4f,    // r, theta, phi, time
  right: vec4f,
  up: vec4f,
  fwd: vec4f,
  beta: vec4f,   // xyz velocity, w = eps
  disk: vec4f,   // inner, outer, peak temperature, exposure
  misc: vec4f,   // flags, max steps, pixel angle, escape radius
};
@group(0) @binding(0) var<uniform> u: U;

const PI = 3.14159265359;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn flag(bit: i32) -> bool {
  return (i32(u.misc.x) & bit) != 0;
}

struct D { ds: vec4f, dph: f32 };

fn deriv(s: vec4f, E: f32, L: f32, Q: f32) -> D {
  let a = u.a;
  let a2 = a * a;
  let r = s.x;
  let sn = sin(s.y);
  let cs = cos(s.y);
  let sn2 = max(sn * sn, 1e-8);
  let sn3 = sn2 * select(max(abs(sn), 1e-4), -max(abs(sn), 1e-4), sn < 0.0);
  let e2 = E * E;
  let k = (L - a * E) * (L - a * E) + Q;
  let rdd = (2.0 * e2 * r * r + (a2 * e2 - L * L - Q)) * r + k;
  let thdd = -a2 * e2 * sn * cs + L * L * cs / sn3;
  let delta = r * r - 2.0 * r + a2;
  let P = E * (r * r + a2) - a * L;
  var d: D;
  d.dph = -(a * E - L / sn2) + a * P / delta;
  d.ds = vec4f(s.z, s.w, rdd, thdd);
  return d;
}

fn hash13(q: vec3f) -> f32 {
  var p = fract(q * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

fn hash33(q: vec3f) -> vec3f {
  var p = fract(q * vec3f(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3f(1, 0, 0)), f.x),
                 mix(hash13(i + vec3f(0, 1, 0)), hash13(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3f(0, 0, 1)), hash13(i + vec3f(1, 0, 1)), f.x),
                 mix(hash13(i + vec3f(0, 1, 1)), hash13(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}

fn fbm(q: vec3f) -> f32 {
  var p = q;
  var v = 0.0;
  var w = 0.5;
  for (var i = 0; i < 4; i++) {
    v += w * noise3(p);
    p = p * 2.03 + 17.1;
    w *= 0.5;
  }
  return v;
}

fn blackbody(T: f32) -> vec3f {
  let lam = vec3f(610e-9, 550e-9, 465e-9);
  let x = 1.4388e-2 / (lam * max(T, 500.0));
  let b = 1.0 / (pow(lam / 550e-9, vec3f(5.0)) * (exp(min(x, vec3f(80.0))) - 1.0));
  return b / max(b.r, max(b.g, b.b));
}

fn starLayer(d: vec3f, scale: f32, density: f32, seed: f32) -> vec3f {
  let p = d * scale;
  let cell = floor(p);
  let h = hash33(cell + seed);
  if (h.x > density) { return vec3f(0.0); }
  let sp = normalize((cell + 0.25 + 0.5 * hash33(cell + seed + 7.7)) / scale);
  let dd = d - sp;
  let size = u.misc.z * 0.75;
  let bright = pow(h.y, 10.0) * 10.0 + 0.12;
  let tint = blackbody(mix(3200.0, 11000.0, h.z));
  return tint * bright * exp(-dot(dd, dd) / (size * size));
}

fn sky(d: vec3f) -> vec3f {
  var c = vec3f(0.0);
  if (flag(16)) { return vec3f(1.0); }
  let pix = u.misc.z;
  if (flag(2)) {
    c += starLayer(d, 45.0, 0.3, 0.0);
    c += starLayer(d, 120.0, 0.18, 41.0) * 0.35;
    let n = normalize(vec3f(0.35, -0.42, 0.84));
    let band = exp(-pow(dot(d, n), 2.0) / 0.03);
    let dust = fbm(d * 6.0);
    let glow = fbm(d * 2.5 + 3.0);
    c += band * (0.05 + 0.10 * glow) * smoothstep(0.35, 0.75, 1.0 - dust * 0.9) * vec3f(0.9, 0.85, 1.0);
    c += 0.012 * vec3f(0.25, 0.3, 0.5) * glow;
    let bd = d - vec3f(-1.0, 0.0, 0.0);
    c += vec3f(0.6, 0.75, 1.0) * 8.0 * exp(-dot(bd, bd) / (2.25 * pix * pix));
  }
  if (flag(4)) {
    let lat = asin(clamp(d.z, -1.0, 1.0));
    let lon = atan2(d.y, d.x);
    let st = PI / 12.0;
    let dl = abs(fract(lat / st + 0.5) - 0.5) * st;
    let dn = abs(fract(lon / st + 0.5) - 0.5) * st * cos(lat);
    let line = 1.0 - smoothstep(0.0, 1.5 * pix, min(dl, dn));
    c += line * vec3f(0.15, 0.55, 0.65) * 0.6;
  }
  return c;
}

fn disk(r: f32, ph: f32, E: f32, L: f32) -> vec3f {
  let a = u.a;
  let sq = sqrt(r);
  let om = 1.0 / (r * sq + a);
  let k = max(r * sq - 3.0 * sq + 2.0 * a, 1e-5);
  let ut = (r * sq + a) / (pow(r, 0.75) * sqrt(k));
  var g = 1.0 / (ut * (E - om * L));
  if (!flag(8)) { g = 1.0; }
  let rin = u.disk.x;
  let rpk = rin * 49.0 / 36.0;
  let fmax = (1.0 - sqrt(rin / rpk)) / (rpk * rpk * rpk);
  let F = max(1.0 - sqrt(rin / r), 0.0) / (r * r * r) / fmax;
  let T = u.disk.z * pow(F, 0.25) * g;
  let I = pow(F, 0.6) * g * g * g * g;
  let pp = ph - om * u.cam.w;
  let q = vec3f(cos(pp) * 2.5, sin(pp) * 2.5, log(r) * 26.0);
  let streak = fbm(q) * 0.8 + 0.5 * fbm(vec3f(q.xy * 4.0, q.z * 0.6) + 5.0);
  let tex = streak * streak * 1.6;
  let edge = smoothstep(u.disk.y, u.disk.y * 0.8, r);
  return blackbody(T) * I * (0.25 + tex) * edge * 0.7;
}

fn planeGrid(r: f32, ph: f32) -> vec3f {
  let ring = abs(fract(r * 0.5 + 0.5) - 0.5) * 2.0;
  let spoke = abs(fract(ph / (PI / 6.0) + 0.5) - 0.5) * (PI / 6.0) * r;
  let w = 0.04 + 0.01 * r;
  let l = max(1.0 - smoothstep(0.0, w, ring), 1.0 - smoothstep(0.0, w, spoke));
  return l * vec3f(0.9, 0.55, 0.2) * 0.5;
}

fn tonemap(c0: vec3f) -> vec4f {
  let c1 = c0 * u.disk.w;
  let lum = dot(c1, vec3f(0.2126, 0.7152, 0.0722));
  let c = max(mix(vec3f(lum), c1, 1.35), vec3f(0.0));
  let m = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return vec4f(pow(clamp(m, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let fc = vec2f(pos.x, u.res.y - pos.y);
  let uv = (2.0 * fc - u.res) / u.res.y;
  let dir = normalize(u.fwd.xyz + u.tanHalfFov * (uv.x * u.right.xyz + uv.y * u.up.xyz));
  var k = -dir;
  var k0 = 1.0;
  let beta = u.beta.xyz;
  let b2 = dot(beta, beta);
  if (b2 > 1e-10) {
    let gm = 1.0 / sqrt(1.0 - b2);
    let bk = dot(beta, k);
    k = k + ((gm - 1.0) * bk / b2 + gm * k0) * beta;
    k0 = gm * (1.0 + bk);
  }
  let a = u.a;
  let a2 = a * a;
  let r = u.cam.x;
  let sn = sin(u.cam.y);
  let cs = cos(u.cam.y);
  let sig = r * r + a2 * cs * cs;
  let del = r * r - 2.0 * r + a2;
  let A = (r * r + a2) * (r * r + a2) - a2 * del * sn * sn;
  let alpha = sqrt(sig * del / A);
  let omega = 2.0 * a * r / A;
  let varpi = sqrt(A / sig) * sn;
  let L = varpi * k.z;
  let E = alpha * k0 + omega * L;
  let Q = sig * k.y * k.y + cs * cs * (L * L / max(sn * sn, 1e-8) - a2 * E * E);
  var s = vec4f(r, u.cam.y, -sqrt(sig * del) * k.x, -sqrt(sig) * k.y);
  var ph = u.cam.z;
  let rH = 1.0 + sqrt(max(1.0 - a2, 0.0));
  let rCap = min(rH * 1.01, rH + 0.5 * (r - rH));
  let eps = u.beta.w;
  let maxSteps = i32(u.misc.y);
  let rEsc = u.misc.w;

  var glow = vec3f(0.0);
  for (var i = 0; i < 2000; i++) {
    if (i >= maxSteps) { break; }
    let d1 = deriv(s, E, L, Q);
    let h = eps / (abs(d1.ds.x) / s.x + abs(d1.ds.y) + min(abs(d1.dph), 4.0) + 1e-4);
    let d2 = deriv(s + 0.5 * h * d1.ds, E, L, Q);
    let d3 = deriv(s + 0.5 * h * d2.ds, E, L, Q);
    let d4 = deriv(s + h * d3.ds, E, L, Q);
    let s0 = s;
    let ph0 = ph;
    s += h / 6.0 * (d1.ds + 2.0 * d2.ds + 2.0 * d3.ds + d4.ds);
    ph -= h / 6.0 * (d1.dph + 2.0 * d2.dph + 2.0 * d3.dph + d4.dph);
    let rr = s.x;
    let kk = (L - a * E) * (L - a * E) + Q;
    let Rr = ((E * E * rr) * rr + (a2 * E * E - L * L - Q)) * rr * rr + 2.0 * kk * rr - a2 * Q;
    if (Rr > 1e-3 * (E * E * rr * rr * rr * rr + L * L * rr * rr)) { s.z = sign(s.z) * sqrt(Rr); }

    let c0 = cos(s0.y);
    let c1 = cos(s.y);
    if (c0 * c1 < 0.0) {
      let f = c0 / (c0 - c1);
      let rc = mix(s0.x, s.x, f);
      let pc = mix(ph0, ph, f);
      if (flag(1) && rc > u.disk.x && rc < u.disk.y) {
        var col = disk(rc, pc, E, L);
        if (flag(4)) { col += planeGrid(rc, pc); }
        return tonemap(col + glow);
      }
      if (flag(4) && rc > rH * 1.05 && rc < 30.0) { glow += planeGrid(rc, pc) * 0.6; }
    }
    if (s.x < rCap) { return tonemap(glow); }
    if (s.x > rEsc && s.z > 0.0) {
      let st = sin(s.y);
      let ct = cos(s.y);
      let sp = sin(ph);
      let cp = cos(ph);
      let er = vec3f(st * cp, st * sp, ct);
      let et = vec3f(ct * cp, ct * sp, -st);
      let ep = vec3f(-sp, cp, 0.0);
      let dd = deriv(s, E, L, Q);
      let d = normalize(s.z * er + s.x * s.w * et - s.x * st * dd.dph * ep);
      return tonemap(sky(d) + glow);
    }
  }
  return tonemap(glow);
}
`;

export const PARTICLES_WGSL = /* wgsl */ `
struct P { s0: vec4f, s1: vec4f, c: vec4f };
struct SU { a: f32, tgt: f32, eps: f32, maxSteps: f32, count: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(0) var<uniform> su: SU;
@group(0) @binding(1) var<storage, read_write> ps: array<P>;

struct Dv { d0: vec4f, d1: vec3f };

fn deriv(x0: vec4f, x1: vec2f, c: vec4f) -> Dv {
  let a = su.a;
  let a2 = a * a;
  let E = c.x;
  let L = c.y;
  let Q = c.z;
  let e2m1 = c.w;
  let r = x0.x;
  let sn = sin(x0.y);
  let cs = cos(x0.y);
  let sn2 = max(sn * sn, 1e-8);
  let sn3 = sn2 * select(max(abs(sn), 1e-4), -max(abs(sn), 1e-4), sn < 0.0);
  let k = (L - a * E) * (L - a * E) + Q;
  let rdd = ((2.0 * e2m1 * r + 3.0) * r + (a2 * e2m1 - L * L - Q)) * r + k;
  let thdd = -a2 * e2m1 * sn * cs + L * L * cs / sn3;
  let delta = r * r - 2.0 * r + a2;
  let P = E * (r * r + a2) - a * L;
  let dph = -(a * E - L / sn2) + a * P / delta;
  let dt = -a * (a * E * sn2 - L) + (r * r + a2) * P / delta;
  var o: Dv;
  o.d0 = vec4f(x1.x, x1.y, dph, dt);
  o.d1 = vec3f(rdd, thdd, r * r + a2 * cs * cs);
  return o;
}

@compute @workgroup_size(64)
fn stepParticles(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u32(su.count)) { return; }
  var p = ps[idx];
  var s0 = p.s0;
  var s1 = p.s1;
  let c = p.c;
  let rH = 1.0 + sqrt(max(1.0 - su.a * su.a, 0.0));
  let maxSteps = i32(su.maxSteps);
  if (s1.z > 0.5) {
    for (var i = 0; i < 400; i++) {
      if (i >= maxSteps || s0.w >= su.tgt) { break; }
      let d = deriv(s0, s1.xy, c);
      let rate = abs(d.d0.x) / s0.x + abs(d.d0.y) + abs(d.d0.z) + sqrt(abs(d.d1.x) / s0.x) + sqrt(abs(d.d1.y));
      var h = su.eps / (rate + 1e-6);
      if (d.d0.w > 0.0) { h = min(h, (su.tgt - s0.w) / d.d0.w * 1.0001 + 1e-6); }
      let a = deriv(s0 + 0.5 * h * d.d0, s1.xy + 0.5 * h * d.d1.xy, c);
      let b = deriv(s0 + 0.5 * h * a.d0, s1.xy + 0.5 * h * a.d1.xy, c);
      let e = deriv(s0 + h * b.d0, s1.xy + h * b.d1.xy, c);
      s0 += h / 6.0 * (d.d0 + 2.0 * a.d0 + 2.0 * b.d0 + e.d0);
      let inc = h / 6.0 * (d.d1 + 2.0 * a.d1 + 2.0 * b.d1 + e.d1);
      s1 = vec4f(s1.xy + inc.xy, s1.z, s1.w + inc.z);
      if (s0.x < rH * 1.02 || s0.x > 500.0 || s0.x != s0.x) { s1.z = 0.0; break; }
    }
  }
  p.s0 = s0;
  p.s1 = s1;
  ps[idx] = p;
}
`;

export const PARTICLE_DRAW_WGSL = /* wgsl */ `
struct P { s0: vec4f, s1: vec4f, c: vec4f };
struct DU { viewProj: mat4x4f, eye: vec4f, misc: vec4f }; // misc: a, point size (clip units x), rH, aspect
@group(0) @binding(0) var<uniform> du: DU;
@group(0) @binding(1) var<storage, read> ps: array<P>;

struct VO { @builtin(position) pos: vec4f, @location(0) color: vec4f, @location(1) q: vec2f };

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  let p = ps[ii];
  let a = du.misc.x;
  let rho = sqrt(p.s0.x * p.s0.x + a * a);
  let x = vec3f(rho * sin(p.s0.y) * cos(p.s0.z), rho * sin(p.s0.y) * sin(p.s0.z), p.s0.x * cos(p.s0.y));
  var o: VO;
  let q = corners[vi];
  var clip = du.viewProj * vec4f(x, 1.0);
  clip = vec4f(clip.xy + q * vec2f(du.misc.y / du.misc.w, du.misc.y) * clip.w, clip.zw);
  o.pos = clip;
  o.q = q;
  let eye = du.eye.xyz;
  let toP = x - eye;
  let dist = length(toP);
  let dirv = toP / dist;
  let tc = -dot(eye, dirv);
  let closest = length(eye + tc * dirv);
  let hidden = closest < du.misc.z && tc < dist;
  let heat = clamp((8.0 - p.s0.x) / 6.0, 0.0, 1.0);
  o.color = vec4f(mix(vec3f(0.55, 0.8, 1.0), vec3f(1.0, 0.55, 0.25), heat), 0.85);
  if (p.s1.z < 0.5 || hidden) {
    o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    o.color = vec4f(0.0);
  }
  return o;
}

@fragment
fn fs(v: VO) -> @location(0) vec4f {
  let m = 1.0 - smoothstep(0.4, 1.0, dot(v.q, v.q));
  return vec4f(v.color.rgb * v.color.a * m, v.color.a * m);
}
`;
