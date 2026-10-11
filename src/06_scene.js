
/* =====================================================================
   9. CÁMARA ORBITAL (con inercia), MODO DE ESCALA Y VISIBILIDAD
   ===================================================================== */
const UV_PER_AU = 1000;          // 1 UA = 1000 unidades de visualización
const Cam = {
  target: new Float64Array(3),
  dist: 1400, distTarget: 1400,
  yaw: 0.85, pitch: 0.42,
  vYaw: 0, vPitch: 0, vDist: 0,
  pan: new Float64Array(3),
  panTarget: new Float64Array(3),   // posición hacia la que se desplaza el objetivo
  eye: new Float64Array(3), up: new Float64Array(3), right: new Float64Array(3), fwd: new Float64Array(3),
  fov: 55, minDist: 0.02, maxDist: 80000,   // coherente con Sim.scaleMode inicial ('didactic'); UI la sube a 400000 en escala real
  followBody: null,
  update(dt) {
    const damp = Math.exp(-dt * 4.5);
    if (!Input.rotating) { this.yaw += this.vYaw * dt; this.pitch += this.vPitch * dt; this.vYaw *= damp; this.vPitch *= damp; }
    if (!Input.zooming) {
      this.vDist *= Math.exp(-dt * 6.0);
      this.distTarget *= (1 + this.vDist * dt);
    }
    this.distTarget = clamp(this.distTarget, this.minDist, this.maxDist);
    this.dist += (this.distTarget - this.dist) * clamp(dt * 9, 0, 1);
    if (this.followBody) {
      const b = this.followBody;
      this.panTarget[0] = b.disp[0]; this.panTarget[1] = b.disp[1]; this.panTarget[2] = b.disp[2];
    }
    // paneo con inercia: el objetivo se interpola suavemente hacia panTarget
    const kp = clamp(dt * 7, 0, 1);
    this.target[0] += (this.panTarget[0] - this.target[0]) * kp;
    this.target[1] += (this.panTarget[1] - this.target[1]) * kp;
    this.target[2] += (this.panTarget[2] - this.target[2]) * kp;
    this.pan[0] = (this.panTarget[0] - this.target[0]);
    this.pan[1] = (this.panTarget[1] - this.target[1]);
    this.pan[2] = (this.panTarget[2] - this.target[2]);
    this.pitch = clamp(this.pitch, -88.5 * DEG, 88.5 * DEG);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.fwd[0] = cp * Math.cos(this.yaw); this.fwd[1] = cp * Math.sin(this.yaw); this.fwd[2] = sp;
    this.eye[0] = this.target[0] + this.fwd[0] * this.dist;
    this.eye[1] = this.target[1] + this.fwd[1] * this.dist;
    this.eye[2] = this.target[2] + this.fwd[2] * this.dist;
    this.up[0] = -sp * Math.cos(this.yaw); this.up[1] = -sp * Math.sin(this.yaw); this.up[2] = cp;
    this.right[0] = -Math.sin(this.yaw); this.right[1] = Math.cos(this.yaw); this.right[2] = 0;
  },
  zoomBy(f) { this.distTarget *= f; },
  panBy(dx, dy) {
    // desplazamiento en unidades de visualización equivalente a dx/dy píxeles de pantalla
    const k = 2 * this.dist * Math.tan(this.fov * DEG / 2) / Math.max(R.H, 1);
    this.panTarget[0] += -this.right[0] * dx * k + this.up[0] * dy * k;
    this.panTarget[1] += -this.right[1] * dx * k + this.up[1] * dy * k;
    this.panTarget[2] += -this.right[2] * dx * k + this.up[2] * dy * k;
  },
  lookAt(x, y, z) { this.panTarget[0] = x; this.panTarget[1] = y; this.panTarget[2] = z; },
  frameBody(b, mult) {
    this.followBody = b;
    const r = Math.max(b.dispR, 0.001);
    this.distTarget = Math.max(r * (mult || 6), Cam.minDist * 2);
    this.target[0] = this.panTarget[0] = b.disp[0];
    this.target[1] = this.panTarget[1] = b.disp[1];
    this.target[2] = this.panTarget[2] = b.disp[2];
  }
};

/* Distancia real -> distancia de visualización según el modo de escala */
function mapDist(rAU) {
  if (Sim.scaleMode === 'real') return rAU * UV_PER_AU;
  return Math.pow(rAU, 0.62) * UV_PER_AU;                 // aproximación logarítmica didáctica
}
function displayRadiusOf(b) {
  if (Sim.scaleMode === 'real') return b.radiusAU * UV_PER_AU * Sim.sizeExagg;
  return Math.pow(b.radiusKm, 1 / 3) * 0.06 * Sim.sizeExagg;   // ~ cúbica: planetas rocosos visibles
}

/* =====================================================================
   10. INTEGRACIÓN N-CUERPO (Velocity Verlet) y energía
   ===================================================================== */
