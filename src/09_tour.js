/* =====================================================================
   09_tour.js — TOUR GUIADO DEL SISTEMA SOLAR
   Un recorrido de 16 paradas con coreografía de cámara, saltos de fecha y
   narración. No añade física nueva: usa las efemérides de 04_textures.js
   (updateKepler), la escala del render (mapDist / mapRadius) y la cámara
   orbital de 06_scene.js. La tarjeta de narración y la ruta 3D son capa UI.

   Esquema de una parada:
     body      id del cuerpo foco (el Sol = origen del sistema)
     dist      {au: x} distancia de cámara en UA  -> mapDist() en escala didáctica
               {mult: x} múltiplo del radio visual del cuerpo (funciona en ambas escalas)
               {pair: id, k} encuadre del par planeta-luna: distancia para que la
               separación visual real entre ambos quepa en el campo (k < 1)
     yawOff    ángulo de cámara relativo a la dirección cuerpo→Sol [rad]
               0 = cámara entre el Sol y el cuerpo: disco completamente iluminado
               π/2 = vista lateral (media fase), π = cámara al lado opuesto (contraluz)
     pitch     elevación sobre la eclíptica [rad]
     dwellZoom alejamiento progresivo durante la parada (factor sobre dist)
     spin      deriva angular de cámara durante la parada [rad/s]
     speed     velocidad de simulación [día/s] durante la parada
     date      'today' o 'AAAA-MM-DD': salto de fecha al entrar en la parada
     on        interruptores de Sim que la parada impone
   ===================================================================== */

