#!/usr/bin/env node
/* ============================================================================
   nbody_check.js — arnés de verificación SIN navegador y SIN leer index.html.

   Lee el código REAL de src/ (no una copia pegada), lo concatena igual que
   build.sh, monta un mini-entorno sin DOM/WebGL, integra N años simulados y
   mide el drift energético. Salida: 3 líneas (~120 tokens para el agente).

   Uso:   node tools/nbody_check.js [dt_dias] [anios]
   Ej.:   node tools/nbody_check.js 0.02 1
   Criterio de aceptación #6: |drift| < 0,01 % en 1 año simulado.
   ============================================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

/* El IIFE de la app abre en 02_core.js:20 y cierra en 08_boot.js:206, así que
   los src/ NO son parseables por separado: se concatenan como hace build.sh. */
const parts = ['02_core.js', '04_textures.js', '06_scene.js'].map(read);

const DT    = parseFloat(process.argv[2] || '0.02');   // paso [días]
const YEARS = parseFloat(process.argv[3] || '1');      // años simulados

const test = `
/* ---- test inyectado dentro del mismo IIFE ---- */
Sim.byId = {}; Sim.bodies = []; Sim.comets = []; Sim.sun = null;
for (const def of BODY_DEFS) {
  const b = new Body(def);
  Sim.byId[def.id] = b; Sim.bodies.push(b);
  if (def.parent) { const p = Sim.byId[def.parent]; b.parent = p; p.children.push(b); }
  if (def.kind === 'star') Sim.sun = b;
  if (def.kind === 'comet') Sim.comets.push(b);
}
NBody.init();

const DAYS = ${YEARS} * JULIAN_YEAR;
const run = (dt) => {
  NBody.reset(); NBody.dt = dt; NBody.lastT = Sim.t; NBody.steps = 0;
  const n = Math.round(DAYS / dt);
  for (let s = 0; s < n; s++) NBody.step(dt);   // mismo patron que simulate(): Verlet kick-drift-kick
  return Math.abs((NBody.energy() - NBody.E0) / Math.abs(NBody.E0));
};

const d1 = run(${DT});
console.log('dt=${DT} d  anios=${YEARS}  pasos=' + NBody.steps + '  drift=' + (d1 * 100).toExponential(3) + ' %');
console.log(d1 * 100 < 0.01 ? 'RESULTADO: OK   (< 0,01 %)' : 'RESULTADO: FALLA  (>= 0,01 %)');

const d2 = run(${DT} / 2);
const orden = d2 === 0 ? Infinity : Math.log(d1 / d2) / Math.log(2);
console.log('orden del integrador: ' + orden.toFixed(2) +
            '   (2.0 = Velocity Verlet / RK4 OK ; 1.0 = Euler 1er orden MAL)');
`;

/* Recorta el cierre del IIFE del último trozo y lo reabre tras el test. */
const last = parts[parts.length - 1];
const closed = last.replace(/\}\)\(\);\s*$/, '');

const script = parts.slice(0, -1).join('\n') + '\n' + closed + '\n' + test + '\n})();\n';

const noop = () => {};
const ctx = vm.createContext({
  console,
  document: { createElement: () => ({ getContext: () => ({ createImageData: () => ({ data: new Uint8Array(1) }), putImageData: noop, drawImage: noop, width: 1, height: 1 }), width: 1, height: 1 }),
             addEventListener: noop, getElementById: () => null, readyState: 'complete' },
  window: { addEventListener: noop },
  performance: { now: () => 0 },
  requestAnimationFrame: noop,
  R:  { tex: {}, gl: null, progs: {}, sphereHi: null, sphereLo: null, quad: null, init: () => false,
        H: 1, W: 1, vp: new Float32Array(16), bindAttribs: noop, texture: noop, resize: noop },
  UI: { els: {} },
  Input: { pointers: new Map() },
});

vm.runInContext(script, ctx, { filename: 'solar_concat.js' });
