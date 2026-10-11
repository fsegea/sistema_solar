
/* =====================================================================
   6b. CLASE BODY Y ESTADO DE LA SIMULACIÓN
   ===================================================================== */
const TRAIL_MAX = 900;   // muestras máximas por estela

class Body {
  constructor(def) {
    this.def = def;
    this.id = def.id; this.name = def.name; this.kind = def.kind;
    this.radiusKm = def.radiusKm;
    this.radiusAU = def.radiusKm / AU_KM;
    this.massKg = def.massKg;
    this.gm = def.gm || (GM_SUN * def.massKg / SOLAR_MASS);   // [UA^3/dia^2]
    this.color = def.color;
    this.rotH = def.rotH;
    this.obli = (def.obliquityDeg || 0) * DEG;
    this.retrograde = (def.obliquityDeg || 0) > 90;
    this.pos = new Float64Array(3);      // posición heliocéntrica [UA]
    this.vel = new Float64Array(3);      // velocidad [UA/dia]
    this.local = new Float64Array(3);    // posición relativa (lunas) [UA]
    this.disp = new Float32Array(3);     // posición en unidades de visualización
    this.dispR = 0;                      // radio en unidades de visualización
    this.pxSize = 0;                     // tamaño proyectado (px)
    this.spin = 0; this.node = 0;
    this.integrated = false;             // true si NBody integra realmente este cuerpo
    this.parent = null; this.children = [];
    this.orbitReal = null; this.orbitN = 0;
    this.trail = new Float32Array(TRAIL_MAX * 3);
    this.trailCount = 0; this.trailHead = 0; this.trailLastT = NaN;
    this.orbitPeriodD = def.el ? def.el.periodD
      : (def.table ? Math.sqrt((def.table ? PLANET_TABLE[def.table][0] ** 3 : 0)) * JULIAN_YEAR : 0);
  }
}

const Sim = {
  t: 0,                 // días simulados desde J2000 [día]
  jd: J2000_JD,
  speed: 1,             // días simulados por segundo real [día/s]
  dir: 1,
  paused: false,
  nbody: false,
  bodies: [], byId: Object.create(null),
  belts: null, comets: [],
  scaleMode: 'didactic', // 'real' | 'didactic'
  sizeExagg: 1,
  minPxSize: 2,
  showOrbits: true, showLabels: true, showTrails: true, showBelts: true,
  showComets: true, showRings: true, showStars: true, showAtmo: true,
  trailLen: 240,
  selected: null, measureA: null, measureB: null,
  fps: 0, msFrame: 0, msPhysics: 0, drawnCount: 0
};

/* Snapshot de elementos keplerianos en el tiempo t [día].
   El nodo ascending se incrementa en psi_A(t) (precesion de los equinoccios, ver
   02_core.js): anadir psi a Omega ES la rotacion rigida alrededor del polo ecliptico
   que lleva el marco J2000 de la tabla al equinoccio de la fecha (i, w y M no cambian).
   Afecta a planetas, lunas, enanos y cometas a la vez, es decir a todo el sistema. */
const _el = { a: 0, e: 0, i: 0, om: 0, w: 0, M: 0, n: 0 };
function elementsOf(body, t, out) {
  const def = body.def;
  if (def.table) {                                  // planetas: tabla JPL con tasas
    const T = t / (JULIAN_YEAR * 100);             // siglos julianos desde J2000
    const p = PLANET_TABLE[def.table];
    out.a = p[0] + p[6] * T;                       // [UA]
    out.e = p[1] + p[7] * T;
    out.i = (p[2] + p[8] * T) * DEG;
    const L = p[3] + p[9] * T, peri = p[4] + p[10] * T, node = p[5] + p[11] * T;
    out.om = node * DEG + precessionAngle(t);
    out.w = (peri - node) * DEG;
    out.M = wrapPi((L - peri) * DEG);
    out.n = Math.sqrt(GM_SUN / (out.a * out.a * out.a));   // [rad/día]
  } else if (def.el) {                        // elementos propios, con tasas opcionales [deg/dia]
    const el = def.el;
    const te = t + (el.t0 || 0);              // epoch propia de estos elementos
    out.a = (el.aKm !== undefined) ? el.aKm / AU_KM : el.a;
    out.e = el.e;
    out.i = (el.iDeg + (el.iDotDegD || 0) * te) * DEG;
    out.om = (el.omDeg + (el.omDotDegD || 0) * te) * DEG + precessionAngle(t);   // nodo lunar: retrocede 19,35 deg/anio
    out.w = (el.wDeg + (el.wDotDegD || 0) * te) * DEG;      // perigeo lunar: avanza 60,0 deg/anio
    out.n = TAU / el.periodD;
    out.M = (el.tPeri !== undefined) ? out.n * (te - el.tPeri) : (el.M0Deg * DEG + out.n * te);
  } else {                                      // estrella u otros: sin órbita propia
    out.a = 0; out.e = 0; out.i = 0; out.om = 0; out.w = 0; out.M = 0; out.n = 0;
  }
  return out;
}

/* Orientación del cuerpo: nodo de render + giro (rotación real) */
function updateOrientation(body, t) {
  const def = body.def;
  body.node = elementsOf(body, t, _el).om;   // nodo de render, con su precesion (0 si no hay orbita)
  const periodH = body.rotH || 1;
  body.spin = TAU * (t * 24 / periodH);            // signo de rotH + oblicuidad ⇒ sentido físico
}

/* Posición kepleriana (heliocéntrica o relativa al padre) y, para los cometas,
   también su velocidad orbital [UA/dia]: la necesita la cola de polvo. */