const TOUR_STOPS = [
  {
    body: 'sun', dist: { au: 45 }, pitch: 0.62, yawOff: 0.9, travel: 6, dwell: 15,
    speed: 30, date: 'today', spin: 0.012,
    on: { showOrbits: true, showBelts: true, showComets: true, showLabels: true, showTrails: false },
    title: 'Un sistema, 5630 cuerpos', kicker: 'parada 00 · punto de partida',
    text: 'Todo lo que se mueve aquí sale de dos reglas: posición kepleriana en la época J2000 y velocidad vis-viva. Órbitas, estelas, colas de cometa y eclipses no están dibujados a mano: se derivan de esos dos cálculos, cuerpo a cuerpo y frame a frame.',
    chips: ['5630 cuerpos', '1800 – 2050', 'escala radial r^0,62', 'fecha: hoy']
  },
  {
    body: 'sun', dist: { mult: 10 }, pitch: 0.12, yawOff: 0, travel: 5, dwell: 14,
    speed: 1, spin: 0.02,
    title: 'El Sol', kicker: '99,86 % de la masa del sistema',
    text: 'Es el único cuerpo que no orbita: los demás giran alrededor de su baricentro. 696.340 km de radio, 5505 °C en la fotosfera y una rotación de ~609 h. Su luz tarda 8,3 minutos en llegar a la Tierra y 4,1 horas a Neptuno.',
    chips: ['R = 696.340 km', 'M = 1,989·10³⁰ kg', 'rotación 609 h', '5505 °C']
  },
  {
    body: 'mercury', dist: { mult: 9 }, dwellZoom: 55, pitch: 0.35, yawOff: 0.55, travel: 5, dwell: 17,
    speed: 0.5,
    title: 'Mercurio', kicker: 'la órbita más excéntrica de los planetas',
    text: 'e = 0,206: su distancia al Sol oscila entre 0,467 y 0,307 UA. La cámara se aleja al final de la parada para que veas la elipse completa y el Sol fuera del centro. Completa una vuelta en 88 días, pero su día solar dura 176 días: dos años mercurianos por cada tres rotaciones.',
    chips: ['a = 0,387 UA', 'e = 0,206', 'P = 88 d', 'día solar 176 d']
  },
  {
    body: 'venus', dist: { mult: 8 }, pitch: 0.2, yawOff: 0.9, travel: 5, dwell: 15,
    speed: 1, spin: 0.008,
    title: 'Venus', kicker: 'gira al revés, y más despacio de lo que avanza',
    text: 'Oblicuidad 177,4°: rotación retrógrada de 243 días, más lenta que su año de 224,7 días, así que un día solar venusiano dura 117 días terrestres. Sin lunas y sin campo magnético medible; superficie a 464 °C bajo una atmósfera de CO₂.',
    chips: ['rotación 243 d retrógrada', 'oblicuidad 177,4°', '464 °C', '0 lunas']
  },
  {
    body: 'earth', dist: { pair: 'moon', k: 0.8 }, pitch: 0.22, yawOff: 0.75, travel: 5, dwell: 17,
    speed: 0.5,
    title: 'Tierra y la Luna', kicker: 'un sistema, no un planeta',
    text: 'La Luna está a 384.748 km —1,28 segundos de luz— y su órbita está inclinada 5,15° respecto a la eclíptica. Por eso no hay un eclipse cada mes: solo cuando la Luna cruza la línea de los nodos. Aquí la Luna avanza a 0,5 d/s: se ve recorrer su órbita.',
    chips: ['Luna 384.748 km', 'i = 5,15°', 'oblicuidad 23,44°', '1,28 s de luz']
  },
  {
    body: 'mars', dist: { mult: 10 }, dwellZoom: 45, pitch: 0.3, yawOff: 0.6, travel: 5, dwell: 17,
    speed: 0.01,
    title: 'Marte', kicker: 'un año de 687 días y estaciones dobles',
    text: 'e = 0,093: entre 1,38 y 1,67 UA, y su velocidad orbital cambia un 15 % entre perihelio y afelio siguiendo vis-viva. Con 25,19° de oblicuidad tiene estaciones como las de la Tierra, pero el doble de largas.',
    chips: ['a = 1,524 UA', 'e = 0,093', 'P = 687 d', 'día 24,62 h']
  },
  {
    body: 'sun', dist: { au: 3.4 }, pitch: 0.32, yawOff: 1.4, travel: 6, dwell: 17,
    speed: 8, on: { showBelts: true, showTrails: false },
    title: 'El cinturón principal', kicker: '3600 cuerpos y cinco lagunas',
    text: 'Entre 2,06 y 3,38 UA. Las lagunas de Kirkwood caen en 2,06 · 2,50 · 2,83 · 2,96 · 3,28 UA: resonancias 4:1, 3:1, 5:2, 7:3 y 2:1 con Júpiter. La simulación no integra 3600 N-cuerpos: cada grano avanza su propia anomalía media, M = M₀ + n·t.',
    chips: ['3600 asteroides', '2,06 – 3,38 UA', 'lagunas 4:1 … 2:1', 'keplerianos, no N-cuerpo']
  },
  {
    body: 'jupiter', dist: { pair: 'callisto', k: 0.8 }, pitch: 0.18, yawOff: 0.8, travel: 6, dwell: 19,
    speed: 0.5,
    title: 'Júpiter y las galileanas', kicker: 'Io, Europa, Ganimedes y Calisto',
    text: 'Júpiter concentra 2,82·10²⁷ kg: más del doble que todos los demás planetas juntos. Io completa una vuelta en 1,77 días y Calisto en 16,7. Con la simulación a media velocidad se ve el baile completo de las cuatro lunas.',
    chips: ['2,82·10²⁷ kg', 'Io 1,77 d', 'Calisto 1,88·10⁶ km', '95 lunas conocidas']
  },
  {
    body: 'saturn', dist: { pair: 'titan', k: 0.7 }, pitch: 0.3, yawOff: 1.0, travel: 6, dwell: 17,
    speed: 0.04, date: '2032-08-01',
    title: 'Saturno', kicker: 'salto de fecha · anillos muy abiertos · 2032',
    text: 'El sistema de anillos se dibuja entre 1,16 y 2,92 radios ecuatoriales, en el plano ecuatorial del planeta: inclinan 26,7° con él y cambian de aspecto según la época. Titán, a 1,22·10⁶ km, es la única luna del sistema con atmósfera densa.',
    chips: ['anillos 1,16 – 2,92 R', 'oblicuidad 26,7°', 'Titán 1,22·10⁶ km', 'día 10,56 h']
  },
  {
    body: 'uranus', dist: { mult: 12 }, pitch: 0.1, yawOff: 0.8, travel: 5, dwell: 15,
    speed: 1.5, spin: 0.02,
    title: 'Urano, tumbado', kicker: '97,77° de oblicuidad',
    text: 'Urano rueda por su órbita: su eje está casi en el plano de la eclíptica, así que los anillos aparecen verticales y cada polo pasa 42 años a la luz y 42 a la sombra. Su rotación también es retrógrada.',
    chips: ['oblicuidad 97,77°', 'rotación 17,24 h retrógrada', 'anillos 1,64 – 2,00 R', '1,59 m/s²']
  },
  {
    body: 'neptune', dist: { pair: 'triton', k: 1.05 }, pitch: 0.24, yawOff: 0.9, travel: 6, dwell: 17,
    speed: 0.6,
    title: 'Neptuno y Tritón', kicker: 'una luna que orbita al revés',
    text: 'Tritón tiene 156,9° de inclinación: orbita en sentido retrógrado, en contra de la rotación de Neptuno — la firma de una captura. Su periodo, 5,88 días, es más corto que el día del planeta (16,1 h), así que se levanta por el oeste.',
    chips: ['Tritón i = 156,9°', 'retrógrado', 'P = 5,88 d', '11,15 m/s²']
  },
  {
    body: 'pluto', dist: { pair: 'charon', k: 1.1 }, pitch: 0.3, yawOff: 0.7, travel: 5, dwell: 17,
    speed: 0.2,
    title: 'Plutón y Caronte', kicker: 'un binario y una órbita cruzada',
    text: 'e = 0,249 e i = 12,2°: Plutón penetra en la órbita de Neptuno (perihelio 29,7 UA frente a afelio neptuniano 30,4 UA), pero la resonancia 3:2 lo mantiene siempre a salvo del encuentro. Caronte orbita en el plano ecuatorial, a 19.591 km, y el baricentro del par está fuera de Plutón.',
    chips: ['e = 0,249', 'i = 12,2°', 'resonancia 3:2', 'Caronte 19.591 km']
  },
  {
    body: 'sun', dist: { au: 45 }, pitch: 0.5, yawOff: 2.4, travel: 7, dwell: 17,
    speed: 300, on: { showBelts: true, showComets: true },
    title: 'El cinturón de Kuiper', kicker: 'la reserva de los cometas',
    text: '2000 cuerpos entre 35 y 50 UA, con inclinaciones de hasta 25°, más allá de Neptuno. Es el almacén del que salen los cometas de período corto. La cámara está a 45 UA: Neptuno queda a 11 UA y el Sol, casi una estrella más.',
    chips: ['2000 objetos Kuiper', '35 – 50 UA', 'i ≤ 25°', 'origen de los cometas']
  },
  {
    body: 'halley', dist: { au: 1.2 }, pitch: 0.25, yawOff: 1.5, travel: 6, dwell: 19,
    speed: 0.02, date: '1986-02-09 02:00', on: { showComets: true, showTrails: true },
    title: '1P/Halley en su perihelio', kicker: 'salto de fecha · 9 de febrero de 1986',
    text: 'La simulación viaja al último perihelio de Halley. A 0,586 UA del Sol su actividad se dispara y la cola iónica, siempre anti-solar, se estira mientras la de polvo se curva porque cada grano sigue su propia elipse. La velocidad en el perihelio sale de vis-viva: 54,6 km/s.',
    chips: ['e = 0,967', 'q = 0,586 UA', 'v perihelio 54,6 km/s', 'P = 75,3 años']
  },
  {
    body: 'earth', dist: { pair: 'moon', k: 1.05 }, pitch: 0.05, yawOff: Math.PI / 2, travel: 6, dwell: 17,
    speed: 0.004, date: '2027-08-02 10:00',
    title: 'Eclipse total de Sol', kicker: 'salto de fecha · 2 de agosto de 2027',
    text: 'Vista lateral: el Sol queda a un lado y la Luna pasa entre el Sol y el disco iluminado de la Tierra. No es un dibujo: es la consecuencia de que la Luna esté cerca de su nodo ascendente. La totalidad de este eclipse durará 6 min 23 s sobre el sur de España.',
    chips: ['Luna cerca del nodo', 'elongación ~0°', 'totalidad 6 min 23 s', 'sombra ~250 km']
  },
  {
    body: 'sun', dist: { au: 60 }, pitch: 1.15, yawOff: 0.6, travel: 8, dwell: 20,
    speed: 30, date: 'today', spin: 0.01,
    on: { showOrbits: true, showBelts: true, showComets: true, showLabels: true, showTrails: false },
    title: 'El sistema desde 60 UA', kicker: 'final del tour · el turno es tuyo',
    text: 'De vuelta a la fecha de hoy y con la cámara casi cenital. A partir de aquí: arrastra para orbitar, rueda para acercar, clic en un cuerpo para seguirlo, y N para integrar de verdad los 17 cuerpos que se afectan entre sí. Esc cierra el tour en cualquier momento.',
    chips: ['60 UA de altura', '17 cuerpos integrados', 'arrastre · rueda · clic', 'N = N-cuerpo']
  }
];

