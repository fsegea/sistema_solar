#!/usr/bin/env node
/* ============================================================================
   tour_probe.js — ventana de velocidad legible en cada parada del tour.

   El guion fija una velocidad de simulacion [d/s] en cada parada. Si es muy
   alta, lo que la parada narraba deja de verse: la textura del planeta se
   vuelve una mancha, las lunas dan vueltas completas en un par de segundos y
   los puntos del fondo saltan de 10 en 10 pixeles por frame. Si es muy baja,
   la parada parece una foto: el fenomeno narrado no avanza durante el dwell.

   El probe mide lo que de verdad se ve en pantalla, con el codigo real de src/
   y la camara colocada donde la coloca tourGo(): anclada al cuerpo foco
   (Cam.followBody), a la distancia tourStopDist(), con el encuadre
   tourBodyAngle()/pitch del guion. La proyeccion replica mat4LookAt +
   mat4Perspective (z = -dot(disp-eye, fwd), x = dot(disp-eye, right) * pxScale/z).

   Criterios, todos en pixeles y segundos reales — no magnitudes fisicas:
     GIRO     un disco de >= 30 px tiene textura que ver: hacen falta >= 8 s por
              vuelta aparente (>= 12 s si el disco pasa de 80 px). Por debajo la
              rotacion estrobea en vez de leerse.
     LUNA     la luna con la que se encuadra la parada: entre 40 s y 400 s por
              vuelta aparente, y como mucho 0,5 vueltas durante la parada.
     LUNAS    lunas del cuerpo foco que se ven separadas (>= 8 px de su planeta):
              >= 25 s por vuelta aparente y <= 4 px/frame.
     PUNTOS   cuerpos del campo que se ven como puntos: <= 4 px/frame. Un punto
              que recorre mas de 4 px por frame deja de verse como algo que se
              mueve y se ve como una sucesion de posiciones.
     CINTURON los granos del cinturon que la parada narra tienen que desplazarse
              entre 0,05 y 4 px/frame: por debajo la parada esta congelada.
     ESTELA   si la parada deja showTrails, updateTrails() muestrea cada
              max(P*0,35/900, speed*0,02) dias: si pasa del 5 % del periodo, la
              estela se dibuja como un poligono.

   Devuelve, por parada, la ventana [min, max] de velocidades legibles y si la
   del guion esta dentro. Todo en d/s.

   Uso:  node tools/tour_probe.js [--json]
   ============================================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const SRC = process.env.SOLAR_SRC || path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const FILES = ['02_core.js', '04_textures.js', '05_gl.js', '06_scene.js', '07_ui.js', '09_tour.js'];
const parts = FILES.map(read);
const last = parts.pop().replace(/\}\)\(\);\s*$/, '');

const PROBE = `
/* ================= PROBE INYECTADO ================= */
const W = 1280, H = 754, FPS = 60;
const GIRO_MIN = 8, GIRO_MIN_GRANDE = 12, DISCO_MIN = 30, DISCO_GRANDE = 80;
const LUNA_MIN = 40, LUNA_MAX = 400, LUNA_VUELTAS = 0.5;
const LUNA_CERCA_MIN = 25, PX_FRAME = 4, SEPARACION_MIN = 8;
const CINTURON_MIN = 0.05, ESTELA_PCT = 5, DERIVE_MAX_D = 1;

Sim.byId = {}; Sim.bodies = []; Sim.comets = []; Sim.sun = null;
for (const def of BODY_DEFS) {
  const b = new Body(def);
  Sim.byId[def.id] = b; Sim.bodies.push(b);
  if (def.parent) { const p = Sim.byId[def.parent]; b.parent = p; p.children.push(b); }
  if (def.kind === 'star') Sim.sun = b;
  if (def.kind === 'comet') Sim.comets.push(b);
}
Sim.t = Date.now() / 86400000 + 2440587.5 - J2000_JD;
Sim.jd = J2000_JD + Sim.t;
for (const b of Sim.bodies) { updateKepler(b, Sim.t); updateOrientation(b, Sim.t); }
R.W = W; R.H = H;

