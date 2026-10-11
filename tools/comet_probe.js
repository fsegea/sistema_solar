#!/usr/bin/env node
/* ============================================================================
   comet_probe.js — sondeo de la Fase 2: velocidad de cometas y colas.

   Lee el código REAL de src/ (concatenado como build.sh), sin navegador.
   Para cada cometa, en varias fechas, imprime:
     r [UA]  |vel| [UA/d]  |vel| [km/s]  vis-viva esperado  act  ang(ion,polvo)

   Uso:  node tools/comet_probe.js            (fechas por defecto)
         node tools/comet_probe.js 9000 22600 -5000   (t simulado [días desde J2000])
   Criterios (ROADMAP Fase 2):
     A  cola iónica anti-solar: dot(ion, sol->cometa) > 0,999
     B  cola de polvo curvada: ang(ion, polvo) > 3° cuando act > 0,3
     C  |vel| dentro del 2 % de la vis-viva sqrt(GM(2/r - 1/a))
   ============================================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const parts = ['02_core.js', '04_textures.js', '06_scene.js'].map(read);

const DAYS = process.argv.slice(2).map(Number).filter(n => isFinite(n));

const test = `
Sim.byId = {}; Sim.bodies = []; Sim.comets = []; Sim.sun = null;
for (const def of BODY_DEFS) {
  const b = new Body(def);
  Sim.byId[def.id] = b; Sim.bodies.push(b);
  if (def.parent) { const p = Sim.byId[def.parent]; b.parent = p; p.children.push(b); }
  if (def.kind === 'star') Sim.sun = b;
  if (def.kind === 'comet') Sim.comets.push(b);
}
R.H = 754; Cam.fov = 55;

const DAYS = ${JSON.stringify(DAYS.length ? DAYS : [-5000, 9000, 22600])};
const km_s = v => v * AU_KM / 86400;
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
let fails = 0;
for (const t of DAYS) {
  Sim.t = t; Sim.jd = J2000_JD + t;
  for (const b of Sim.bodies) { updateKepler(b, t); updateOrientation(b, t); }
  console.log('--- t=' + t.toFixed(1) + ' d  (' + fmtDate(Sim.jd) + ')');
  for (const b of Sim.comets) {
    const r = hypot3(b.pos[0], b.pos[1], b.pos[2]);
    const el = elementsOf(b, t, _el);
    const v = hypot3(b.vel[0], b.vel[1], b.vel[2]);
    const vv = Math.sqrt(Math.max(0, GM_SUN * (2 / r - 1 / el.a)));   // vis-viva [UA/d]
    const T = cometTail(b, { ion: new Float64Array(3), dust: new Float64Array(3) });
    const sd = nrm([b.pos[0] - Sim.sun.pos[0], b.pos[1] - Sim.sun.pos[1], b.pos[2] - Sim.sun.pos[2]]);
    const dotIon = T.ion[0]*sd[0] + T.ion[1]*sd[1] + T.ion[2]*sd[2];
    const errV = vv > 0 ? Math.abs(v - vv) / vv : 0;
    const A = dotIon > 0.999, B = T.act <= 0.3 || T.angleDeg > 3, C = errV <= 0.02;
    if (!A || !B || !C) fails++;
    console.log('  ' + b.id.padEnd(9) +
      ' r=' + r.toFixed(2).padStart(7) + ' UA' +
      '  |vel|=' + v.toFixed(6).padStart(9) + ' UA/d (' + km_s(v).toFixed(2).padStart(6) + ' km/s)' +
      '  visviva=' + vv.toFixed(6).padStart(9) + ' err=' + (errV*100).toFixed(3).padStart(6) + ' %' +
      '  act=' + T.act.toFixed(2) +
      '  ang(ion,polvo)=' + T.angleDeg.toFixed(1).padStart(5) + ' deg' +
      '  A=' + (A?'OK':'X') + ' B=' + (B?'OK':'X') + ' C=' + (C?'OK':'X'));
  }
}
console.log('---');
console.log(fails === 0 ? 'RESULTADO: OK   (A anti-solar, B polvo curvado, C vis-viva)'
                        : 'RESULTADO: FALLA  (' + fails + ' comprobaciones)');
process.exit(fails === 0 ? 0 : 1);
`;

const last = parts[parts.length - 1].replace(/\}\)\(\);\s*$/, '');
const script = parts.slice(0, -1).join('\n') + '\n' + last + '\n' + test + '\n})();\n';

const noop = () => {};
const ctx = vm.createContext({
  console, Math, Date, JSON, isNaN, isFinite, parseInt, parseFloat, process,
  Float32Array, Float64Array, Uint8Array, Uint16Array, Int32Array, Array, Object, Map, Set, Infinity, NaN,
  document: { createElement: noop, addEventListener: noop, getElementById: () => null, readyState: 'complete' },
  window: { addEventListener: noop },
  performance: { now: () => 0 }, requestAnimationFrame: noop,
  R: { tex: {}, gl: null, progs: {}, sphereHi: null, sphereLo: null, quad: null, init: () => false,
       H: 1, W: 1, vp: new Float32Array(16), bindAttribs: noop, texture: noop, resize: noop },
  UI: { els: {} }, Input: { pointers: new Map() },
});
vm.runInContext(script, ctx, { filename: 'solar_comet_probe.js' });
