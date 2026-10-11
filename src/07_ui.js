
/* =====================================================================
   11. INTERFAZ (HUD), ENTRADA, ETIQUETAS
   ===================================================================== */
const Input = {
  rotating: false, panning: false, zooming: false,
  measureMode: false, measureA: null,
  pointers: new Map(), lastX: 0, lastY: 0, moved: 0, pinchDist: 0,
  keys: new Set()
};
const UI = { els: Object.create(null), labels: [], listItems: Object.create(null), hudT: 0 };
const nf = (d) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const nf0 = nf(0), nf1 = nf(1), nf2 = nf(2), nf3 = nf(3), nf4 = nf(4);
function fmtSI(v, d) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(d === undefined ? 2 : d).replace('e+', 'e');
  return nf(d === undefined ? 2 : d).format(v);
}
function $(id) { return document.getElementById(id); }

function buildUI() {
  UI.els = {
    fps: $('fps'), mframe: $('mframe'), mphysics: $('mphysics'), mbodies: $('mbodies'),
    mdrawn: $('mdrawn'), menergy: $('menergy'), energyWrap: $('energyWrap'),
    modeBadge: $('modeBadge'), scaleBadge: $('scaleBadge'), scaleNote: $('scaleNote'),
    listMain: $('listMain'), listDwarf: $('listDwarf'), listMoon: $('listMoon'), listComet: $('listComet'),
    toggles: $('toggles'), infoName: $('infoName'), infoType: $('infoType'),
    infoStatic: $('infoStatic'), infoLive: $('infoLive'), info: $('info'), panel: $('panel'),
    dateText: $('dateText'), jdText: $('jdText'), speedText: $('speedText'), rngSpeed: $('rngSpeed'),
    datePick: $('datePick'), measure: $('measure'), labels: $('labels'),
    rngSize: $('rngSize'), valSize: $('valSize'), rngTrail: $('rngTrail'), valTrail: $('valTrail'),
    rngExp: $('rngExp'), valExp: $('valExp'), help: $('help'), loading: $('loading'),
    barFill: $('barFill'), loadMsg: $('loadMsg'), fatal: $('fatal'),
    btnPlay: $('btnPlay'), btnRev: $('btnRev'), btnToday: $('btnToday'), btnGo: $('btnGo'),
    btnFollow: $('btnFollow'), btnReset: $('btnReset'), btnTop: $('btnTop'),
    btnMeasure: $('btnMeasure'), btnHelp: $('btnHelp'), btnCloseHelp: $('btnCloseHelp'),
    btnTour: $('btnTour'), btnTourPrev: $('btnTourPrev'), btnTourPlay: $('btnTourPlay'),
    btnTourNext: $('btnTourNext'), btnTourExit: $('btnTourExit'),
    panelToggle: $('panelToggle'), infoToggle: $('infoToggle')
  };
  const KIND_LABEL = { star: 'estrella', planet: 'planeta', dwarf: 'planeta enano', moon: 'luna', comet: 'cometa' };
  const groups = { planet: UI.els.listMain, star: UI.els.listMain, dwarf: UI.els.listDwarf, moon: UI.els.listMoon, comet: UI.els.listComet };
  const hotkeys = { mercury: '1', venus: '2', earth: '3', mars: '4', jupiter: '5', saturn: '6', uranus: '7', neptune: '8', pluto: '9', sun: '0' };
  for (const b of Sim.bodies) {
    const row = document.createElement('div');
    row.className = 'bodyItem';
    row.dataset.id = b.id;
    const c = b.color;
    const rgb = 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
    row.innerHTML = '<span class="dot" style="background:' + rgb + ';color:' + rgb + '"></span>' +
      '<span class="nm">' + b.name + '</span>' +
      (hotkeys[b.id] ? '<span class="kb">' + hotkeys[b.id] + '</span>' : '');
    row.addEventListener('click', () => selectBody(b, false));
    row.addEventListener('dblclick', () => { selectBody(b, true); Cam.frameBody(b, 6); });
    groups[b.kind].appendChild(row);
    UI.listItems[b.id] = row;
  }
  /* interruptores de render */
  const TOGGLES = [
    ['showOrbits', 'Órbitas', 'O'], ['showLabels', 'Etiquetas', 'L'], ['showTrails', 'Estelas', 'K'],
    ['showBelts', 'Cinturones', 'B'], ['showComets', 'Cometas', 'C'], ['showRings', 'Anillos', 'G'],
    ['showStars', 'Vía Láctea', 'S'], ['showAtmo', 'Atmósferas', 'A']
  ];
  for (const [key, label, kb] of TOGGLES) {
    const row = document.createElement('div'); row.className = 'ctrl';
    row.innerHTML = '<div class="switch' + (Sim[key] ? ' on' : '') + '"></div><label>' + label +
      ' <span class="dim small">' + kb + '</span>';
    const sw = row.querySelector('.switch');
    const act = () => { Sim[key] = !Sim[key]; sw.classList.toggle('on', Sim[key]); };
    sw.addEventListener('click', act); row.querySelector('label').addEventListener('click', act);
    UI.els.toggles.appendChild(row);
    UI['tg_' + key] = act;
    UI['sw_' + key] = sw;          // el tour (09_tour.js) impone interruptores por parada
  }
  /* modo de simulación y de escala */
  const rowMode = document.createElement('div'); rowMode.className = 'ctrl';
  rowMode.innerHTML = '<div class="switch"></div><label>Integración N‑cuerpo <span class="dim small">N</span></label>';
  UI.els.toggles.appendChild(rowMode);
  const swMode = rowMode.querySelector('.switch');
  const actMode = () => { setNBody(!Sim.nbody); };
  swMode.addEventListener('click', actMode); rowMode.querySelector('label').addEventListener('click', actMode);
  UI.tg_nbody = actMode;
  UI.swNbody = swMode;              // setNBody() la necesita; antes se buscaba por indice [7]

  const rowScale = document.createElement('div'); rowScale.className = 'ctrl';
  rowScale.innerHTML = '<div class="switch"></div><label>Escala real (1 UA = 1000) <span class="dim small">D</span></label>';
  UI.els.toggles.appendChild(rowScale);
  const swScale = rowScale.querySelector('.switch');
  const actScale = () => {
    Sim.scaleMode = Sim.scaleMode === 'real' ? 'didactic' : 'real';
    swScale.classList.toggle('on', Sim.scaleMode === 'real');
    UI.els.scaleBadge.textContent = Sim.scaleMode === 'real' ? 'escala real' : 'escala didáctica';
    if (UI.els.scaleNote) UI.els.scaleNote.textContent = Sim.scaleMode === 'real'
      ? 'radios reales · distancia en escala real'
      : 'radios reales · distancia en escala didáctica';
    if (Sim.scaleMode === 'real') Cam.maxDist = 400000; else Cam.maxDist = 80000;
  };
  swScale.addEventListener('click', actScale); rowScale.querySelector('label').addEventListener('click', actScale);
  UI.tg_scale = actScale;

  /* etiquetas DOM para nombres de cuerpos */
  for (const b of Sim.bodies) {
    if (b.kind === 'star' || b.kind === 'planet' || b.kind === 'dwarf' || b.kind === 'comet' || b.kind === 'moon') {
      const d = document.createElement('div');
      d.className = 'lbl' + (b.kind === 'moon' ? ' moon' : '');
      d.textContent = b.name;
      d.style.display = 'none';
      UI.els.labels.appendChild(d);
      b.labelEl = d;
    }
  }
}