const Tour = {
  active: false, paused: false, manual: false,
  i: 0, stop: null, body: null, phase: 'idle', t: 0, elapsed: 0, total: 0,
  yaw0: 0, yaw1: 0, pitch0: 0, pitch1: 0, dist0: 1, dist1: 1,
  tgt0: new Float64Array(3),
  els: null, dots: [], nextEl: null, card: -1
};

/* ---- utilidades del guion ---- */
const tourTodayJD = () => Date.now() / 86400000 + 2440587.5;

function tourDateJD(spec) {
  if (!spec) return null;
  if (spec === 'today') return tourTodayJD();
  const p = spec.split(' ');                          // 'AAAA-MM-DD [HH:MM]'
  const d = p[0].split('-');
  let h = 0, m = 0;
  if (p[1]) { const t = p[1].split(':'); h = +t[0] || 0; m = +t[1] || 0; }
  return gregorianToJD(+d[0], +d[1], +d[2]) - 0.5 + h / 24 + m / 1440;   // gregorianToJD da mediodia: -0,5 = 00h UTC
}

/* Etiqueta legible de la fecha del guion para la tarjeta */
function tourDateLabel(spec) {
  if (spec === 'today') return 'la fecha de hoy';
  const g = jdToGregorian(tourDateJD(spec));
  return g.day + ' ' + MONTHS[g.month - 1] + ' ' + g.year;
}

