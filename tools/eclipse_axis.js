#!/usr/bin/env node
/* eclipse_axis.js — sondeo: geometría REAL (UA) del eje de sombra Luna→Sol sobre la Tierra.
   Barrido fino de una ventana de fechas y búsqueda por refinamiento de Fibonacci del instante
   en que el eje de sombra pasa más cerca del centro de la Tierra.
   Uso: node tools/eclipse_axis.js [JD0 JD1]     (por defecto: ventana del 12 ago 2026)     */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const FILES = ['02_core.js', '04_textures.js', '05_gl.js', '06_scene.js', '07_ui.js'];
const parts = FILES.map(read);
const last = parts[parts.length - 1].replace(/\}\)\(\);\s*$/, '');

const TEST = `
Sim.byId = {}; Sim.bodies = []; Sim.comets = []; Sim.sun = null;
for (const def of BODY_DEFS) {
  const b = new Body(def);
  Sim.byId[def.id] = b; Sim.bodies.push(b);
  if (def.parent) { const p = Sim.byId[def.parent]; b.parent = p; p.children.push(b); }
  if (def.kind === 'star') Sim.sun = b;
  if (def.kind === 'comet') Sim.comets.push(b);
}
NBody.init();
Sim.belts = { ast: {}, ku: {} }; updateBelt = () => {}; updateTrails = () => {};
Sim.scaleMode = 'real'; Sim.sizeExagg = 1; Sim.minPxSize = 0;

const E = Sim.byId.earth, M = Sim.byId.moon, S = Sim.sun;
const sub = (a,b) => [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
const nrm = v => { const l = Math.hypot(v[0],v[1],v[2]); return [v[0]/l, v[1]/l, v[2]/l]; };
const KM_PER_AU = 149597870.7;

/* pone NBody/Sim en el instante jd (días desde J2000 = jd - J2000_JD) */
function gotoJD(jd) {
  const target = jd - J2000_JD;
  const total = target - NBody.lastT;
  const steps = Math.max(1, Math.ceil(Math.abs(total) / 0.02));
  const dt = total / steps;
  for (let s = 0; s < steps; s++) NBody.step(dt);
  NBody.lastT = target; Sim.t = target; Sim.jd = jd;
  simulate(0);                       /* refresca lunas y keplerianas en ese t */
}

/* elongación geocéntrica Sol-Luna (grados) y distancia perpendicular del eje de sombra
   Luna->Sol al centro de la Tierra, en radios terrestres */
function geo(jd) {
  gotoJD(jd);
  const toSun = nrm(sub(S.pos, E.pos));          // Tierra -> Sol (direccion geocentrica al Sol)
  const toMoon = sub(M.pos, E.pos);
  const dMoon = Math.hypot(toMoon[0], toMoon[1], toMoon[2]);
  const dot = (toMoon[0]*toSun[0] + toMoon[1]*toSun[1] + toMoon[2]*toSun[2]) / dMoon;   // cos elongación
  const elong = Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
  const axis = nrm(sub(M.pos, S.pos));           // dirección del eje de sombra Sol -> Luna -> Tierra
  const v = sub(E.pos, M.pos);                   // Luna -> Tierra
  const along = v[0]*axis[0] + v[1]*axis[1] + v[2]*axis[2];   // >0 => la Tierra está tras la Luna
  const perp = Math.hypot(v[0]-axis[0]*along, v[1]-axis[1]*along, v[2]-axis[2]*along);
  const perpKm = perp * KM_PER_AU;
  return { jd, elong, alongAU: along, perpAU: perp, perpKm,
           perpER: perpKm / E.radiusKm,
           moonDistKm: dMoon * KM_PER_AU,
           /* radios angulares aparentes desde el centro de la Tierra */
           rSun: Math.atan2(S.radiusKm*0 + 696340, Math.hypot(...sub(S.pos, E.pos)) * KM_PER_AU) * 180/Math.PI,
           rMoon: Math.atan2(M.radiusKm, dMoon * KM_PER_AU) * 180 / Math.PI };
}

const JD0 = parseFloat(process.env.JD0 || 2461262.5);
const JD1 = parseFloat(process.env.JD1 || 2461267.5);

/* 1) barrido grosero para aislar el mínimo */
let best = null;
for (let jd = JD0; jd <= JD1; jd += 0.05) {
  const g = geo(jd);
  if (!best || g.perpER < best.perpER) best = g;
}
/* 2) refinamiento por sección áurea en ±0.05 d */
let a = best.jd - 0.05, b = best.jd + 0.05;
const f = x => geo(x).perpER;
const gr = (Math.sqrt(5) - 1) / 2;
let c = b - gr*(b-a), d = a + gr*(b-a);
for (let k = 0; k < 40; k++) {
  if (f(c) < f(d)) { b = d; d = c; c = b - gr*(b-a); } else { a = c; c = d; d = a + gr*(b-a); }
}
const g = geo((a+b)/2);
const R_T = 6371.0;
console.log('=== geometria REAL del eje de sombra Luna -> Sol sobre la Tierra ===');
console.log('instante simulado   : ' + fmtDate(g.jd));
console.log('elongacion Sol-Luna : ' + g.elong.toFixed(4) + ' deg   (Sol radio aparente ' +
            g.rSun.toFixed(3) + ' deg, Luna ' + g.rMoon.toFixed(3) + ' deg)');
console.log('distancia Luna-Tierra: ' + (g.moonDistKm/1000).toFixed(1) + ' mil km  (real: 357k-406k)');
console.log('eje de sombra: la Tierra esta ' + (g.alongAU*KM_PER_AU/1000).toFixed(0) +
            ' mil km detras de la Luna a lo largo del eje');
console.log('desvio del eje respecto al centro de la Tierra:');
console.log('   ' + g.perpAU.toFixed(6) + ' UA = ' + (g.perpKm/1000).toFixed(0) + ' mil km = ' +
            g.perpER.toFixed(2) + ' radios terrestres');
console.log('   (hace falta < ' + ((M.radiusKm + R_T)/R_T).toFixed(2) + ' R_Tierra para penumbra, < ' +
            ((M.radiusKm - R_T)/R_T < 0 ? 0 : 0) + ' para umbra total)');
console.log('veredicto geometrico: ' + (g.perpER*R_T < M.radiusKm + R_T ? 'HAY ECLIPSE (penumbra toca la Tierra)'
            : 'NO HAY ECLIPSE: el eje de sombra pasa ' + ((g.perpER*R_T - M.radiusKm - R_T)/1000).toFixed(0) +
              ' mil km fuera del disco terrestre'));
`;