function setNBody(on) {
  Sim.nbody = on;
  UI.els.modeBadge.textContent = on ? 'N‑cuerpo · Velocity Verlet' : 'Kepler J2000';
  UI.els.modeBadge.classList.toggle('warn', on);
  UI.els.energyWrap.style.display = on ? '' : 'none';
  if (UI.swNbody) UI.swNbody.classList.toggle('on', on);
  if (on) { NBody.init(); NBody.lastT = Sim.t; } else { for (const b of Sim.bodies) updateKepler(b, Sim.t); }
}

/* Devuelve un Body a partir de un Body o de un id; null en cualquier otro caso.
   Funcion pura: es la puerta de entrada de window.SOLAR.selectBody(), que admite
   que el usuario pase un string ('earth') o un valor erroneo. */
function resolveBody(b) {
  if (b instanceof Body) return b;
  if (typeof b === 'string') return Sim.byId[b] || null;
  return null;
}

function selectBody(b, follow) {
  const body = resolveBody(b);
  // Un Sim.selected invalido revienta render() (drawLines lee sel.pos) y mataba la animacion.
  if (!body) { console.warn('selectBody: cuerpo no valido ->', b); return; }
  Sim.selected = body;
  for (const k in UI.listItems) UI.listItems[k].classList.toggle('active', Sim.bodies.find(x => x.id === k) === body);
  if (follow) { Cam.followBody = body; Cam.frameBody(body, 6); }
  renderSheetStatic(body);
  UI.els.info.classList.remove('collapsed');
}