const NBody = {
  n: 0, list: [], pos: null, vel: null, acc: null, gm: null,
  E0: 0, E: 0, drift: 0, dt: 0.02, steps: 0,
  init() {
    this.list = Sim.bodies.filter(b => b.kind === 'star' || b.kind === 'planet' || b.kind === 'dwarf');
    this.n = this.list.length;
    /* marca los cuerpos que realmente integra el Verlet: en modo N-cuerpo la HUD
       debe mostrar la velocidad INTEGRADA |b.vel|, no la vis-viva kepleriana. */
    for (let i = 0; i < this.n; i++) this.list[i].integrated = true;
    this.pos = new Float64Array(this.n * 3);
    this.vel = new Float64Array(this.n * 3);
    this.acc = new Float64Array(this.n * 3);
    this.gm = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) this.gm[i] = this.list[i].gm;
    this.reset();
  },
  reset() {
    const t = Sim.t;
    for (let i = 0; i < this.n; i++) {
      const b = this.list[i], el = elementsOf(b, t, _el);
      orbitPosition(el.a, el.e, el.i, el.om, el.w, el.M, b.pos);
      orbitVelocity(el.a, el.e, el.i, el.om, el.w, el.M, el.n, b.vel);
      for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = b.pos[k]; this.vel[i * 3 + k] = b.vel[k]; }
    }
    this.computeAcc();
    this.E0 = this.energy(); this.E = this.E0; this.drift = 0;
  },
  computeAcc() {
    const n = this.n, p = this.pos, a = this.acc, g = this.gm;
    a.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
        const r2 = dx * dx + dy * dy + dz * dz + 1e-12;
        const inv = 1 / (r2 * Math.sqrt(r2));
        a[i * 3] += g[j] * dx * inv; a[i * 3 + 1] += g[j] * dy * inv; a[i * 3 + 2] += g[j] * dz * inv;
        a[j * 3] -= g[i] * dx * inv; a[j * 3 + 1] -= g[i] * dy * inv; a[j * 3 + 2] -= g[i] * dz * inv;
      }
    }
  },
  /* Velocity Verlet canonico: kick(dt/2) - drift(dt) - kick(dt/2).
     El impulso total del paso es (a_old + a_new)/2 * dt, no a_new * dt. */
  step(dt) {
    const n3 = this.n * 3, p = this.pos, v = this.vel, a = this.acc, h = 0.5 * dt;
    for (let i = 0; i < n3; i++) v[i] += a[i] * h;   // half-kick con a_old
    for (let i = 0; i < n3; i++) p[i] += v[i] * dt;  // full-drift
    this.computeAcc();                               // a := a_new
    for (let i = 0; i < n3; i++) v[i] += a[i] * h;   // half-kick con a_new
    this.steps++;
  },
  energy() {
    const n = this.n, p = this.pos, v = this.vel, g = this.gm;
    let E = 0;
    for (let i = 0; i < n; i++) {
      const vx = v[i * 3], vy = v[i * 3 + 1], vz = v[i * 3 + 2];
      E += 0.5 * g[i] * (vx * vx + vy * vy + vz * vz);
      for (let j = i + 1; j < n; j++) {
        const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
        E -= g[i] * g[j] / Math.sqrt(dx * dx + dy * dy + dz * dz + 1e-12);
      }
    }
    return E;
  },
  syncToBodies() {
    for (let i = 0; i < this.n; i++) {
      const b = this.list[i];
      b.pos[0] = this.pos[i * 3]; b.pos[1] = this.pos[i * 3 + 1]; b.pos[2] = this.pos[i * 3 + 2];
      b.vel[0] = this.vel[i * 3]; b.vel[1] = this.vel[i * 3 + 1]; b.vel[2] = this.vel[i * 3 + 2];
    }
  }
};

/* Avance de la simulación en el tiempo */
function simulate(dtSim) {
  Sim.t += dtSim;
  Sim.jd = J2000_JD + Sim.t;
  if (Sim.nbody) {
    const total = Math.abs(Sim.t - NBody.lastT);
    const maxSteps = 700;
    let steps = Math.min(maxSteps, Math.max(1, Math.ceil(total / NBody.dt)));
    const dt = total / steps;
    for (let s = 0; s < steps; s++) NBody.step(dt);
    NBody.lastT = Sim.t;
    NBody.E = NBody.energy();
    NBody.drift = NBody.E0 !== 0 ? (NBody.E - NBody.E0) / Math.abs(NBody.E0) : 0;
    NBody.syncToBodies();
    // lunas y cuerpos menores siguen a sus padres (kepleriano relativo)
    for (const b of Sim.bodies) {
      if (b.kind === 'moon') {
        const el = elementsOf(b, Sim.t, _el);
        orbitPosition(el.a, el.e, el.i, el.om, el.w, el.M, b.local);
        if (b.def.el.frame === 'equatorial') { rot3(b.parent.node, b.parent.obli, 0, _r9b); rot3Apply(_r9b, b.local[0], b.local[1], b.local[2], b.local); }
        const p = b.parent.pos;
        b.pos[0] = p[0] + b.local[0]; b.pos[1] = p[1] + b.local[1]; b.pos[2] = p[2] + b.local[2];
      } else if (!NBody.has(b)) {
        updateKepler(b, Sim.t);
      }
      updateOrientation(b, Sim.t);
    }
  } else {
    for (const b of Sim.bodies) { updateKepler(b, Sim.t); updateOrientation(b, Sim.t); }
  }
  /* Los cinturones solo se calculan si se dibujan: 5600 cuerpos no aportan nada
     cuando Sim.showBelts esta apagado. Al reactivarlos se recalculan ese mismo frame. */
  if (Sim.showBelts) { updateBelt(Sim.belts.ast, Sim.t); updateBelt(Sim.belts.ku, Sim.t); }
  updateTrails();
}
NBody.has = function (b) { return this.list.indexOf(b) >= 0; };
NBody.lastT = 0;

