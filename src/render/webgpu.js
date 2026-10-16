// WebGPU back end, mirroring src/render/webgl2.js.

import { RAYTRACE_WGSL, PARTICLES_WGSL, PARTICLE_DRAW_WGSL } from './wgsl.js';

export async function createWebGPU(canvas) {
  if (!globalThis.navigator?.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });

  const errors = [];
  device.addEventListener?.('uncapturederror', (e) => errors.push(e.error?.message ?? String(e)));

  const rayModule = device.createShaderModule({ code: RAYTRACE_WGSL });
  const partModule = device.createShaderModule({ code: PARTICLES_WGSL });
  const drawModule = device.createShaderModule({ code: PARTICLE_DRAW_WGSL });
  for (const m of [rayModule, partModule, drawModule]) {
    const info = await m.getCompilationInfo?.();
    const bad = info?.messages?.filter((x) => x.type === 'error') ?? [];
    if (bad.length) throw new Error(`WGSL: ${bad.map((x) => `${x.lineNum}: ${x.message}`).join('; ')}`);
  }

  const rayPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: rayModule, entryPoint: 'vs' },
    fragment: { module: rayModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const rayUniforms = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const rayBind = device.createBindGroup({
    layout: rayPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: rayUniforms } }],
  });
  const rayData = new Float32Array(32);

  const stepPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: partModule, entryPoint: 'stepParticles' },
  });
  const drawPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: drawModule, entryPoint: 'vs' },
    fragment: {
      module: drawModule,
      entryPoint: 'fs',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const stepUniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const drawUniforms = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  let swarm = null;
  // Work recorded since the last present: the particle step and draw share
  // one encoder so the ray trace and the swarm never fight over the canvas.
  let pendingClear = false;

  function submitPass(fn, loadOp) {
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    });
    fn(pass);
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  return {
    kind: 'WebGPU',
    supportsSwarm: true,
    errors,
    lost: device.lost,

    rayTrace(P) {
      const d = rayData;
      d.set([canvas.width, canvas.height, P.a, P.tanHalfFov], 0);
      d.set([P.cam[0], P.cam[1], P.cam[2], P.time], 4);
      d.set([...P.right, 0], 8);
      d.set([...P.up, 0], 12);
      d.set([...P.fwd, 0], 16);
      d.set([...P.beta, P.eps], 20);
      d.set(P.disk, 24);
      d.set([P.flags, P.maxSteps, P.pix, P.rEsc], 28);
      device.queue.writeBuffer(rayUniforms, 0, d);
      submitPass((pass) => {
        pass.setPipeline(rayPipeline);
        pass.setBindGroup(0, rayBind);
        pass.draw(3);
      }, 'clear');
    },

    setParticles(data, count) {
      if (swarm) swarm.buffer.destroy();
      const buffer = device.createBuffer({
        size: Math.max(48, count * 48),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      device.queue.writeBuffer(buffer, 0, data.subarray(0, count * 12));
      swarm = {
        buffer,
        count,
        stepBind: device.createBindGroup({
          layout: stepPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: stepUniforms } }, { binding: 1, resource: { buffer } }],
        }),
        drawBind: device.createBindGroup({
          layout: drawPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: drawUniforms } }, { binding: 1, resource: { buffer } }],
        }),
      };
      return true;
    },

    clearParticles() {
      if (swarm) swarm.buffer.destroy();
      swarm = null;
    },

    stepParticles({ a, target, eps, maxSteps }) {
      if (!swarm) return;
      device.queue.writeBuffer(stepUniforms, 0, new Float32Array([a, target, eps, maxSteps, swarm.count, 0, 0, 0]));
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(stepPipeline);
      pass.setBindGroup(0, swarm.stepBind);
      pass.dispatchWorkgroups(Math.ceil(swarm.count / 64));
      pass.end();
      device.queue.submit([enc.finish()]);
    },

    clear() {
      pendingClear = true;
    },

    drawParticles({ viewProj, eye, a, rH, pointSize }) {
      if (!swarm) {
        if (pendingClear) submitPass(() => {}, 'clear');
        pendingClear = false;
        return;
      }
      const sizeClip = (pointSize / canvas.height);
      const u = new Float32Array(24);
      u.set(viewProj, 0);
      u.set([eye[0], eye[1], eye[2], 0], 16);
      u.set([a, sizeClip, rH, canvas.width / canvas.height], 20);
      device.queue.writeBuffer(drawUniforms, 0, u);
      submitPass((pass) => {
        pass.setPipeline(drawPipeline);
        pass.setBindGroup(0, swarm.drawBind);
        pass.draw(6, swarm.count);
      }, 'clear');
      pendingClear = false;
    },

    async readParticles() {
      if (!swarm) return null;
      const size = swarm.count * 48;
      const read = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(swarm.buffer, 0, read, 0, size);
      device.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const all = new Float32Array(read.getMappedRange().slice(0));
      read.unmap();
      read.destroy();
      const s0 = new Float32Array(swarm.count * 4);
      const s1 = new Float32Array(swarm.count * 4);
      for (let i = 0; i < swarm.count; i++) {
        s0.set(all.subarray(i * 12, i * 12 + 4), i * 4);
        s1.set(all.subarray(i * 12 + 4, i * 12 + 8), i * 4);
      }
      return { s0, s1, count: swarm.count };
    },

    finish() {
      return device.queue.onSubmittedWorkDone();
    },
  };
}