function renderSheetStatic(b) {
  const d = b.def;
  UI.els.infoName.textContent = d.name;
  const KIND_LABEL = { star: 'estrella · enana amarilla G2V', planet: d.id === 'mercury' || d.id === 'venus' || d.id === 'earth' || d.id === 'mars' ? 'planeta rocoso' : 'planeta gigante', dwarf: 'planeta enano', moon: 'luna de ' + (Sim.byId[d.parent] ? Sim.byId[d.parent].name : '—'), comet: 'cometa periódico' };
  UI.els.infoType.textContent = KIND_LABEL[d.kind] || d.kind;
  const vol = 4 / 3 * Math.PI * Math.pow(d.radiusKm * 1000, 3);
  const dens = d.massKg / vol;
  const el = elementsOf(b, Sim.t, _el);
  const rows = [];
  const kv = (k, v, note) => rows.push('<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + (note ? ' <em>' + note + '</em>' : '') + '</span></div>');
  kv('Radio medio', nf0.format(d.radiusKm) + ' km', '⊕=' + nf2.format(d.radiusKm / 6371) + ' R⊕');
  kv('Masa', fmtSI(d.massKg, 3) + ' kg', fmtSI(d.massKg / SOLAR_MASS, 3) + ' M☉');
  kv('Densidad', nf1.format(dens) + ' kg/m³');
  kv('Gravedad superficial', nf2.format(d.gravity) + ' m/s²');
  kv('Velocidad de escape', nf1.format(Math.sqrt(2 * G_SI * d.massKg / (d.radiusKm * 1000))) + ' km/s');
  kv('Periodo de rotación', nf2.format(d.rotH) + ' h', d.obliquityDeg > 90 ? 'retrógrada' : 'directa');
  kv('Oblicuidad', nf2.format(d.obliquityDeg) + '°');
  kv('Temp. media', nf0.format(d.tempC) + ' °C');
  if (d.moons) kv('Lunas conocidas', String(d.moons));
  kv('Semieje mayor a', nf4.format(el.a) + ' UA', nf0.format(el.a * AU_KM) + ' km');
  kv('Excentricidad e', nf4.format(el.e));
  kv('Inclinación i', nf2.format(el.i * RAD) + '°');
  kv('Nodo Ω', nf2.format(el.om * RAD) + '°');
  kv('Perihelio ω', nf2.format(el.w * RAD) + '°');
  kv('Periodo orbital', el.n > 0 ? nf2.format(TAU / el.n) + ' d' : '—', el.n > 0 ? nf3.format(TAU / el.n / JULIAN_YEAR) + ' años' : '');
  kv('Anillo', d.ring ? 'sí (' + nf2.format(d.ring.inner) + '–' + nf2.format(d.ring.outer) + ' R)' : 'no');
  UI.els.infoStatic.innerHTML = rows.join('');
}

function renderSheetLive(b) {
  const rows = [];
  const kv = (k, v, note) => rows.push('<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + (note ? ' <em>' + note + '</em>' : '') + '</span></div>');
  const rSun = hypot3(b.pos[0], b.pos[1], b.pos[2]);
  const earth = Sim.byId.earth;
  const rEarth = hypot3(b.pos[0] - earth.pos[0], b.pos[1] - earth.pos[1], b.pos[2] - earth.pos[2]);
  const el = elementsOf(b, Sim.t, _el);
  const gmParent = b.kind === 'moon' ? (b.parent.gm || GM_SUN) : GM_SUN;
  const rRef = b.kind === 'moon' ? hypot3(b.local[0], b.local[1], b.local[2]) : rSun;
  /* En modo N-cuerpo la velocidad real es la integrada por Verlet: la vis-viva
     kepleriana ignoraria las perturbaciones que precisamente se estan simulando. */
  const integrada = Sim.nbody && b.integrated;
  const vOrb = integrada ? hypot3(b.vel[0], b.vel[1], b.vel[2])
    : (el.a > 0 ? Math.sqrt(Math.max(0, gmParent * (2 / rRef - 1 / el.a))) : 0);   // vis-viva [UA/día]
  const vKms = vOrb * AU_KM / 86400;
  kv('Distancia al Sol', nf4.format(rSun) + ' UA', nf0.format(rSun * AU_KM) + ' km');
  kv('Distancia a la Tierra', nf4.format(rEarth) + ' UA', 'luz ' + nf2.format(rEarth * AU_KM / C_KM_S / 60) + ' min');
  if (b.kind === 'moon') {
    const rp = hypot3(b.local[0], b.local[1], b.local[2]);
    kv('Distancia a ' + b.parent.name, nf0.format(rp * AU_KM) + ' km', nf3.format(rp * AU_KM / b.parent.radiusKm) + ' R');
  }
  kv('Velocidad orbital', nf2.format(vKms) + ' km/s', nf3.format(vOrb) + ' UA/día' + (integrada ? ' · integrada N-cuerpo' : ' · vis-viva'));
  kv('Radio vector', nf4.format(rRef) + ' UA');
  kv('Ángulo polar ν', nf1.format(Math.atan2(b.pos[1], b.pos[0]) * RAD >= 0 ? Math.atan2(b.pos[1], b.pos[0]) * RAD : Math.atan2(b.pos[1], b.pos[0]) * RAD + 360) + '° eclíptico');
  const anomaly = 't = ' + nf1.format(Sim.t) + ' d desde J2000';
  kv('Estado', Sim.paused ? 'pausado' : (Sim.dir > 0 ? 'avanzando' : 'retrocedendo'), anomaly);
  UI.els.infoLive.innerHTML = rows.join('');
}

function updateHUD() {
  UI.els.fps.textContent = nf0.format(Sim.fps);
  UI.els.mframe.textContent = nf1.format(Sim.msFrame) + ' ms';
  UI.els.mphysics.textContent = nf1.format(Sim.msPhysics) + ' ms';
  UI.els.mbodies.textContent = nf0.format(Sim.totalBodies);
  UI.els.mdrawn.textContent = nf0.format(Sim.drawnCount + Sim.belts.visibleCount);
  if (Sim.nbody) {
    UI.els.menergy.textContent = (NBody.drift >= 0 ? '+' : '') + (NBody.drift * 100).toPrecision(2) + ' %';
    UI.els.menergy.style.color = Math.abs(NBody.drift) < 1e-4 ? 'var(--good)' : (Math.abs(NBody.drift) < 1e-2 ? 'var(--accent-2)' : 'var(--warn)');
  }
  UI.els.dateText.textContent = fmtDate(Sim.jd);
  UI.els.jdText.textContent = 'JD ' + nf1.format(Sim.jd);
  const s = Math.abs(Sim.speed);
  UI.els.speedText.textContent = (Sim.dir < 0 ? '−' : '') +
    (s >= JULIAN_YEAR ? nf2.format(s / JULIAN_YEAR) + ' años/s'
     : s >= 1         ? nf1.format(s) + ' d/s'
     : s >= 1e-4      ? nf3.format(s) + ' d/s'
     :                 nf0.format(s * 86400) + ' s/s');
  const m = Sim.measureA && Sim.measureB;
  if (m) {
    const dx = Sim.measureA.pos[0] - Sim.measureB.pos[0], dy = Sim.measureA.pos[1] - Sim.measureB.pos[1], dz = Sim.measureA.pos[2] - Sim.measureB.pos[2];
    const r = hypot3(dx, dy, dz);
    UI.els.measure.textContent = 'A↔B  ' + Sim.measureA.name + ' → ' + Sim.measureB.name + '   ' +
      nf3.format(r) + ' UA  ·  ' + nf0.format(r * AU_KM) + ' km  ·  luz ' + nf2.format(r * AU_KM / C_KM_S / 60) + ' min' +
      (Input.measureMode ? '  (M para salir)' : '');
    UI.els.measure.classList.add('show');
  } else UI.els.measure.classList.remove('show');
}

/* Proyección de un punto de visualización a coordenadas CSS [px] */
const _clip = new Float32Array(4);
function project(x, y, z) {
  const m = R.vp;
  _clip[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  _clip[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  _clip[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  _clip[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (_clip[3] <= 0) return null;
  const nx = _clip[0] / _clip[3], ny = _clip[1] / _clip[3];
  return [ (nx * 0.5 + 0.5) * R.canvas.clientWidth, (1 - (ny * 0.5 + 0.5)) * R.canvas.clientHeight ];
}
const labelCells = new Set();
function updateLabels() {
  labelCells.clear();
  const show = Sim.showLabels;
  const cw = R.canvas.clientWidth, ch = R.canvas.clientHeight;
  for (const b of Sim.bodies) {
    const el = b.labelEl; if (!el) continue;
    if (!show) { el.style.display = 'none'; continue; }
    const minPx = b.kind === 'moon' ? 3.2 : (b.kind === 'comet' ? 1.2 : 1.0);
    if (b.pxSize < minPx) { el.style.display = 'none'; continue; }
    const p = project(b.disp[0], b.disp[1], b.disp[2]);
    if (!p || p[0] < -40 || p[0] > cw + 40 || p[1] < -20 || p[1] > ch + 20) { el.style.display = 'none'; continue; }
    const cellKey = Math.round(p[0] / 110) + ':' + Math.round(p[1] / 20);
    if (labelCells.has(cellKey) && b !== Sim.selected) { el.style.display = 'none'; continue; }
    labelCells.add(cellKey);
    el.style.display = 'block';
    el.style.left = p[0].toFixed(0) + 'px';
    el.style.top = p[1].toFixed(0) + 'px';
    el.classList.toggle('sel', b === Sim.selected);
  }
}

/* ---------- selección por clic en el canvas ---------- */
function pickAt(cx, cy) {
  let best = null, bestScore = 1e9;
  for (const b of Sim.bodies) {
    const p = project(b.disp[0], b.disp[1], b.disp[2]);
    if (!p) continue;
    const d = Math.hypot(p[0] - cx, p[1] - cy);
    const hit = Math.max(b.pxSize * 1.3, 14);
    if (d >= hit) continue;
    /* Puntuación: distancia redondeada a píxeles (dos cuerpos que caen en el mismo
       píxel empatan) con desempate a favor del cuerpo de mayor tamaño aparente y una
       pequeña penalización a las lunas: a escala amplia una luna diminuta no le roba
       la selección al planeta, pero pinchando con precisión sí se elige. */
    let score = Math.round(d) - (b.pxSize || 0) * 0.5 + (b.parent ? 2 : 0);
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/* ---------- entrada de ratón / táctil ---------- */
function bindInput(canvas) {
  const el = canvas;
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    Input.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    Input.lastX = e.clientX; Input.lastY = e.clientY; Input.moved = 0;
    if (e.button === 2 || e.shiftKey) Input.panning = true; else Input.rotating = true;
    Input.zooming = false;
    if (Input.pointers.size === 2) {
      const pts = [...Input.pointers.values()];
      Input.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      Input.rotating = false; Input.zooming = true;
    }
  });
  el.addEventListener('pointermove', e => {
    if (!Input.pointers.has(e.pointerId)) return;
    Input.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (Input.pointers.size === 2) {
      const pts = [...Input.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (Input.pinchDist > 0) Cam.zoomBy(Input.pinchDist / Math.max(d, 1));
      Input.pinchDist = d;
      return;
    }
    const dx = e.clientX - Input.lastX, dy = e.clientY - Input.lastY;
    Input.lastX = e.clientX; Input.lastY = e.clientY;
    Input.moved += Math.abs(dx) + Math.abs(dy);
    if (Math.abs(dx) + Math.abs(dy) > 2) tourTakeOver();
    if (Input.panning) {
      Cam.panBy(dx, dy);
      Cam.followBody = null;
    } else if (Input.rotating) {
      const dyaw = -dx * 0.0055, dpitch = dy * 0.0055;
      Cam.yaw += dyaw; Cam.pitch += dpitch;
      Cam.vYaw = dyaw * 12; Cam.vPitch = dpitch * 12;
    }
  });
  const endPointer = e => {
    if (Input.pointers.has(e.pointerId)) Input.pointers.delete(e.pointerId);
    if (Input.pointers.size < 2) { Input.zooming = false; Input.pinchDist = 0; }
    if (Input.pointers.size === 0) {
      const wasDrag = Input.moved > 6;
      Input.rotating = false; Input.panning = false;
      if (!wasDrag && e.type === 'pointerup' && e.button === 0) {
        const rect = el.getBoundingClientRect();
        const b = pickAt(e.clientX - rect.left, e.clientY - rect.top);
        if (b) {
          if (Input.measureMode) {
            if (!Input.measureA) { Input.measureA = b; Sim.measureA = b; Sim.measureB = b; }
            else { Sim.measureB = b; Input.measureA = null; Input.measureMode = false; UI.els.btnMeasure.classList.remove('on'); }
          } else selectBody(b, false);
        }
      }
    }
  };
  el.addEventListener('pointerup', endPointer);
  el.addEventListener('pointercancel', endPointer);
  el.addEventListener('wheel', e => {
    e.preventDefault();
    tourTakeOver();
    const f = Math.exp((e.deltaY > 0 ? 1 : -1) * Math.min(Math.abs(e.deltaY), 120) * 0.0016);
    Cam.zoomBy(f);
  }, { passive: false });
}

/* ---------- teclado ---------- */
/* Velocidad: slider 0..100 <-> [1 s/s .. 100 anios/s] en escala logaritmica.
   Sim.speed esta en dias simulados por segundo real. */
const SPEED_MIN = 1 / 86400;             // 1 s/s      [d/s]
const SPEED_MAX = 100 * JULIAN_YEAR;     // 100 anios/s [d/s]
const SPEED_SPAN = SPEED_MAX / SPEED_MIN; // 3,15576e9
function speedFromSlider(v) { return SPEED_MIN * Math.pow(SPEED_SPAN, v / 100); }
function sliderFromSpeed(s) { return clamp(100 * Math.log(Math.max(s, SPEED_MIN) / SPEED_MIN) / Math.log(SPEED_SPAN), 0, 100); }
function setSpeedFromSlider() {
  Sim.speed = speedFromSlider(parseFloat(UI.els.rngSpeed.value));
}
function nudgeSpeed(steps) {
  UI.els.rngSpeed.value = String(clamp(parseFloat(UI.els.rngSpeed.value) + steps, 0, 100));
  setSpeedFromSlider();
}
function bindKeys() {
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    const b = Sim.selected;
    switch (k) {
      case ' ': case 'spacebar': e.preventDefault(); togglePause(); break;
      case '+': case '=': nudgeSpeed(+4); break;
      case '-': case '_': nudgeSpeed(-4); break;
      case ',': nudgeSpeed(-1); break;
      case '.': nudgeSpeed(+1); break;
      case 'arrowleft': tourTakeOver(); Cam.yaw -= 0.06; e.preventDefault(); break;
      case 'arrowright': tourTakeOver(); Cam.yaw += 0.06; e.preventDefault(); break;
      case 'arrowup': tourTakeOver(); Cam.pitch = clamp(Cam.pitch + 0.05, -88 * DEG, 88 * DEG); e.preventDefault(); break;
      case 'arrowdown': tourTakeOver(); Cam.pitch = clamp(Cam.pitch - 0.05, -88 * DEG, 88 * DEG); e.preventDefault(); break;
      case 'f': if (b) { Cam.followBody = (Cam.followBody === b) ? null : b; UI.els.btnFollow.classList.toggle('on', Cam.followBody === b); } break;
      case 'escape': if (Tour.active) tourStop();
        Cam.followBody = null; Input.measureMode = false; Sim.measureA = Sim.measureB = null;
        UI.els.btnFollow.classList.remove('on'); UI.els.btnMeasure.classList.remove('on'); closeHelp(); break;
      case 'r': resetView(); break;
      case 't': Cam.pitch = 88 * DEG; Cam.followBody = null; Cam.distTarget = Math.max(Cam.distTarget, Sim.scaleMode === 'real' ? 62000 : 12000); break;   // cenital de vista general: nunca acerca
      case 'h': toggleHelp(); break;
      case 'v': tourToggle(); break;
      case '[': tourPrev(); break;
      case ']': tourNext(); break;
      case 'o': UI.tg_showOrbits(); break;
      case 'l': UI.tg_showLabels(); break;
      case 'k': UI.tg_showTrails(); break;
      case 'b': UI.tg_showBelts(); break;
      case 'c': UI.tg_showComets(); break;
      case 'g': UI.tg_showRings(); break;
      case 's': UI.tg_showStars(); break;
      case 'a': UI.tg_showAtmo(); break;
      case 'd': UI.tg_scale(); break;
      case 'n': UI.tg_nbody(); break;
      case 'm': Input.measureMode = !Input.measureMode; Input.measureA = null;
        if (!Input.measureMode) { Sim.measureA = Sim.measureB = null; }
        UI.els.btnMeasure.classList.toggle('on', Input.measureMode); break;
      case 'p': UI.els.panel.classList.toggle('collapsed'); break;
      case 'i': UI.els.info.classList.toggle('collapsed'); break;
      case 'j': goToday(); break;
      default:
        if (k >= '0' && k <= '9') { const id = k === '0' ? 'sun' : ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'][parseInt(k, 10) - 1]; if (Sim.byId[id]) selectBody(Sim.byId[id], true); }
    }
  });
}
function togglePause() {
  Sim.paused = !Sim.paused;
  UI.els.btnPlay.textContent = Sim.paused ? '▶' : '⏸';
  UI.els.btnPlay.classList.toggle('on', Sim.paused);
}
function resetView() {
  Cam.followBody = null; Cam.yaw = 0.85; Cam.pitch = 0.42;
  Cam.pan[0] = Cam.pan[1] = Cam.pan[2] = 0;
  Cam.lookAt(Sim.sun.disp[0], Sim.sun.disp[1], Sim.sun.disp[2]);
  Cam.target[0] = Sim.sun.disp[0]; Cam.target[1] = Sim.sun.disp[1]; Cam.target[2] = Sim.sun.disp[2];
  Cam.distTarget = Sim.scaleMode === 'real' ? 62000 : 12000;
  UI.els.btnFollow.classList.remove('on');
}
function toggleHelp() { UI.els.help.classList.toggle('show'); }
function closeHelp() { UI.els.help.classList.remove('show'); }
function goToday() {
  const now = Date.now();
  const jd = now / 86400000 + 2440587.5;
  Sim.t = jd - J2000_JD; Sim.jd = jd; clearTrails();
  if (Sim.nbody) { NBody.reset(); NBody.lastT = Sim.t; }
  for (const b of Sim.bodies) { updateKepler(b, Sim.t); updateOrientation(b, Sim.t); }
  buildAllOrbits();
  UI.els.datePick.value = new Date(now).toISOString().slice(0, 10);
}
function bindControls() {
  UI.els.btnPlay.addEventListener('click', togglePause);
  UI.els.btnRev.addEventListener('click', () => { Sim.dir *= -1; UI.els.btnRev.classList.toggle('on', Sim.dir < 0); });
  UI.els.btnToday.addEventListener('click', goToday);
  UI.els.btnGo.addEventListener('click', () => {
    const v = UI.els.datePick.value; if (!v) return;
    const [Y, M, D] = v.split('-').map(s => parseInt(s, 10));
    const jd = gregorianToJD(Y, M, D) - 0.5;   // gregorianToJD devuelve mediodia (JD .0); -0.5 = 00h UTC del dia elegido
    Sim.t = jd - J2000_JD; Sim.jd = jd; clearTrails();
    if (Sim.nbody) { NBody.reset(); NBody.lastT = Sim.t; }
    for (const b of Sim.bodies) { updateKepler(b, Sim.t); updateOrientation(b, Sim.t); }
    buildAllOrbits();
  });
  UI.els.rngSpeed.addEventListener('input', setSpeedFromSlider);
  UI.els.rngSize.addEventListener('input', () => { Sim.minPxSize = parseInt(UI.els.rngSize.value, 10); UI.els.valSize.textContent = UI.els.rngSize.value; });
  UI.els.rngTrail.addEventListener('input', () => { Sim.trailLen = parseInt(UI.els.rngTrail.value, 10); UI.els.valTrail.textContent = UI.els.rngTrail.value; });
  UI.els.rngExp.addEventListener('input', () => { Sim.sizeExagg = parseInt(UI.els.rngExp.value, 10); UI.els.valExp.textContent = UI.els.rngExp.value + '×'; });
  UI.els.btnFollow.addEventListener('click', () => {
    const b = Sim.selected; if (!b) return;
    Cam.followBody = (Cam.followBody === b) ? null : b;
    if (Cam.followBody) Cam.frameBody(b, 6);
    UI.els.btnFollow.classList.toggle('on', Cam.followBody === b);
  });
  UI.els.btnReset.addEventListener('click', resetView);
  UI.els.btnTop.addEventListener('click', () => { Cam.pitch = 88 * DEG; });
  UI.els.btnMeasure.addEventListener('click', () => {
    Input.measureMode = !Input.measureMode; Input.measureA = null;
    if (!Input.measureMode) { Sim.measureA = Sim.measureB = null; }
    UI.els.btnMeasure.classList.toggle('on', Input.measureMode);
  });
  UI.els.btnHelp.addEventListener('click', toggleHelp);
  UI.els.btnCloseHelp.addEventListener('click', closeHelp);
  /* tour guiado (09_tour.js) */
  UI.els.btnTour.addEventListener('click', tourToggle);
  UI.els.btnTourPrev.addEventListener('click', tourPrev);
  UI.els.btnTourNext.addEventListener('click', tourNext);
  UI.els.btnTourPlay.addEventListener('click', tourPauseToggle);
  UI.els.btnTourExit.addEventListener('click', tourStop);
  UI.els.help.addEventListener('click', e => { if (e.target === UI.els.help) closeHelp(); });
  UI.els.panelToggle.addEventListener('click', () => UI.els.panel.classList.toggle('collapsed'));
  UI.els.infoToggle.addEventListener('click', () => UI.els.info.classList.toggle('collapsed'));
}