/* Estelas: muestreo en tiempo simulado, se guardan posiciones REALES [UA] */
function updateTrails() {
  for (const b of Sim.bodies) {
    if (b.kind === 'star') continue;
    const period = b.orbitPeriodD || 365;
    const interval = Math.max(period * 0.35 / TRAIL_MAX, Math.abs(Sim.speed) * 0.02, 1e-4);
    if (isNaN(b.trailLastT)) { b.trailLastT = Sim.t; }
    if (Math.abs(Sim.t - b.trailLastT) >= interval) {
      const h = b.trailHead;
      b.trail[h * 3] = b.pos[0]; b.trail[h * 3 + 1] = b.pos[1]; b.trail[h * 3 + 2] = b.pos[2];
      b.trailHead = (h + 1) % TRAIL_MAX;
      if (b.trailCount < TRAIL_MAX) b.trailCount++;
      b.trailLastT = Sim.t;
    }
  }
}
function clearTrails() {
  for (const b of Sim.bodies) { b.trailCount = 0; b.trailHead = 0; b.trailLastT = NaN; }
}

/* =====================================================================
   8b. DIBUJO DE LA ESCENA
   ===================================================================== */
const _v4 = new Float32Array(4);
const _model = mat4(), _normal = new Float32Array(9);
const _tmp3 = new Float64Array(3);
const _prev3 = new Float64Array(3);   // extremo anterior del segmento: gl.LINES necesita 2 vertices por tramo

/* Oclusores solares: cuerpos que pueden tapar el Sol desde un punto de la superficie
   de b (su planeta padre + sus lunas). Lo usa el shader de cuerpo para los eclipses. */
const MAX_OCC = 6;
const _occPos = new Float32Array(MAX_OCC * 3);
const _occR = new Float32Array(MAX_OCC);
const _occList = [];
function collectOcculters(b) {
  _occList.length = 0;
  if (b.parent && b.parent.kind !== 'star') _occList.push(b.parent);
  for (const o of Sim.bodies) if (o !== b && o.parent === b) _occList.push(o);
  _occList.sort((x, y) => y.dispR - x.dispR);            // los grandes primero
  let n = 0;
  for (let i = 0; i < _occList.length && n < MAX_OCC; i++) {
    const o = _occList[i];
    _occPos[n * 3] = o.disp[0]; _occPos[n * 3 + 1] = o.disp[1]; _occPos[n * 3 + 2] = o.disp[2];
    _occR[n] = o.dispR; n++;
  }
  return n;
}

function computeDisplayPositions() {
  const tanHalf = Math.tan(Cam.fov * DEG / 2);
  const pxScale = (R.H / 2) / tanHalf;
  for (const b of Sim.bodies) {
    const r = hypot3(b.pos[0], b.pos[1], b.pos[2]);
    let dispR;
    if (b.kind === 'moon') {
      const lr = hypot3(b.local[0], b.local[1], b.local[2]);
      const f = lr > 0 ? mapDist(lr) / lr : 1;
      b.disp[0] = b.parent.disp[0] + b.local[0] * f;
      b.disp[1] = b.parent.disp[1] + b.local[1] * f;
      b.disp[2] = b.parent.disp[2] + b.local[2] * f;
      dispR = displayRadiusOf(b);
    } else {
      const f = r > 0 ? mapDist(r) / r : 1;
      b.disp[0] = b.pos[0] * f; b.disp[1] = b.pos[1] * f; b.disp[2] = b.pos[2] * f;
      dispR = displayRadiusOf(b);
    }
    b.distCam = hypot3(b.disp[0] - Cam.eye[0], b.disp[1] - Cam.eye[1], b.disp[2] - Cam.eye[2]);
    // Suelo de visibilidad: ningún cuerpo baja de minPxSize píxeles, pero sin inflarse
    // más allá de una fracción de su distancia al cuerpo al que pertenece.
    const minR = Sim.minPxSize * b.distCam / pxScale;
    let ref;
    if (b.parent) ref = hypot3(b.disp[0] - b.parent.disp[0], b.disp[1] - b.parent.disp[1], b.disp[2] - b.parent.disp[2]);
    else if (b.kind === 'star') ref = b.distCam;
    else ref = hypot3(b.disp[0], b.disp[1], b.disp[2]);
    const capR = ref > 0 ? ref * 0.30 : minR;
    b.dispR = Math.max(dispR, Math.min(minR, capR));
    b.pxSize = b.dispR * pxScale / Math.max(b.distCam, 1e-9);
  }
}

function inFrustum(x, y, z, radius) {
  const m = R.vp;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0) return false;
  const lim = cw + radius;
  return cx > -lim && cx < lim && cy > -lim && cy < lim;
}

function drawSky() {
  const gl = R.gl, p = R.progs.sky;
  gl.useProgram(p.p);
  gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  R.bindAttribs(p, R.sphereHi);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.sphereHi.idx);
  gl.uniformMatrix4fv(p.u.uVP, false, R.vp);
  gl.uniform1f(p.u.uBright, Sim.showStars ? 1.0 : 0.06);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.tex.sky);
  gl.uniform1i(p.u.uTex, 0);
  gl.drawElements(gl.TRIANGLES, R.sphereHi.count, gl.UNSIGNED_SHORT, 0);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
}

