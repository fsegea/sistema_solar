#!/usr/bin/env node
/* ============================================================================
   ephemeris_probe.js — sondeo (no test) de la fidelidad de las efemérides.
   Compara el código REAL de src/ con instantes publicados:
     · equinoccios y solsticios  (longitud heliocéntrica de la Tierra)
     · conjunciones Sol-Luna     (elongación geocéntrica mínima => eclipse)
   Salida: una tabla con el error en minutos.

   Uso:  node tools/ephemeris_probe.js            todo
         node tools/ephemeris_probe.js --ecl      solo eclipses
   ============================================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = process.env.SOLAR_SRC || path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const FILES = ['02_core.js', '04_textures.js', '05_gl.js', '06_scene.js', '07_ui.js'];
const parts = FILES.map(read);

const TEST = `
/* ---- poblacion completa, modo kepleriano (el modo por defecto de la app) ---- */
Sim.byId = {}; Sim.bodies = []; Sim.comets = []; Sim.sun = null;
for (const def of BODY_DEFS) {
  const b = new Body(def);
  Sim.byId[def.id] = b; Sim.bodies.push(b);
  if (def.parent) { const p = Sim.byId[def.parent]; b.parent = p; p.children.push(b); }
  if (def.kind === 'star') Sim.sun = b;
  if (def.kind === 'comet') Sim.comets.push(b);
}
Sim.belts = { ast: {}, ku: {} }; updateTrails = () => {};

