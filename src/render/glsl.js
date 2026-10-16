// WebGL2 shaders. The ray tracer and the particle integrator use the same
// Mino-time Kerr equations as src/physics/kerr.js, in single precision.
// src/render/wgsl.js is the WebGPU translation; keep the two in step.

export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const RAYTRACE_FS = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform float uA;
uniform float uTanHalfFov;
uniform vec3 uCam;      // r, theta, phi of the probe
uniform float uTime;
uniform vec3 uRight;    // camera axes in the local ZAMO frame (r, theta, phi)
uniform vec3 uUp;
uniform vec3 uFwd;
uniform vec3 uBeta;     // probe velocity relative to the ZAMO, same frame
uniform vec4 uDisk;     // inner radius, outer radius, peak temperature (K), exposure
uniform int uFlags;     // 1 disk, 2 stars, 4 grid, 8 Doppler and redshift, 16 white sky
uniform int uMaxSteps;
uniform float uEps;
uniform float uPix;     // angular size of one pixel (rad)
uniform float uREsc;

out vec4 fragColor;

const float PI = 3.14159265359;

// d/dlambda of (r, theta, dr/dlambda, dtheta/dlambda) and dphi/dlambda for light.
void deriv(vec4 s, float E, float L, float Q, out vec4 ds, out float dph) {
  float a = uA;
  float a2 = a * a;
  float r = s.x;
  float sn = sin(s.y);
  float cs = cos(s.y);
  float sn2 = max(sn * sn, 1e-8);
  float sn3 = sn2 * (sn < 0.0 ? -max(abs(sn), 1e-4) : max(abs(sn), 1e-4));
  float e2 = E * E;
  float k = (L - a * E) * (L - a * E) + Q;
  float rdd = (2.0 * e2 * r * r + (a2 * e2 - L * L - Q)) * r + k;
  float thdd = -a2 * e2 * sn * cs + L * L * cs / sn3;
  float delta = r * r - 2.0 * r + a2;
  float P = E * (r * r + a2) - a * L;
  dph = -(a * E - L / sn2) + a * P / delta;
  ds = vec4(s.z, s.w, rdd, thdd);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float w = 0.5;
  for (int i = 0; i < 4; i++) {
    v += w * noise3(p);
    p = p * 2.03 + 17.1;
    w *= 0.5;
  }
  return v;
}

// Relative RGB of a blackbody at temperature T (Planck's law sampled at
// three wavelengths), normalised so the brightest channel is 1.
vec3 blackbody(float T) {
  vec3 lam = vec3(610e-9, 550e-9, 465e-9);
  vec3 x = 1.4388e-2 / (lam * max(T, 500.0));
  vec3 b = 1.0 / (pow(lam / 550e-9, vec3(5.0)) * (exp(min(x, vec3(80.0))) - 1.0));
  return b / max(b.r, max(b.g, b.b));
}

vec3 starLayer(vec3 d, float scale, float density, float seed) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  vec3 h = hash33(cell + seed);
  if (h.x > density) return vec3(0.0);
  vec3 sp = normalize((cell + 0.25 + 0.5 * hash33(cell + seed + 7.7)) / scale);
  vec3 dd = d - sp;
  float size = uPix * 0.75;
  float bright = pow(h.y, 10.0) * 10.0 + 0.12;
  vec3 tint = blackbody(mix(3200.0, 11000.0, h.z));
  return tint * bright * exp(-dot(dd, dd) / (size * size));
}