function updateKepler(body, t) {
  if (body.kind === 'star') {                    // el Sol define el origen del sistema
    body.pos[0] = 0; body.pos[1] = 0; body.pos[2] = 0;
    body.vel[0] = 0; body.vel[1] = 0; body.vel[2] = 0;
    return;
  }
  const el = elementsOf(body, t, _el);
  const E = body.kind === 'comet' ? keplerSolve(el.M, el.e) : undefined;   // compartida pos+vel
  if (body.kind === 'moon') {
    const p = body.parent;
    orbitPosition(el.a, el.e, el.i, el.om, el.w, el.M, body.local);
    if (body.def.el.frame === 'equatorial') {      // plano ecuatorial del padre
      rot3(p.node, p.obli, 0, _r9b);
      rot3Apply(_r9b, body.local[0], body.local[1], body.local[2], body.local);
    }
    body.pos[0] = p.pos[0] + body.local[0];
    body.pos[1] = p.pos[1] + body.local[1];
    body.pos[2] = p.pos[2] + body.local[2];
  } else {
    orbitPosition(el.a, el.e, el.i, el.om, el.w, el.M, body.pos, E);
    if (body.kind === 'comet')                    // |vel| = sqrt(GM(2/r - 1/a))
      orbitVelocity(el.a, el.e, el.i, el.om, el.w, el.M, el.n, body.vel, E);
  }
}
const _r9b = new Float64Array(9);

/* Poligonal de la órbita completa (para dibujar la elipse) */
function buildOrbitPolyline(body, samples) {
  const el = elementsOf(body, Sim.t, _el);
  const n = samples || (body.kind === 'comet' ? 420 : 256);
  const arr = new Float32Array(n * 3);
  const v = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const nu = (i / n) * TAU;
    ellipsePoint(el.a, el.e, el.i, el.om, el.w, nu, v);
    if (body.kind === 'moon') {                     // órbita en el plano del padre
      if (body.def.el.frame === 'equatorial') { rot3(body.parent.node, body.parent.obli, 0, _r9b); rot3Apply(_r9b, v[0], v[1], v[2], v); }
      v[0] += body.parent.pos[0]; v[1] += body.parent.pos[1]; v[2] += body.parent.pos[2];
    }
    arr[i * 3] = v[0]; arr[i * 3 + 1] = v[1]; arr[i * 3 + 2] = v[2];
  }
  body.orbitReal = arr; body.orbitN = n;
}

/* =====================================================================
   6c. POBLACIONES (cinturón de asteroides y cinturón de Kuiper)
   ===================================================================== */
function beltDensityFactor(a) {
  let f = 1;
  for (let k = 0; k < KIRKWOOD.length; k++) {
    const d = (a - KIRKWOOD[k].a) / 0.030;
    f *= 1 - 0.94 * Math.exp(-d * d);              // vacío casi total en la resonancia
  }
  f *= smoothstep(2.02, 2.25, a);                  // borde interior (resonancia 4:1)
  f *= 1 - 0.8 * smoothstep(3.18, 3.34, a);        // borde exterior (resonancia 5:2 / 2:1)
  return f;
}
function makeBelt(opts) {
  const rnd = mulberry32(opts.seed);
  const n = opts.n;
  const b = {
    n,
    a: new Float32Array(n), e: new Float32Array(n), i: new Float32Array(n),
    om: new Float32Array(n), w: new Float32Array(n), M0: new Float32Array(n),
    nrad: new Float32Array(n), size: new Float32Array(n),
    cr: new Float32Array(n), cg: new Float32Array(n), cb: new Float32Array(n),
    resonant: new Uint8Array(n),
    pos: new Float32Array(n * 3), disp: new Float32Array(n * 3),
    gpu: new Float32Array(n * 8), visibleCount: 0
  };
  let i = 0, guard = 0;
  while (i < n && guard < n * 400) {
    guard++;
    let a, e, inc, resFlag = 0;
    if (opts.resonantFrac && rnd() < opts.resonantFrac) {   // población en resonancia
      const R = opts.resonances[(rnd() * opts.resonances.length) | 0];
      a = R.a + (rnd() - 0.5) * 0.012; e = 0.12 + rnd() * 0.28; resFlag = 1;
      inc = (rnd() * rnd()) * opts.incMax * 1.4;
    } else {
      for (let tries = 0; tries < 60; tries++) {
        a = opts.aMin + rnd() * (opts.aMax - opts.aMin);
        if (rnd() < beltDensityFactor(a)) break;
        if (tries === 59) a = opts.aMin + rnd() * (opts.aMax - opts.aMin);
      }
      e = Math.abs(gauss(rnd) * opts.eSigma);
      if (e > opts.eMax) e = opts.eMax * (0.6 + 0.4 * rnd());
      inc = Math.abs(gauss(rnd) * opts.incSigma);
      if (inc > opts.incMax) inc = opts.incMax * rnd();
    }
    b.a[i] = a; b.e[i] = e; b.i[i] = inc * DEG;
    b.om[i] = rnd() * TAU; b.w[i] = rnd() * TAU; b.M0[i] = rnd() * TAU;
    b.nrad[i] = TAU / (JULIAN_YEAR * Math.pow(a, 1.5));      // n = 2π/P, P = a^1.5 años [rad/día]
    b.size[i] = opts.sizeMin + Math.pow(rnd(), opts.sizePow) * (opts.sizeMax - opts.sizeMin);
    const cls = rnd();                                       // tipos espectrales
    let c;
    if (opts.icy) c = cls < 0.70 ? [0.62, 0.66, 0.74] : (cls < 0.90 ? [0.72, 0.62, 0.52] : [0.80, 0.48, 0.34]);
    else c = cls < 0.72 ? [0.42, 0.42, 0.45] : (cls < 0.90 ? [0.66, 0.56, 0.42] : [0.78, 0.78, 0.80]);
    if (resFlag) { c = [c[0] * 1.15, c[1] * 1.05, c[2] * 0.95]; }
    b.cr[i] = c[0]; b.cg[i] = c[1]; b.cb[i] = c[2];
    b.resonant[i] = resFlag;
    i++;
  }
  b.n = i;
  b.pos = new Float32Array(i * 3); b.disp = new Float32Array(i * 3); b.gpu = new Float32Array(i * 8);
  /* Precomputacion por cuerpo, hecha una sola vez al construir el cinturon:
     - rot: matriz de rotacion (w, om, i) que se aplica a (xo, yo). Se guardan 6
       coeficientes porque la tercera columna nunca se usa (xo, yo tienen z nula):
         x = m00*xo + m01*yo ; y = m10*xo + m11*yo ; z = m20*xo + m21*yo
     - bax: semieje menor a*sqrt(1-e^2)
     Con esto el bucle caliente pasa de 10 trig + 1 sqrt por cuerpo y por frame a 2 trig.
     Coste: 5600 cuerpos * 6 float = 134 KB. */
  b.rot = new Float64Array(i * 6);
  b.bax = new Float64Array(i);
  for (let k = 0; k < i; k++) {
    const cw = Math.cos(b.w[k]), sw = Math.sin(b.w[k]);
    const cO = Math.cos(b.om[k]), sO = Math.sin(b.om[k]);
    const ci = Math.cos(b.i[k]), si = Math.sin(b.i[k]);
    const r = k * 6;
    b.rot[r]     = cO * cw - sO * sw * ci;
    b.rot[r + 1] = -cO * sw - sO * cw * ci;
    b.rot[r + 2] = sO * cw + cO * sw * ci;
    b.rot[r + 3] = -sO * sw + cO * cw * ci;
    b.rot[r + 4] = si * sw;
    b.rot[r + 5] = si * cw;
    const ek = b.e[k];
    b.bax[k] = b.a[k] * Math.sqrt(1 - ek * ek);
  }
  return b;
}
function gauss(rnd) { // Box-Muller
  let u = rnd(); if (u < 1e-9) u = 1e-9;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd());
}

