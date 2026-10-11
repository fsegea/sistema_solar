#!/usr/bin/env node
/* eclipse_probe.js — sondeo (no es un test): geometría de eclipses Sol-Luna-Tierra con el
   código real de src/. Avanza N-body + lunas fecha a fecha y evalúa la oclusión tal y como
   la calcula FS_BODY (uOccPos/uOccR sobre disp,dispR). */
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
Sim.scaleMode = 'real'; Sim.sizeExagg = 1; Cam.fov = 45; Sim.minPxSize = 2; R.H = 754;

const E = Sim.byId.earth, M = Sim.byId.moon, S = Sim.sun;
const sub = (a,b) => [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
const nrm = v => { const l=Math.hypot(v[0],v[1],v[2]); return [v[0]/l,v[1]/l,v[2]/l]; };
const ss = (a,b,x)=>{ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };

/* --- oclusion en un punto de la superficie de un cuerpo, con su oclusor (replica FS_BODY) --- */
function shadeAt(body, oc, point) {
  const toSun = sub(point, S.disp); const sunDist = Math.hypot(...toSun); const L = nrm(toSun);   // direction du point vers le Soleil
  const d = sub(oc.disp, point); const t = d[0]*L[0]+d[1]*L[1]+d[2]*L[2];
  const miss = Math.hypot(d[0]-L[0]*t, d[1]-L[1]*t, d[2]-L[2]*t);
  const valid = (t > 0 && t < sunDist) ? 1 : 0;
  const s = (1 - ss(oc.dispR*0.55, oc.dispR*1.45, miss)) * valid;   // igual que FS_BODY: 1 = ocluido
  return { shade: 1 - 0.94*s, t, miss, valid, rO: oc.dispR, sunDist };
}

/* --- geometría REAL (UA) del eje de sombra --- */
function realGeo() {
  const eSun = nrm(sub(E.pos, S.pos));
  const eM = sub(M.pos, E.pos);
  const t = eM[0]*eSun[0]+eM[1]*eSun[1]+eM[2]*eSun[2];
  const miss = Math.hypot(eM[0]-eSun[0]*t, eM[1]-eSun[1]*t, eM[2]-eSun[2]*t);
  return { t, missAU: miss, missER: miss * 149597870.7 / E.radiusKm };   // miss en radios terrestres
}

/* --- barrido monotono 2026-01-01 .. 2026-12-31 --- */
let jd = parseFloat(process.env.JD0 || 2461000.5);
const jdEnd = parseFloat(process.env.JD1 || 2461400.5);
const MODE = process.env.MODE || 'real'; Sim.scaleMode = MODE;
let bestS = null, bestL = null, nEcl = 0;
while (jd <= jdEnd) {
  const target = jd - J2000_JD;
  const total = target - NBody.lastT;
  const steps = Math.max(1, Math.ceil(Math.abs(total)/0.05));
  const dt = total/steps;
  for (let s=0;s<steps;s++) NBody.step(dt);
  NBody.lastT = target; Sim.t = target; Sim.jd = jd;
  simulate(0);                                       // refresca lunas/keplerianas en ese t
  computeDisplayPositions();
  const rg = realGeo();
  const sunDir = nrm(sub(E.disp, S.disp));
  const P = [E.disp[0]+sunDir[0]*E.dispR, E.disp[1]+sunDir[1]*E.dispR, E.disp[2]+sunDir[2]*E.dispR];
  const sol = shadeAt(E, M, P);                     // punto subsolar de la Tierra
  const mDir = nrm(sub(M.disp, S.disp));
  const Q = [M.disp[0]+mDir[0]*M.dispR, M.disp[1]+mDir[1]*M.dispR, M.disp[2]+mDir[2]*M.dispR];
  const lun = shadeAt(M, E, Q);                     // punto sub-terrestre de la Luna
  if (rg.t > 0 && rg.missER < 1.0) nEcl++;        // eje de sombra cayendo sobre la Tierra (física real)
  if (!bestS || sol.shade < bestS.sol.shade) bestS = { jd, rg, sol, lun, px:{eR:E.dispR, mR:M.dispR, d:Math.hypot(...sub(M.disp,E.disp))} };
  if (!bestL || lun.shade < bestL.lun.shade) bestL = { jd, rg, sol, lun };
  jd += 0.25;
}
console.log('dias escaneados:', ((jdEnd-jd)/0.25|0)+1, ' dias con eje de sombra sobre la Tierra:', nEcl);
console.log('--- eclipse solar minimo (shade subsolar Tierra) ---');
console.log(fmtDate(bestS.jd), 'shade =', bestS.sol.shade.toFixed(4),
            '| real: t>0?', bestS.rg.t>0, 'miss =', bestS.rg.missER.toFixed(3), 'R_Tierra');
console.log('   shader: t =', bestS.sol.t.toFixed(5), 'valid =', bestS.sol.valid,
            'miss =', bestS.sol.miss.toFixed(5), 'rO =', bestS.sol.rO.toFixed(5), 'sunDist =', bestS.sol.sunDist.toFixed(3));
console.log('   disp: R_Tierra =', bestS.px.eR.toFixed(4), 'R_Luna =', bestS.px.mR.toFixed(4),
            'd(Tierra-Luna) =', bestS.px.d.toFixed(4), ' -> en radios terrestres:', (bestS.px.d/bestS.px.eR).toFixed(2), ' (real: 60,3)');
const capDeg = Math.asin(Math.min(1, 1.45*bestS.sol.rO/bestS.px.d))*180/Math.PI;
console.log('   radio del parche de penumbra sobre la Tierra:', capDeg.toFixed(1), 'grados de radio angular',
            ' (real: <=0,7 grados)');
console.log('--- eclipse lunar minimo (shade punto sub-terrestre Luna) ---');
console.log(fmtDate(bestL.jd), 'shade =', bestL.lun.shade.toFixed(4), '| valid =', bestL.lun.valid,
            'miss =', bestL.lun.miss.toFixed(5), 'rO =', bestL.lun.rO.toFixed(5));
console.log('   ese dia, solar: shade =', bestL.sol.shade.toFixed(4), ' real miss =', bestL.rg.missER.toFixed(3));
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
vm.runInContext(script, ctx, { filename: 'eclipse_probe.js' });