vec3 sky(vec3 d) {
  vec3 c = vec3(0.0);
  if ((uFlags & 16) != 0) return vec3(1.0);  // flat white sky, for measuring the shadow
  if ((uFlags & 2) != 0) {
    c += starLayer(d, 45.0, 0.3, 0.0);
    c += starLayer(d, 120.0, 0.18, 41.0) * 0.35;
    // Milky Way-like band with dust lanes.
    vec3 n = normalize(vec3(0.35, -0.42, 0.84));
    float band = exp(-pow(dot(d, n), 2.0) / 0.03);
    float dust = fbm(d * 6.0);
    float glow = fbm(d * 2.5 + 3.0);
    c += band * (0.05 + 0.10 * glow) * smoothstep(0.35, 0.75, 1.0 - dust * 0.9) * vec3(0.9, 0.85, 1.0);
    c += 0.012 * vec3(0.25, 0.3, 0.5) * glow;
    // A bright blue beacon star behind the hole, for the Einstein ring.
    vec3 bd = d - vec3(-1.0, 0.0, 0.0);
    c += vec3(0.6, 0.75, 1.0) * 8.0 * exp(-dot(bd, bd) / (2.25 * uPix * uPix));
  }
  if ((uFlags & 4) != 0) {
    float lat = asin(clamp(d.z, -1.0, 1.0));
    float lon = atan(d.y, d.x);
    float step = PI / 12.0;
    float dl = abs(fract(lat / step + 0.5) - 0.5) * step;
    float dn = abs(fract(lon / step + 0.5) - 0.5) * step * cos(lat);
    float line = 1.0 - smoothstep(0.0, 1.5 * uPix, min(dl, dn));
    c += line * vec3(0.15, 0.55, 0.65) * 0.6;
  }
  return c;
}

vec3 disk(float r, float ph, float E, float L) {
  float a = uA;
  float sq = sqrt(r);
  float om = 1.0 / (r * sq + a);
  float k = max(r * sq - 3.0 * sq + 2.0 * a, 1e-5);
  float ut = (r * sq + a) / (pow(r, 0.75) * sqrt(k));
  float g = 1.0 / (ut * (E - om * L));
  if ((uFlags & 8) == 0) g = 1.0;
  float rin = uDisk.x;
  float rpk = rin * 49.0 / 36.0;
  float fmax = (1.0 - sqrt(rin / rpk)) / (rpk * rpk * rpk);
  float F = max(1.0 - sqrt(rin / r), 0.0) / (r * r * r) / fmax;
  float T = uDisk.z * pow(F, 0.25) * g;
  float I = pow(F, 0.6) * g * g * g * g;
  float pp = ph - om * uTime;
  vec3 q = vec3(cos(pp) * 2.5, sin(pp) * 2.5, log(r) * 26.0);
  float streak = fbm(q) * 0.8 + 0.5 * fbm(vec3(q.xy * 4.0, q.z * 0.6) + 5.0);
  float tex = streak * streak * 1.6;
  float edge = smoothstep(uDisk.y, uDisk.y * 0.8, r);
  return blackbody(T) * I * (0.25 + tex) * edge * 0.7;
}

vec3 planeGrid(float r, float ph) {
  float ring = abs(fract(r * 0.5 + 0.5) - 0.5) * 2.0;
  float spoke = abs(fract(ph / (PI / 6.0) + 0.5) - 0.5) * (PI / 6.0) * r;
  float w = 0.04 + 0.01 * r;
  float l = max(1.0 - smoothstep(0.0, w, ring), 1.0 - smoothstep(0.0, w, spoke));
  return l * vec3(0.9, 0.55, 0.2) * 0.5;
}