/* Distancia de cámara de una parada, en unidades de visualización.
   {au} se mapea con mapDist() para que la misma parada encuadre igual en
   escala real y en escala didáctica; {mult} es relativo al radio visual.
   Se usa displayRadiusOf(), no b.dispR: dispR lleva el inflado del suelo de
   minPxSize, que depende de la distancia a la que estaba la cámara al entrar.
   {pair} encuadra un planeta con una de sus lunas: la distancia sale de la
   separación visual real entre los dos y del campo de visión. */
function tourStopDist(s, b) {
  const d = s.dist || { mult: 8 };
  let dist;
  if (d.au !== undefined) dist = Sim.scaleMode === 'real' ? d.au * UV_PER_AU : mapDist(d.au);
  else if (d.pair && Sim.byId[d.pair]) {
    const p = Sim.byId[d.pair];
    const sep = hypot3(b.disp[0] - p.disp[0], b.disp[1] - p.disp[1], b.disp[2] - p.disp[2]);
    const r = Math.max(displayRadiusOf(b), 1e-4);
    dist = Math.max(sep, r * 6) / Math.tan(Cam.fov * DEG / 2) * (d.k || 0.9);
  } else dist = Math.max(displayRadiusOf(b), 1e-4) * (d.mult || 8);
  return clamp(dist, Cam.minDist * 2.5, Cam.maxDist);
}