function drawBodies() {
  const gl = R.gl, p = R.progs.body;
  gl.useProgram(p.p);
  gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  let mesh = R.sphereHi;                                  // LOD: se cambia dentro del bucle
  R.bindAttribs(p, mesh);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
  gl.uniformMatrix4fv(p.u.uVP, false, R.vp);
  gl.uniform3fv(p.u.uCam, Cam.eye);
  gl.uniform3fv(p.u.uSunPos, Sim.sun.disp);
  gl.uniform1f(p.u.uExposure, 1.05);
  gl.uniform1i(p.u.uTex, 0);
  gl.uniform1i(p.u.uNight, 1);
  gl.uniform1i(p.u.uClouds, 2);
  // los uniforms-array se listan como "uOccPos[0]"
  const locOccPos = p.u.uOccPos || p.u['uOccPos[0]'];
  const locOccR = p.u.uOccR || p.u['uOccR[0]'];
  let count = 0;
  for (const b of Sim.bodies) {
    if (!inFrustum(b.disp[0], b.disp[1], b.disp[2], b.dispR)) continue;
    if (b.pxSize < 0.6) continue;
    const m = b.pxSize < 48 ? R.sphereLo : R.sphereHi;    // < 48 px aparentes: 480 triángulos
    if (m !== mesh) { mesh = m; R.bindAttribs(p, mesh); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx); }
    composeModel(_model, b.disp, b.dispR, b.node, b.obli, b.spin, _normal);
    gl.uniformMatrix4fv(p.u.uModel, false, _model);
    gl.uniformMatrix3fv(p.u.uNormalMat, false, _normal);
    gl.uniform1f(p.u.uEmissive, b.kind === 'star' ? 1 : 0);
    const isEarth = b.id === 'earth';
    gl.uniform1f(p.u.uNightOn, isEarth ? 1 : 0);
    gl.uniform1f(p.u.uCloudOn, isEarth ? 1 : 0);
    gl.uniform1f(p.u.uCloudShift, isEarth ? (Sim.t * 0.04) % 1 : 0);   // nubes: deriva 4 %/dia
    // sombra del anillo sobre la superficie del planeta
    const rg = b.def.ring;
    gl.uniform1f(p.u.uRingOn, rg ? 1 : 0);
    if (rg) {
      gl.uniform3f(p.u.uRingAxis, _r9[2], _r9[5], _r9[8]);   // 3ª columna de _r9 = polo del planeta
      gl.uniform3fv(p.u.uPlanetPos, b.disp);
      gl.uniform1f(p.u.uPlanetR, b.dispR);
      gl.uniform1f(p.u.uRingInner, rg.inner);
      gl.uniform1f(p.u.uRingOuter, rg.outer);
      gl.uniform1f(p.u.uRingOpacity, b.id === 'saturn' ? 0.72 : b.id === 'jupiter' ? 0.12 : 0.35);
    }
    // eclipses: sombra de lunas/planetas sobre el cuerpo que se dibuja
    const nOcc = collectOcculters(b);
    gl.uniform1i(p.u.uOccN, nOcc);
    if (nOcc) { gl.uniform3fv(locOccPos, _occPos); gl.uniform1fv(locOccR, _occR); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.tex[b.def.tex] || R.tex.rock);
    if (isEarth) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.tex.earthNight);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.tex.earthClouds);
    }
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    count++;
  }
  Sim.drawnCount = count;
}

/* Corona del Sol: billboard aditivo para que la estrella sea siempre legible */
function drawSunGlow() {
  const gl = R.gl, p = R.progs.bill, b = Sim.sun;
  const pxScale = (R.H / 2) / Math.tan(Cam.fov * DEG / 2);
  const minSize = 34 * b.distCam / pxScale;              // halo mínimo de ~34 px en pantalla
  const s = Math.max(b.dispR * 6.0, minSize);
  gl.useProgram(p.p);
  gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.uniformMatrix4fv(p.u.uVP, false, R.vp);
  gl.bindBuffer(gl.ARRAY_BUFFER, R.quad);
  if (p.a.aQuad >= 0) { gl.enableVertexAttribArray(p.a.aQuad); gl.vertexAttribPointer(p.a.aQuad, 2, gl.FLOAT, false, 0, 0); }
  drawBillboard(R.tex.glowWide, b.disp[0], b.disp[1], b.disp[2],
    Cam.right[0], Cam.right[1], Cam.right[2], Cam.up[0], Cam.up[1], Cam.up[2],
    s, s, [1.0, 0.72, 0.32], 0.60);
  drawBillboard(R.tex.glowSoft, b.disp[0], b.disp[1], b.disp[2],
    Cam.right[0], Cam.right[1], Cam.right[2], Cam.up[0], Cam.up[1], Cam.up[2],
    s * 0.30, s * 0.30, [1.0, 0.90, 0.68], 0.95);
  gl.depthMask(true);
}

