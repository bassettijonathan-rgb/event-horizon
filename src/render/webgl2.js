// WebGL2 back end: the ray-traced view and the GPU particle swarm.

import { FULLSCREEN_VS, RAYTRACE_FS, PARTICLE_STEP_FS, PARTICLE_DRAW_VS, PARTICLE_DRAW_FS } from './glsl.js';

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

export function createWebGL2(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  const ray = program(gl, FULLSCREEN_VS, RAYTRACE_FS);
  const vao = gl.createVertexArray();
  let step = null;
  let draw = null;
  if (floatTargets) {
    step = program(gl, FULLSCREEN_VS, PARTICLE_STEP_FS);
    draw = program(gl, PARTICLE_DRAW_VS, PARTICLE_DRAW_FS);
  }

  let swarm = null;

  function floatTexture(w, h, data) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function target(t0, t1) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t1, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fb;
  }

  return {
    kind: 'WebGL2',
    supportsSwarm: floatTargets,

    rayTrace(P) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(ray.p);
      const u = ray.u;
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uA, P.a);
      gl.uniform1f(u.uTanHalfFov, P.tanHalfFov);
      gl.uniform3fv(u.uCam, P.cam);
      gl.uniform1f(u.uTime, P.time);
      gl.uniform3fv(u.uRight, P.right);
      gl.uniform3fv(u.uUp, P.up);
      gl.uniform3fv(u.uFwd, P.fwd);
      gl.uniform3fv(u.uBeta, P.beta);
      gl.uniform4fv(u.uDisk, P.disk);
      gl.uniform1i(u.uFlags, P.flags);
      gl.uniform1i(u.uMaxSteps, P.maxSteps);
      gl.uniform1f(u.uEps, P.eps);
      gl.uniform1f(u.uPix, P.pix);
      gl.uniform1f(u.uREsc, P.rEsc);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    // data: Float32Array of 12 floats per particle (state0, state1, consts).
    setParticles(data, count) {
      if (!floatTargets) return false;
      const w = 128;
      const h = Math.max(1, Math.ceil(count / w));
      const n = w * h;
      const a0 = new Float32Array(n * 4);
      const a1 = new Float32Array(n * 4);
      const ac = new Float32Array(n * 4);
      for (let i = 0; i < count; i++) {
        a0.set(data.subarray(i * 12, i * 12 + 4), i * 4);
        a1.set(data.subarray(i * 12 + 4, i * 12 + 8), i * 4);
        ac.set(data.subarray(i * 12 + 8, i * 12 + 12), i * 4);
      }
      if (swarm) swarm.dispose();
      const tex = [floatTexture(w, h, a0), floatTexture(w, h, a1), floatTexture(w, h, a0), floatTexture(w, h, a1)];
      const consts = floatTexture(w, h, ac);
      const fbs = [target(tex[0], tex[1]), target(tex[2], tex[3])];
      swarm = {
        w, h, count, tex, consts, fbs, cur: 0,
        dispose() {
          tex.forEach((t) => gl.deleteTexture(t));
          gl.deleteTexture(consts);
          fbs.forEach((f) => gl.deleteFramebuffer(f));
        },
      };
      return true;
    },

    clearParticles() {
      if (swarm) swarm.dispose();
      swarm = null;
    },

    stepParticles({ a, target: tgt, eps, maxSteps }) {
      if (!swarm) return;
      const src = swarm.cur;
      const dst = 1 - src;
      gl.bindFramebuffer(gl.FRAMEBUFFER, swarm.fbs[dst]);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, swarm.w, swarm.h);
      gl.disable(gl.BLEND);
      gl.useProgram(step.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, swarm.tex[src * 2]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, swarm.tex[src * 2 + 1]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, swarm.consts);
      gl.uniform1i(step.u.uState0, 0);
      gl.uniform1i(step.u.uState1, 1);
      gl.uniform1i(step.u.uConsts, 2);
      gl.uniform1f(step.u.uA, a);
      gl.uniform1f(step.u.uTarget, tgt);
      gl.uniform1f(step.u.uEps, eps);
      gl.uniform1i(step.u.uMaxSteps, maxSteps);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      swarm.cur = dst;
    },

    clear() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    drawParticles({ viewProj, eye, a, rH, pointSize }) {
      if (!swarm) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(draw.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, swarm.tex[swarm.cur * 2]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, swarm.tex[swarm.cur * 2 + 1]);
      gl.uniform1i(draw.u.uState0, 0);
      gl.uniform1i(draw.u.uState1, 1);
      gl.uniformMatrix4fv(draw.u.uViewProj, false, viewProj);
      gl.uniform3fv(draw.u.uEye, eye);
      gl.uniform1f(draw.u.uA, a);
      gl.uniform1f(draw.u.uRH, rH);
      gl.uniform1f(draw.u.uPointSize, pointSize);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, swarm.count);
      gl.disable(gl.BLEND);
    },

    // Reads particle states back (for tests and the readout of survivors).
    readParticles() {
      if (!swarm) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, swarm.fbs[swarm.cur]);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      const s0 = new Float32Array(swarm.w * swarm.h * 4);
      gl.readPixels(0, 0, swarm.w, swarm.h, gl.RGBA, gl.FLOAT, s0);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      const s1 = new Float32Array(swarm.w * swarm.h * 4);
      gl.readPixels(0, 0, swarm.w, swarm.h, gl.RGBA, gl.FLOAT, s1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return Promise.resolve({ s0, s1, count: swarm.count });
    },

    finish() {
      gl.finish();
    },
  };
}