/* Posiciones de un cinturon en el tiempo t (dias).
   Kepler en la misma aproximacion de 2do orden que keplerSolveFast():
       E = M + d ,  d = e*sen M + 0.5*e^2*sen 2M = sen M * (e + e^2*cos M)
   y cos E / sen E se obtienen con la formula de suma de angulos, usando Taylor para
   sen d y cos d (|d| <= e + e^2 <= 0,85 aqui; error abs < 1e-7). Pasa de 4 trig por
   cuerpo (sen M, sen 2M, cos E, sen E) a 2 trig (sen M, cos M).
   Ademas ya no se envuelve M con wrapPi(): todo lo que viene despues es periodico en
   M, y el operador % sobre doubles costaba ~100 ns por cuerpo y frame, casi 3 veces
   lo que cuesta un seno. */
function updateBelt(b, t) {
  const a = b.a, e = b.e, M0 = b.M0, nr = b.nrad, bax = b.bax, R = b.rot, pos = b.pos;
  /* los cinturones comparten el marco de los planetas: misma rotacion psi_A(t).
     Se aplica sobre la posicion ya girada (R_z(psi)·R(Omega,w,i) = R(Omega+psi,w,i));
     4 multiplicaciones por cuerpo, coste medible cero. */
  const psi = precessionAngle(t), cpsi = Math.cos(psi), spsi = Math.sin(psi);
  for (let k = 0; k < b.n; k++) {
    const ek = e[k], M = M0[k] + nr[k] * t;
    const sM = Math.sin(M), cM = Math.cos(M);
    const d = sM * (ek + ek * ek * cM), d2 = d * d;
    const sinD = d * (1 + d2 * (-1 / 6 + d2 * (1 / 120 - d2 / 5040)));
    const cosD = 1 + d2 * (-1 / 2 + d2 * (1 / 24 - d2 * (1 / 720 - d2 / 40320)));
    const xo = a[k] * (cM * cosD - sM * sinD - ek), yo = bax[k] * (sM * cosD + cM * sinD);
    const o = k * 3, r = k * 6;
    const x = R[r] * xo + R[r + 1] * yo, y = R[r + 2] * xo + R[r + 3] * yo;
    pos[o]     = x * cpsi - y * spsi;
    pos[o + 1] = x * spsi + y * cpsi;
    pos[o + 2] = R[r + 4] * xo + R[r + 5] * yo;
  }
}

/* =====================================================================
   7. TEXTURAS PROCEDURALES (generadas una vez y cacheadas)
   ===================================================================== */
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgb255(c) { return [clamp(c[0], 0, 1) * 255, clamp(c[1], 0, 1) * 255, clamp(c[2], 0, 1) * 255]; }