function drawAtmospheres() {
  if (!Sim.showAtmo) return;
  const gl = R.gl, p = R.progs.atmo;
  gl.useProgram(p.p);
  gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);      // aditivo
  R.bindAttribs(p, R.sphereHi);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.sphereHi.idx);
  gl.uniformMatrix4fv(p.u.uVP, false, R.vp);
  gl.uniform3fv(p.u.uCam, Cam.eye);
  gl.uniform3fv(p.u.uSunPos, Sim.sun.disp);
  for (const b of Sim.bodies) {
    const at = b.def.atmo;
    if (!at) continue;
    if (!inFrustum(b.disp[0], b.disp[1], b.disp[2], b.dispR * at.scale)) continue;
    if (b.pxSize < 1.2) continue;
    composeModel(_model, b.disp, b.dispR * at.scale, b.node, b.obli, b.spin, _normal);
    gl.uniformMatrix4fv(p.u.uModel, false, _model);
    gl.uniformMatrix3fv(p.u.uNormalMat, false, _normal);
    gl.uniform3fv(p.u.uColor, at.color);
    gl.uniform1f(p.u.uPower, at.power);
    gl.uniform1f(p.u.uStrength, clamp(at.strength !== undefined ? at.strength : at.power, 0, 1)
                               * (b.kind === 'moon' ? 0.8 : 1.0));
    gl.drawElements(gl.TRIANGLES, R.sphereHi.count, gl.UNSIGNED_SHORT, 0);
  }
  gl.depthMask(true);
}

const ringOrder = [];
function drawRings() {
  if (!Sim.showRings) return;
  const gl = R.gl, p = R.progs.ring;
  gl.useProgram(p.p);
  gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniformMatrix4fv(p.u.uVP, false, R.vp);
  gl.uniform3fv(p.u.uCam, Cam.eye);
  gl.uniform3fv(p.u.uSunPos, Sim.sun.disp);
  ringOrder.length = 0;
  for (const b of Sim.bodies) if (b.def.ring && inFrustum(b.disp[0], b.disp[1], b.disp[2], b.dispR * b.def.ring.outer * 1.2)) ringOrder.push(b);
  ringOrder.sort((a, b) => b.distCam - a.distCam);              // de lejos a cerca
  for (const b of ringOrder) {
    const rg = b.ringMesh;
    R.bindAttribs(p, rg);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rg.idx);
    composeModel(_model, b.disp, b.dispR, b.node, b.obli, 0, _normal);
    gl.uniformMatrix4fv(p.u.uModel, false, _model);
    gl.uniformMatrix3fv(p.u.uNormalMat, false, _normal);
    gl.uniform3f(p.u.uRingNormal, _r9[2], _r9[5], _r9[8]);      // eje del anillo = polo del planeta
    gl.uniform3fv(p.u.uPlanetPos, b.disp);
    gl.uniform1f(p.u.uPlanetR, b.dispR);
    gl.uniform1f(p.u.uBright, b.kind === 'planet' ? 1.0 : 0.8);
    gl.uniform1f(p.u.uAlpha, 0.95);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.tex[b.def.ring.tex]);
    gl.uniform1i(p.u.uTex, 0);
    gl.drawElements(gl.TRIANGLES, rg.count, gl.UNSIGNED_SHORT, 0);
  }
  gl.depthMask(true);
}

/* --- puntos: asteroides y Kuiper --- */
function drawBelts() {
  if (!Sim.showBelts) { Sim.belts.visibleCount = 0; return; }   // el HUD cuenta dibujados reales
  const gl = R.gl, p = R.progs.point;
  gl.useProgram(p.p);
  gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);      // acumulación de brillo
  const buf = Sim.belts.gpu;
  let n = 0;
  for (const belt of [Sim.belts.ast, Sim.belts.ku]) {
    const pos = belt.pos, disp = belt.disp;
    for (let k = 0; k < belt.n; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      const r = hypot3(x, y, z);
      const f = mapDist(r) / r;
      const dx = x * f, dy = y * f, dz = z * f;
      const dCam = hypot3(dx - Cam.eye[0], dy - Cam.eye[1], dz - Cam.eye[2]);
      if (dCam < Cam.dist * 0.02) continue;
      const near = clamp(1 - dCam / (Cam.dist * 2.2), 0, 1);
      const bright = clamp(6.5 / (r * r), 0.05, 1.3) * (0.60 + 0.40 * Math.pow(belt.size[k] / 90, 0.33));
      const px = clamp(1.2 + 3.0 * bright * (0.40 + 0.60 * near), 1, 6);
      const alpha = clamp(0.25 + 0.70 * bright, 0.06, 0.95) * (0.35 + 0.65 * near);
      if (alpha < 0.03) continue;
      const o = n * 8;
      buf[o] = dx; buf[o + 1] = dy; buf[o + 2] = dz;
      buf[o + 3] = belt.cr[k]; buf[o + 4] = belt.cg[k]; buf[o + 5] = belt.cb[k];
      buf[o + 6] = alpha; buf[o + 7] = px;
      n++;
    }
  }
  Sim.belts.visibleCount = n;
  if (!n) { gl.depthMask(true); return; }
  gl.bindBuffer(gl.ARRAY_BUFFER, Sim.belts.buf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, n * 8));
  const stride = 8 * 4;
  if (p.a.aPos >= 0) { gl.enableVertexAttribArray(p.a.aPos); gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, stride, 0); }
  if (p.a.aColor >= 0) { gl.enableVertexAttribArray(p.a.aColor); gl.vertexAttribPointer(p.a.aColor, 4, gl.FLOAT, false, stride, 12); }
  if (p.a.aSize >= 0) { gl.enableVertexAttribArray(p.a.aSize); gl.vertexAttribPointer(p.a.aSize, 1, gl.FLOAT, false, stride, 28); }
  gl.uniformMatrix4fv(p.u.uVP, false, R.vp);
  gl.drawArrays(gl.POINTS, 0, n);
  if (p.a.aPos >= 0) gl.disableVertexAttribArray(p.a.aPos);
  if (p.a.aColor >= 0) gl.disableVertexAttribArray(p.a.aColor);
  if (p.a.aSize >= 0) gl.disableVertexAttribArray(p.a.aSize);
  gl.depthMask(true);
}

