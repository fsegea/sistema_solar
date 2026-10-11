#!/usr/bin/env node
/* ============================================================================
   perf_check.js — puerta de rendimiento del bucle de simulacion (FASE 1).

   Mide en Node, sin WebGL: updateBelt(), simulate() (kepleriano y n-cuerpo),
   updateKepler() de los cometas, computeDisplayPositions() y updateTrails().

   Uso:   node tools/perf_check.js            -> sale 1 si updateBelt > 1,5 ms
          node tools/perf_check.js --iters 400
   Umbrales: se pueden ajustar con variables de entorno (UMBELT_MS, UMSIM_MS).
   ============================================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const SRC = process.env.SOLAR_SRC || path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const FILES = ['02_core.js', '04_textures.js', '05_gl.js', '06_scene.js', '07_ui.js'];
const parts = FILES.map(read);
const last = parts[parts.length - 1].replace(/\}\)\(\);\s*$/, '');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const ITERS = arg('--iters', 200);
const UMBELT = Number(process.env.UMBELT_MS || 1.5);      // objetivo FASE 1
const UMSIM = Number(process.env.UMSIM_MS || 6.0);

const TEST = `
/* ================= BENCHMARK INYECTADO ================= */
Sim.byId = {}; Sim.bodies = []; Sim.comets = []; Sim.sun = null;
for (const def of BODY_DEFS) {
  const b = new Body(def);
  Sim.byId[def.id] = b; Sim.bodies.push(b);
  if (def.parent) { const p = Sim.byId[def.parent]; b.parent = p; p.children.push(b); }
  if (def.kind === 'star') Sim.sun = b;
  if (def.kind === 'comet') Sim.comets.push(b);
}
Sim.planets = Sim.bodies.filter(b => b.kind === 'planet');
Sim.belts = { ast: makeBelt(BELT_AST_OPTS), ku: makeBelt(BELT_KUIPER_OPTS), visibleCount: 0 };
Sim.totalBodies = Sim.bodies.length + Sim.belts.ast.n + Sim.belts.ku.n;
Sim.jd = 2451545.0; Sim.t = 9000;
for (const b of Sim.bodies) { updateKepler(b, Sim.t); updateOrientation(b, Sim.t); }
for (const b of Sim.bodies) {              // como buildAllOrbits() en 08_boot.js
  if (!b.def.table && !b.def.el || b.kind === 'star') continue;
  buildOrbitPolyline(b, b.kind === 'comet' ? 420 : (b.kind === 'moon' ? 160 : 280));
}
for (const b of Sim.bodies) b.trailLastT = Sim.t;
NBody.init(); NBody.dt = 0.02; NBody.lastT = Sim.t;

const bench = (label, iters, fn) => {
  fn();                                                    // calentamiento + JIT
  for (let i = 0; i < 20; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / iters;
  PERF.push([label, ms]);
  return ms;
};
const PERF = [];
let tt = Sim.t;

bench('updateBelt ast+ku', ${ITERS}, () => { tt += 0.5; updateBelt(Sim.belts.ast, tt); updateBelt(Sim.belts.ku, tt); });
bench('simulate() kepleriano', ${ITERS}, () => { Sim.nbody = false; tt += 0.016; Sim.t = tt; simulate(0.016); });
bench('simulate() n-cuerpo', ${ITERS}, () => { Sim.nbody = true; tt += 0.016; NBody.lastT = tt - 0.016; simulate(0.016); });
bench('updateKepler 4 cometas', ${ITERS}, () => { for (const c of Sim.comets) updateKepler(c, tt); });
bench('computeDisplayPositions', ${ITERS}, () => computeDisplayPositions());
bench('updateTrails', ${ITERS}, () => updateTrails());

globalThis.PERF_OUT = PERF;
globalThis.BODIES = Sim.totalBodies;
globalThis.BELTN = Sim.belts.ast.n + Sim.belts.ku.n;
`;

const script = parts.slice(0, -1).join('\n') + '\n' + last + '\n' + TEST + '\n})();\n';

const noop = () => {};
const canvasStub = () => ({ getContext: () => ({ createImageData: s => ({ data: new Uint8Array(s * s * 4) }), putImageData: noop, drawImage: noop, fillRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop, createLinearGradient: () => ({ addColorStop: noop }), width: 1, height: 1 }), width: 1, height: 1 });
const ctx = vm.createContext({
  console, process, Math, Date, JSON, isNaN, isFinite, parseInt, parseFloat,
  Float32Array, Float64Array, Uint8Array, Uint16Array, Int32Array, Array, Object, Map, Set, Infinity, NaN,
  document: { createElement: canvasStub, addEventListener: noop, getElementById: () => null, readyState: 'complete' },
  window: { addEventListener: noop },
  performance: { now: () => 0 }, requestAnimationFrame: noop,
  R: { tex: {}, gl: null, progs: {}, sphereHi: null, sphereLo: null, quad: null, init: () => false,
       H: 1, W: 1, vp: new Float32Array(16), bindAttribs: noop, texture: noop, resize: noop, bindBuffer: noop },
  UI: { els: {} }, Input: { pointers: new Map() },
});
vm.runInContext(script, ctx, { filename: 'solar_perf.js' });

const perf = ctx.PERF_OUT;
const pad = s => (s + ' '.repeat(28)).slice(0, 28);
console.log('coste JS/frame (Node, sin GL) · ' + ITERS + ' iteraciones · ' + ctx.BODIES + ' cuerpos (' + ctx.BELTN + ' de ellos cinturones)');
for (const [label, ms] of perf) console.log('  ' + pad(label) + ms.toFixed(3) + ' ms');

const belt = perf.find(p => p[0] === 'updateBelt ast+ku')[1];
const sim = perf.find(p => p[0] === 'simulate() kepleriano')[1];
let fail = 0;
if (belt > UMBELT) { console.log('FAIL updateBelt ' + belt.toFixed(2) + ' ms > ' + UMBELT + ' ms'); fail++; }
else console.log('OK   updateBelt ' + belt.toFixed(2) + ' ms <= ' + UMBELT + ' ms');
if (sim > UMSIM) { console.log('FAIL simulate() ' + sim.toFixed(2) + ' ms > ' + UMSIM + ' ms'); fail++; }
else console.log('OK   simulate() ' + sim.toFixed(2) + ' ms <= ' + UMSIM + ' ms');
process.exit(fail ? 1 : 0);
