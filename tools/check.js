#!/usr/bin/env node
/* ============================================================================
   check.js — verificación automática de los criterios comprobables sin navegador.
   Lee el código REAL de src/ (concatenado como build.sh). Salida: ~12 líneas.

   Uso:  node tools/check.js
   ============================================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const SRC = process.env.SOLAR_SRC || path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

/* El IIFE abre en 02_core.js:20 y cierra en 08_boot.js:206: los src/ no son
   parseables por separado, hay que concatenarlos. */
const FILES = ['02_core.js', '04_textures.js', '05_gl.js', '06_scene.js', '07_ui.js', '09_tour.js'];
const parts = FILES.map(read);
const last = parts[parts.length - 1].replace(/\}\)\(\);\s*$/, '');

/* Comprobaciones estaticas del tour (se inyectan como booleanos: dentro del VM
   las expresiones regulares del template literal escapan mal). */
const TOUR_SRC = read('09_tour.js');
const TOUR_HOOK_GATED = /RenderHooks\.tour\s*=\s*function\s*\(\)\s*\{\s*if\s*\(Tour\.active/.test(TOUR_SRC);
const TOUR_NO_DYNAMIC = !/\beval\(|\bnew Function\(/.test(TOUR_SRC);
const TOUR_PUSHES_PAIRS = /linePush\([^)]*\);\s*linePush\([^)]*\);/.test(TOUR_SRC);
/* frame() debe recalcular disp ANTES de la coreografia: si tourUpdate ancla el
   objetivo sobre los disp del frame anterior, el ojo queda un frame por detras. */
const TOUR_ANCHOR_FRESH = /computeDisplayPositions\(\);[^\n]*\n[ \t]*tourUpdate\(dt\);/.test(read('08_boot.js'));

const TEST = `
/* ================= TESTS INYECTADOS ================= */
let pass = 0, fail = 0;
const T = (name, ok, detail) => { console.log((ok ? 'OK   ' : 'FAIL ') + name.padEnd(34) + detail); ok ? pass++ : fail++; };

/* ---- 1. Criterio #6: drift N-cuerpo < 0,01 % en 1 año simulado ---- */
Sim.byId = {}; Sim.bodies = []; Sim.comets = []; Sim.sun = null;
for (const def of BODY_DEFS) {
  const b = new Body(def);
  Sim.byId[def.id] = b; Sim.bodies.push(b);
  if (def.parent) { const p = Sim.byId[def.parent]; b.parent = p; p.children.push(b); }
  if (def.kind === 'star') Sim.sun = b;
  if (def.kind === 'comet') Sim.comets.push(b);
}
NBody.init();
const run = (dt, days) => {
  NBody.reset(); NBody.dt = dt; NBody.lastT = Sim.t; NBody.steps = 0;
  const n = Math.round(days / dt);
  for (let s = 0; s < n; s++) NBody.step(dt);   // step() es un Verlet kick-drift-kick completo
  return Math.abs((NBody.energy() - NBody.E0) / Math.abs(NBody.E0));
};
const d1 = run(0.02, JULIAN_YEAR), d2 = run(0.01, JULIAN_YEAR);
const orden = d2 === 0 ? Infinity : Math.log(d1 / d2) / Math.log(2);
T('N-cuerpo drift 1 anio (dt=0.02 d)', d1 * 100 < 0.01, (d1 * 100).toExponential(3) + ' %');
T('orden del integrador', orden > 1.7, orden.toFixed(2) + '  (2=Verlet/RK4, 1=Euler)');
const d10 = run(0.02, 10 * JULIAN_YEAR);
T('N-cuerpo drift 10 anios', d10 * 100 < 0.1, (d10 * 100).toExponential(3) + ' %');

/* ---- 2. Fecha simulada: jdToGregorian vs Date UTC ---- */
let bad = 0, tot = 0, ejemplo = '';
// medianoches exactas (semienteros representables): sin error de acumulacion en el propio test
for (let i = 0; i < 70858; i++) {
  const jd = 2415020.5 + i;                       // 1900-01-01 .. 2093-12-31
  tot++;
  const g = jdToGregorian(jd), dt = new Date((jd - 2440587.5) * 86400000);
  if (g.year !== dt.getUTCFullYear() || g.month < 1 || g.month > 12 || g.day < 1 || g.day !== dt.getUTCDate()) {
    bad++; if (!ejemplo) ejemplo = 'JD ' + jd + ' -> ' + fmtDate(jd);
  }
}
// ida y vuelta: gregorianToJD(jdToGregorian(jd)) == jd
let badRT = 0;
for (let i = 0; i < 70858; i += 7) {
  const jd = 2415020.5 + i, g = jdToGregorian(jd);
  if (gregorianToJD(g.year, g.month, g.day) !== jd + 0.5) badRT++;
}
T('jdToGregorian (1900-2093)', bad === 0 && badRT === 0,
  bad + '/' + tot + ' fechas mal' + (badRT ? '  ' + badRT + ' idayvuelta' : '') + (ejemplo ? '  ej.: ' + ejemplo : ''));
T('fecha del epoch J2000', fmtDate(2451544.5).indexOf('01 ene 2000') === 0, fmtDate(2451544.5));

/* ---- 3. Rango y consistencia de la velocidad ---- */
const sMin = speedFromSlider(0), sMax = speedFromSlider(100);
const RT = speedFromSlider(sliderFromSpeed(365.25));
T('velocidad minima <= 1 s/s', sMin <= (1 / 86400) * 1.0000001, sMin.toExponential(3) + ' UA/d = ' + (sMin * 86400).toFixed(3) + ' s/s');
T('velocidad maxima >= 100 anios/s', sMax >= 36525, sMax.toExponential(3) + ' UA/d = ' + (sMax / JULIAN_YEAR).toFixed(1) + ' anios/s');
T('slider<->velocidad inversos', Math.abs(RT / 365.25 - 1) < 0.02, '1 anio/s -> ' + RT.toFixed(2) + ' UA/d');

/* ---- 4. Criterios astronómicos ---- */
/* periodo [días] a partir de la anomalía media del TABLE [grados/siglo] */
const per = id => 13149000 / PLANET_TABLE[id][9];
T('periodo Tierra ~365.25 d', Math.abs(per('earth') - 365.25) < 0.5, per('earth').toFixed(2) + ' d');
T('periodo Mercurio ~88 d', Math.abs(per('mercury') - 87.97) < 0.5, per('mercury').toFixed(2) + ' d');
const ven = BODY_DEFS.find(x => x.id === 'venus'), ura = BODY_DEFS.find(x => x.id === 'uranus');
T('Venus retrogrado (oblicuidad > 90)', ven.obliquityDeg > 90, ven.obliquityDeg + ' deg');
T('Urano ~98 deg ("tumbado")', Math.abs(ura.obliquityDeg - 97.77) < 1, ura.obliquityDeg + ' deg');
T('cinturon asteroides >= 3000', N_ASTEROIDS >= 3000, N_ASTEROIDS);
T('cinturon Kuiper >= 1500', N_KUIPER >= 1500, N_KUIPER);
T('lagunas de Kirkwood', KIRKWOOD.length >= 5, KIRKWOOD.map(k => k.ratio).join(','));

/* ---- 5. Requisitos de render (comprobación estática del código) ---- */
const SKY = ${JSON.stringify(read('04_textures.js'))};
const SCENE = ${JSON.stringify(read('06_scene.js'))};
const texSkySrc = SKY.slice(SKY.indexOf('function texSky'));
const texSkyBody = texSkySrc.slice(0, texSkySrc.indexOf('function ', 20));
const dibujaEstrellas = /fillRect|arc\\(|fillCircle|drawPoint/.test(texSkyBody) && /star|estrella/i.test(texSkyBody);
T('campo estelar >= 5000 estrellas', dibujaEstrellas, dibujaEstrellas ? 'texSky() dibuja estrellas' : 'texSky(): solo Via Lactea difusa, sin estrellas puntuales');
T('nubes de la Tierra usadas en el render', /earthClouds/.test(SCENE), 'R.tex.earthClouds ' + (/earthClouds/.test(SCENE) ? 'enlazado en 06_scene.js' : 'generado pero NUNCA usado'));
T('LOD (sphereLo) en uso', /sphereLo/.test(SCENE), 'R.sphereLo ' + (/sphereLo/.test(SCENE) ? 'usado' : 'creado y sin usar'));

/* ---- 6. Eclipses (criterio #19) y sombra de anillos (criterio #20) ---- */
const GL = ${JSON.stringify(read('05_gl.js'))};
Sim.belts = { ast: {}, ku: {} };
const _updateBelt = updateBelt, _updateTrails = updateTrails;   // restaurados antes del bloque 9
updateBelt = () => {}; updateTrails = () => {};
R.H = 754; Cam.fov = 55;                       // como en la app real
NBody.init(); Sim.t = 0; NBody.lastT = 0;
const sub3 = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
const nrm3 = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function gotoJD (jd) {
  const target = jd - J2000_JD, total = target - NBody.lastT;
  const steps = Math.max(1, Math.ceil(Math.abs(total) / 0.05)), dt = total / steps;
  for (let s = 0; s < steps; s++) NBody.step(dt);
  NBody.lastT = target; Sim.t = target; Sim.jd = jd;
  simulate(0); computeDisplayPositions();
}
/* replica el calculo de oclusion de FS_BODY sobre el punto subsolar del cuerpo */
function shadeAt (body, oc) {
  const S = Sim.sun, sd = nrm3(sub3(body.disp, S.disp));
  const P = [body.disp[0] + sd[0] * body.dispR, body.disp[1] + sd[1] * body.dispR, body.disp[2] + sd[2] * body.dispR];
  const toSun = sub3(P, S.disp), sunDist = Math.hypot(toSun[0], toSun[1], toSun[2]), L = nrm3(toSun);
  const d = sub3(P, oc.disp), t = d[0] * L[0] + d[1] * L[1] + d[2] * L[2];
  const miss = Math.hypot(d[0] - L[0] * t, d[1] - L[1] * t, d[2] - L[2] * t);
  const valid = (t > 0 && t < sunDist) ? 1 : 0;
  return 1 - 0.94 * (1 - sst(oc.dispR * 0.55, oc.dispR * 1.45, miss)) * valid;
}
const EARTH = Sim.byId.earth, MOON = Sim.byId.moon;
let bestS = null, bestL = null;
for (let jd = 2461000.5; jd <= 2461400.5; jd += 0.5) {
  gotoJD(jd);
  const sS = shadeAt(EARTH, MOON), sL = shadeAt(MOON, EARTH);
  if (!bestS || sS < bestS.s) bestS = { jd, s: sS, other: sL };
  if (!bestL || sL < bestL.s) bestL = { jd, s: sL, other: sS };
}
T('oclusion solar (eclipse de Sol)', bestS.s < 0.5 && bestS.other > 0.99,
  'shade punto subsolar Tierra = ' + bestS.s.toFixed(3) + ' en ' + fmtDate(bestS.jd));
T('oclusion lunar (eclipse de Luna)', bestL.s < 0.5 && bestL.other > 0.99,
  'shade punto sub-terrestre Luna = ' + bestL.s.toFixed(3) + ' en ' + fmtDate(bestL.jd));
const ringShader = /uRingOn/.test(GL) && /inBand/.test(GL) && /uRingOpacity/.test(GL);
const ringJS = /uRingOpacity/.test(SCENE) && /uRingAxis/.test(SCENE);
T('sombra de anillos sobre el planeta', ringShader && ringJS,
  'FS_BODY ' + (ringShader ? 'calcula la banda' : 'ignora los anillos') + ' / drawBodies ' + (ringJS ? 'pasa eje+opacidad' : 'no pasa uniforms'));

/* ---- 7. Cometas: velocidad orbital y geometria de las colas (Fase 2) ---- */
/* Sin body.vel la cola de polvo cae en el fallback anti-solar y queda
   coincidente con la ionica: no existe cola curvada. */
const CFECHAS = [-5000, -1005.5, 1194.5, 7999.5, 9000, 22600];   // incluye los 4 perihelios
let cTot = 0, cIon = 0, cVel = 0, cCurv = 0, maxErrV = 0, minAng = 1e9, curvTot = 0, kepErr = 0;
for (const t of CFECHAS) {
  Sim.t = t; Sim.jd = J2000_JD + t;
  for (const b of Sim.comets) {
    updateKepler(b, t);
    const r = hypot3(b.pos[0], b.pos[1], b.pos[2]);
    const el = elementsOf(b, t, _el);
    const v = hypot3(b.vel[0], b.vel[1], b.vel[2]);
    const vv = Math.sqrt(Math.max(0, GM_SUN * (2 / r - 1 / el.a)));      // vis-viva [UA/d]
    const errV = vv > 0 ? Math.abs(v - vv) / vv : 1;
    const T = cometTail(b, { ion: new Float64Array(3), dust: new Float64Array(3) });
    const sd = [b.pos[0] - Sim.sun.pos[0], b.pos[1] - Sim.sun.pos[1], b.pos[2] - Sim.sun.pos[2]];
    const sl = hypot3(sd[0], sd[1], sd[2]) || 1;
    const dotIon = (T.ion[0]*sd[0] + T.ion[1]*sd[1] + T.ion[2]*sd[2]) / sl;
    cTot++;
    if (dotIon > 0.999) cIon++;
    if (errV <= 0.02) cVel++;
    maxErrV = Math.max(maxErrV, errV);
    kepErr = Math.max(kepErr, Math.abs(el.n - Math.sqrt(GM_SUN / (el.a ** 3))) / el.n);
    if (T.act > 0.3) { curvTot++; if (T.angleDeg > 3) cCurv++; minAng = Math.min(minAng, T.angleDeg); }
  }
}
T('cometas |vel| = vis-viva', cVel === cTot, cVel + '/' + cTot + '  err max ' + (maxErrV * 100).toFixed(3) + ' %');
T('cola ionica anti-solar', cIon === cTot, cIon + '/' + cTot + ' casos dot > 0,999');
T('cola de polvo curvada', cCurv === curvTot && curvTot >= 4, cCurv + '/' + curvTot + ' casos ang > 3 deg  (min ' + minAng.toFixed(1) + ' deg)');
T('elementos de cometas (3ª Kepler)', kepErr < 0.001, 'n vs sqrt(GM/a3): desvio ' + (kepErr * 100).toFixed(3) + ' %');

/* ---- 8. Robustez: selectBody() y frame() (FASE 5, fragilidad detectada en la FASE 2) ---- */
/* window.SOLAR.selectBody() es la puerta de depuracion: si acepta un argumento invalido,
   Sim.selected queda corrupto, drawLines() lanza y el bucle rAF muere sin recuperacion. */
const RB = [resolveBody(Sim.byId.earth) === Sim.byId.earth, resolveBody('earth') === Sim.byId.earth,
  resolveBody('halley') === Sim.byId.halley, resolveBody('noexiste') === null, resolveBody(null) === null,
  resolveBody(undefined) === null, resolveBody(42) === null, resolveBody({}) === null, resolveBody([]) === null];
T('selectBody: acepta Body o id', RB[0] && RB[1] && RB[2], 'Body, "earth", "halley"');
T('selectBody: arg invalido -> null', RB.slice(3).every(Boolean), RB.slice(3).filter(Boolean).length + '/6 casos -> null');
const centinela = Sim.byId.earth;
Sim.selected = centinela;
let selThrew = null;
const _warn = console.warn; console.warn = () => {};      // silenciamos los avisos esperados
try { selectBody('noexiste', false); selectBody(null, true); selectBody(42); } catch (e) { selThrew = e; }
console.warn = _warn;
T('selectBody invalido: sin efecto', !selThrew && Sim.selected === centinela, selThrew ? 'lanza ' + selThrew.name : 'Sim.selected intacto');

/* frame(): el requestAnimationFrame debe quedar FUERA del try/catch, si no una excepcion
   dentro de render() deja la animacion muerta. Comprobacion estructural del fuente. */
const fsrc = (BOOT_SRC.match(/function frame\\(now\\) \\{([\\s\\S]*?)\\n\\}/) || [, ''])[1];
const iTry = fsrc.indexOf('try {'), iCatch = fsrc.indexOf('} catch'), iRaf = fsrc.lastIndexOf('requestAnimationFrame(frame);');
const rafRearmado = iTry >= 0 && iCatch > iTry && iRaf > iCatch;
T('frame() rearma el rAF tras error', rafRearmado, 'try@' + iTry + ' catch@' + iCatch + ' rAF@' + iRaf);
const rafN = (fsrc.match(/requestAnimationFrame\\(frame\\);/g) || []).length;
T('frame(): rAF unico y ultima sentencia', rafN === 1 && fsrc.trimEnd().endsWith('requestAnimationFrame(frame);'), rafN + ' llamada(s), ' + (fsrc.trimEnd().endsWith('requestAnimationFrame(frame);') ? 'al final' : 'NO al final'));

/* ---- 9. Regresion numerica de los cinturones (FASE 1) ---- */
/* Congelada ANTES del refactor del bucle caliente. La referencia es la formula
   elementos -> cartesianas escrita a mano, con la misma aproximacion de Kepler
   (keplerSolveFast) que usa updateBelt(). Un refactor con matrices precomputadas
   debe reproducirla dentro del redondeo float32 de belt.pos. */
/* restaurar los stubs del bloque 6: el test 9 necesita el updateBelt() real */
updateBelt = _updateBelt; updateTrails = _updateTrails;
const BELT_T = [-60000, 0, 9000, 22600, 60000];   // 1836 .. 2164: cubre el rango de fechas de la UI
let beltMaxRel = 0, beltMaxAbs = 0, beltN = 0, beltBodies = 0, beltWorst = '';
for (const opts of [BELT_AST_OPTS, BELT_KUIPER_OPTS]) {
  const bb = makeBelt(opts);
  beltBodies += bb.n;
  for (const t of BELT_T) {
    updateBelt(bb, t);
    for (let k = 0; k < bb.n; k++) {
      const M = wrapPi(bb.M0[k] + bb.nrad[k] * t), ek = bb.e[k], ak = bb.a[k];
      const E = keplerSolveFast(M, ek);
      const cE = Math.cos(E), sE = Math.sin(E);
      const xo = ak * (cE - ek), yo = ak * Math.sqrt(1 - ek * ek) * sE;
      const cw = Math.cos(bb.w[k]), sw = Math.sin(bb.w[k]);
      const cO = Math.cos(bb.om[k]), sO = Math.sin(bb.om[k]);
      const ci = Math.cos(bb.i[k]), si = Math.sin(bb.i[k]);
      const x1 = xo * cw - yo * sw, y1 = xo * sw + yo * cw;
      const rx = x1 * cO - y1 * sO * ci, ry = x1 * sO + y1 * cO * ci, rz = y1 * si;
      /* FASE 7: el cinturon se expresa en el equinoccio de la fecha, igual que updateBelt() */
      const psi = precessionAngle(t), cpsi = Math.cos(psi), spsi = Math.sin(psi);
      const d = Math.hypot(rx * cpsi - ry * spsi - bb.pos[k * 3],
                           rx * spsi + ry * cpsi - bb.pos[k * 3 + 1],
                           rz - bb.pos[k * 3 + 2]);
      const r = Math.hypot(rx, ry, rz);            // distancia al Sol: escala natural del error
      const rel = d / r;                           // error relativa del vector de posicion
      beltN++;
      if (d > beltMaxAbs) beltMaxAbs = d;
      if (rel > beltMaxRel) { beltMaxRel = rel; beltWorst = 'a=' + ak.toFixed(1) + ' e=' + ek.toFixed(2) + ' r=' + r.toFixed(1) + ' UA, t=' + t; }
    }
  }
}
T('cinturones = formula exacta', beltMaxRel < 1e-6, 'max rel ' + beltMaxRel.toExponential(2) + '  max abs ' + beltMaxAbs.toExponential(2) + ' UA  (' + beltN + ' cuerpos-epoca, peor: ' + beltWorst + ')');

/* ---- 10. codigo muerto eliminado (FASE 5) ----
   Cada simbolo listado aqui fue revisado uno a uno en el roadmap: se asignaba y
   jamas se leia. Si alguno vuelve a aparecer, el test lo cuenta. */
const MUERTOS = ['step2(dt)', 'TexCache', 'gl_REPEAT', 'gl_CLAMP', 'orbitDisp',
                 'Cam.follow ', 'Sim.following', 'this.visible', 'this.periodD',
                 "querySelectorAll('.switch')[7]"];
const _quedan = MUERTOS.filter(s => SRC_TEXT.indexOf(s) >= 0);
T('sin codigo muerto (FASE 5)', _quedan.length === 0,
  _quedan.length ? 'quedan: ' + _quedan.join(', ') : SRC_LINES + ' lineas de src/ revisadas');

/* ---- 11. FASE 6: criterio de cierre ----
   "Toda tecla documentada en #helpCard existe en bindKeys() y todo interruptor del panel
   tiene su tecla", comprobado en los dos sentidos sobre el codigo real.
   Se parsea a mano (indexOf) en lugar de regex: TEST va dentro de una plantilla de Node
   y cada barra invertida extra habria que doblarla. */
const _tg = [];
let _i = 0;
while ((_i = SRC_TEXT.indexOf("['show", _i)) >= 0) {
  const _e = SRC_TEXT.indexOf("']", _i);
  const _p = SRC_TEXT.slice(_i + 2, _e).split("', '").map(s => s.replace(/^'|'$/g, ''));
  if (_p.length === 3 && _p[2].length === 1) _tg.push({ sim: _p[0], label: _p[1], kbd: _p[2] });
  _i = _e;
}
const _cases = new Set();
let _j = 0;
while ((_j = SRC_TEXT.indexOf("case '", _j)) >= 0) {
  const _c = SRC_TEXT[_j + 6];
  if (_c >= 'a' && _c <= 'z' && SRC_TEXT[_j + 7] === "'") _cases.add(_c);   // _j+7 es la comilla de cierre
  _j += 6;
}
const _kbdDoc = new Set();
const _hp = SHELL_HTML.split('<kbd>');
for (let _h = 1; _h < _hp.length; _h++) { const _s = _hp[_h].split('<')[0]; if (_s.length === 1 && _s >= 'A' && _s <= 'Z') _kbdDoc.add(_s); }
const _sinTecla = _tg.filter(t => !_cases.has(t.kbd.toLowerCase()));
const _sinAyuda = _tg.filter(t => !_kbdDoc.has(t.kbd));
const _sinSim = _tg.filter(t => !(t.sim in Sim));
const _teclaFantasma = [..._kbdDoc].filter(k => !_cases.has(k.toLowerCase()));
T('teclas: panel ↔ bindKeys ↔ ayuda',
  _sinTecla.length + _sinAyuda.length + _sinSim.length + _teclaFantasma.length === 0,
  _tg.length + ' interruptores · ' + _kbdDoc.size + ' teclas en la ayuda · ' + _cases.size + ' en bindKeys' +
  (_sinTecla.length ? '  SIN TECLA: ' + _sinTecla.map(t => t.label).join(', ') : '') +
  (_sinAyuda.length ? '  SIN AYUDA: ' + _sinAyuda.map(t => t.label).join(', ') : '') +
  (_sinSim.length ? '  SIN SIM: ' + _sinSim.map(t => t.sim).join(', ') : '') +
  (_teclaFantasma.length ? '  SIN CASO: ' + _teclaFantasma.join(', ') : ''));

/* ---- 12. Efemerides: precesion de los equinoccios y fechas de eclipse (FASE 7) ----
   Antes de la correccion el sistema vivia en el marco J2000 de la tabla JPL: los
   equinoccios caian 7-9 h tarde y el error crecia ~20 min por ano (medido: +422 min
   en 2021, +550 min en 2027). Con psi_A aplicado a todo el sistema el error residual
   debe quedar por debajo de la exactitud de la propia tabla JPL (~1' ~ 25 min) y, sobre
   todo, ya no debe crecer con el tiempo. Referencias: instantes publicados de equinoccios
   y solsticios (UTC). */
const _E0 = Sim.byId.earth, _L0 = Sim.byId.moon;
const _t0 = (y, m, d, H, mm) => gregorianToJD(y, m, d) - 0.5 + (H + mm / 60) / 24 - J2000_JD;
const _lonSun = t => { updateKepler(_E0, t); return (Math.atan2(-_E0.pos[1], -_E0.pos[0]) * RAD + 360) % 360; };
const _cross = (target, t0, t1) => {
  let lo = t0, hi = t1;
  const f = t => ((_lonSun(t) - target + 540) % 360) - 180;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
};
const _errMin = (t, y, m, d, H, mm) => ((J2000_JD + t) - (gregorianToJD(y, m, d) - 0.5 + (H + mm / 60) / 24)) * 1440;
const EST = [
  ['equinoccio mar 2021', 2021, 3, 20,  9, 37,   0],
  ['equinoccio mar 2024', 2024, 3, 20,  3,  6,   0],
  ['equinoccio mar 2025', 2025, 3, 20,  9,  1,   0],
  ['equinoccio mar 2026', 2026, 3, 20, 14, 46,   0],
  ['equinoccio mar 2027', 2027, 3, 20, 20, 25,   0],
  ['solsticio jun 2024',  2024, 6, 20, 20, 51,  90],
  ['solsticio jun 2025',  2025, 6, 21,  2, 42,  90],
  ['equinoccio sep 2024', 2024, 9, 22, 12, 44, 180],
  ['solsticio dic 2024',  2024, 12, 21,  9, 20, 270]
];
let estWorst = 0, estTxt = '', estErr = {};
for (const it of EST) {
  const base = _t0(it[1], it[2], it[3], it[4], it[5]);
  const e = _errMin(_cross(it[6], base - 20, base + 20), it[1], it[2], it[3], it[4], it[5]);
  estErr[it[1]] = e;
  if (Math.abs(e) > Math.abs(estWorst)) estWorst = e;
  estTxt += it[0] + ' ' + (e >= 0 ? '+' : '') + e.toFixed(0) + '  ';
}
T('equinoccios y solsticios reales', Math.abs(estWorst) < 30,
  'peor ' + (estWorst >= 0 ? '+' : '') + estWorst.toFixed(0) + ' min (antes +550) · [min] ' + estTxt);
const _crece = (estErr[2027] || 0) - (estErr[2021] || 0);
T('error estacional sin deriva', Math.abs(_crece) < 15,
  'marzo 2021 -> 2027: ' + (_crece >= 0 ? '+' : '') + _crece.toFixed(0) + ' min (antes +128 min en 6 anios)');
/* El intervalo entre equinoccios de marzo sucesivos es el anio TROPICO (365,2422 d), no el
   sidero (365,2564 d). Es la prueba autonoma de la precesion: sin psi_A el intervalo mediria
   el anio sidero, 20,5 min mas largo cada ano. */
let _prev = _cross(0, _t0(2021, 3, 20, 0, 0) - 20, _t0(2021, 3, 20, 0, 0) + 20), _deriva = 0;
for (let _y = 2022; _y <= 2101; _y++) {
  const _t = _cross(0, _t0(_y, 3, 20, 0, 0) - 20, _t0(_y, 3, 20, 0, 0) + 20);
  const _d = _t - _prev; _prev = _t;
  if (Math.abs(_d - 365.2422) > Math.abs(_deriva)) _deriva = _d - 365.2422;
}
T('anio tropico 365,2422 d', Math.abs(_deriva) < 1 / 60,
  'desvio maximo ' + (_deriva * 1440).toFixed(2) + ' min/anio (sin psi_A: 20,5 min/anio)');
const _psi1 = precessionAngle(JULIAN_CENTURY) * RAD * 3600;
T('psi_A(1 siglo) = 5029,65"', Math.abs(_psi1 - 5029.65264) < 1e-6,
  _psi1.toFixed(5) + '" = 5029,0966 + 0,55604');
T('psi_A(J2000) = 0', precessionAngle(0) === 0,
  'psi_A(2026) = ' + (precessionAngle(_t0(2026, 3, 20, 0, 0)) * RAD * 3600).toFixed(1) + '"');

/* Eclipses reales: la rotacion psi_A es rigida sobre todo el sistema, asi que la
   geometria relativa (la que produce los eclipses) NO cambia. Comprobado: las mismas
   7 fechas de eclipse, con el mismo error de instante (el modelo lunar es de elementos
   MEDIOS, sin terminos periodicos: +-3 h en la fase de la conjuncion). */
const _elong = t => {
  updateKepler(_E0, t); updateKepler(_L0, t);
  const sx = -_E0.pos[0], sy = -_E0.pos[1], sz = -_E0.pos[2];
  const mx = _L0.pos[0] - _E0.pos[0], my = _L0.pos[1] - _E0.pos[1], mz = _L0.pos[2] - _E0.pos[2];
  return Math.acos(clamp((sx * mx + sy * my + sz * mz) / (hypot3(sx, sy, sz) * hypot3(mx, my, mz)), -1, 1)) * RAD;
};
const ECL = [[2017, 8, 21], [2019, 7, 2], [2023, 10, 14], [2024, 4, 8], [2026, 8, 12], [2027, 8, 2], [2028, 7, 22]];
let eclOK = 0, eclTxt = '';
for (const ec of ECL) {
  const tg = _t0(ec[0], ec[1], ec[2], 12, 0);
  let best = 1e9, bt = tg;
  for (let t = tg - 0.6; t <= tg + 0.6; t += 0.01) { const e = _elong(t); if (e < best) { best = e; bt = t; } }
  const fch = fmtDate(J2000_JD + bt);
  const diaOk = fch.indexOf(String(ec[2]).padStart(2, '0') + ' ') === 0 &&
    fch.indexOf(['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][ec[1] - 1]) > 0 &&
    fch.indexOf(String(ec[0])) > 0;
  if (diaOk && best < 1.5) eclOK++;
  eclTxt += ec[0] + (diaOk && best < 1.5 ? ' OK' : ' FALLO(' + fch + ' ' + best.toFixed(2) + ')') + ' ';
}
T('7 eclipses reales en su fecha', eclOK === ECL.length,
  eclOK + '/' + ECL.length + ' · elongacion min < 1,5 deg · ' + eclTxt);
T('HUD: velocidad integrada',
  SRC_TEXT.indexOf('Sim.nbody && b.integrated') >= 0 &&
  SRC_TEXT.indexOf('hypot3(b.vel[0]') >= 0 &&
  SRC_TEXT.indexOf('integrated = true') >= 0,
  'renderSheetLive usa |b.vel| de Verlet para los cuerpos que NBody integra');

/* ---- 13. Estelas y orbitas: gl.LINES exige DOS vertices por tramo ----
   drawLines() emite UN solo drawArrays(gl.LINES) sobre ~23000 vertices y GL los agrupa
   en parejas (0,1)(2,3)(4,5)... Si un bucle emite un vertex por muestra, las parejas se
   desfasan: se dibuja un tramo si y otro no, y -cuando el numero de vertices de una
   seccion es impar- el ultimo punto de un cuerpo se conecta con el primero del siguiente.
   Efecto medido antes de la correccion: 9459 vertices (impar), 34 tramos de hasta 11349
   unidades uniendo estelas de planetas distintos -> lineas rectas cruzando la pantalla
   que ademas cambiaban de frame a frame (el desfase depende de cuantas muestras tenga
   cada estela). Se ejecuta drawLines() con un GL de mentira y se comprueba el layout. */
const _noop2 = () => {};
let _lineData = null;
const _glFake = {
  useProgram: _noop2, depthMask: _noop2, enable: _noop2, blendFunc: _noop2,
  bindBuffer: _noop2, bufferSubData: (t, o, d) => { _lineData = d; }, drawArrays: _noop2,
  vertexAttribPointer: _noop2, enableVertexAttribArray: _noop2, disableVertexAttribArray: _noop2,
  uniformMatrix4fv: _noop2, ARRAY_BUFFER: 1, FLOAT: 2, LINES: 1, DEPTH_TEST: 3,
  BLEND: 4, SRC_ALPHA: 5, ONE_MINUS_SRC_ALPHA: 6
};
const _keepGl = R.gl, _keepProg = R.progs.line;
const _keepSel = Sim.selected, _keepOrb = Sim.showOrbits, _keepTr = Sim.showTrails, _keepLen = Sim.trailLen;
const _keepMA = Sim.measureA, _keepMB = Sim.measureB, _keepDist = Cam.dist;
Sim.showOrbits = true; Sim.showTrails = true; Sim.trailLen = 240;
Sim.measureA = null; Sim.measureB = null; Sim.selected = Sim.byId.earth;
Cam.dist = 2600; Cam.right = [1, 0, 0]; Cam.up = [0, 1, 0];
Sim.t = 0; Sim.jd = J2000_JD;
for (const b of Sim.bodies) {                      // replica buildAllOrbits() (vive en 08_boot.js)
  if (!b.def.table && !b.def.el || b.kind === 'star') continue;
  buildOrbitPolyline(b, b.kind === 'comet' ? 420 : (b.kind === 'moon' ? 160 : 280));
}
simulate(0); computeDisplayPositions();
for (const b of Sim.bodies) {                     // estela sintetica: 240 muestras de su propia orbita
  if (b.kind === 'star' || !b.orbitReal) continue;
  const n = Math.min(Sim.trailLen, b.orbitN);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i * b.orbitN / n) * 3;
    b.trail[i * 3] = b.orbitReal[k]; b.trail[i * 3 + 1] = b.orbitReal[k + 1]; b.trail[i * 3 + 2] = b.orbitReal[k + 2];
  }
  b.trailCount = n; b.trailHead = n; b.trailLastT = 0;
}
R.gl = _glFake; R.progs.line = { p: {}, a: { aPos: 0, aColor: 1 }, u: { uVP: 0 } };
let _dlErr = null;
try { drawLines(); } catch (e) { _dlErr = e; }
const _n = LinePool.n, _d = _lineData;
R.gl = _keepGl; R.progs.line = _keepProg;
Sim.selected = _keepSel; Sim.showOrbits = _keepOrb; Sim.showTrails = _keepTr;
Sim.trailLen = _keepLen; Sim.measureA = _keepMA; Sim.measureB = _keepMB; Cam.dist = _keepDist;
const _secs = []; let _exp = 0;
for (const b of Sim.bodies) {
  if (!b.orbitReal || (b.kind === 'moon' && b.parent.pxSize < 3)) continue;
  _secs.push(['orbita ' + b.id, _exp, 2 * b.orbitN]); _exp += 2 * b.orbitN;
}
for (const b of Sim.bodies) {
  if (b.trailCount < 2) continue;
  const len = Math.min(b.trailCount, Sim.trailLen);
  _secs.push(['estela ' + b.id, _exp, 2 * (len - 1)]); _exp += 2 * (len - 1);
}
_secs.push(['anillo de seleccion', _exp, 144]); _exp += 144;
const _px = i => [_d[i * 7], _d[i * 7 + 1], _d[i * 7 + 2]];
let _odd = 0, _cruz = 0, _gap = 0, _gapMax = 0;
for (const s of _secs) {
  if (s[1] % 2 !== 0) _odd++;                     // la pareja que cruza el limite une dos cuerpos
  for (let j = 0; _d && j + 1 < s[2] / 2; j++) {  // continuidad: fin del tramo j == inicio del j+1
    const a = _px(s[1] + 2 * j + 1), b2 = _px(s[1] + 2 * j + 2);
    const dd = Math.hypot(a[0] - b2[0], a[1] - b2[1], a[2] - b2[2]);
    if (dd > 1e-6) { _gap++; _gapMax = Math.max(_gapMax, dd); }
  }
}
for (let i = 0; _d && i + 1 < _n; i += 2) {       // ninguna pareja debe saltar de una seccion a otra
  const s = _secs.find(x => i >= x[1] && i < x[1] + x[2]);
  const s2 = _secs.find(x => i + 1 >= x[1] && i + 1 < x[1] + x[2]);
  if (!s || !s2 || s !== s2) _cruz++;
}
T('lineas: 2 vertices por tramo (gl.LINES)',
  !_dlErr && _n === _exp && !!_d && _d.length === _n * 7 && _odd === 0 && _cruz === 0 && _gap === 0,
  _dlErr ? 'drawLines() lanza ' + _dlErr.name : _n + ' vertices / ' + _exp + ' esperados · ' +
    _secs.length + ' secciones · ' + _odd + ' inicio impar · ' + _cruz + ' parejas entre cuerpos · ' +
    _gap + ' saltos (max ' + _gapMax.toFixed(1) + ' u)');

/* ---- 14. tour guiado: guion, camara y no-regresion ---- */
{
  const _ids = new Set(Sim.bodies.map(b => b.id));
  const _titulos = new Set(), _probs = [];
  for (const s of TOUR_STOPS) {
    if (!_ids.has(s.body)) _probs.push(s.body + ' no existe');
    if (_titulos.has(s.title)) _probs.push('titulo repetido: ' + s.title);
    _titulos.add(s.title);
    if (!s.title || !s.kicker || !s.text || !Array.isArray(s.chips) || s.chips.length < 3) _probs.push(s.body + ':guion');
    if (!(s.dist.au > 0) && !(s.dist.mult > 0) && !(s.dist.pair)) _probs.push(s.body + ':distancia');
    if (s.dist.pair) {
      const p = Sim.byId[s.dist.pair], foc = Sim.byId[s.body];
      if (!p || p.parent !== foc) _probs.push(s.body + ':pair ' + s.dist.pair + ' no es luna suya');
    }
    if (!(s.travel > 0) || !(s.dwell > 0)) _probs.push(s.body + ':tiempos');
    if (s.date && s.date !== 'today' && !s.date.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}( [0-9]{2}:[0-9]{2})?$/)) _probs.push(s.body + ':fecha');
    if (s.on) for (const k in s.on) if (!(k in Sim)) _probs.push(s.body + ':toggle ' + k);
    if (typeof s.speed === 'number' && (s.speed < 1 / 86400 || s.speed > 100 * 365.44)) _probs.push(s.body + ':velocidad');
  }
  T('tour: ' + TOUR_STOPS.length + ' paradas coherentes', _probs.length === 0, _probs.join(' | '));

  /* distancias de parada validas en ambas escalas (limites de Cam.minDist..maxDist) */
  const _out = [];
  for (const m of ['didactic', 'real']) {
    Sim.scaleMode = m;
    for (const s of TOUR_STOPS) {
      const b = Sim.byId[s.body];
      const d0 = s.dist || { mult: 8 };
      let d;
      if (d0.au !== undefined) d = m === 'real' ? d0.au * UV_PER_AU : mapDist(d0.au);
      else if (d0.pair) {
        const p = Sim.byId[d0.pair];
        if (!p) { _out.push(m + ':' + s.body + ':pair inexistente ' + d0.pair); continue; }
        const sep = hypot3(b.disp[0] - p.disp[0], b.disp[1] - p.disp[1], b.disp[2] - p.disp[2]);
        d = Math.max(sep, displayRadiusOf(b) * 6) / Math.tan(Cam.fov * DEG / 2) * (d0.k || 0.9);
      } else d = Math.max(displayRadiusOf(b), 1e-4) * (d0.mult || 8);
      if (!(d > Cam.minDist) || d > 400000) _out.push(m + ':' + s.body + '=' + d.toFixed(1));
    }
  }
  Sim.scaleMode = 'didactic';
  T('tour: distancias validas en escala didactica y real', _out.length === 0, _out.join(', '));

  /* encuadre: la luna de referencia de cada parada tiene que caber en el campo
     visual a la distancia calculada, y los primeros planos tienen que ser grandes */
  R.W = 1280; R.H = 754; Cam.dist = 1000; Cam.distTarget = 1000; Cam.update(0); computeDisplayPositions();
  const _halfH = Math.atan(Math.tan(Cam.fov * DEG / 2) * (R.W / R.H)) / DEG;
  const _fov = [], _tiny = [];
  for (const s of TOUR_STOPS) {
    const b = Sim.byId[s.body], d0 = s.dist || { mult: 8 }, dist = tourStopDist(s, b);
    if (d0.pair && Sim.byId[d0.pair]) {
      const p = Sim.byId[d0.pair];
      const sep = hypot3(b.disp[0] - p.disp[0], b.disp[1] - p.disp[1], b.disp[2] - p.disp[2]);
      const ang = Math.atan2(sep, dist) / DEG;
      if (ang > _halfH - 2) _fov.push(s.body + ' ' + ang.toFixed(1) + '/' + _halfH.toFixed(1) + '°');
    } else if (d0.mult !== undefined) {
      const ang = Math.atan2(displayRadiusOf(b), dist) / DEG;
      if (ang < 2 || ang > 30) _tiny.push(s.body + ' ' + ang.toFixed(1) + '°');
    }
  }
  T('tour: lunas emparejadas caben en el FOV', _fov.length === 0, _fov.join(', ') || 'campo ' + _halfH.toFixed(1) + '°');
  T('tour: primeros planos entre 2 y 30 grados', _tiny.length === 0, _tiny.join(', '));

  /* fechas del guion: deben ser fechas julianas finitas y dentro del rango tabulado */
  let _badDate = 0;
  for (const s of TOUR_STOPS) {
    if (!s.date || s.date === 'today') continue;
    const q = s.date.split(' ')[0].split('-');
    const jd = gregorianToJD(+q[0], +q[1], +q[2]) - 0.5;
    const g = jdToGregorian(jd);
    if (!isFinite(jd) || g.year !== +q[0] || g.month !== +q[1] || g.day !== +q[2]) _badDate++;
  }
  T('tour: fechas del guion reversibles', _badDate === 0, _badDate + ' fechas incorrectas');

  /* las paradas con salto de fecha no pueden derivar tanto como para desmontar el
     fenomeno que narran: Halley debe seguir en el perihelio y el eclipse alineado */
  let _drift = [];
  for (const s of TOUR_STOPS) {
    if (!s.date || s.date === 'today') continue;
    const dias = (Math.max(s.travel || 5, .5) + Math.max(s.dwell || 14, 1)) * (s.speed || 0);
    if (dias > 1) _drift.push(s.title + ' ' + dias.toFixed(1) + ' d');
  }
  T('tour: deriva de fecha < 1 dia en las paradas con salto', _drift.length === 0, _drift.join(', '));

  T('tour: capa de lineas solo con Tour.active', TOUR_HOOK_GATED, 'RenderHooks.tour()');
  T('tour: sin eval ni Function dinamica', TOUR_NO_DYNAMIC, '');
  T('tour: linePush emite parejas (gl.LINES)', TOUR_PUSHES_PAIRS, '');

  /* el anclaje duro del dwell debe dejar la camara autoconsistente: si el objetivo
     esta clavado en el cuerpo, el ojo tiene que quedar exactamente a Cam.dist de el.
     Si no, el cuerpo sale descentrado y ese descentrado tiembla con el jitter de dt
     (fallo real de la parada 03: Mercurio, camara a 7,3 unidades). */
  {
    const _s = TOUR_STOPS[2], _m = Sim.byId[_s.body];
    Tour.active = true; Tour.manual = false; Tour.paused = false;
    Tour.i = 2; Tour.stop = _s; Tour.body = _m; Tour.phase = 'dwell'; Tour.t = 1;
    Tour.travel = _s.travel; Tour.dwell = _s.dwell;
    Tour.dist1 = tourStopDist(_s, _m);
    Cam.dist = Cam.distTarget = Tour.dist1; Cam.followBody = _m;
    computeDisplayPositions();
    tourUpdate(1 / 60);
    computeDisplayPositions();
    const _d = hypot3(_m.disp[0] - Cam.eye[0], _m.disp[1] - Cam.eye[1], _m.disp[2] - Cam.eye[2]);
    T('tour: ojo anclado a la distancia exacta', Math.abs(_d - Cam.dist) < 1e-9 && TOUR_ANCHOR_FRESH,
      'eye-cuerpo ' + _d.toFixed(6) + ' = Cam.dist ' + Cam.dist.toFixed(6));
    Tour.active = false; Cam.followBody = null;
  }
}

console.log('---');
console.log('TOTAL: ' + pass + ' OK, ' + fail + ' FAIL');
`;

const script = parts.slice(0, -1).join('\n') + '\n' + last + '\nconst BOOT_SRC = ' + JSON.stringify(read('08_boot.js')) + ';\n' + TEST + '\n})();\n';

const noop = () => {};
const canvasStub = () => ({ getContext: () => ({ createImageData: s => ({ data: new Uint8Array(s * s * 4) }), putImageData: noop, drawImage: noop, fillRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop, createLinearGradient: () => ({ addColorStop: noop }), width: 1, height: 1 }), width: 1, height: 1 });

const ctx = vm.createContext({
  console, Math, Date, JSON, isNaN, isFinite, parseInt, parseFloat,
  Float32Array, Float64Array, Uint8Array, Uint16Array, Int32Array, Array, Object, Map, Set, Infinity, NaN,
  document: { createElement: canvasStub, addEventListener: noop, getElementById: () => null, readyState: 'complete' },
  window: { addEventListener: noop },
  performance: { now: () => 0 }, requestAnimationFrame: noop,
  R: { tex: {}, gl: null, progs: {}, sphereHi: null, sphereLo: null, quad: null, init: () => false,
       H: 1, W: 1, vp: new Float32Array(16), bindAttribs: noop, texture: noop, resize: noop, bindBuffer: noop },
  UI: { els: {} }, Input: { pointers: new Map() },
  SRC_TEXT: ['01_shell.html', '02_core.js', '04_textures.js', '05_gl.js', '06_scene.js', '07_ui.js', '09_tour.js', '08_boot.js'].map(read).join('\n'),
  SRC_LINES: ['01_shell.html', '02_core.js', '04_textures.js', '05_gl.js', '06_scene.js', '07_ui.js', '09_tour.js', '08_boot.js'].map(read).join('\n').split('\n').length,
  SHELL_HTML: read('01_shell.html'),
  TOUR_HOOK_GATED, TOUR_NO_DYNAMIC, TOUR_PUSHES_PAIRS, TOUR_ANCHOR_FRESH,
});

vm.runInContext(script, ctx, { filename: 'solar_check.js' });
