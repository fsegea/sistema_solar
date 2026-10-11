
/* =====================================================================
   12. ARRANQUE (boot): cuerpos, poblaciones, texturas, bucle principal
   ===================================================================== */
function fatal(err) {
  const el = document.getElementById('fatal');
  el.style.display = 'block';
  el.textContent = 'ERROR FATAL · no se pudo iniciar la simulación\n\n' +
    (err && err.stack ? err.stack : String(err));
  document.getElementById('loading').classList.add('done');
  console.error(err);
}

function buildBodies() {
  for (const def of BODY_DEFS) {
    const b = new Body(def);
    Sim.byId[def.id] = b;
    Sim.bodies.push(b);
    if (def.parent) {
      const p = Sim.byId[def.parent];
      if (!p) throw new Error('padre desconocido: ' + def.parent);
      b.parent = p; p.children.push(b);
    }
    if (def.kind === 'star') Sim.sun = b;
    if (def.kind === 'comet') Sim.comets.push(b);
  }
  Sim.planets = Sim.bodies.filter(b => b.kind === 'planet');
}

function buildAllOrbits() {
  for (const b of Sim.bodies) {
    if (!b.def.table && !b.def.el) continue;
    if (b.kind === 'star') continue;
    buildOrbitPolyline(b, b.kind === 'comet' ? 420 : (b.kind === 'moon' ? 160 : 280));
  }
}

/* Perfil de anillos 1D (coincide con def.ring.inner / outer de cada planeta) */
const RING_NAMES = ['ringSaturn', 'ringJupiter', 'ringUranus', 'ringNeptune'];

const TEX_JOBS = [
  ['sky', texSky, 'vía láctea procedural'],
  ['sun', texSun, 'fotosfera solar (gránulos + manchas)'],
  ['mercury', () => texRocky(1101, [0.52, 0.50, 0.47], [0.21, 0.20, 0.19], 240, 0.055, false), 'Mercurio craterizado'],
  ['venus', texVenus, 'nubes venusinas en vórtice'],
  ['earth', texEarth, 'Tierra: continentes, hielos, luces nocturnas, nubes'],
  ['mars', texMars, 'Marte: dust, basalto, casquetes polares'],
  ['jupiter', () => texBanded(6001, 1024, 512, jupiterPalette, 0.16, drawGRS), 'Júpiter: bandas + Gran Mancha Roja'],
  ['saturn', () => texBanded(6101, 1024, 512, saturnPalette, 0.13, null), 'Saturno: bandas zonales'],
  ['uranus', () => texBanded(6201, 512, 256, (t) => uranusPalette(t), 0.06, null), 'Urano: neblina de metano'],
  ['neptune', () => texBanded(6301, 512, 256, neptunePalette, 0.09, drawNeptuneSpot), 'Neptuno: Gran Mancha Oscura'],
  ['pluto', texPluto, 'Plutón: Sputnik Planum'],
  ['ceres', () => texRocky(1201, [0.45, 0.43, 0.41], [0.19, 0.18, 0.17], 170, 0.06, false), 'Ceres'],
  ['moon', texMoon, 'Luna: mares + cráteres + rayos'],
  ['io', texIo, 'Ío: azufre y volcanes'],
  ['europa', texEuropa, 'Europa: lineae (grietas)'],
  ['ganymede', texGanymede, 'Ganímedes: terreno surcado'],
  ['callisto', texCallisto, 'Calisto: craterizado'],
  ['titan', texTitan, 'Titán: bruma de hidrocarburos'],
  ['rock', () => texRocky(1301, [0.55, 0.52, 0.48], [0.24, 0.23, 0.21], 190, 0.06, false), 'plantilla rocosa'],
  ['ice', () => texRocky(1401, [0.80, 0.83, 0.88], [0.44, 0.47, 0.54], 130, 0.05, true), 'plantilla helada'],
  ['coma', texComa, 'sprite de coma'],
  ['tail', texTail, 'sprite de cola'],
  ['glowSoft', texGlowSoft, 'glow suave'],
  ['glowWide', texGlowWide, 'glow ancho']
];
for (const n of RING_NAMES) TEX_JOBS.push([n, () => texRing1D(n), 'estructura de anillo 1D']);

function runTextureJobs(done) {
  let i = 0;
  const total = TEX_JOBS.length;
  const step = () => {
    const t0 = performance.now();
    while (i < total && performance.now() - t0 < 26) {          // ~26 ms por cuadro: UI fluida
      const [name, fn, msg] = TEX_JOBS[i];
      UI.els.loadMsg.textContent = 'textura procedural · ' + msg;
      const c = fn();
      if (name === 'earth') {
        R.tex.earth = R.texture(c.day, R.gl.REPEAT);
        R.tex.earthNight = R.texture(c.night, R.gl.REPEAT);
        R.tex.earthClouds = R.texture(c.clouds, R.gl.REPEAT);
      } else {
        R.tex[name] = R.texture(c, name === 'sky' ? R.gl.REPEAT : R.gl.CLAMP_TO_EDGE);
      }
      i++;
      UI.els.barFill.style.width = (100 * i / total).toFixed(1) + '%';
    }
    if (i < total) requestAnimationFrame(step);
    else done();
  };
  requestAnimationFrame(step);
}
function setupGLBuffers() {
  const gl = R.gl;
  const nPts = Sim.belts.ast.n + Sim.belts.ku.n + 8;
  Sim.belts.gpu = new Float32Array(nPts * 8);
  Sim.belts.buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, Sim.belts.buf);
  gl.bufferData(gl.ARRAY_BUFFER, nPts * 8 * 4, gl.DYNAMIC_DRAW);
  Sim.lineBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, Sim.lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, LinePool.data.length * 4, gl.DYNAMIC_DRAW);
  // mallas de anillos (en radios del planeta)
  for (const b of Sim.bodies) {
    if (!b.def.ring) continue;
    b.ringMesh = R.makeRingMesh(b.def.ring.inner, b.def.ring.outer, 128, 26);
  }
}

