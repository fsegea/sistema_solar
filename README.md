# Sistema Solar — simulación física offline

Simulación del Sistema Solar contenida en **un único `index.html`**: HTML, CSS y
JavaScript en el mismo archivo, sin servidor, sin dependencias, sin CDNs y sin
imágenes externas. Funciona abriendo el archivo directamente en el navegador
(doble clic), incluso sin conexión.

Sin librerías externas: WebGL1 nativo y texturas generadas por procedimiento.

## Cómo usarlo

```bash
# opción 1: abrir directamente
xdg-open index.html          # Linux
open index.html              # macOS

# opción 2: servirlo localmente (opcional)
python3 -m http.server 8000  # y abrir http://localhost:8000
```

El archivo `index.html` de la raíz está **generado** a partir de `src/`. Puedes
abrirlo tal cual o regenerarlo con `./build.sh`.

## Qué incluye

### Física y astronomía
- Órbitas keplerianas con elementos orbitales de la época **J2000**
  (`a`, `e`, `i`, `Ω`, `ω`, `M0`) y resolución de la ecuación de Kepler por
  Newton-Raphson con convergencia controlada.
- Modo **N-cuerpo** con integración Velocity Verlet (timestep fijo, `G` real),
  con deriva energética visible como indicador de precisión.
- Cuerpos: Sol, Mercurio, Venus, Tierra, Marte, Júpiter, Saturno, Urano,
  Neptuno y los planetas enanos Ceres, Plutón, Eris, Haumea y Makemake.
- Lunas con órbita propia: Luna, Fobos, Deimos, Io, Europa, Ganimedes,
  Calisto, Titán, Encélado, Rea, Tritón y Caronte.
- Cinturón de asteroides (**3600** cuerpos) y cinturón de Kuiper (**2000**),
  con lagunas de Kirkwood y resonancias básicas con Júpiter.
- Cometas en órbitas muy excéntricas, con cola siempre **anti-solar** cuya
  longitud e intensidad dependen de la distancia al Sol.
- Rotación axial con periodo y oblicuidad reales (Venus retrógrada, Urano
  apoyado ~98°).
- Control de tiempo: pausa, velocidad de 1 s/s hasta 100 años/s, tiempo
  invertido, fecha simulada y salto a la fecha de hoy o a una fecha arbitraria.

### Render
- Vista 3D con proyección en perspectiva y cámara orbital libre (rotar, zoom,
  pan) con inercia.
- Dos modos de escala: **realista** (tamaños y distancias proporcionales) y
  **didáctico** (tamaños exagerados, distancias comprimidas).
- Sol con corona, resplandor simulado, manchas y granulación.
- Texturas procedurales (ruido Perlin/Simplex): continentes y océanos en la
  Tierra, nubes animadas, bandas y Gran Mancha Roja en Júpiter, cráteres en
  Mercurio y la Luna.
- Iluminación direccional desde el Sol con terminador día/noche y luces de
  ciudades en el lado nocturno de la Tierra.
- Anillos de Saturno (y anillos tenues de Júpiter, Urano y Neptuno) con
  transparencia, división de Cassini y sombras analíticas.
- Atmósferas con dispersión en el limbo.
- Campo estelar con más de 5000 estrellas y Vía Láctea procedural.
- Estelas de órbita con desvanecimiento y líneas de órbita completas
  conmutables.
- Etiquetas con anti-solapamiento y oclusión.
- Eclipses solares y lunares visibles al acercarse a la Tierra.

### Interfaz (HUD)
- Panel lateral con la lista de cuerpos; al seleccionar uno la cámara lo sigue.
- Ficha de datos: radio, masa, gravedad, periodos orbital y de rotación,
  distancia actual al Sol y a la Tierra, velocidad orbital instantánea,
  temperatura media y número de lunas.