/* Ángulo de la dirección cuerpo→Sol: la cámara se coloca relativa-mente a
   esa línea, así la iluminación sale coherente sea cual sea la época. Para una
   luna se usa el ángulo de su planeta padre. yawOff = 0 => cara iluminada. */
function tourBodyAngle(b) {
  const ref = (b.parent && b.parent.kind !== 'star') ? b.parent : b;
  if (ref.kind === 'star') return 0;
  return Math.atan2(Sim.sun.disp[1] - ref.disp[1], Sim.sun.disp[0] - ref.disp[0]);
}

/* Salto de fecha del guion: mismo camino que goToday(), con reconstrucción de
   órbitas y estelas limpias para que no queden trazos de la época anterior. */
function tourJumpToJD(jd) {
  Sim.t = jd - J2000_JD;
  Sim.jd = jd;
  clearTrails();
  if (Sim.nbody) { NBody.reset(); NBody.lastT = Sim.t; }
  for (const b of Sim.bodies) { updateKepler(b, Sim.t); updateOrientation(b, Sim.t); }
  buildAllOrbits();
  const g = jdToGregorian(jd);
  UI.els.datePick.value = g.year + '-' + String(g.month).padStart(2, '0') + '-' + String(g.day).padStart(2, '0');
}

function tourSetToggle(key, on) {
  if (typeof Sim[key] !== 'boolean') return;
  Sim[key] = on;
  const sw = UI['sw_' + key];
  if (sw) sw.classList.toggle('on', on);
}

/* ---- entrada en una parada ---- */
function tourGo(i, keepCamera) {
  if (!Tour.active) return;
  i = clamp(i | 0, 0, TOUR_STOPS.length - 1);
  const s = TOUR_STOPS[i];
  const b = Sim.byId[s.body];
  if (!b) return;

  Tour.i = i; Tour.stop = s; Tour.body = b; Tour.phase = 'travel'; Tour.t = 0;
  Tour.manual = false; Tour.paused = false;

  if (s.on) for (const k in s.on) tourSetToggle(k, s.on[k]);
  if (typeof s.speed === 'number') {
    UI.els.rngSpeed.value = sliderFromSpeed(s.speed);
    setSpeedFromSlider();
  }
  const jd = tourDateJD(s.date);
  if (jd !== null && Math.abs(jd - Sim.jd) > 0.02) tourJumpToJD(jd);
  selectBody(b, false);

  /* Objetivos de cámara. yaw se elige por el camino corto desde la posición
     actual: si no, un salto de +2,4 rad haría dar media vuelta a toda la escena. */
  const yawT = tourBodyAngle(b) + (typeof s.yawOff === 'number' ? s.yawOff : 0.6);
  Tour.dist1 = tourStopDist(s, b);
  Tour.pitch1 = clamp(typeof s.pitch === 'number' ? s.pitch : 0.35, -88.5 * DEG, 88.5 * DEG);
  Tour.yaw1 = Cam.yaw + wrapPi(yawT - Cam.yaw);
  Tour.yaw0 = Cam.yaw; Tour.pitch0 = Cam.pitch; Tour.dist0 = Cam.dist;
  for (let k = 0; k < 3; k++) Tour.tgt0[k] = Cam.target[k];
  if (!keepCamera) { /* la trayectoria siempre arranca de la cámara presente */ }

  Tour.travel = Math.max(s.travel || 5, 0.5);
  Tour.dwell = Math.max(s.dwell || 14, 1);
  Tour.total = TOUR_STOPS.reduce((a, st) => a + Math.max(st.dwell || 14, 1) + Math.max(st.travel || 5, .5), 0);
  Tour.elapsed = TOUR_STOPS.slice(0, i).reduce((a, st) => a + Math.max(st.dwell || 14, 1) + Math.max(st.travel || 5, .5), 0);

  tourRenderCard();
}