/* Pinta una textura equirectangular: fn(dirX,dirY,dirZ,lat,lon,out) */
function paintEquirect(w, h, fn) {
  const c = newCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: false });
  const img = ctx.createImageData(w, h), d = img.data, out = [0, 0, 0, 255];
  for (let py = 0; py < h; py++) {
    const v = (py + 0.5) / h, lat = (0.5 - v) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let px = 0; px < w; px++) {
      const lon = ((px + 0.5) / w) * TAU - Math.PI;
      out[3] = 255;
      fn(cl * Math.cos(lon), cl * Math.sin(lon), sl, lat, lon, out);
      const idx = (py * w + px) * 4;
      d[idx] = out[0]; d[idx + 1] = out[1]; d[idx + 2] = out[2]; d[idx + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
/* Cráteres: círculos con suelo oscuro y borde brillante, corregidos por latitud */
function drawCraters(ctx, W, H, count, rnd, opts) {
  const minR = opts.minAng, maxR = opts.maxAng;
  for (let k = 0; k < count; k++) {
    const lat = Math.asin(clamp(rnd() * 2 - 1, -1, 1));
    const lon = rnd() * TAU - Math.PI;
    const ang = minR + Math.pow(rnd(), 2.2) * (maxR - minR);
    const cx = ((lon + Math.PI) / TAU) * W;
    const cy = (0.5 - lat / Math.PI) * H;
    const ry = (ang / Math.PI) * H;
    const rx = Math.min(ry / Math.max(Math.cos(lat), 0.12), W * 0.35);
    const bright = opts.bright || 0.25, dark = opts.dark || 0.30;
    for (let rep = -1; rep <= 1; rep++) {
      const x0 = cx + rep * W;
      if (x0 + rx < 0 || x0 - rx > W) continue;
      ctx.save();
      ctx.translate(x0, cy); ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
      g.addColorStop(0, 'rgba(0,0,0,' + dark + ')');
      g.addColorStop(0.62, 'rgba(0,0,0,' + (dark * 0.35) + ')');
      g.addColorStop(0.78, 'rgba(255,255,255,' + bright + ')');
      g.addColorStop(0.92, 'rgba(255,255,255,' + (bright * 0.35) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}
/* Manchas de albedo (regiones oscuras/claras) usando ruido de baja frecuencia */
function albedoBlobs(ctx, W, H, rnd, count, color, alphaMax, sizeFrac) {
  for (let k = 0; k < count; k++) {
    const lat = Math.asin(clamp(rnd() * 2 - 1, -1, 1)), lon = rnd() * TAU - Math.PI;
    const cx = ((lon + Math.PI) / TAU) * W, cy = (0.5 - lat / Math.PI) * H;
    const ry = (0.04 + rnd() * sizeFrac) * H, rx = Math.min(ry / Math.max(Math.cos(lat), 0.15), W * 0.4);
    for (let rep = -1; rep <= 1; rep++) {
      const x0 = cx + rep * W;
      if (x0 + rx < 0 || x0 - rx > W) continue;
      ctx.save(); ctx.translate(x0, cy); ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const a = alphaMax * (0.4 + 0.6 * rnd());
      g.addColorStop(0, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + a + ')');
      g.addColorStop(0.7, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + (a * 0.55) + ')');
      g.addColorStop(1, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
    }
  }
}

/* ---------- Sol ---------- */
function texSun() {
  const N = makeNoise(1013), W = 1024, H = 512;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const gran = N.fbm3(x * 22, y * 22, z * 22, 5, 0.55, 2.2);
    const meso = N.fbm3(x * 5.5, y * 5.5, z * 5.5, 4, 0.6, 2.1);
    let v = 0.62 + 0.5 * gran + 0.22 * (meso - 0.5);
    // manchas: ruido de muy baja frecuencia umbralizado
    const sp = N.fbm3(x * 2.1 + 11, y * 2.1, z * 2.1, 3, 0.5, 2.0);
    const spotMask = smoothstep(0.63, 0.70, sp) * (1 - smoothstep(0.78, 0.86, sp));
    v *= 1 - 0.78 * spotMask;
    // fáculas brillantes
    v += 0.12 * smoothstep(0.66, 0.78, N.fbm3(x * 9 + 3, y * 9, z * 9, 3, 0.5, 2.0));
    v = clamp(v, 0.05, 1.25);
    const col = mixc([1.0, 0.52, 0.10], [1.0, 0.96, 0.78], smoothstep(0.35, 1.05, v));
    out[0] = col[0] * 255; out[1] = col[1] * 255; out[2] = col[2] * 255;
  });
  return c;
}

/* ---------- Mercurio / cuerpos rocosos ---------- */
function texRocky(seed, base, dark, craters, maxAng, icy) {
  const N = makeNoise(seed), W = 768, H = 384;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const big = N.fbm3(x * 2.4, y * 2.4, z * 2.4, 4, 0.55, 2.0);
    const mid = N.ridged3(x * 7 + 5, y * 7, z * 7, 4, 0.55, 2.2);
    const fine = N.fbm3(x * 26, y * 26, z * 26, 3, 0.5, 2.0);
    let v = 0.55 + 0.42 * (big - 0.5) + 0.30 * (mid - 0.5) + 0.12 * (fine - 0.5);
    if (icy) v = 0.72 + 0.34 * (v - 0.5);
    const col = mixc(dark, base, smoothstep(0.18, 0.92, v));
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  const ctx = c.getContext('2d');
  drawCraters(ctx, W, H, mulberry32(seed + 7), craters, { minAng: 0.006, maxAng: maxAng, bright: icy ? 0.22 : 0.30, dark: icy ? 0.18 : 0.34 });
  return c;
}

/* ---------- Venus ---------- */
function texVenus() {
  const N = makeNoise(2201), W = 768, H = 384;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const warp = N.fbm3(x * 3, y * 3, z * 3, 3, 0.5, 2.0);
    const bandLat = lat + 0.35 * (warp - 0.5) + 0.12 * Math.sin(lat * 6);
    const bands = 0.5 + 0.5 * Math.sin(bandLat * 9.0);
    const swirl = N.fbm3(x * 6 + warp * 2, y * 6, z * 6, 5, 0.55, 2.1);
    const v = 0.55 + 0.28 * bands + 0.30 * (swirl - 0.5);
    const polar = smoothstep(0.9, 1.35, Math.abs(lat));
    const col = mixc([0.98, 0.86, 0.58], [0.78, 0.62, 0.36], clamp(1 - v, 0, 1));
    const col2 = mixc(col, [0.66, 0.52, 0.32], polar * 0.55);
    const px = rgb255(col2); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  return c;
}

/* ---------- Tierra: día + luces nocturnas + nubes ---------- */
function earthHeight(N, x, y, z) {
  const wx = N.fbm3(x * 1.3 + 31, y * 1.3, z * 1.3, 3) - 0.5;
  const wy = N.fbm3(x * 1.3, y * 1.3 + 17, z * 1.3, 3) - 0.5;
  const h = N.fbm3(x * 2.1 + wx * 1.6, y * 2.1 + wy * 1.6, z * 2.1, 6, 0.55, 2.15);
  const cont = N.fbm3(x * 0.9 + 5, y * 0.9, z * 0.9, 3, 0.5, 2.0);
  return h * 0.72 + cont * 0.28;
}
function texEarth() {
  const N = makeNoise(3011), W = 1024, H = 512;
  const landMask = new Uint8Array(W * H);
  const heightArr = new Float32Array(W * H);
  const day = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const h = earthHeight(N, x, y, z);
    const polar = Math.abs(lat);
    const iceCap = smoothstep(1.12, 1.40, polar + 0.16 * (N.fbm3(x * 4 + 9, y * 4, z * 4, 3) - 0.5));
    const isLand = h > 0.515;
    const idx = landIdx++;
    heightArr[idx] = h;
    if (isLand) landMask[idx] = 1;
    let col;
    if (isLand) {
      const alt = smoothstep(0.515, 0.72, h);
      const arid = smoothstep(0.30, 0.62, Math.abs(lat) - 0.28) * (1 - smoothstep(0.75, 1.05, Math.abs(lat)));
      const moist = N.fbm3(x * 5 + 21, y * 5, z * 5, 4);
      const forest = (1 - arid) * smoothstep(0.42, 0.62, moist);
      const tundra = smoothstep(0.85, 1.15, polar);
      let g = mixc([0.30, 0.24, 0.16], [0.16, 0.36, 0.14], forest);      // desierto → bosque
      g = mixc(g, [0.34, 0.42, 0.22], smoothstep(0.15, 0.45, 1 - arid) * 0.5);
      g = mixc(g, [0.42, 0.40, 0.32], tundra);
      g = mixc(g, [0.52, 0.48, 0.42], alt * 0.7);                        // montaña
      col = mixc(g, [0.95, 0.96, 0.98], smoothstep(0.74, 0.86, h) + iceCap);
      const spec = 18;
      out[3] = spec;
    } else {
      const depth = smoothstep(0.515, 0.30, h);
      const shallow = mixc([0.10, 0.46, 0.62], [0.02, 0.14, 0.38], depth);
      col = mixc(shallow, [0.90, 0.95, 0.98], iceCap);
      out[3] = 235;                                                      // máscara especular (océano)
    }
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  // Luces urbanas: cúmulos sobre tierra, más densos en costas y latitudes templadas
  const night = newCanvas(W, H), nctx = night.getContext('2d');
  nctx.fillStyle = '#000'; nctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(999);
  const img = nctx.createImageData(W, H), d = img.data;
  landIdx = 0;
  for (let py = 0; py < H; py++) {
    const lat = (0.5 - (py + 0.5) / H) * Math.PI;
    const habit = smoothstep(1.25, 0.75, Math.abs(lat)) * (0.35 + 0.65 * smoothstep(0.15, 0.55, Math.abs(lat) < 1.0 ? 1 - Math.abs(Math.abs(lat) - 0.75) : 0));
    for (let px = 0; px < W; px++) {
      const idx = py * W + px;
      if (!landMask[idx]) continue;
      const near = (idx > W ? landMask[idx - W] : 0) + (idx < W * H - W ? landMask[idx + W] : 0) +
                   (px > 0 ? landMask[idx - 1] : 0) + (px < W - 1 ? landMask[idx + 1] : 0);
      const coastBoost = near < 4 ? 1.9 : 1.0;
      const cl = N.fbm3(px * 0.06, py * 0.06, 3.7, 4, 0.5, 2.0);
      const cl2 = N.fbm3(px * 0.017, py * 0.017, 8.1, 3, 0.5, 2.0);
      let v = smoothstep(0.58, 0.80, cl) * smoothstep(0.35, 0.72, cl2) * habit * coastBoost;
      if (rnd() < 0.0015) v += 0.6;                                      // grandes metrópolis
      v = clamp(v, 0, 1);
      const o = idx * 4;
      d[o] = 255 * v * 0.98; d[o + 1] = 230 * v * 0.85; d[o + 2] = 150 * v * 0.55; d[o + 3] = 255 * v;
    }
  }
  nctx.putImageData(img, 0, 0);
  // Capa de nubes (alfa = cobertura) con bandas de latitud y remolinos
  const clouds = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const warp = N.fbm3(x * 2.2 + 40, y * 2.2, z * 2.2, 3) - 0.5;
    const swirl = N.fbm3(x * 4.2 + warp * 2.4, y * 4.2 + warp * 1.6, z * 4.2, 6, 0.55, 2.1);
    const band = 0.55 + 0.45 * Math.sin(lat * 3.1) - 0.35 * Math.exp(-Math.pow((Math.abs(lat) - 0.35) * 4.5, 2));
    const cover = clamp((swirl - 0.5) * 1.9 + band * 0.55, 0, 1);
    const a = smoothstep(0.42, 0.78, cover);
    out[0] = 255; out[1] = 255; out[2] = 255; out[3] = 255 * a;
  });
  return { day, night, clouds };
}
let landIdx = 0;

/* ---------- Marte ---------- */
function texMars() {
  const N = makeNoise(4409), W = 768, H = 384;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const big = N.fbm3(x * 2.0 + 7, y * 2.0, z * 2.0, 4, 0.55, 2.0);
    const ridge = N.ridged3(x * 8, y * 8, z * 8, 4, 0.55, 2.2);
    const fine = N.fbm3(x * 24, y * 24, z * 24, 3);
    let v = 0.5 + 0.4 * (big - 0.5) + 0.22 * (ridge - 0.5) + 0.1 * (fine - 0.5);
    let col = mixc([0.45, 0.20, 0.11], [0.86, 0.52, 0.30], smoothstep(0.20, 0.85, v));
    col = mixc(col, [0.62, 0.36, 0.22], smoothstep(0.55, 0.85, big));   // polvo claro
    const cap = smoothstep(1.28, 1.45, Math.abs(lat) + 0.12 * (N.fbm3(x * 5, y * 5, z * 5, 3) - 0.5));
    col = mixc(col, [0.96, 0.95, 0.93], cap);
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  const ctx = c.getContext('2d');
  albedoBlobs(ctx, W, H, mulberry32(4410), 14, [40, 26, 20], 0.42, 0.16);   // zonas basálticas oscuras
  drawCraters(ctx, W, H, mulberry32(4411), 90, { minAng: 0.006, maxAng: 0.05, bright: 0.22, dark: 0.28 });
  return c;
}

/* ---------- Gigantes: bandas + manchas ---------- */
function texBanded(seed, W, H, palette, turb, spot) {
  const N = makeNoise(seed);
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const warp = N.fbm3(x * 2.6 + 13, y * 2.6, z * 2.6, 4, 0.55, 2.1) - 0.5;
    const jet = N.fbm3(x * 1.2, y * 1.2 + 60, z * 1.2, 3) - 0.5;
    const latT = lat + warp * turb + jet * turb * 0.6;
    const t = 0.5 + 0.5 * Math.sin(latT * 7.4) * 0.6 + 0.5 * Math.sin(latT * 15.1 + 1.2) * 0.25 + 0.2 * Math.sin(latT * 3.0);
    const swirl = N.fbm3(x * 9 + warp * 3, y * 9, z * 9, 5, 0.55, 2.2);
    const tt = clamp(t + (swirl - 0.5) * 0.45, 0, 1);
    const col = palette(tt, latT);
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  if (spot) spot(c.getContext('2d'), W, H);
  return c;
}
function jupiterPalette(t, lat) {
  const zones = [[0.62, 0.44, 0.30], [0.86, 0.70, 0.50], [0.96, 0.90, 0.78], [0.80, 0.60, 0.42]];
  const idx = clamp(t * 3.35, 0, 3);
  const i0 = Math.floor(idx), i1 = Math.min(3, i0 + 1);
  let col = mixc(zones[i0], zones[i1], idx - i0);
  const polar = smoothstep(1.15, 1.50, Math.abs(lat));
  col = mixc(col, [0.55, 0.52, 0.50], polar * 0.5);
  return col;
}
function drawGRS(ctx, W, H) {
  const cx = W * 0.62, cy = H * (0.5 + 0.19 / Math.PI * 1), rx = W * 0.075, ry = H * 0.055;
  for (let rep = -1; rep <= 1; rep++) {
    ctx.save(); ctx.translate(cx + rep * W, cy); ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
    g.addColorStop(0, 'rgba(196,84,52,0.98)');
    g.addColorStop(0.45, 'rgba(214,116,74,0.92)');
    g.addColorStop(0.75, 'rgba(232,168,120,0.65)');
    g.addColorStop(1, 'rgba(240,200,160,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(150,60,40,0.35)'; ctx.lineWidth = 0.10;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(0, 0, 0.45 + k * 0.16, 0.32 + k * 0.14, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }
  // óvalos blancos menores
  for (let k = 0; k < 5; k++) {
    const x0 = W * (0.15 + 0.16 * k), y0 = H * (0.5 + (k % 2 ? 0.10 : -0.13) / Math.PI);
    ctx.save(); ctx.translate(x0, y0); ctx.scale(W * 0.022, H * 0.018);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
  }
}
function drawNeptuneSpot(ctx, W, H) {
  const cx = W * 0.42, cy = H * (0.5 + 0.22 / Math.PI), rx = W * 0.06, ry = H * 0.045;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
  g.addColorStop(0, 'rgba(10,22,70,0.85)'); g.addColorStop(1, 'rgba(20,40,110,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
  for (let k = 0; k < 8; k++) {   // cirros brillantes
    const y0 = H * (0.30 + 0.06 * k);
    ctx.strokeStyle = 'rgba(235,245,255,' + (0.10 + 0.05 * (k % 3)) + ')'; ctx.lineWidth = H * 0.006;
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.bezierCurveTo(W * 0.3, y0 - H * 0.02, W * 0.7, y0 + H * 0.02, W, y0); ctx.stroke();
  }
}
function saturnPalette(t, lat) {
  const zones = [[0.72, 0.58, 0.36], [0.90, 0.80, 0.58], [0.97, 0.92, 0.76], [0.84, 0.72, 0.50]];
  const idx = clamp(t * 3.2, 0, 3);
  const i0 = Math.floor(idx), i1 = Math.min(3, i0 + 1);
  let col = mixc(zones[i0], zones[i1], idx - i0);
  col = mixc(col, [0.55, 0.48, 0.36], smoothstep(1.2, 1.5, Math.abs(lat)) * 0.55);
  return col;
}
function uranusPalette(t) {
  return mixc([0.42, 0.74, 0.80], [0.66, 0.90, 0.93], t);
}
function neptunePalette(t) {
  return mixc([0.10, 0.22, 0.62], [0.42, 0.60, 0.92], t);
}

/* ---------- Plutón ---------- */
function texPluto() {
  const N = makeNoise(7701), W = 512, H = 256;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const big = N.fbm3(x * 2.4 + 3, y * 2.4, z * 2.4, 4, 0.55, 2.0);
    const fine = N.fbm3(x * 12, y * 12, z * 12, 4);
    let col = mixc([0.36, 0.24, 0.18], [0.86, 0.78, 0.66], smoothstep(0.28, 0.80, big * 0.7 + fine * 0.3));
    // región brillante tipo "corazón" (Sputnik Planum) cerca del ecuador
    const dx = Math.atan2(y, x) - 3.0, dy = lat;
    const heart = Math.exp(-(dx * dx * 1.6 + dy * dy * 6.0));
    col = mixc(col, [0.94, 0.92, 0.88], heart * 0.9);
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  drawCraters(c.getContext('2d'), W, H, mulberry32(7702), 60, { minAng: 0.008, maxAng: 0.05, bright: 0.18, dark: 0.22 });
  return c;
}

/* ---------- Luna ---------- */
function texMoon() {
  const N = makeNoise(5501), W = 768, H = 384;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const big = N.fbm3(x * 2.2, y * 2.2, z * 2.2, 4, 0.55, 2.0);
    const mid = N.ridged3(x * 8 + 4, y * 8, z * 8, 4, 0.55, 2.2);
    const fine = N.fbm3(x * 28, y * 28, z * 28, 3);
    let v = 0.55 + 0.35 * (big - 0.5) + 0.25 * (mid - 0.5) + 0.12 * (fine - 0.5);
    let col = mixc([0.30, 0.30, 0.31], [0.80, 0.79, 0.76], smoothstep(0.22, 0.90, v));
    // mares: manchas oscuras basálticas en la cara visible (x>0)
    const mare = smoothstep(0.56, 0.66, N.fbm3(x * 1.5 + 1.5, y * 1.5 + 2, z * 1.5, 3)) * smoothstep(-0.1, 0.5, x);
    col = mixc(col, [0.20, 0.20, 0.22], mare * 0.8);
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  const ctx = c.getContext('2d');
  drawCraters(ctx, W, H, mulberry32(5502), 260, { minAng: 0.004, maxAng: 0.06, bright: 0.30, dark: 0.34 });
  albedoBlobs(ctx, W, H, mulberry32(5503), 6, [245, 245, 240], 0.16, 0.10);  // rayos brillantes
  return c;
}

/* ---------- Lunas galileanas / Titán ---------- */
function texIo() {
  const N = makeNoise(8801), W = 512, H = 256;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const p = N.fbm3(x * 3 + 2, y * 3, z * 3, 4, 0.55, 2.0);
    const s = N.ridged3(x * 9, y * 9, z * 9, 4, 0.55, 2.2);
    let col = mixc([0.98, 0.86, 0.30], [0.92, 0.62, 0.16], smoothstep(0.35, 0.85, p));
    col = mixc(col, [0.72, 0.30, 0.12], smoothstep(0.55, 0.85, s) * 0.6);
    const volc = smoothstep(0.72, 0.82, N.fbm3(x * 7 + 30, y * 7, z * 7, 3));
    col = mixc(col, [0.15, 0.10, 0.08], volc * 0.85);
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  const ctx = c.getContext('2d');
  albedoBlobs(ctx, W, H, mulberry32(8802), 18, [255, 240, 180], 0.30, 0.05);  // anillos de pluma
  return c;
}
function texEuropa() {
  const N = makeNoise(8901), W = 512, H = 256;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const b = N.fbm3(x * 3.5, y * 3.5, z * 3.5, 4, 0.55, 2.0);
    let col = mixc([0.72, 0.66, 0.56], [0.94, 0.93, 0.90], smoothstep(0.30, 0.80, b));
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  const ctx = c.getContext('2d');
  const rnd = mulberry32(8902);
  ctx.lineCap = 'round';
  for (let k = 0; k < 46; k++) {          // lineae: grietas largas
    const y0 = H * (0.10 + 0.80 * rnd());
    const amp = H * (0.02 + 0.10 * rnd());
    const w = H * (0.002 + 0.006 * rnd());
    ctx.strokeStyle = 'rgba(150,95,70,' + (0.18 + 0.30 * rnd()) + ')';
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(0, y0);
    for (let px = 0; px <= W; px += W / 8) ctx.lineTo(px, y0 + amp * Math.sin(px / W * TAU * (1 + rnd() * 2) + k));
    ctx.stroke();
  }
  return c;
}
function texGanymede() {
  const N = makeNoise(9001), W = 512, H = 256;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const dark = smoothstep(0.45, 0.58, N.fbm3(x * 1.6 + 8, y * 1.6, z * 1.6, 3));
    const groove = N.ridged3(x * 12, y * 12, z * 12, 4, 0.55, 2.3);
    let col = mixc([0.34, 0.31, 0.29], [0.78, 0.75, 0.70], dark);
    col = mixc(col, mixc(col, [0.90, 0.88, 0.84], groove), 1 - dark);
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  drawCraters(c.getContext('2d'), W, H, mulberry32(9002), 120, { minAng: 0.006, maxAng: 0.04, bright: 0.22, dark: 0.26 });
  return c;
}
function texCallisto() {
  const N = makeNoise(9101), W = 512, H = 256;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const b = N.fbm3(x * 3 + 12, y * 3, z * 3, 4, 0.55, 2.0);
    const f = N.fbm3(x * 16, y * 16, z * 16, 3);
    let col = mixc([0.24, 0.22, 0.20], [0.62, 0.58, 0.54], smoothstep(0.25, 0.85, b * 0.6 + f * 0.4));
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  const ctx = c.getContext('2d');
  drawCraters(ctx, W, H, mulberry32(9102), 240, { minAng: 0.005, maxAng: 0.045, bright: 0.30, dark: 0.32 });
  albedoBlobs(ctx, W, H, mulberry32(9103), 12, [255, 255, 255], 0.35, 0.02);
  return c;
}
function texTitan() {
  const N = makeNoise(9201), W = 512, H = 256;
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const band = 0.5 + 0.5 * Math.sin(lat * 5 + 0.4 * (N.fbm3(x * 2, y * 2, z * 2, 3) - 0.5) * 4);
    const h = N.fbm3(x * 5, y * 5, z * 5, 5, 0.55, 2.1);
    let col = mixc([0.72, 0.42, 0.14], [0.96, 0.78, 0.44], clamp(band * 0.6 + h * 0.5, 0, 1));
    col = mixc(col, [0.55, 0.32, 0.12], smoothstep(1.0, 1.4, Math.abs(lat)) * 0.4);
    const px = rgb255(col); out[0] = px[0]; out[1] = px[1]; out[2] = px[2];
  });
  return c;
}

/* ---------- Texturas 1D de anillos ---------- */
function texRing1D(name) {
  const W = 1024, H = 1;
  const c = newCanvas(W, H), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  const rnd = mulberry32(name === 'ringSaturn' ? 1201 : 1300 + name.length);
  const bands = [];
  if (name === 'ringSaturn') {
    // (r/R_saturno, alfa, brillo) — C, B, división de Cassini, A, división Encke, F
    bands.push([1.16, 1.235, 0.03, 0.55], [1.235, 1.525, 0.20, 0.62], [1.525, 1.74, 0.34, 0.70],
               [1.74, 2.02, 0.92, 1.00], [2.02, 2.27, 0.05, 0.45], [2.27, 2.62, 0.62, 0.90],
               [2.62, 2.66, 0.10, 0.50], [2.66, 2.86, 0.48, 0.85], [2.86, 2.92, 0.22, 0.75]);
  } else if (name === 'ringJupiter') {
    bands.push([1.40, 1.62, 0.06, 0.5], [1.62, 1.75, 0.16, 0.7], [1.75, 1.82, 0.05, 0.5]);
  } else if (name === 'ringUranus') {
    bands.push([1.64, 1.70, 0.05, 0.5], [1.70, 1.95, 0.10, 0.6]);
    for (let k = 0; k < 9; k++) { const a = 1.72 + k * 0.026; bands.push([a, a + 0.008, 0.42, 0.8]); }
    bands.push([1.95, 2.02, 0.28, 0.75]);
  } else {
    bands.push([1.75, 2.05, 0.05, 0.5], [2.05, 2.25, 0.14, 0.65], [2.25, 2.40, 0.06, 0.5], [2.40, 2.55, 0.10, 0.6]);
  }
  const r0 = bands[0][0], r1 = bands[bands.length - 1][1];
  for (let px = 0; px < W; px++) {
    const r = r0 + (px + 0.5) / W * (r1 - r0);
    let alpha = 0, bright = 0.6;
    for (let k = 0; k < bands.length; k++) {
      if (r >= bands[k][0] && r <= bands[k][1]) { alpha = bands[k][2]; bright = bands[k][3]; break; }
    }
    const n = 1 + 0.25 * (rnd() - 0.5) + 0.18 * Math.sin(px * 0.35) + 0.10 * Math.sin(px * 0.07);
    alpha = clamp(alpha * n, 0, 1);
    const g = clamp(bright * (0.9 + 0.2 * (rnd() - 0.5)), 0, 1);
    d[px * 4] = 255 * clamp(g * 1.02, 0, 1);
    d[px * 4 + 1] = 255 * clamp(g * 0.93, 0, 1);
    d[px * 4 + 2] = 255 * clamp(g * 0.78, 0, 1);
    d[px * 4 + 3] = 255 * alpha;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---------- Cielo: Vía Láctea procedural ---------- */
function texSky() {
  const N = makeNoise(31337), W = 1024, H = 512;
  // plano galáctico inclinado ~60° respecto a la eclíptica
  const gn = [Math.cos(60 * DEG), 0, Math.sin(60 * DEG)];   // normal del plano galáctico
  const c = paintEquirect(W, H, (x, y, z, lat, lon, out) => {
    const hGal = x * gn[0] + y * gn[1] + z * gn[2];        // altura sobre el plano
    const band = Math.exp(-Math.pow(hGal * 5.2, 2));
    const along = Math.atan2(y, x);
    const dens = N.fbm3(x * 3.2, y * 3.2, z * 3.2, 5, 0.55, 2.1);
    const dust = N.ridged3(x * 6 + 20, y * 6, z * 6, 4, 0.55, 2.2);
    const neb = smoothstep(0.62, 0.86, N.fbm3(x * 1.8 + 55, y * 1.8, z * 1.8, 3));
    let v = band * (0.35 + 0.95 * dens) * (1 - 0.55 * dust);
    v += 0.010 * N.fbm3(x * 12, y * 12, z * 12, 3);        // fondo difuso
    let col = mixc([0.10, 0.13, 0.22], [0.72, 0.74, 0.80], clamp(v * 1.6, 0, 1));
    col = mixc(col, [0.55, 0.35, 0.30], neb * band * 0.7);
    const k = 0.55;
    out[0] = col[0] * k * 255; out[1] = col[1] * k * 255; out[2] = col[2] * k * 255;
  });

  /* --- campo estelar: 6 800 estrellas discretas, brillo y color variables ---
     Se pintan encima de la Via Lactea con el contexto 2D, de forma que puedan
     caer entre pixeles y solaparse. Direccion -> pixel (inverso de paintEquirect):
       px = ((lon + PI)/TAU)·W - 0.5      py = (0.5 - lat/PI)·H - 0.5            */
  const ctx = c.getContext('2d');
  const rnd = mulberry32(20240101);
  const N_STARS = 6800;                       // requisito: >= 5 000
  const PAL = [                               // colores tipo cuerpo negro [r,g,b]
    [0.68, 0.76, 1.00],   // O/B  azul-blanca        8 %
    [0.92, 0.95, 1.00],   // A     blanca           18 %
    [1.00, 0.98, 0.88],   // F     blanco-amarilla  26 %
    [1.00, 0.88, 0.66],   // G     amarilla         22 %
    [1.00, 0.72, 0.48],   // K     naranja          16 %
    [1.00, 0.55, 0.44]    // M     roja             10 %
  ];
  for (let i = 0; i < N_STARS; i++) {
    // direccion uniforme en la esfera
    const zz = rnd() * 2 - 1, ph = rnd() * TAU, rr = Math.sqrt(Math.max(0, 1 - zz * zz));
    let x = rr * Math.cos(ph), y = rr * Math.sin(ph), z = zz;
    // 45 % de las estrellas concentradas en el plano galactico (banda de la Via Lactea)
    if (rnd() < 0.45) {
      const h = x * gn[0] + y * gn[1] + z * gn[2];
      const t = h - (rnd() + rnd() - 1) * 0.11;          // altura objetivo, casi en el plano
      x += (t - h) * gn[0]; y += (t - h) * gn[1]; z += (t - h) * gn[2];
      const n = Math.hypot(x, y, z) || 1; x /= n; y /= n; z /= n;
    }
    const lat = Math.asin(clamp(z, -1, 1)), lon = Math.atan2(y, x);
    const px = ((lon + Math.PI) / TAU) * W - 0.5, py = (0.5 - lat / Math.PI) * H - 0.5;
    // distribucion de magnitudes: ley de potencias -> muchas debiles, pocas brillantes
    const mag = Math.pow(rnd(), 2.6);                    // 0 = debil, 1 = brillante
    const b = 0.20 + mag * 0.80;                         // brillo (alfa)
    const q = rnd();
    const ci = q < 0.08 ? 0 : q < 0.26 ? 1 : q < 0.52 ? 2 : q < 0.74 ? 3 : q < 0.90 ? 4 : 5;
    const col = PAL[ci];
    ctx.fillStyle = 'rgba(' + (col[0] * 255 | 0) + ',' + (col[1] * 255 | 0) + ',' +
                    (col[2] * 255 | 0) + ',' + b.toFixed(3) + ')';
    const r = 0.5 + mag * 2.3;                           // radio [px]
    if (mag < 0.18) { ctx.fillRect(px - 0.5, py - 0.5, 1, 1); continue; }   // debiles: 1 px
    if (mag > 0.72) {                                     // halo de las brillantes
      ctx.beginPath(); ctx.arc(px, py, r * 2.2, 0, TAU);
      ctx.globalAlpha = 0.15 * mag; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
  }
  return c;
}

/* ---------- Sprites (glow, coma, cola) ---------- */
function texRadial(size, inner, outer, pow) {
  const c = newCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const dx = (px + 0.5) / size * 2 - 1, dy = (py + 0.5) / size * 2 - 1;
    const r = Math.sqrt(dx * dx + dy * dy);
    let a = Math.pow(clamp(1 - r, 0, 1), pow);
    a *= smoothstep(0, inner, 1 - r) * 0.4 + 0.6;
    const o = (py * size + px) * 4;
    d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 255 * clamp(a * outer, 0, 1);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function texComa() { return texRadial(128, 0.0, 1.0, 2.2); }
function texGlowSoft() { return texRadial(256, 0.0, 1.0, 2.0); }
function texGlowWide() { return texRadial(256, 0.0, 1.0, 1.35); }
/* Cola: brillante en el núcleo (v=0) y abriéndose hacia v=1 */
function texTail() {
  const W = 128, H = 256, c = newCanvas(W, H), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data, N = makeNoise(4242);
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;
    const width = 0.10 + 0.85 * Math.pow(v, 0.75);
    for (let px = 0; px < W; px++) {
      const u = ((px + 0.5) / W) * 2 - 1;
      const across = Math.abs(u) / width;
      let a = Math.pow(clamp(1 - across, 0, 1), 1.6) * Math.pow(1 - v, 1.35);
      a *= 0.75 + 0.5 * N.noise3(px * 0.09, py * 0.035, 7.7);
      a *= smoothstep(0, 0.06, v) * 0.5 + 0.5;
      const o = (py * W + px) * 4;
      d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 255 * clamp(a, 0, 1);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