const pxScale = () => (H / 2) / Math.tan(Cam.fov * DEG / 2);
/* proyeccion a pixeles desde el centro de la pantalla, igual que project() */
function scr(b) {
  const dx = b.disp[0] - Cam.eye[0], dy = b.disp[1] - Cam.eye[1], dz = b.disp[2] - Cam.eye[2];
  const z = -(dx * Cam.fwd[0] + dy * Cam.fwd[1] + dz * Cam.fwd[2]);   // fwd va del objetivo al ojo
  if (z <= 0) return null;
  const s = pxScale() / z;
  return [(dx * Cam.right[0] + dy * Cam.right[1] + dz * Cam.right[2]) * s,
         -(dx * Cam.up[0]    + dy * Cam.up[1]    + dz * Cam.up[2])    * s, z];
}
const periodo = b => b.orbitPeriodD || (b.def.el && b.def.el.periodD) || 0;
/* velocidad tangencial aparente de un cuerpo a aAU, en unidades de visualizacion
   por dia simulado: su radio de visualizacion es mapDist(a) y barre n radianes/dia */
const vt = aAU => (TAU / (Math.pow(aAU, 1.5) * JULIAN_YEAR)) * mapDist(aAU);

/* un frame de simulacion a velocidad v, con la camara del guion: devuelve el
   desplazamiento en px/frame de todo lo que esta dentro del campo */
function medir(b, cfg, v) {
  Sim.speed = v;
  Cam.followBody = b; Cam.dist = Cam.distTarget = cfg.dist;
  Cam.yaw = cfg.yaw; Cam.pitch = cfg.pitch;
  Cam.target[0] = Cam.panTarget[0] = b.disp[0];
  Cam.target[1] = Cam.panTarget[1] = b.disp[1];
  Cam.target[2] = Cam.panTarget[2] = b.disp[2];
  Cam.update(0); computeDisplayPositions();
  const p0 = new Map();
  for (const c of Sim.bodies) { const p = scr(c); if (p) p0.set(c, p); }
  Sim.t += v / FPS; Sim.jd = J2000_JD + Sim.t;
  for (const c of Sim.bodies) { updateKepler(c, Sim.t); updateOrientation(c, Sim.t); }
  Cam.target[0] = Cam.panTarget[0] = b.disp[0];
  Cam.target[1] = Cam.panTarget[1] = b.disp[1];
  Cam.target[2] = Cam.panTarget[2] = b.disp[2];
  Cam.update(0); computeDisplayPositions();
  const out = [];
  for (const c of Sim.bodies) {
    if (c === b) continue;
    const a = p0.get(c), z = scr(c);
    if (!a || !z) continue;
    if (Math.abs(a[0]) > W / 2 || Math.abs(a[1]) > H / 2) continue;          // fuera del campo
    const sep = c.parent && p0.get(c.parent)
      ? Math.hypot(a[0] - p0.get(c.parent)[0], a[1] - p0.get(c.parent)[1]) : Infinity;
    /* tamano real sin el suelo de visibilidad: por debajo de 1 px es un punto y su
       unico defecto posible es desplazarse demasiado por frame */
    const real = displayRadiusOf(c) * pxScale() / Math.max(c.distCam, 1e-9);
    if (real < 1 && sep < SEPARACION_MIN) continue;                        // no se distingue
    out.push({ id: c.id, luna: !!c.parent && sep >= SEPARACION_MIN,
      lunaDelFoco: !!c.parent && c.parent === b, sep,
      px: Math.hypot(z[0] - a[0], z[1] - a[1]), P: periodo(c) });
  }
  out.sort((x, y) => y.px - x.px);
  return out;
}