function tourStart() {
  if (Tour.active) return;
  Tour.active = true;
  Tour.els = {
    card: document.getElementById('tour'),
    chapter: document.getElementById('tourChapter'),
    title: document.getElementById('tourTitle'),
    kicker: document.getElementById('tourKicker'),
    text: document.getElementById('tourText'),
    chips: document.getElementById('tourChips'),
    bar: document.getElementById('tourBarFill'),
    dots: document.getElementById('tourDots'),
    hint: document.getElementById('tourHint'),
    play: document.getElementById('btnTourPlay'),
    prev: document.getElementById('btnTourPrev'),
    next: document.getElementById('btnTourNext'),
    exit: document.getElementById('btnTourExit')
  };
  Tour.nextEl = document.getElementById('tourNext');
  Tour.els.dots.innerHTML = '';
  Tour.dots = [];
  TOUR_STOPS.forEach((s, k) => {
    const d = document.createElement('div');
    d.className = 'tdot'; d.title = (k + 1) + '. ' + s.title;
    d.addEventListener('click', () => { Tour.active ? tourGo(k) : tourStart(); });
    Tour.els.dots.appendChild(d); Tour.dots.push(d);
  });
  Tour.els.card.classList.add('show');
  document.body.classList.add('touring');
  Cam.followBody = null; Cam.vYaw = Cam.vPitch = Cam.vDist = 0;
  Tour.card = -1;
  tourSyncButtons();
  tourGo(0);
}

function tourStop() {
  if (!Tour.active) return;
  Tour.active = false; Tour.manual = false; Tour.paused = false;
  Tour.els.card.classList.remove('show');
  document.body.classList.remove('touring');
  if (Tour.nextEl) Tour.nextEl.style.display = 'none';
  Cam.followBody = null;
  tourSyncButtons();
  tourHint('tour terminado · ' + TOUR_STOPS.length + ' paradas');
}

/* estado de los botones: panel (V) y tarjeta (play/pausa) */
function tourSyncButtons() {
  const bt = UI.els.btnTour;
  if (bt) bt.classList.toggle('on', Tour.active);
  if (Tour.els && Tour.els.play) Tour.els.play.textContent = Tour.paused ? '▶' : '⏸';
}

function tourToggle() { Tour.active ? tourStop() : tourStart(); }

/* parada anterior / siguiente: teclas [ y ], botones de la tarjeta */
function tourPrev() {
  if (!Tour.active) { tourStart(); return; }
  if (Tour.manual) { tourResume(); return; }
  tourGo(Tour.i - 1);
}
function tourNext() {
  if (!Tour.active) { tourStart(); return; }
  if (Tour.manual) { tourResume(); return; }
  if (Tour.i + 1 >= TOUR_STOPS.length) { tourStop(); return; }
  tourGo(Tour.i + 1);
}

/* El usuario toma la cámara: el tour deja de moverla hasta que se reanude. */
function tourTakeOver() {
  if (!Tour.active || Tour.manual) return;
  Tour.manual = true;
  Cam.followBody = null;
  tourHint('cámara manual · pulsa ] o ▶ para volver al tour');
}

function tourResume() {
  if (!Tour.active || !Tour.manual) return;
  tourGo(Tour.i);            // re-encuadra la parada desde la cámara actual
}

function tourPauseToggle() {
  if (!Tour.active) { tourStart(); return; }
  Tour.paused = !Tour.paused;
  tourSyncButtons();
  tourHint(Tour.paused ? 'tour en pausa · ] para saltar de parada' : '');
}

function tourHint(txt) { if (Tour.els && Tour.els.hint) Tour.els.hint.textContent = txt || ''; }