const script = parts.slice(0, -1).join('\n') + '\n' + last + '\n' + TEST + '\n})();\n';
const noop = () => {};
const canvasStub = () => ({ getContext: () => ({ createImageData: s => ({ data: new Uint8Array(s * s * 4) }), putImageData: noop, drawImage: noop, fillRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop, createLinearGradient: () => ({ addColorStop: noop }), width: 1, height: 1 }), width: 1, height: 1 });
const ctx = vm.createContext({
  console, process, Math, Date, JSON, isNaN, isFinite, parseInt, parseFloat,
  Float32Array, Float64Array, Uint8Array, Uint16Array, Int32Array, Array, Object, Map, Set, Infinity, NaN,
  document: { createElement: canvasStub, addEventListener: noop, getElementById: () => null, readyState: 'complete' },
  window: { addEventListener: noop }, performance: { now: () => 0 }, requestAnimationFrame: noop,
  R: { tex: {}, gl: null, progs: {}, sphereHi: null, sphereLo: null, quad: null, init: () => false, H: 754, W: 1344, vp: new Float32Array(16), bindAttribs: noop, texture: noop, resize: noop, bindBuffer: noop },
  UI: { els: {} }, Input: { pointers: new Map() },
});
vm.runInContext(script, ctx, { filename: 'eclipse_axis.js' });