vec3 tonemap(vec3 c) {
  c = c * uDisk.w;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(lum), c, 1.35), 0.0);
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 dir = normalize(uFwd + uTanHalfFov * (uv.x * uRight + uv.y * uUp));
  // The photon reaching the camera travels along -dir; boost it to the ZAMO.
  vec3 k = -dir;
  float k0 = 1.0;
  float b2 = dot(uBeta, uBeta);
  if (b2 > 1e-10) {
    float gm = 1.0 / sqrt(1.0 - b2);
    float bk = dot(uBeta, k);
    k = k + ((gm - 1.0) * bk / b2 + gm * k0) * uBeta;
    k0 = gm * (1.0 + bk);
  }
  float a = uA;
  float a2 = a * a;
  float r = uCam.x;
  float sn = sin(uCam.y);
  float cs = cos(uCam.y);
  float sig = r * r + a2 * cs * cs;
  float del = r * r - 2.0 * r + a2;
  float A = (r * r + a2) * (r * r + a2) - a2 * del * sn * sn;
  float alpha = sqrt(sig * del / A);
  float omega = 2.0 * a * r / A;
  float varpi = sqrt(A / sig) * sn;
  float L = varpi * k.z;
  float E = alpha * k0 + omega * L;
  float Q = sig * k.y * k.y + cs * cs * (L * L / max(sn * sn, 1e-8) - a2 * E * E);
  // Trace backwards in time: flip the velocities.
  vec4 s = vec4(r, uCam.y, -sqrt(sig * del) * k.x, -sqrt(sig) * k.y);
  float ph = uCam.z;
  float rH = 1.0 + sqrt(max(1.0 - a2, 0.0));
  float rCap = min(rH * 1.01, rH + 0.5 * (r - rH));

  vec3 col = vec3(0.0);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 2000; i++) {
    if (i >= uMaxSteps) break;
    vec4 k1; float p1;
    deriv(s, E, L, Q, k1, p1);
    float h = uEps / (abs(k1.x) / s.x + abs(k1.y) + min(abs(p1), 4.0) + 1e-4);
    vec4 k2, k3, k4; float p2, p3, p4;
    deriv(s + 0.5 * h * k1, E, L, Q, k2, p2);
    deriv(s + 0.5 * h * k2, E, L, Q, k3, p3);
    deriv(s + h * k3, E, L, Q, k4, p4);
    vec4 s0 = s;
    float ph0 = ph;
    s += h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    ph -= h / 6.0 * (p1 + 2.0 * p2 + 2.0 * p3 + p4);
    // Keep dr/dlambda on the constraint surface far from turning points.
    float rr = s.x;
    float kk = (L - a * E) * (L - a * E) + Q;
    float Rr = ((E * E * rr) * rr + (a2 * E * E - L * L - Q)) * rr * rr + 2.0 * kk * rr - a2 * Q;
    if (Rr > 1e-3 * (E * E * rr * rr * rr * rr + L * L * rr * rr)) s.z = sign(s.z) * sqrt(Rr);

    float c0 = cos(s0.y);
    float c1 = cos(s.y);
    if (c0 * c1 < 0.0) {
      float f = c0 / (c0 - c1);
      float rc = mix(s0.x, s.x, f);
      float pc = mix(ph0, ph, f);
      if ((uFlags & 1) != 0 && rc > uDisk.x && rc < uDisk.y) {
        col = disk(rc, pc, E, L);
        if ((uFlags & 4) != 0) col += planeGrid(rc, pc);
        fragColor = vec4(tonemap(col + glow), 1.0);
        return;
      }
      if ((uFlags & 4) != 0 && rc > rH * 1.05 && rc < 30.0) glow += planeGrid(rc, pc) * 0.6;
    }
    if (s.x < rCap) {
      fragColor = vec4(tonemap(glow), 1.0);
      return;
    }
    if (s.x > uREsc && s.z > 0.0) {
      float st = sin(s.y), ct = cos(s.y), sp = sin(ph), cp = cos(ph);
      vec3 er = vec3(st * cp, st * sp, ct);
      vec3 et = vec3(ct * cp, ct * sp, -st);
      vec3 ep = vec3(-sp, cp, 0.0);
      vec4 dsd; float dphd;
      deriv(s, E, L, Q, dsd, dphd);
      vec3 d = normalize(s.z * er + s.x * s.w * et - s.x * st * dphd * ep);
      fragColor = vec4(tonemap(sky(d) + glow), 1.0);
      return;
    }
  }
  fragColor = vec4(tonemap(glow), 1.0);
}`;

// Test particles integrated on the GPU. Each texel holds one particle:
// state0 = (r, theta, phi, t), state1 = (dr/dl, dtheta/dl, alive, tau),
// consts = (E, L, Q, E^2 - 1). Each frame advances every particle until its
// coordinate time reaches uTarget.
export const PARTICLE_STEP_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState0;
uniform sampler2D uState1;
uniform sampler2D uConsts;
uniform float uA;
uniform float uTarget;
uniform float uEps;
uniform int uMaxSteps;
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;

// d/dlambda of (r, theta, phi, t, rdot, thetadot, tau) for a massive particle.
void deriv(vec4 x0, vec2 x1, vec4 c, out vec4 d0, out vec3 d1) {
  float a = uA;
  float a2 = a * a;
  float E = c.x, L = c.y, Q = c.z, e2m1 = c.w;
  float r = x0.x;
  float sn = sin(x0.y);
  float cs = cos(x0.y);
  float sn2 = max(sn * sn, 1e-8);
  float sn3 = sn2 * (sn < 0.0 ? -max(abs(sn), 1e-4) : max(abs(sn), 1e-4));
  float k = (L - a * E) * (L - a * E) + Q;
  float rdd = ((2.0 * e2m1 * r + 3.0) * r + (a2 * e2m1 - L * L - Q)) * r + k;
  float thdd = -a2 * e2m1 * sn * cs + L * L * cs / sn3;
  float delta = r * r - 2.0 * r + a2;
  float P = E * (r * r + a2) - a * L;
  float dph = -(a * E - L / sn2) + a * P / delta;
  float dt = -a * (a * E * sn2 - L) + (r * r + a2) * P / delta;
  d0 = vec4(x1.x, x1.y, dph, dt);
  d1 = vec3(rdd, thdd, r * r + a2 * cs * cs);
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 s0 = texelFetch(uState0, ij, 0);
  vec4 s1 = texelFetch(uState1, ij, 0);
  vec4 c = texelFetch(uConsts, ij, 0);
  float rH = 1.0 + sqrt(max(1.0 - uA * uA, 0.0));
  if (s1.z > 0.5) {
    for (int i = 0; i < 400; i++) {
      if (i >= uMaxSteps || s0.w >= uTarget) break;
      vec4 d0; vec3 d1;
      deriv(s0, s1.xy, c, d0, d1);
      float rate = abs(d0.x) / s0.x + abs(d0.y) + abs(d0.z) + sqrt(abs(d1.x) / s0.x) + sqrt(abs(d1.y));
      float h = uEps / (rate + 1e-6);
      if (d0.w > 0.0) h = min(h, (uTarget - s0.w) / d0.w * 1.0001 + 1e-6);
      vec4 a0; vec3 a1; vec4 b0; vec3 b1; vec4 e0; vec3 e1;
      vec4 x0 = s0 + 0.5 * h * d0; vec2 x1 = s1.xy + 0.5 * h * d1.xy;
      deriv(x0, x1, c, a0, a1);
      x0 = s0 + 0.5 * h * a0; x1 = s1.xy + 0.5 * h * a1.xy;
      deriv(x0, x1, c, b0, b1);
      x0 = s0 + h * b0; x1 = s1.xy + h * b1.xy;
      deriv(x0, x1, c, e0, e1);
      s0 += h / 6.0 * (d0 + 2.0 * a0 + 2.0 * b0 + e0);
      vec3 inc = h / 6.0 * (d1 + 2.0 * a1 + 2.0 * b1 + e1);
      s1.xy += inc.xy;
      s1.w += inc.z;
      if (s0.x < rH * 1.02 || s0.x > 500.0 || s0.x != s0.x) { s1.z = 0.0; break; }
    }
  }
  out0 = s0;
  out1 = s1;
}`;