/* ---- coreografía ---- */
function tourUpdate(dt) {
  if (!Tour.active || !Tour.stop) return;
  const s = Tour.stop, b = Tour.body;
  if (Tour.manual) return;
  if (Tour.paused) {
    /* pausa: se congela la coreografia pero el objetivo sigue anclado al cuerpo */
    for (let c = 0; c < 3; c++) { Cam.target[c] = Cam.panTarget[c] = b.disp[c]; Cam.pan[c] = 0; }
    Cam.update(0);
    return;
  }
  Tour.t += dt; Tour.elapsed += dt;

  if (Tour.phase === 'travel') {
    const k = smoothstep(0, 1, Tour.t / Tour.travel);
    Cam.followBody = null;
    Cam.vYaw = Cam.vPitch = Cam.vDist = 0;
    Cam.yaw = Tour.yaw0 + (Tour.yaw1 - Tour.yaw0) * k;
    Cam.pitch = Tour.pitch0 + (Tour.pitch1 - Tour.pitch0) * k;
    Cam.dist = Cam.distTarget = Math.exp(lerp(Math.log(Tour.dist0), Math.log(Tour.dist1), k));
    /* el cuerpo se mueve mientras volamos: el destino se recalcula cada frame */
    for (let c = 0; c < 3; c++) {
      Cam.target[c] = lerp(Tour.tgt0[c], b.disp[c], k);
      Cam.panTarget[c] = Cam.target[c];
    }
    Cam.update(0);            // recalcula eye/up/right/fwd con la camara recien colocada
    if (Tour.t >= Tour.travel) { Tour.phase = 'dwell'; Tour.t = 0; Cam.followBody = b; }
  } else {
    const k = clamp(Tour.t / Tour.dwell, 0, 1);
    /* anclaje duro del objetivo: en paradas cercanas el cuerpo recorre muchos
       km por segundo de simulación y la inercia de paneo lo sacaría del encuadre */
    for (let c = 0; c < 3; c++) { Cam.target[c] = Cam.panTarget[c] = b.disp[c]; Cam.pan[c] = 0; }
    Cam.yaw += (s.spin || 0) * dt;
    Cam.vYaw = Cam.vPitch = 0;
    if (s.dwellZoom) {
      const f = 1 + (s.dwellZoom - 1) * smoothstep(0.15, 0.92, k);
      Cam.dist = Cam.distTarget = Tour.dist1 * f;
    }
    /* mismo cierre que la rama 'travel': frame() calcula eye() en Cam.update(dt)
       ANTES de la coreografía, así que sin este repaso el ojo queda colocado sobre
       el objetivo del frame anterior. Con la cámara a 7 unidades de un cuerpo que
       recorre 0,33 unidades por frame (Mercurio, parada 03) ese retraso es un 5 %
       de la distancia: 30 px de descentrado que además tiembla con el jitter de dt. */
    Cam.update(0);            // recalcula eye/up/right/fwd con el objetivo recien anclado
    if (Tour.t >= Tour.dwell) {
      if (Tour.i + 1 < TOUR_STOPS.length) tourGo(Tour.i + 1);
      else { tourHint('tour completado · Esc para salir'); Tour.paused = true;
             if (Tour.els.play) Tour.els.play.textContent = '\u21ba'; }
    }
  }
}

/* ---- tarjeta de narración ---- */
function tourRenderCard() {
  const s = TOUR_STOPS[Tour.i];
  if (!Tour.els) return;
  Tour.els.chapter.textContent = String(Tour.i + 1).padStart(2, '0') + ' / ' + TOUR_STOPS.length;
  Tour.els.title.textContent = s.title;
  Tour.els.kicker.textContent = s.kicker;
  Tour.els.text.textContent = s.text;
  Tour.els.chips.innerHTML = '';
  for (const c of s.chips) {
    const el = document.createElement('span');
    el.className = 'chip'; el.textContent = c;
    Tour.els.chips.appendChild(el);
  }
  Tour.dots.forEach((d, k) => {
    d.classList.toggle('done', k < Tour.i);
    d.classList.toggle('cur', k === Tour.i);
  });
  Tour.els.play.textContent = '⏸';
  tourHint(s.date ? 'esta parada salta en el tiempo a ' + tourDateLabel(s.date) : '');
  Tour.card = Tour.i;
  tourSyncButtons();
}