function render() {
  const gl = R.gl;
  R.resize();
  const aspect = R.W / Math.max(R.H, 1);
  const near = Math.max(Cam.dist * 0.0012, 1e-4);
  const far = Cam.dist * 60 + 1e6;
  mat4Perspective(R.proj, Cam.fov, aspect, near, far);
  mat4LookAt(R.view, Cam.eye, Cam.target, Cam.up);
  mat4Mul(R.vp, R.proj, R.view);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawSky();
  drawBodies();
  drawSunGlow();
  drawRings();
  drawAtmospheres();
  drawBelts();
  drawLines();
  drawComets();
}

let lastFrameT = 0;
let frameErrors = 0;
function frame(now) {
  /* El rAF se rearma SIEMPRE, fuera del try: si simulate()/render()/updateLabels() lanza,
     la animacion continuaba en el siguiente frame. Sin esto, una excepcion dentro de
     render() abortaba requestAnimationFrame(frame) y la pantalla se quedaba muerta. */
  try {
    const dt = Math.min((now - lastFrameT) / 1000, 0.1);
    lastFrameT = now;
    const t0 = performance.now();
    if (!Sim.paused && Sim.speed !== 0) simulate(Sim.speed * Sim.dir * dt);
    Sim.msPhysics = performance.now() - t0;
    Cam.update(dt);
    computeDisplayPositions();   // disp frescos: la coreografía ancla sobre la posición de ESTE frame
    tourUpdate(dt);              // coreografía del tour (09_tour.js) sobre la cámara ya integrada
    computeDisplayPositions();   // distCam/dispR/pxSize coherentes con el eye que el tour acaba de mover
    render();
    updateLabels();
    tourOverlay();               // tarjeta + marcador proyectado de la próxima parada
    Sim.msFrame = performance.now() - t0;
    Sim.fps = Sim.fps ? lerp(Sim.fps, 1 / Math.max(dt, 1e-4), 0.12) : 1 / Math.max(dt, 1e-4);
    if (now - UI.hudT > 120) {
      UI.hudT = now;
      updateHUD();
      if (Sim.selected) renderSheetLive(Sim.selected);
    }
  } catch (e) {
    frameErrors++;
    if (frameErrors <= 3) console.error('[frame ' + frameErrors + '] ' + ((e && e.stack) || e));
    else if (frameErrors === 4) console.error('[frame] silenciando errores posteriores (total: ' + frameErrors + ')');
  }
  requestAnimationFrame(frame);
}

function boot() {
  try {
    buildBodies();
    Sim.belts = {
      ast: makeBelt(BELT_AST_OPTS),
      ku: makeBelt(BELT_KUIPER_OPTS),
      visibleCount: 0
    };
    Sim.totalBodies = Sim.bodies.length + Sim.belts.ast.n + Sim.belts.ku.n;

    // fecha real de inicio
    const jdNow = Date.now() / 86400000 + 2440587.5;
    Sim.jd = jdNow; Sim.t = jdNow - J2000_JD;
    for (const b of Sim.bodies) { updateKepler(b, Sim.t); updateOrientation(b, Sim.t); }
    buildAllOrbits();

    if (!R.init(document.getElementById('gl'))) {
      throw new Error('WebGL no está disponible en este navegador. Se requiere un contexto WebGL 1.0.');
    }
    buildUI(); bindInput(R.canvas); bindKeys(); bindControls();
    setupGLBuffers();

    UI.els.rngSpeed.value = String(Math.round(sliderFromSpeed(1)));
    setSpeedFromSlider();
    UI.els.datePick.value = new Date().toISOString().slice(0, 10);
    selectBody(Sim.byId.earth, false);
    Cam.distTarget = 2600; Cam.dist = 2600;

    runTextureJobs(() => {
      updateHUD();
      UI.els.loading.classList.add('done');
      window.SOLAR = { Sim, Cam, R, UI, NBody, selectBody, resetView,
                       simulate, updateKepler, updateOrientation, buildAllOrbits, clearTrails,
                       Tour, TOUR_STOPS, tourStart, tourStop, tourToggle, tourGo };  // gancho de depuración
      lastFrameT = performance.now();
      requestAnimationFrame(frame);
    });

    window.addEventListener('resize', () => R.resize());
    document.addEventListener('visibilitychange', () => { lastFrameT = performance.now(); });
  } catch (e) { fatal(e); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();   // fin del IIFE