- Regla de distancia entre dos cuerpos con tiempo de viaje de la luz.
- Medidor de FPS, contador de cuerpos y tiempo de cómputo por frame.
- **Tour guiado** de 16 paradas con coreografía de cámara, saltos de fecha y
  narración (`src/09_tour.js`).

## Atajos de teclado

| Tecla | Acción |
| --- | --- |
| `Espacio` | Pausar / reanudar |
| `+` / `-` | Subir / bajar la velocidad (pasos de 4) |
| `,` / `.` | Ajuste fino de velocidad |
| Flechas | Orbitar la cámara (con inercia) |
| `1`…`9` | Seleccionar Mercurio…Plutón |
| `0` | Seleccionar el Sol |
| `F` | Seguir / dejar de seguir el cuerpo seleccionado |
| `Esc` | Detener el tour / cerrar ayuda |
| `R` | Reiniciar la vista |
| `T` | Vista cenital general |
| `V` | Activar / desactivar el tour guiado |
| `O` `L` `K` `B` `C` `G` `S` `A` | Órbitas, etiquetas, estelas, cinturones, cometas, anillos, estrellas, atmósferas |
| `D` | Cambiar escala real ↔ didáctica |
| `N` | Modo N-cuerpo ↔ kepleriano |
| `M` | Modo medición entre dos cuerpos |
| `P` / `I` | Colapsar panel lateral / ficha |
| `J` | Saltar a la fecha de hoy |
| `H` | Ayuda |

## Estructura del repositorio

```
index.html        artifact final, generado por build.sh (3937 líneas)
build.sh          ensambla index.html desde src/ y comprueba la sintaxis del JS
test.sh           puerta de verificación del repo
prompt.txt        brief original con los criterios de aceptación

src/
  01_shell.html   estructura HTML y hoja de estilo (tema oscuro, responsive)
  02_core.js      constantes físicas, datos astronómicos, motor orbital
  04_textures.js  texturas procedurales, clase Body y estado de la simulación
  05_gl.js        render WebGL1 nativo
  06_scene.js     cámara orbital, modo de escala y visibilidad
  07_ui.js        HUD, entrada y etiquetas
  08_boot.js      arranque: cuerpos, poblaciones, texturas, bucle principal
  09_tour.js      tour guiado de 16 paradas

tools/
  check.js          51 comprobaciones de los criterios verificables sin navegador
  perf_check.js     puerta de rendimiento del bucle de simulación
  nbody_check.js    deriva energética del modo N-cuerpo
  ephemeris_probe.js  cotejo de efemérides
  eclipse_probe.js  / eclipse_axis.js  geometría de eclipses
  comet_probe.js    orientación de la cola de los cometas
  tour_probe.js     coherencia del tour guiado
  browser_probe.js  / browser_smoke.sh  consola y FPS reales en navegador
```

## Compilar y probar

```bash
./build.sh                 # regenera index.html y comprueba la sintaxis del JS
./test.sh                  # Node: build + check.js + puerta de rendimiento  (~2 s)
./test.sh --with-browser   # añade smoke de consola y probe de FPS reales    (~15 s)
```

`test.sh` es la puerta de entrada: sale con código distinto de cero si algo
falla. Los probes de `tools/` son independientes y se pueden ejecutar uno a uno
(`node tools/nbody_check.js`, por ejemplo).

## Limitaciones conocidas

- Las distancias interplanetarias no son visibles a escala real junto con los
  tamaños de los planetas: por eso existe el modo de escala didáctico.
- Los cinturones son poblaciones sintéticas estadísticamente fieles
  (distribución, excentricidades, lagunas de Kirkwood), no el catálogo real de
  asteroides.
- No hay efemérides de alta precisión (DE440): la posición se obtiene de los
  elementos keplerianos J2000, sin perturbaciones planetarias en modo kepleriano.
- El render es WebGL1 con sombreadores analíticos: no hay sombras proyectadas
  por mapa de sombras ni oclusión ambiental.

## Licencia

MIT — ver [LICENSE](LICENSE).