/* --- líneas: órbitas, estelas, selección, regla --- */
const LinePool = { data: new Float32Array(120000 * 7), n: 0 };
/* Gancho de capas de líneas externas (09_tour.js). Se resuelve en tiempo de
   render, no en carga: 06_scene.js no depende del orden de concatenación. */
const RenderHooks = { tour: null };
function linePush(x, y, z, r, g, b, a) {
  const o = LinePool.n * 7;
  const d = LinePool.data;
  if (o + 7 > d.length) return;
  d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = r; d[o + 4] = g; d[o + 5] = b; d[o + 6] = a;
  LinePool.n++;
}
function mapPoint(x, y, z, out) {
  const r = hypot3(x, y, z);
  if (r === 0) { out[0] = out[1] = out[2] = 0; return out; }
  const f = mapDist(r) / r;
  out[0] = x * f; out[1] = y * f; out[2] = z * f;
  return out;
}
function drawLines() {
  const gl = R.gl, p = R.progs.line;
  gl.useProgram(p.p);
  gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  LinePool.n = 0;
  const sel = Sim.selected;
  if (Sim.showOrbits) {
    for (const b of Sim.bodies) {
      if (!b.orbitReal) continue;
      if (b.kind === 'moon' && b.parent.pxSize < 3) continue;
      const isSel = sel === b;
      const base = isSel ? [1.0, 0.85, 0.35] : b.color;
      const baseA = isSel ? 0.85 : (b.kind === 'comet' ? 0.30 : b.kind === 'dwarf' ? 0.38 : b.kind === 'moon' ? 0.30 : 0.42);
      const n = b.orbitN, arr = b.orbitReal;
      let has = false;
      for (let i = 0; i <= n; i++) {
        const k = (i % n) * 3;
        mapPoint(arr[k], arr[k + 1], arr[k + 2], _tmp3);
        if (has) {
          const a = baseA * (isSel ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(i / n * Math.PI)));
          linePush(_prev3[0], _prev3[1], _prev3[2], base[0], base[1], base[2], a);
          linePush(_tmp3[0], _tmp3[1], _tmp3[2], base[0], base[1], base[2], a);
        }
        _prev3[0] = _tmp3[0]; _prev3[1] = _tmp3[1]; _prev3[2] = _tmp3[2];
        has = true;
      }
    }
  }
  if (Sim.showTrails) {
    for (const b of Sim.bodies) {
      if (b.trailCount < 2) continue;
      const len = Math.min(b.trailCount, Sim.trailLen);
      const start = (b.trailHead - len + TRAIL_MAX) % TRAIL_MAX;
      const base = b.color;
      let has = false;
      for (let i = 0; i < len; i++) {
        const idx = (start + i) % TRAIL_MAX;
        mapPoint(b.trail[idx * 3], b.trail[idx * 3 + 1], b.trail[idx * 3 + 2], _tmp3);
        if (has) {
          const t = i / len, t0 = (i - 1) / len;
          linePush(_prev3[0], _prev3[1], _prev3[2], base[0], base[1], base[2], 0.10 + 0.75 * t0 * t0);
          linePush(_tmp3[0], _tmp3[1], _tmp3[2], base[0], base[1], base[2], 0.10 + 0.75 * t * t);
        }
        _prev3[0] = _tmp3[0]; _prev3[1] = _tmp3[1]; _prev3[2] = _tmp3[2];
        has = true;
      }
    }
  }
  /* anillo de selección (círculo en el plano de la cámara) */
  if (sel) {
    const r = Math.max(sel.dispR * 1.6, Cam.dist * 0.012);
    const cx = sel.disp[0], cy = sel.disp[1], cz = sel.disp[2];
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
      linePush(cx + Cam.right[0] * Math.cos(a0) * r + Cam.up[0] * Math.sin(a0) * r,
               cy + Cam.right[1] * Math.cos(a0) * r + Cam.up[1] * Math.sin(a0) * r,
               cz + Cam.right[2] * Math.cos(a0) * r + Cam.up[2] * Math.sin(a0) * r, 1, 0.85, 0.35, 0.9);
      linePush(cx + Cam.right[0] * Math.cos(a1) * r + Cam.up[0] * Math.sin(a1) * r,
               cy + Cam.right[1] * Math.cos(a1) * r + Cam.up[1] * Math.sin(a1) * r,
               cz + Cam.right[2] * Math.cos(a1) * r + Cam.up[2] * Math.sin(a1) * r, 1, 0.85, 0.35, 0.9);
    }
  }
  /* regla de distancia */
  if (Sim.measureA && Sim.measureB) {
    const A = Sim.measureA, B = Sim.measureB;
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const ax = A.disp[0] + (B.disp[0] - A.disp[0]) * t0, ay = A.disp[1] + (B.disp[1] - A.disp[1]) * t0, az = A.disp[2] + (B.disp[2] - A.disp[2]) * t0;
      const bx = A.disp[0] + (B.disp[0] - A.disp[0]) * t1, by = A.disp[1] + (B.disp[1] - A.disp[1]) * t1, bz = A.disp[2] + (B.disp[2] - A.disp[2]) * t1;
      linePush(ax, ay, az, 0.45, 1.0, 0.85, 0.85);
      linePush(bx, by, bz, 0.45, 1.0, 0.85, 0.85);
    }
  }
  /* capa del tour guiado (09_tour.js): ruta entre paradas y anillo de destino */
  if (RenderHooks.tour) RenderHooks.tour();

  if (!LinePool.n) { gl.depthMask(true); return; }
  gl.bindBuffer(gl.ARRAY_BUFFER, Sim.lineBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, LinePool.data.subarray(0, LinePool.n * 7));
  if (p.a.aPos >= 0) { gl.enableVertexAttribArray(p.a.aPos); gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 28, 0); }
  if (p.a.aColor >= 0) { gl.enableVertexAttribArray(p.a.aColor); gl.vertexAttribPointer(p.a.aColor, 4, gl.FLOAT, false, 28, 12); }
  gl.uniformMatrix4fv(p.u.uVP, false, R.vp);
  gl.drawArrays(gl.LINES, 0, LinePool.n);
  if (p.a.aPos >= 0) gl.disableVertexAttribArray(p.a.aPos);
  if (p.a.aColor >= 0) gl.disableVertexAttribArray(p.a.aColor);
  gl.depthMask(true);
}