const rows = [];
let estado = {};
for (const s of TOUR_STOPS) {
  const b = Sim.byId[s.body];
  if (s.on) estado = Object.assign({}, estado, s.on);      // el tour solo toca lo que el paso declara
  const guion = typeof s.speed === 'number' ? s.speed : Sim.speed;
  const dwell = Math.max(s.dwell || 14, 1), travel = Math.max(s.travel || 5, .5);
  const parada = dwell + travel;
  /* la velocidad que queda despues de encajar el slider en su step entero */
  const efectiva = speedFromSlider(Math.round(sliderFromSpeed(guion)));

  const cfg = { dist: tourStopDist(s, b),
    yaw: tourBodyAngle(b) + (typeof s.yawOff === 'number' ? s.yawOff : 0.6),
    pitch: typeof s.pitch === 'number' ? s.pitch : 0.35 };

  /* medir a velocidad unitaria: px/frame y vueltas escalan lineales con d/s.
     Con dwellZoom la parada termina mas lejos: se evaluan los dos encuadres y
     se queda uno con la ventana mas estrecha (la que se cumple en todo el plano). */
  const encuadres = [cfg];
  if (s.dwellZoom) encuadres.push(Object.assign({}, cfg, { dist: cfg.dist * s.dwellZoom }));
  let base = null, disco = 0;
  for (const cq of encuadres) {
    const m = medir(b, cq, 1);
    const d = 2 * b.dispR * pxScale() / Math.max(b.distCam, 1e-9);
    if (!base || m.length > base.length) base = m;
    if (d > disco) disco = d;
  }

  let vmin = 0, vmax = Infinity, porQueMin = '—', porQueMax = '—';
  const encoge = (v, mot) => { if (v < vmax) { vmax = v; porQueMax = mot; } };
  const limita = (v, mot) => { if (v > vmin) { vmin = v; porQueMin = mot; } };

  if (disco >= DISCO_MIN) {
    const t = disco >= DISCO_GRANDE ? GIRO_MIN_GRANDE : GIRO_MIN;
    encoge((b.rotH || 24) / 24 / t, 'giro de ' + b.id + ' estrobea (' + ((b.rotH || 24) / 24 / guion).toFixed(1) + ' s/vuelta)');
  }

  const par = s.dist && s.dist.pair ? Sim.byId[s.dist.pair] : null;
  /* las paradas con salto de fecha narran un instante: su presupuesto de tiempo es
     el de la fecha (derivar <= 1 dia simulado), no el movimiento de su luna */
  const instante = !!(s.date && s.date !== 'today');
  if (instante) encoge(DERIVE_MAX_D / parada, 'salto de fecha: derivar <= ' + DERIVE_MAX_D + ' dia en ' + parada.toFixed(0) + ' s');
  if (par) {
    const P = periodo(par);
    if (!instante) limita(P / LUNA_MAX, par.id + ' apenas completa un arco');
    encoge(P / LUNA_MIN, 'periodo aparente de ' + par.id);
    encoge(LUNA_VUELTAS * P / parada, par.id + ' da demasiadas vueltas en la parada');
  }

  for (const m of base) {
    if (m.luna && m.lunaDelFoco) {
      limita(m.P / LUNA_MAX, 'luna ' + m.id + ' congelada');
      encoge(m.P / LUNA_CERCA_MIN, 'periodo aparente de ' + m.id);
    }
    encoge(PX_FRAME / m.px, m.id + ' ' + (m.px * guion).toFixed(1) + ' px/frame');
  }

  let belt = null;
  if (estado.showBelts) {
    const au = s.dist && s.dist.au ? s.dist.au : 2.7;
    const grains = au > 10 ? [35, 45] : [2.1, 3.3];
    const px = grains.map(a => vt(a) * pxScale() / cfg.dist / FPS);
    belt = { grains: grains.join('-') + ' UA', px: px[0] * guion };
    limita(CINTURON_MIN / px[1], 'cinturon ' + grains.join('-') + ' UA apenas se mueve');
    encoge(PX_FRAME / px[0], 'granos del ' + grains.join('-') + ' UA');
  }
  if (estado.showTrails) {
    for (const c of Sim.bodies) {
      if (c.kind === 'star') continue;
      const P = periodo(c) || 365;
      encoge(ESTELA_PCT / 100 * P / 0.02, 'estela de ' + c.id + ' poligonal');
    }
  }

  const ok = guion >= vmin && guion <= vmax;
  rows.push({ title: s.title, guion, efectiva, vmin, vmax, ok, dwell, travel, trails: !!estado.showTrails,
    disco, giro: (b.rotH || 24) / 24 / guion,
    peor: base[0] ? base[0].id + ' ' + (base[0].px * guion).toFixed(1) + ' px/frame' : 'nada en movimiento',
    belt: belt ? belt.grains + ' ' + belt.px.toFixed(2) + ' px/frame' : '—',
    porQueMin, porQueMax });
}