function tourOverlay() {
  if (!Tour.active || !Tour.els) return;
  Tour.els.bar.style.width = (100 * clamp(Tour.elapsed / Tour.total, 0, 1)).toFixed(2) + '%';
  /* marcador de la proxima parada, proyectado sobre el lienzo */
  const el = Tour.nextEl;
  if (!el) return;
  const nx = TOUR_STOPS[Tour.i + 1];
  if (!nx) { el.style.display = 'none'; return; }
  const b = Sim.byId[nx.body];
  const cw = R.canvas.clientWidth, ch = R.canvas.clientHeight;
  const p = project(b.disp[0], b.disp[1], b.disp[2]);
  if (!p || p[0] < 60 || p[0] > cw - 60 || p[1] < 40 || p[1] > ch - 90) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = p[0].toFixed(0) + 'px';
  el.style.top = p[1].toFixed(0) + 'px';
  el.textContent = '\u2192 ' + nx.title;
}

/* ---- ruta 3D del tour (se dibuja dentro de drawLines) ----
   linePush() emite UN vertex y gl.LINES agrupa de dos en dos: cada tramo exige
   dos llamadas. Un total impar desfasaria las parejas y enlazaria el tour con
   las orbitas (el fallo que caza el test 13 de tools/check.js). */
function tourRouteLines() {
  const n = TOUR_STOPS.length;
  const prog = Tour.phase === 'travel' ? smoothstep(0, 1, Tour.t / Tour.travel) : 1;
  const pulse = Tour.i + prog;
  const MUESTRAS = 44;
  const A = new Float64Array(3), B = new Float64Array(3);
  for (let i = 0; i + 1 < n; i++) {
    if (i > Tour.i + 1) break;                       // solo el tramo actual y el siguiente
    const ba = Sim.byId[TOUR_STOPS[i].body], bb = Sim.byId[TOUR_STOPS[i + 1].body];
    if (!ba || !bb) continue;
    const cur = i === Tour.i;
    for (let s = 0; s < MUESTRAS; s += 2) {          // tramo discontinuo: guia, no orbita
      const t0 = s / MUESTRAS, t1 = (s + 1) / MUESTRAS;
      for (let c = 0; c < 3; c++) {
        A[c] = lerp(ba.disp[c], bb.disp[c], t0);
        B[c] = lerp(ba.disp[c], bb.disp[c], t1);
      }
      const near = Math.min(Math.abs(i + t0 - pulse), Math.abs(i + t1 - pulse));
      let r, g, bl, al;
      if (cur && near < 0.35) { r = 1.0; g = 0.80; bl = 0.42; al = 0.85; }      // pulso de vuelo
      else if (cur) { r = 0.36; g = 0.78; bl = 1.0; al = 0.45; }                // tramo actual
      else if (i === Tour.i + 1) { r = 0.36; g = 0.78; bl = 1.0; al = 0.22; }   // proximo destino
      else { r = 0.42; g = 0.62; bl = 0.95; al = 0.12; }                        // recorrido hecho
      linePush(A[0], A[1], A[2], r, g, bl, al);
      linePush(B[0], B[1], B[2], r, g, bl, al);
    }
  }
  /* anillo de destino sobre la proxima parada, en el plano de la camara */
  const nx = TOUR_STOPS[Tour.i + 1];
  if (!nx) return;
  const b = Sim.byId[nx.body];
  const rr = Math.max(b.dispR * 2.6, Cam.dist * 0.02);
  const N = 40;
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU;
    ringPoint(b.disp, Cam.right, Cam.up, rr, a0, A);
    ringPoint(b.disp, Cam.right, Cam.up, rr, a1, B);
    linePush(A[0], A[1], A[2], 1.0, 0.75, 0.45, 0.5);
    linePush(B[0], B[1], B[2], 1.0, 0.75, 0.45, 0.5);
  }
}

function ringPoint(center, right, up, r, a, out) {
  const c = Math.cos(a), s = Math.sin(a);
  out[0] = center[0] + (right[0] * c + up[0] * s) * r;
  out[1] = center[1] + (right[1] * c + up[1] * s) * r;
  out[2] = center[2] + (right[2] * c + up[2] * s) * r;
}

/* Gancho de render: 06_scene.js llama a RenderHooks.tour() dentro de drawLines().
   Solo dibuja cuando el tour está activo, para no alterar el layout de vértices
   que verifica tools/check.js en el render normal. */
RenderHooks.tour = function () { if (Tour.active && !Tour.manual) tourRouteLines(); };