/* --- cometas: coma y colas (billboards) --- */
function cometActivity(rAU) {
  return clamp(Math.pow(2.6 / Math.max(rAU, 0.25), 2.1), 0, 1.8);
}
function drawBillboard(tex, cx, cy, cz, rx, ry, rz, ux, uy, uz, sx, sy, color, intensity) {
  const gl = R.gl, p = R.progs.bill;
  gl.uniform3f(p.u.uCenter, cx, cy, cz);
  gl.uniform3f(p.u.uRight, rx, ry, rz);
  gl.uniform3f(p.u.uUp, ux, uy, uz);
  gl.uniform2f(p.u.uSize, sx, sy);
  gl.uniform3fv(p.u.uColor, color);
  gl.uniform1f(p.u.uIntensity, intensity);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(p.u.uTex, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
/* Geometria de las colas de un cometa. Funcion pura (sin GL): la consumen
   drawComets() y los tests de tools/check.js, asi que se comprueba exactamente
   lo que se dibuja.
     - cola ionica: anti-solar exacta (la arrastra el viento solar)
     - cola de polvo: anti-solar mezclada con la ESTELA ORBITAL RETRASADA, es
       decir con la direccion en la que estaba el cometa cuando se libero el
       grano mas viejo de la cola; ese retraso es lo que la curva.
   out: { rAU, act, ion[3], dust[3], lenIon, lenDust, lagD, mix, w, angleDeg } */
const TAIL_ION_AU  = [0.06, 0.42];   // [base, por unidad de actividad] [UA]
const TAIL_DUST_AU = [0.04, 0.30];   // idem; en modo real 1 UA = UV_PER_AU
const _tailPos = new Float64Array(3);
function cometTail(body, out) {
  const rAU = hypot3(body.pos[0], body.pos[1], body.pos[2]);
  const act = cometActivity(rAU);
  out.rAU = rAU; out.act = act;
  out.lenIon  = (TAIL_ION_AU[0]  + TAIL_ION_AU[1]  * act) * UV_PER_AU;
  out.lenDust = (TAIL_DUST_AU[0] + TAIL_DUST_AU[1] * act) * UV_PER_AU;
  /* eje ionico: opuesto al Sol (presion de radiacion + viento solar) */
  const dx = body.pos[0] - Sim.sun.pos[0], dy = body.pos[1] - Sim.sun.pos[1], dz = body.pos[2] - Sim.sun.pos[2];
  const dl = hypot3(dx, dy, dz) || 1;
  const ax = dx / dl, ay = dy / dl, az = dz / dl;
  out.ion[0] = ax; out.ion[1] = ay; out.ion[2] = az;
  /* estela retrasada: el grano mas viejo salio cuando el cometa estaba a una
     longitud de cola de distancia, es decir hace lag = lenDust[UA] / |vel| dias */
  const vl = hypot3(body.vel[0], body.vel[1], body.vel[2]);
  let tx = 0, ty = 0, tz = 0, lag = 0, w = 0, ok = false;
  if (act > 0.02 && vl > 1e-12) {
    lag = Math.min(TAIL_DUST_AU[0] + TAIL_DUST_AU[1] * act, (body.orbitPeriodD || 365) * 0.02 * vl) / vl;
    const el = elementsOf(body, Sim.t, _el);
    orbitPosition(el.a, el.e, el.i, el.om, el.w, el.M - el.n * lag, _tailPos);
    tx = _tailPos[0] - body.pos[0]; ty = _tailPos[1] - body.pos[1]; tz = _tailPos[2] - body.pos[2];
    let tl = hypot3(tx, ty, tz);
    if (tl < 1e-12) { tx = -body.vel[0]; ty = -body.vel[1]; tz = -body.vel[2]; tl = vl; }   // respaldo
    /* solo la componente TRANSVERSAL de la estela curva la cola: la radial ya la
       aporta el eje anti-solar, y asi el angulo (ion,polvo) queda acotado < 90 deg */
    const rad = tx * ax + ty * ay + tz * az;
    tx -= ax * rad; ty -= ay * rad; tz -= az * rad;
    const tp = hypot3(tx, ty, tz);
    if (tp > 1e-12) { tx /= tp; ty /= tp; tz /= tp; w = Math.min(1, tp / tl); ok = true; }
  }
  /* mezcla: a mas actividad mas peso de la estela => cola de polvo mas curva */
  const mix = ok ? clamp(0.72 - 0.32 * Math.min(act, 1), 0.35, 0.72) : 1;
  const k = (1 - mix) * w;
  let bx = ax * mix + tx * k, by = ay * mix + ty * k, bz = az * mix + tz * k;
  const bl = hypot3(bx, by, bz) || 1;
  out.dust[0] = bx / bl; out.dust[1] = by / bl; out.dust[2] = bz / bl;
  out.lagD = lag; out.mix = mix; out.w = w;
  out.angleDeg = Math.acos(clamp(out.ion[0] * out.dust[0] + out.ion[1] * out.dust[1] + out.ion[2] * out.dust[2], -1, 1)) * RAD;
  return out;
}
const _tail = { rAU: 0, act: 0, ion: new Float64Array(3), dust: new Float64Array(3),
                lenIon: 0, lenDust: 0, lagD: 0, mix: 1, w: 0, angleDeg: 0 };
function drawComets() {
  if (!Sim.showComets) return;
  const gl = R.gl, p = R.progs.bill;
  gl.useProgram(p.p);
  gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);      // aditivo
  gl.uniformMatrix4fv(p.u.uVP, false, R.vp);
  gl.bindBuffer(gl.ARRAY_BUFFER, R.quad);
  if (p.a.aQuad >= 0) { gl.enableVertexAttribArray(p.a.aQuad); gl.vertexAttribPointer(p.a.aQuad, 2, gl.FLOAT, false, 0, 0); }
  for (const b of Sim.comets) {
    if (!inFrustum(b.disp[0], b.disp[1], b.disp[2], 400)) continue;
    const T = cometTail(b, _tail);
    const act = T.act;
    if (act < 0.02) {
      drawBillboard(R.tex.coma, b.disp[0], b.disp[1], b.disp[2], 1, 0, 0, 0, 1, 0,
        Math.max(b.dispR, 0.02), Math.max(b.dispR, 0.02), [0.7, 0.75, 0.8], 0.5);
      continue;
    }
    // eje de la cola ionica: anti-solar
    const ax = T.ion[0], ay = T.ion[1], az = T.ion[2];
    // vector perpendicular a (eje cola, direccion a camara)
    const vx = Cam.eye[0] - b.disp[0], vy = Cam.eye[1] - b.disp[1], vz = Cam.eye[2] - b.disp[2];
    let rx = ay * vz - az * vy, ry = az * vx - ax * vz, rz = ax * vy - ay * vx;
    const rl = hypot3(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const comaR = Math.max(b.dispR, 0.02) + act * (Sim.scaleMode === 'real' ? 6 : 9);
    drawBillboard(R.tex.coma, b.disp[0], b.disp[1], b.disp[2], rx, ry, rz, ax, ay, az,
      comaR * 1.1, comaR * 1.1, [0.85, 0.9, 1.0], clamp(0.35 + act * 0.5, 0, 1.2));
    const lenIon = T.lenIon, lenDust = T.lenDust;
    // cola iónica: exactamente anti-solar
    drawBillboard(R.tex.tail, b.disp[0] + ax * lenIon * 0.5, b.disp[1] + ay * lenIon * 0.5, b.disp[2] + az * lenIon * 0.5,
      rx, ry, rz, ax, ay, az, lenIon * 0.10, lenIon * 0.5, b.def.comet.ion, clamp(act * 0.55, 0, 1));
    // cola de polvo: eje curvado (anti-solar + estela retrasada); su vector
    // "right" se recalcula para que el billboard no quede oblicuo respecto a su eje
    const bx = T.dust[0], by = T.dust[1], bz = T.dust[2];
    let qx = by * vz - bz * vy, qy = bz * vx - bx * vz, qz = bx * vy - by * vx;
    const ql = hypot3(qx, qy, qz);
    if (ql > 1e-9) { qx /= ql; qy /= ql; qz /= ql; } else { qx = rx; qy = ry; qz = rz; }
    drawBillboard(R.tex.tail, b.disp[0] + bx * lenDust * 0.5, b.disp[1] + by * lenDust * 0.5, b.disp[2] + bz * lenDust * 0.5,
      qx, qy, qz, bx, by, bz, lenDust * 0.16, lenDust * 0.5, b.def.comet.dust, clamp(act * 0.45, 0, 1));
  }
  if (p.a.aQuad >= 0) gl.disableVertexAttribArray(p.a.aQuad);
  gl.depthMask(true);
}