/* t [dias desde J2000] de una fecha UTC con hora */
const T0 = (y, m, d, H, mm) => gregorianToJD(y, m, d) - 0.5 + (H + mm / 60) / 24 - J2000_JD;
const E = Sim.byId.earth, MOON = Sim.byId.moon;
function lonSun (t) { updateKepler(E, t); return (Math.atan2(-E.pos[1], -E.pos[0]) * RAD + 360) % 360; }   // longitud GEOCENTRICA del Sol
function elong (t) {                                          // elongacion geocentrica Sol-Luna [deg]
  updateKepler(E, t); updateKepler(MOON, t);
  const s0 = -E.pos[0], s1 = -E.pos[1], s2 = -E.pos[2];
  const l0 = MOON.pos[0] - E.pos[0], l1 = MOON.pos[1] - E.pos[1], l2 = MOON.pos[2] - E.pos[2];
  const n1 = hypot3(s0, s1, s2), n2 = hypot3(l0, l1, l2);
  return Math.acos(clamp((s0 * l0 + s1 * l1 + s2 * l2) / (n1 * n2), -1, 1)) * RAD;
}
/* instante en el que la longitud heliocentrica de la Tierra cruza 'target' */
function crossLon (target, t0, t1) {
  let lo = t0, hi = t1;
  const f = t => ((lonSun(t) - target + 540) % 360) - 180;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/* instante de conjuncion (minimo de elongacion) cerca de tGuess */
function conjunction (tGuess) {
  let a = tGuess - 0.5, b = tGuess + 0.5;
  for (let k = 0; k < 80; k++) {
    const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
    if (elong(m1) < elong(m2)) b = m2; else a = m1;
  }
  const t = (a + b) / 2;
  return { t, e: elong(t) };
}
const minErr = (simJD, y, m, d, H, mm) => (simJD - (gregorianToJD(y, m, d) - 0.5 + (H + mm / 60) / 24)) * 1440;

/* ---- 1. equinoccios y solsticios ----
   Instantes del equinoccio/solsticio = instantes en que la longitud geocentrica
   aparente del Sol vale 0 / 90 / 180 / 270. Como el Sol geocentrico es la direccion
   opuesta a la Tierra heliocentrica, se busca lonSun = 0 / 90 / 180 / 270.
   (El modelo no incluye nutacion ni aberracion: ~20" de desfase, <10 min.) */
const EST = [
  ['equinoccio mar', 2021, 3, 20,  9, 37,   0, -20, +20],
  ['equinoccio mar', 2024, 3, 20,  3,  6,   0, -20, +20],
  ['equinoccio mar', 2025, 3, 20,  9,  1,   0, -20, +20],
  ['equinoccio mar', 2026, 3, 20, 14, 46,   0, -20, +20],
  ['equinoccio mar', 2027, 3, 20, 20, 25,   0, -20, +20],
  ['solsticio jun',  2024, 6, 20, 20, 51,  90, -20, +20],
  ['solsticio jun',  2025, 6, 21,  2, 42,  90, -20, +20],
  ['equinoccio sep', 2024, 9, 22, 12, 44, 180, -20, +20],
  ['solsticio dic',  2024, 12, 21, 9, 20, 270, -20, +20]
];
console.log('--- equinoccios y solsticios (publicado vs simulado) ---');
let worst = 0;
for (const [name, y, m, d, H, mm, target, d0, d1] of EST) {
  const t = crossLon(target, T0(y, m, d, H, mm) + d0, T0(y, m, d, H, mm) + d1);
  const jd = J2000_JD + t, err = minErr(jd, y, m, d, H, mm);
  worst = Math.max(worst, Math.abs(err));
  console.log(name + ' ' + y + '  publicado ' + String(d).padStart(2) + '/' + m + ' ' + String(H).padStart(2) + ':' + String(mm).padStart(2) +
    '   simulado ' + fmtDate(jd) + '   error ' + (err >= 0 ? '+' : '') + err.toFixed(1) + ' min');
}
console.log('peor error estacional: ' + worst.toFixed(1) + ' min');

/* Deriva del equinoccio: el intervalo entre equinoccios de marzo sucesivos es el ANIO
   TROPICO (365,2422 d), no el sidero (365,2564 d). Sin precesion la app mediria el sidero:
   la diferencia, 0,0142 d = 20,5 min por ano, es justo el desfase que se acumulaba.
   Comprobado hasta 2100 sin necesitar efemerides publicadas. */
console.log('--- intervalo entre equinoccios de marzo (debe ser el anio tropico 365,2422 d) ---');
let prev = crossLon(0, T0(2021, 3, 20, 0, 0) - 20, T0(2021, 3, 20, 0, 0) + 20), peorDeriva = 0;
for (let y = 2022; y <= 2101; y++) {
  const t = crossLon(0, T0(y, 3, 20, 0, 0) - 20, T0(y, 3, 20, 0, 0) + 20);
  const d = t - prev; prev = t;
  if (Math.abs(d - 365.2422) > Math.abs(peorDeriva)) peorDeriva = d - 365.2422;
}
console.log('desvio maximo del anio tropico (2021-2100): ' + (peorDeriva * 1440).toFixed(2) + ' min');
console.log('  (sin precesion el intervalo habria sido el anio sidero: +20,5 min por ano)');

/* ---- 2. eclipses: conjunciones Sol-Luna ---- */
const ECL = [
  [2017, 8, 21, 18, 46, 'total USA'],
  [2019, 7,  2, 19, 23, 'total Chile'],
  [2023, 10, 14, 17, 36, 'anular'],
  [2024, 4,  8, 18, 17, 'total'],
  [2026, 8, 12, 18, 46, 'total'],
  [2027, 8,  2, 10,  7, 'total'],
  [2028, 7, 22, 12, 55, 'total']
];
console.log('--- conjuncion Sol-Luna (maximo de eclipse publicado vs conjuncion simulada) ---');
let worstE = 0;
for (const [y, m, d, H, mm, tag] of ECL) {
  const c = conjunction(T0(y, m, d, H, mm));
  const err = minErr(J2000_JD + c.t, y, m, d, H, mm);
  worstE = Math.max(worstE, Math.abs(err));
  console.log(y + '-' + String(m).padStart(2) + '-' + String(d).padStart(2) + ' (' + tag + ')  simulado ' + fmtDate(J2000_JD + c.t) +
    '   elong ' + c.e.toFixed(3) + ' deg   error ' + (err >= 0 ? '+' : '') + err.toFixed(1) + ' min' + (c.e < 1.5 ? '  ECLIPSE' : ''));
}
console.log('peor error de eclipse: ' + worstE.toFixed(1) + ' min');
`;

const script = parts.slice(0, -1).join('\n') + '\n' + parts[parts.length - 1] + '\n' + TEST + '\n})();\n';
const noop = () => {};
const canvasStub = () => ({ getContext: () => ({ createImageData: s => ({ data: new Uint8Array(s * s * 4) }), putImageData: noop, drawImage: noop, fillRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop, createLinearGradient: () => ({ addColorStop: noop }), width: 1, height: 1 }), width: 1, height: 1 });
const ctx = vm.createContext({
  console, process, Math, Date, JSON, isNaN, isFinite, parseInt, parseFloat,
  Float32Array, Float64Array, Uint8Array, Uint16Array, Int32Array, Array, Object, Map, Set, Infinity, NaN,
  document: { createElement: canvasStub, addEventListener: noop, getElementById: () => null, readyState: 'complete' },
  window: { addEventListener: noop }, performance: { now: () => 0 }, requestAnimationFrame: noop,
  R: { tex: {}, gl: null, progs: {}, sphereHi: null, sphereLo: null, quad: null, init: () => false, H: 754, W: 1344, vp: new Float32Array(16), bindAttribs: noop, texture: noop, resize: noop, bindBuffer: noop },
  UI: { els: {} }, Input: { pointers: new Map() }
});
vm.runInContext(script, ctx, { filename: 'ephemeris_probe.js' });