export const PARTICLE_DRAW_VS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState0;
uniform sampler2D uState1;
uniform mat4 uViewProj;
uniform float uA;
uniform float uPointSize;
uniform vec3 uEye;
uniform float uRH;
out vec4 vColor;
void main() {
  int w = textureSize(uState0, 0).x;
  ivec2 ij = ivec2(gl_VertexID % w, gl_VertexID / w);
  vec4 s0 = texelFetch(uState0, ij, 0);
  vec4 s1 = texelFetch(uState1, ij, 0);
  float rho = sqrt(s0.x * s0.x + uA * uA);
  vec3 p = vec3(rho * sin(s0.y) * cos(s0.z), rho * sin(s0.y) * sin(s0.z), s0.x * cos(s0.y));
  gl_Position = uViewProj * vec4(p, 1.0);
  gl_PointSize = uPointSize;
  // Hide particles behind the horizon sphere as seen from the eye.
  vec3 toP = p - uEye;
  float dist = length(toP);
  vec3 dirv = toP / dist;
  float tc = -dot(uEye, dirv);
  float closest = length(uEye + tc * dirv);
  bool hidden = closest < uRH && tc < dist;
  float heat = clamp((8.0 - s0.x) / 6.0, 0.0, 1.0);
  vColor = vec4(mix(vec3(0.55, 0.8, 1.0), vec3(1.0, 0.55, 0.25), heat), 0.85);
  if (s1.z < 0.5 || hidden) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); }
}`;

export const PARTICLE_DRAW_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float m = 1.0 - smoothstep(0.4, 1.0, dot(q, q));
  fragColor = vec4(vColor.rgb * vColor.a * m, vColor.a * m);
}`;