const f = (v, d) => !isFinite(v) ? 'inf' : v.toFixed(d);
const pad = (v, n) => String(v).padEnd(n);
console.log('velocidad legible del tour · ' + R.W + 'x' + R.H + ' px · ' + FPS + ' fps · escala ' + Sim.scaleMode);
console.log('  parada                          d/s guion  d/s slider   ventana legible      disco  giro/vuelta');
for (const r of rows) {
  console.log('  ' + pad(r.title.slice(0, 28), 29) + pad(f(r.guion, 3), 10) + pad(f(r.efectiva, 3), 12) +
    pad('[' + f(r.vmin, 3) + ' - ' + f(r.vmax, 3) + ']', 21) +
    pad(r.disco.toFixed(0) + 'px', 8) + f(r.giro, 1) + ' s');
}
console.log('');
console.log('  parada                          veredicto');
let mal = 0;
for (const r of rows) {
  if (!r.ok) mal++;
  console.log('  ' + pad(r.title.slice(0, 28), 29) + (r.ok
    ? 'OK  · peor: ' + r.peor + ' · cinturon: ' + r.belt
    : 'FUERA  ' + (r.guion > r.vmax ? 'rapido ' + f(r.guion / r.vmax, 1) + 'x — ' + r.porQueMax
                    : 'lento ' + f(r.vmin / r.guion, 1) + 'x — ' + r.porQueMin)));
}
console.log('---');
console.log('paradas fuera de la ventana legible: ' + mal + ' de ' + rows.length);
if (process.argv.indexOf('--json') >= 0) console.log(JSON.stringify(rows));
`;

const script = parts.join('\n') + '\n' + last + '\n' + PROBE + '\n})();\n';
const noop = () => {};
const canvasStub = () => ({ getContext: () => ({ createImageData: s => ({ data: new Uint8Array(s * s * 4) }), putImageData: noop, drawImage: noop, fillRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop, createLinearGradient: () => ({ addColorStop: noop }), width: 1, height: 1 }), width: 1, height: 1 });

const ctx = vm.createContext({
  console, Math, Date, JSON, isNaN, isFinite, parseInt, parseFloat,
  Float32Array, Float64Array, Uint8Array, Uint16Array, Int32Array, Array, Object, Map, Set, Infinity, NaN,
  document: { createElement: canvasStub, addEventListener: noop, getElementById: () => null, readyState: 'complete' },
  window: { addEventListener: noop },
  performance: { now: () => 0 }, requestAnimationFrame: noop,
  R: { tex: {}, gl: null, progs: {}, sphereHi: null, sphereLo: null, quad: null, init: () => false, H: 1, W: 1, vp: new Float32Array(16), bindAttribs: noop, texture: noop, resize: noop, bindBuffer: noop },
  UI: { els: {} }, Input: { pointers: new Map() },
  process,
});

vm.runInContext(script, ctx, { filename: 'solar_tour_probe.js' });
