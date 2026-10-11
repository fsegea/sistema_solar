/* =====================================================================
   SISTEMA SOLAR · simulación física 100 % offline (sin librerías)
   Todo el código va dentro de un IIFE: sin globales innecesarios.
   Índice de secciones
     1. Constantes físicas y unidades
     2. Matemáticas: vectores, matrices 4x4/3x3, utilidades
     3. Ruído procedural (value noise 3D + fbm) y PRNG determinista
     4. Motor orbital: ecuación de Kepler, elementos→posición/velocidad
     5. Datos astronómicos (J2000) y cuerpos
     6. Poblaciones: cinturón de asteroides, cinturón de Kuiper, cometas
     7. Texturas procedurales (offscreen, cacheadas)
     8. Render WebGL (programas, mallas, dibujado)
     9. Cámara orbital con inercia y modos de escala
     10. Integración N-cuerpo (Velocity Verlet) y energía
     11. Interfaz (HUD), etiquetas, atajos
     12. Bucle principal y arranque
   Unidades usadas: km, kg, s, días, UA, radianes, grados (sufijo Deg).
   ===================================================================== */
'use strict';
(function () {

/* =====================================================================
   1. CONSTANTES FÍSICAS Y UNIDADES
   ===================================================================== */
const AU_KM      = 149597870.700;          // 1 unidad astronómica en km
const GM_SUN     = 2.959122082855911e-4;   // constante gravitacional solar [UA^3 / dia^2]
const G_SI       = 6.67430e-11;            // constante gravitacional [m^3 kg^-1 s^-2]
const C_KM_S     = 299792.458;             // velocidad de la luz [km/s]
const SOLAR_MASS = 1.98847e30;             // masa solar [kg]
const J2000_JD   = 2451545.0;              // Dia Juliano de la época J2000 (2000-01-01 12:00 TT)
const JULIAN_YEAR = 365.25;                // año juliano en días
const DEG = Math.PI / 180, RAD = 180 / Math.PI, TAU = Math.PI * 2;
const PLANET_GM = {                        // GM = GM_SUN * masa/masa_solar [UA^3/dia^2]
  mercury: 4.42542e-10, venus: 7.24534e-10, earth: 8.88615e-10, mars: 1.904e-10,
  jupiter: 2.82537e-7,  saturn: 8.460e-8,  uranus: 4.321e-8,    neptune: 5.154e-8,
  ceres: 4.7e-13, pluto: 5.8e-12
};

/* =====================================================================
   2. MATEMÁTICAS
   ===================================================================== */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function wrapPi(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
function hypot3(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

/* --- mat4 (column-major, como WebGL) --- */
function mat4() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function mat4Identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function mat4Perspective(m, fovDeg, aspect, near, far) {
  const f = 1 / Math.tan(fovDeg * DEG / 2), nf = 1 / (near - far);
  m.fill(0);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
  return m;
}
function mat4LookAt(m, eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = hypot3(zx, zy, zz); if (l < 1e-12) { zz = 1; l = 1; } zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = hypot3(xx, xy, xz);
  if (l < 1e-9) { // up paralelo a la mirada: elegir un up alternativo
    xx = 1; xy = 0; xz = 0; l = 1;
  }
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}
function mat4Mul(o, a, b) { // o = a * b
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}
/* R = Rz(node) * Rx(obli) * Rz(spin)  (3x3 row-major) */
function rot3(node, obli, spin, out9) {
  const cn = Math.cos(node), sn = Math.sin(node);
  const cp = Math.cos(obli), sp = Math.sin(obli);
  const cs = Math.cos(spin), ss = Math.sin(spin);
  // Rx*Rs
  const m00 = cs,        m01 = -ss,        m02 = 0;
  const m10 = cp * ss,   m11 = cp * cs,    m12 = -sp;
  const m20 = sp * ss,   m21 = sp * cs,    m22 = cp;
  // Rz * (Rx*Rs)
  out9[0] = cn * m00 - sn * m10; out9[1] = cn * m01 - sn * m11; out9[2] = cn * m02 - sn * m12;
  out9[3] = sn * m00 + cn * m10; out9[4] = sn * m01 + cn * m11; out9[5] = sn * m02 + cn * m12;
  out9[6] = m20;                 out9[7] = m21;                 out9[8] = m22;
  return out9;
}
/* M = T(center) * R * S(scale) ; normalMat = R (column-major 3x3) */
const _r9 = new Float64Array(9);
function composeModel(m, center, scale, node, obli, spin, normalMat) {
  rot3(node, obli, spin, _r9);
  m[0] = _r9[0] * scale; m[1] = _r9[3] * scale; m[2] = _r9[6] * scale; m[3] = 0;
  m[4] = _r9[1] * scale; m[5] = _r9[4] * scale; m[6] = _r9[7] * scale; m[7] = 0;
  m[8] = _r9[2] * scale; m[9] = _r9[5] * scale; m[10] = _r9[8] * scale; m[11] = 0;
  m[12] = center[0]; m[13] = center[1]; m[14] = center[2]; m[15] = 1;
  if (normalMat) {
    normalMat[0] = _r9[0]; normalMat[1] = _r9[3]; normalMat[2] = _r9[6];
    normalMat[3] = _r9[1]; normalMat[4] = _r9[4]; normalMat[5] = _r9[7];
    normalMat[6] = _r9[2]; normalMat[7] = _r9[5]; normalMat[8] = _r9[8];
  }
  return m;
}
/* Aplica una rotación 3x3 (row-major) a un vector */
function rot3Apply(r9, x, y, z, out) {
  out[0] = r9[0] * x + r9[1] * y + r9[2] * z;
  out[1] = r9[3] * x + r9[4] * y + r9[5] * z;
  out[2] = r9[6] * x + r9[7] * y + r9[8] * z;
  return out;
}

/* =====================================================================
   3. RUÍDO PROCEDURAL (value noise 3D + fbm) y PRNG
   ===================================================================== */
function mulberry32(seed) { // PRNG determinista, periodo 2^32
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const hashCache = new Float32Array(256);
  for (let i = 0; i < 256; i++) hashCache[i] = rnd();
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function lattice(ix, iy, iz) {
    const h = perm[perm[perm[ix & 255] + (iy & 255)] + (iz & 255)];
    return hashCache[h];
  }
  function noise3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = fade(fx), v = fade(fy), w = fade(fz);
    const c000 = lattice(ix, iy, iz),     c100 = lattice(ix + 1, iy, iz);
    const c010 = lattice(ix, iy + 1, iz), c110 = lattice(ix + 1, iy + 1, iz);
    const c001 = lattice(ix, iy, iz + 1), c101 = lattice(ix + 1, iy, iz + 1);
    const c011 = lattice(ix, iy + 1, iz + 1), c111 = lattice(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w; // [0,1]
  }
  function fbm3(x, y, z, oct, gain, lac) {
    oct = oct || 5; gain = gain === undefined ? 0.5 : gain; lac = lac || 2.0;
    let amp = 0.5, sum = 0, norm = 0, fx = x, fy = y, fz = z;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise3(fx, fy, fz); norm += amp;
      amp *= gain; fx *= lac; fy *= lac; fz *= lac;
    }
    return sum / norm;
  }
  function ridged3(x, y, z, oct, gain, lac) {
    oct = oct || 4; gain = gain === undefined ? 0.55 : gain; lac = lac || 2.1;
    let amp = 0.6, sum = 0, norm = 0, fx = x, fy = y, fz = z;
    for (let i = 0; i < oct; i++) {
      let n = noise3(fx, fy, fz) * 2 - 1; n = 1 - Math.abs(n);
      sum += amp * n * n; norm += amp;
      amp *= gain; fx *= lac; fy *= lac; fz *= lac;
    }
    return sum / norm;
  }
  return { rnd, noise3, fbm3, ridged3 };
}

/* =====================================================================
   4. MOTOR ORBITAL
   ===================================================================== */
/* ---- Precesion general de los equinoccios -------------------------------------
   Los elementos de la tabla JPL estan referidos al equinoccio y ecliptica MEDIOS de
   J2000.0; los de la Luna (Meeus) se propagan con sus propias tasas. Eso situa todo
   el sistema en el marco de J2000, que en 2026 esta girado 0,37 deg respecto al
   equinoccio de la fecha: los equinoccios y solsticios caian ~8,7 h tarde, y el
   error crece ~20 min por anio (medido: +422 min en 2021, +550 min en 2027).

   Solucion: girar TODO el sistema psi_A alrededor del polo ecliptico (eje z). En
   elementos keplerianos una rotacion pura alrededor de z es anadir psi a la longitud
   del nodo ascending; i, w y M no cambian. Al ser una rotacion rigida del sistema
   completo, la geometria RELATIVA (eclipses, elongaciones, distancias, sombras) no
   se altera lo mas minimo: solo cambia la orientacion respecto a las estrellas fijas,
   que es justo lo que faltaba.

     psi_A = p_A*T + 1/2*q_A*T^2   [segundos de arco],  T en siglos julianos
     p_A = 5029,0966 "/siglo      q_A = 1,11208 "/siglo^2   (IAU 2006, Capitaine et al.)

   Los terminos omega_A y chi_A de la matriz de precesion valen -1/2*q_A*T^2 < 0,6"
   incluso a un siglo: despreciables (0,2 min en un equinoccio). Sigue sin haber
   nutacion ni aberracion (~20", <10 min). */
const ARCSEC = DEG / 3600;             // segundo de arco -> radian
const JULIAN_CENTURY = 36525;          // siglo juliano en dias
const PRECESS_P = 5029.0966;           // p_A ["/siglo juliano] = 50,29 "/anio
const PRECESS_Q = 1.11208;             // q_A ["/siglo^2]
function precessionAngle (t) {         // psi_A [rad] para t dias desde J2000 (valido ±10 siglos)
  const T = t / JULIAN_CENTURY;
  return (PRECESS_P * T + 0.5 * PRECESS_Q * T * T) * ARCSEC;
}

/* Resolución de M = E - e·sin E por Newton-Raphson con convergencia
   controlada (paso limitado) y respaldo por bisección para e muy alto. */
function keplerSolve(M, e) {
  M = wrapPi(M);
  let E = e < 0.8 ? M : (M < 0 ? -Math.PI : Math.PI);
  let ok = false;
  for (let k = 0; k < 24; k++) {
    const f = E - e * Math.sin(E) - M;
    if (Math.abs(f) < 1e-12) { ok = true; break; }
    const fp = 1 - e * Math.cos(E);
    let dE = -f / (fp > 1e-9 ? fp : 1e-9);
    if (dE > 0.7) dE = 0.7; else if (dE < -0.7) dE = -0.7;   // amortiguación
    E += dE;
  }
  if (!ok || Math.abs(E - e * Math.sin(E) - M) > 1e-9) {     // respaldo robusto
    let lo = -Math.PI - 1e-6, hi = Math.PI + 1e-6;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) * 0.5;
      const f = mid - e * Math.sin(mid) - M;
      if (f < 0) lo = mid; else hi = mid;
    }
    E = (lo + hi) * 0.5;
  }
  return E;
}
/* Aproximación rápida (2 términos) para miles de cuerpos pequeños: error O(e^3) */
function keplerSolveFast(M, e) {
  return M + e * Math.sin(M) + 0.5 * e * e * Math.sin(M + M);
}
/* Posición heliocéntrica/geocéntrica a partir de elementos keplerianos.
   Salida en el sistema eclíptico: X hacia el equinoccio vernal, Z al polo norte eclíptico.
   Epre opcional: anomalia excentrica ya resuelta (evita resolver Kepler dos veces). */
function orbitPosition(a, e, i, om, w, M, out, Epre) {
  const E = Epre === undefined ? keplerSolve(M, e) : Epre;
  const cE = Math.cos(E), sE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const xo = a * (cE - e), yo = b * sE;                 // plano orbital
  const cw = Math.cos(w), sw = Math.sin(w);
  const co = Math.cos(om), so = Math.sin(om);
  const ci = Math.cos(i), si = Math.sin(i);
  const x1 = xo * cw - yo * sw, y1 = xo * sw + yo * cw; // giro por ω
  out[0] = x1 * co - y1 * so * ci;
  out[1] = x1 * so + y1 * co * ci;
  out[2] = y1 * si;
  return out;
}
/* Velocidad orbital [UA/dia]. Epre: anomalia excentrica ya resuelta (evita resolver dos veces).
   Satisface la vis-viva v = sqrt(GM(2/r - 1/a)) con la precision de keplerSolve. */
function orbitVelocity(a, e, i, om, w, M, n, out, Epre) {
  const E = Epre === undefined ? keplerSolve(M, e) : Epre;
  const cE = Math.cos(E), sE = Math.sin(E);
  const Edot = n / (1 - e * cE);
  const xo = -a * sE * Edot, yo = a * Math.sqrt(1 - e * e) * cE * Edot;
  const cw = Math.cos(w), sw = Math.sin(w);
  const co = Math.cos(om), so = Math.sin(om);
  const ci = Math.cos(i), si = Math.sin(i);
  const x1 = xo * cw - yo * sw, y1 = xo * sw + yo * cw;
  out[0] = x1 * co - y1 * so * ci;
  out[1] = x1 * so + y1 * co * ci;
  out[2] = y1 * si;
  return out;
}
/* Posición sobre una elipse (para dibujar la órbita completa), sin resolver Kepler */
function ellipsePoint(a, e, i, om, w, nu, out) {
  const r = a * (1 - e * e) / (1 + e * Math.cos(nu));
  const xo = r * Math.cos(nu), yo = r * Math.sin(nu);
  const cw = Math.cos(w), sw = Math.sin(w);
  const co = Math.cos(om), so = Math.sin(om);
  const ci = Math.cos(i), si = Math.sin(i);
  const x1 = xo * cw - yo * sw, y1 = xo * sw + yo * cw;
  out[0] = x1 * co - y1 * so * ci;
  out[1] = x1 * so + y1 * co * ci;
  out[2] = y1 * si;
  return out;
}

/* Conversión Dia Juliano <-> calendario gregoriano */
function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

/* Aritmetica civil exacta (algoritmo de Howard Hinnant, dias desde 1970-01-01,
   eras de 146097 dias = 400 anios). month en [1,12], day en [1,31] garantizados. */
function jdToGregorian(jd) {
  const z = Math.floor(jd + 0.5);                 // numero de dia civil (00h UTC)
  const f = jd + 0.5 - z;                         // fraccion del dia [0,1)
  const r = z - 2440588 + 719468;                 // dias desde 1970-01-01, desplazados a la era
  const era = Math.floor(r / 146097);
  const doe = r - era * 146097;                   // dia de la era   [0, 146096]
  const yoy = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399]
  let year = yoy + era * 400;
  const doy = doe - (365 * yoy + Math.floor(yoy / 4) - Math.floor(yoy / 100));   // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153);     // mes [0,11], anio empezando en marzo
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;                          // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9;                                       // [1, 12]
  if (month <= 2) year += 1;
  const hh = f * 24, H0 = Math.floor(hh);
  const mm0 = Math.floor((hh - H0) * 60);
  let ss = Math.round(((hh - H0) * 60 - mm0) * 60);
  let mm = mm0, H = H0, dayF = day;               // arrastre si el redondeo da ss = 60
  if (ss === 60) {
    ss = 0; mm++;
    if (mm === 60) { mm = 0; H++; }
    if (H === 24) { H = 0; dayF++; }
  }
  let y2 = year, m2 = month, d2 = dayF;
  const dim = [31, 28 + (isLeap(year) ? 1 : 0), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (d2 > dim) { d2 = 1; m2++; if (m2 > 12) { m2 = 1; y2++; } }
  return { year: y2, month: m2, day: d2, H, mm, ss };
}
function gregorianToJD(year, month, day) {
  const a = Math.floor((14 - month) / 12), y = year + 4800 - a;
  const m2 = month + 12 * a - 3;
  return day + Math.floor((153 * m2 + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDate(jd) {
  const g = jdToGregorian(jd);
  const y = g.year <= 0 ? (1 - g.year) + ' a.C.' : g.year;
  const pad = n => (n < 10 ? '0' : '') + n;
  return pad(g.day) + ' ' + MONTHS[g.month - 1] + ' ' + y + '  ' + pad(g.H) + ':' + pad(g.mm) + ':' + pad(g.ss) + ' UTC';
}

/* =====================================================================
   5. DATOS ASTRONÓMICOS
   Elementos keplerianos de la tabla JPL "Approximate Positions of the
   Major Planets" (válida 1800-2050): a,e,i,L,λ(perihelio),Ω y sus
   tasas por siglo juliano. ω = λ_peri − Ω ; M = L − λ_peri.
   ===================================================================== */
const PLANET_TABLE = {
  mercury: [0.38709927, 0.20563593, 7.00497901, 252.25032350, 77.45779628, 48.33086204,
            0.00000037, 0.00001906, -0.00594749, 149472.67411162, 0.16047689, -0.12534081],
  venus:   [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
            0.00000390, -0.00004107, -0.00078890, 5025.91327452, 0.00268329, -0.27769037],
  earth:   [1.00000261, 0.01671125, -0.00001531, 100.46435349, 102.94719014, 0.0,
            0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.29010215, 0.0],
  mars:    [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
            0.00001847, 0.00007847, -0.00060109, 19140.30268502, 0.19240856, -0.22711107],
  jupiter: [5.20288700, 0.04838624, 1.30439695, 343.59636185, 14.72847583, 100.47390909,
            -0.00116070, -0.00013253, -0.00183714, 3034.74612775, 0.21320322, 0.20469106],
  saturn:  [9.53667594, 0.05386180, 2.48599187, 49.95424400, 92.43194215, 113.66550350,
            -0.00125048, -0.00050991, 0.00193609, 1222.49368717, -0.41504758, -0.37009870],
  uranus:  [19.18916464, 0.04725744, 0.77715283, 313.23216599, 170.95427630, 74.00634548,
            -0.00196108, -0.00034518, -0.00155225, 428.49589900, 0.20720950, 0.04250689],
  neptune: [30.06992320, 0.00858587, 1.77004347, -55.12002965, 44.97132091, 131.78422574,
            0.00026291, 0.00021500, 0.00022302, 288.70884833, -0.36148375, -0.00616142]
};

/* Definición de cuerpos.
   radiusKm [km], massKg [kg], gravity [m/s^2], rotH [horas de día sidéreo;
   obliquityDeg > 90 ⇒ rotación retrógrada], tempC [°C media], moons [nº]. */
const BODY_DEFS = [
  { id: 'sun', name: 'Sol', kind: 'star', radiusKm: 696340, massKg: 1.98847e30, gravity: 274.0,
    rotH: 609.12, obliquityDeg: 7.25, tempC: 5505, moons: 0, color: [1.0, 0.82, 0.45], tex: 'sun',
    glow: [1.0, 0.72, 0.30] },

  { id: 'mercury', name: 'Mercurio', kind: 'planet', radiusKm: 2439.7, massKg: 3.3011e23, gravity: 3.70,
    rotH: 1407.6, obliquityDeg: 0.034, tempC: 167, moons: 0, color: [0.72, 0.68, 0.62], tex: 'mercury',
    table: 'mercury', gm: PLANET_GM.mercury },
  { id: 'venus', name: 'Venus', kind: 'planet', radiusKm: 6051.8, massKg: 4.8675e24, gravity: 8.87,
    rotH: 5832.5, obliquityDeg: 177.36, tempC: 464, moons: 0, color: [0.93, 0.82, 0.55], tex: 'venus',
    table: 'venus', gm: PLANET_GM.venus, atmo: { color: [1.0, 0.85, 0.55], power: 0.55, strength: 1.00, scale: 1.10 } },
  { id: 'earth', name: 'Tierra', kind: 'planet', radiusKm: 6371.0, massKg: 5.9724e24, gravity: 9.81,
    rotH: 23.9345, obliquityDeg: 23.44, tempC: 15, moons: 1, color: [0.30, 0.62, 0.95], tex: 'earth',
    table: 'earth', gm: PLANET_GM.earth, atmo: { color: [0.42, 0.68, 1.0], power: 0.85, strength: 0.85, scale: 1.055 } },
  { id: 'mars', name: 'Marte', kind: 'planet', radiusKm: 3389.5, massKg: 6.4171e23, gravity: 3.72,
    rotH: 24.6223, obliquityDeg: 25.19, tempC: -63, moons: 2, color: [0.87, 0.45, 0.27], tex: 'mars',
    table: 'mars', gm: PLANET_GM.mars, atmo: { color: [0.95, 0.62, 0.45], power: 0.22, strength: 0.22, scale: 1.03 } },
  { id: 'jupiter', name: 'Júpiter', kind: 'planet', radiusKm: 69911, massKg: 1.8982e27, gravity: 24.79,
    rotH: 9.925, obliquityDeg: 3.13, tempC: -110, moons: 95, color: [0.87, 0.72, 0.55], tex: 'jupiter',
    table: 'jupiter', gm: PLANET_GM.jupiter, atmo: { color: [1.0, 0.85, 0.65], power: 0.35, strength: 0.45, scale: 1.035 },
    ring: { inner: 1.40, outer: 1.82, tex: 'ringJupiter' } },
  { id: 'saturn', name: 'Saturno', kind: 'planet', radiusKm: 58232, massKg: 5.6834e26, gravity: 10.44,
    rotH: 10.656, obliquityDeg: 26.73, tempC: -140, moons: 146, color: [0.92, 0.83, 0.62], tex: 'saturn',
    table: 'saturn', gm: PLANET_GM.saturn, atmo: { color: [1.0, 0.9, 0.7], power: 0.30, strength: 0.38, scale: 1.03 },
    ring: { inner: 1.16, outer: 2.92, tex: 'ringSaturn' } },
  { id: 'uranus', name: 'Urano', kind: 'planet', radiusKm: 25362, massKg: 8.681e25, gravity: 8.87,
    rotH: 17.24, obliquityDeg: 97.77, tempC: -195, moons: 28, color: [0.55, 0.85, 0.90], tex: 'uranus',
    table: 'uranus', gm: PLANET_GM.uranus, atmo: { color: [0.55, 0.9, 0.95], power: 0.55, strength: 0.50, scale: 1.06 },
    ring: { inner: 1.64, outer: 2.02, tex: 'ringUranus' } },
  { id: 'neptune', name: 'Neptuno', kind: 'planet', radiusKm: 24622, massKg: 1.02413e26, gravity: 11.15,
    rotH: 16.11, obliquityDeg: 28.32, tempC: -200, moons: 16, color: [0.30, 0.48, 0.92], tex: 'neptune',
    table: 'neptune', gm: PLANET_GM.neptune, atmo: { color: [0.35, 0.55, 1.0], power: 0.6, strength: 0.55, scale: 1.06 },
    ring: { inner: 1.75, outer: 2.55, tex: 'ringNeptune' } },

  { id: 'ceres', name: 'Ceres', kind: 'dwarf', radiusKm: 469.7, massKg: 9.3835e20, gravity: 0.28,
    rotH: 9.0742, obliquityDeg: 4.0, tempC: -105, moons: 0, color: [0.66, 0.63, 0.58], tex: 'ceres',
    el: { a: 2.767518629, e: 0.07567856, iDeg: 10.59337961, omDeg: 80.30457671, wDeg: 73.54314346, M0Deg: 100.048994, periodD: 1681.608 } },
  { id: 'pluto', name: 'Plutón', kind: 'dwarf', radiusKm: 1188.3, massKg: 1.303e22, gravity: 0.62,
    rotH: 153.29, obliquityDeg: 122.53, tempC: -229, moons: 5, color: [0.80, 0.70, 0.58], tex: 'pluto',
    el: { a: 39.48211675, e: 0.24883276, iDeg: 12.21266699, omDeg: 110.30110881, wDeg: 113.75821547, M0Deg: 217.998488, periodD: 90560.0 } },
  { id: 'eris', name: 'Eris', kind: 'dwarf', radiusKm: 1163, massKg: 1.66e22, gravity: 0.77,
    rotH: 15.79, obliquityDeg: 78.0, tempC: -231, moons: 1, color: [0.85, 0.86, 0.90], tex: 'ice',
    el: { a: 67.8636472, e: 0.44066633, iDeg: 44.0400461, omDeg: 151.51123, wDeg: 151.0952, M0Deg: 204.16, periodD: 203400 } },
  { id: 'haumea', name: 'Haumea', kind: 'dwarf', radiusKm: 816, massKg: 4.006e21, gravity: 0.44,
    rotH: 3.915, obliquityDeg: 90.0, tempC: -241, moons: 2, color: [0.88, 0.88, 0.92], tex: 'ice',
    el: { a: 43.21788, e: 0.19012, iDeg: 28.21163, omDeg: 232.44, wDeg: 239.04, M0Deg: 226.0, periodD: 103770 } },
  { id: 'makemake', name: 'Makemake', kind: 'dwarf', radiusKm: 715, massKg: 3.1e21, gravity: 0.36,
    rotH: 8.7, obliquityDeg: 90.0, tempC: -239, moons: 1, color: [0.86, 0.55, 0.42], tex: 'pluto',
    el: { a: 45.79278, e: 0.41394, iDeg: 28.9822, omDeg: 29.634, wDeg: 165.6, M0Deg: 162.5, periodD: 306 * JULIAN_YEAR } },

  /* --- lunas principales (a en km, periodo en días) --- */
  { id: 'moon', name: 'Luna', kind: 'moon', parent: 'earth', radiusKm: 1737.4, massKg: 7.346e22, gravity: 1.62,
    rotH: 655.72, obliquityDeg: 6.68, tempC: -20, moons: 0, color: [0.78, 0.78, 0.76], tex: 'moon',
    /* Elementos lunares CON sus tasas (epoch J2000.0, t = dias desde JD 2451545.0; Meeus).
       El nodo retrocede 19,35 deg/anio (ciclo de 18,6 anios) y el perigeo avanza 40,7 deg/anio;
       sin esas tasas los nodos quedan fijos y las fechas de eclipse se desplazan respecto a
       las reales (p. ej. el eclipse total del 2027-08-02). Periodo = mes anomalistico. */
    el: { aKm: 384748, e: 0.0549, iDeg: 5.145,
          omDeg: 125.00530, omDotDegD: -0.05295381,
          wDeg: 318.34775,  wDotDegD: 0.16435734,
          M0Deg: 134.96340, periodD: 27.5545491, frame: 'ecliptic' } },
  { id: 'phobos', name: 'Fobos', kind: 'moon', parent: 'mars', radiusKm: 13.3, massKg: 1.066e16, gravity: 0.0057,
    rotH: 7.6536, obliquityDeg: 0, tempC: -40, moons: 0, color: [0.62, 0.55, 0.48], tex: 'rock',
    el: { aKm: 9376, e: 0.0151, iDeg: 1.08, omDeg: 215.0, wDeg: 295.0, M0Deg: 200.0, periodD: 0.31891, frame: 'equatorial' } },
  { id: 'deimos', name: 'Deimos', kind: 'moon', parent: 'mars', radiusKm: 6.2, massKg: 1.476e15, gravity: 0.0035,
    rotH: 30.2986, obliquityDeg: 0, tempC: -40, moons: 0, color: [0.60, 0.54, 0.47], tex: 'rock',
    el: { aKm: 23463, e: 0.00033, iDeg: 1.79, omDeg: 285.0, wDeg: 65.0, M0Deg: 60.0, periodD: 1.26244, frame: 'equatorial' } },
  { id: 'io', name: 'Io', kind: 'moon', parent: 'jupiter', radiusKm: 1821.6, massKg: 8.932e22, gravity: 1.796,
    rotH: 42.459, obliquityDeg: 0, tempC: -143, moons: 0, color: [0.95, 0.85, 0.42], tex: 'io',
    el: { aKm: 421700, e: 0.0041, iDeg: 0.05, omDeg: 0, wDeg: 0, M0Deg: 300.0, periodD: 1.769138, frame: 'equatorial' } },
  { id: 'europa', name: 'Europa', kind: 'moon', parent: 'jupiter', radiusKm: 1560.8, massKg: 4.7996e22, gravity: 1.314,
    rotH: 85.228, obliquityDeg: 0, tempC: -171, moons: 0, color: [0.85, 0.82, 0.74], tex: 'europa',
    el: { aKm: 671034, e: 0.009, iDeg: 0.47, omDeg: 0, wDeg: 0, M0Deg: 200.0, periodD: 3.551181, frame: 'equatorial' } },
  { id: 'ganymede', name: 'Ganímedes', kind: 'moon', parent: 'jupiter', radiusKm: 2634.1, massKg: 1.4819e23, gravity: 1.949,
    rotH: 171.709, obliquityDeg: 0, tempC: -163, moons: 0, color: [0.72, 0.68, 0.62], tex: 'ganymede',
    el: { aKm: 1070412, e: 0.0013, iDeg: 0.18, omDeg: 0, wDeg: 0, M0Deg: 100.0, periodD: 7.154553, frame: 'equatorial' } },
  { id: 'callisto', name: 'Calisto', kind: 'moon', parent: 'jupiter', radiusKm: 2410.3, massKg: 1.0759e23, gravity: 1.419,
    rotH: 400.53, obliquityDeg: 0, tempC: -157, moons: 0, color: [0.60, 0.56, 0.52], tex: 'callisto',
    el: { aKm: 1882709, e: 0.0074, iDeg: 0.19, omDeg: 0, wDeg: 0, M0Deg: 20.0, periodD: 16.689018, frame: 'equatorial' } },
  { id: 'titan', name: 'Titán', kind: 'moon', parent: 'saturn', radiusKm: 2574.7, massKg: 1.3452e23, gravity: 1.352,
    rotH: 382.68, obliquityDeg: 0, tempC: -179, moons: 0, color: [0.92, 0.70, 0.35], tex: 'titan',
    el: { aKm: 1221870, e: 0.0288, iDeg: 0.35, omDeg: 0, wDeg: 0, M0Deg: 300.0, periodD: 15.945, frame: 'equatorial' },
    atmo: { color: [1.0, 0.68, 0.30], power: 0.8, strength: 0.60, scale: 1.12 } },
  { id: 'enceladus', name: 'Encélado', kind: 'moon', parent: 'saturn', radiusKm: 252.1, massKg: 1.08e20, gravity: 0.113,
    rotH: 32.8852, obliquityDeg: 0, tempC: -198, moons: 0, color: [0.92, 0.95, 0.98], tex: 'ice',
    el: { aKm: 237948, e: 0.0047, iDeg: 0.02, omDeg: 0, wDeg: 0, M0Deg: 150.0, periodD: 1.370218, frame: 'equatorial' } },
  { id: 'rhea', name: 'Rea', kind: 'moon', parent: 'saturn', radiusKm: 763.8, massKg: 2.309e21, gravity: 0.22,
    rotH: 108.437, obliquityDeg: 0, tempC: -174, moons: 0, color: [0.80, 0.80, 0.78], tex: 'callisto',
    el: { aKm: 527108, e: 0.001, iDeg: 0.36, omDeg: 0, wDeg: 0, M0Deg: 60.0, periodD: 4.518212, frame: 'equatorial' } },
  { id: 'triton', name: 'Tritón', kind: 'moon', parent: 'neptune', radiusKm: 1353.4, massKg: 2.14e22, gravity: 1.06,
    rotH: 141.0446, obliquityDeg: 0, tempC: -235, moons: 0, color: [0.82, 0.80, 0.78], tex: 'ice',
    el: { aKm: 354759, e: 0.000016, iDeg: 156.86, omDeg: 300.0, wDeg: 0, M0Deg: 0.0, periodD: 5.876854, frame: 'equatorial' } },
  { id: 'charon', name: 'Caronte', kind: 'moon', parent: 'pluto', radiusKm: 603.6, massKg: 1.586e21, gravity: 0.49,
    rotH: 153.293, obliquityDeg: 0, tempC: -223, moons: 0, color: [0.70, 0.66, 0.62], tex: 'callisto',
    el: { aKm: 19591, e: 0.0002, iDeg: 0.0, omDeg: 0, wDeg: 0, M0Deg: 90.0, periodD: 6.3872, frame: 'equatorial' } },

  /* --- cometas (a en UA, perihelio como días respecto a J2000).
     a y periodD cumplen la 3ª ley de Kepler, P = 2π·sqrt(a³/GM): si no cuadran,
     la velocidad orbital no satisface la vis-viva y la cola de polvo sale mal. */
  { id: 'halley', name: '1P/Halley', kind: 'comet', radiusKm: 5.5, massKg: 2.2e14, gravity: 0.0003,
    rotH: 52.8, obliquityDeg: 0, tempC: -58, moons: 0, color: [0.75, 0.85, 0.95], tex: 'comet',
    el: { a: 17.83412, e: 0.96714, iDeg: 162.2628, omDeg: 58.4208, wDeg: 111.7242, periodD: 27511.45, tPeri: -4999.5 },
    comet: { ion: [0.55, 0.75, 1.0], dust: [1.0, 0.85, 0.62] } },
  { id: 'encke', name: '2P/Encke', kind: 'comet', radiusKm: 2.4, massKg: 3.0e13, gravity: 0.0002,
    rotH: 15.4, obliquityDeg: 0, tempC: -60, moons: 0, color: [0.80, 0.85, 0.80], tex: 'comet',
    el: { a: 2.21540, e: 0.84825, iDeg: 11.7503, omDeg: 334.9412, wDeg: 186.5102, periodD: 1204.42, tPeri: 1194.5 },
    comet: { ion: [0.5, 0.8, 1.0], dust: [0.95, 0.8, 0.6] } },
  { id: '67p', name: '67P/Churyumov–Gerasimenko', kind: 'comet', radiusKm: 2.0, massKg: 1.0e13, gravity: 0.0001,
    rotH: 12.4, obliquityDeg: 0, tempC: -65, moons: 0, color: [0.7, 0.8, 0.9], tex: 'comet',
    el: { a: 3.46239, e: 0.64102, iDeg: 65.4708, omDeg: 36.3634, wDeg: 200.562, periodD: 2353.22, tPeri: 7999.5 },
    comet: { ion: [0.6, 0.85, 1.0], dust: [0.9, 0.78, 0.62] } },
  { id: 'halebopp', name: 'C/1995 O1 Hale-Bopp', kind: 'comet', radiusKm: 37, massKg: 2.0e16, gravity: 0.0005,
    rotH: 11.3, obliquityDeg: 0, tempC: -70, moons: 0, color: [0.85, 0.9, 1.0], tex: 'comet',
    el: { a: 173.0, e: 0.99501, iDeg: 88.736, omDeg: 284.474, wDeg: 130.367, periodD: 831127, tPeri: -1005.5 },
    comet: { ion: [0.45, 0.7, 1.0], dust: [1.0, 0.9, 0.72] } }
];

/* =====================================================================
   6. POBLACIONES: cinturón de asteroides, cinturón de Kuiper
   ===================================================================== */
const N_ASTEROIDS = 3600;   // ≥3000 requerido
const N_KUIPER    = 2000;   // ≥1500 requerido
/* Lagunas de Kirkwood (resonancias medias con Júpiter) [UA] */
const KIRKWOOD = [
  { a: 2.062, ratio: '4:1' }, { a: 2.502, ratio: '3:1' }, { a: 2.825, ratio: '5:2' },
  { a: 2.958, ratio: '7:3' }, { a: 3.035, ratio: '2:1' }, { a: 3.279, ratio: '5:3' }
];
/* Resonancias exteriores con Neptuno [UA] */
const NEPTUNE_RES = [{ a: 39.44, ratio: '2:1' }, { a: 36.30, ratio: '3:2' }, { a: 34.75, ratio: '5:3' }];
/* Parametros de poblacion: una sola definicion, la comparten boot() y los tests */
const BELT_AST_OPTS = {
  n: N_ASTEROIDS, aMin: 2.06, aMax: 3.38, eSigma: 0.13, eMax: 0.35,
  incSigma: 6.5 * DEG, incMax: 22 * DEG, sizeMin: 2, sizeMax: 320, sizePow: 2.6,
  icy: false, resonantFrac: 0.16, resonances: KIRKWOOD, seed: 20240101
};
const BELT_KUIPER_OPTS = {
  n: N_KUIPER, aMin: 30, aMax: 55, eSigma: 0.16, eMax: 0.55,
  incSigma: 12 * DEG, incMax: 40 * DEG, sizeMin: 20, sizeMax: 600, sizePow: 2.2,
  icy: true, resonantFrac: 0.10, resonances: NEPTUNE_RES, seed: 776655
};
