
/* =====================================================================
   8. RENDER WEBGL (WebGL1 nativo, sin librerías)
   ===================================================================== */
const VS_BODY = [
  'attribute vec3 aPos;', 'attribute vec3 aNormal;', 'attribute vec2 aUV;',
  'uniform mat4 uVP;', 'uniform mat4 uModel;', 'uniform mat3 uNormalMat;',
  'varying vec3 vWorld;', 'varying vec3 vNormal;', 'varying vec2 vUV;',
  'void main(){', '  vec4 w = uModel * vec4(aPos, 1.0);',
  '  vWorld = w.xyz;', '  vNormal = uNormalMat * aNormal;', '  vUV = aUV;',
  '  gl_Position = uVP * w;', '}'
].join('\n');

const FS_BODY = [
  'precision highp float;',
  'varying vec3 vWorld;', 'varying vec3 vNormal;', 'varying vec2 vUV;',
  'uniform sampler2D uTex;', 'uniform sampler2D uNight;', 'uniform sampler2D uClouds;',
  'uniform vec3 uCam;', 'uniform vec3 uSunPos;',
  'uniform float uEmissive;', 'uniform float uNightOn;', 'uniform float uExposure;',
  'uniform float uCloudOn;', 'uniform float uCloudShift;',
  // anillos: sombra proyectada del anillo sobre la superficie del planeta
  'uniform vec3  uPlanetPos;', 'uniform float uPlanetR;', 'uniform vec3 uRingAxis;',
  'uniform float uRingOn;', 'uniform float uRingInner;', 'uniform float uRingOuter;', 'uniform float uRingOpacity;',
  // eclipses: hasta 4 oclusores (padre + lunas) que pueden tapar el Sol
  'uniform int   uOccN;', 'uniform vec3 uOccPos[6];', 'uniform float uOccR[6];',
  'void main(){',
  '  vec3 N = normalize(vNormal);',
  '  vec4 tx = texture2D(uTex, vUV);',
  '  vec3 col;',
  '  if (uEmissive > 0.5) {',
  '    col = tx.rgb * 1.45;',                       // estrella: emisiva, sin iluminación
  '  } else {',
  '    vec3 toSun = uSunPos - vWorld;',
  '    float sunDist = length(toSun);',
  '    vec3 L = toSun / max(sunDist, 1e-9);',
  '    float ndl = dot(N, L);',
  '    float diff = max(ndl, 0.0);',
  '    float shade = 1.0;',
  // --- oclusion solar: luna sobre planeta, planeta sobre luna, lunas entre si ---
  '    for (int i = 0; i < 6; i++) {',
  '      vec3 d = uOccPos[i] - vWorld;',
  '      float t = dot(d, L);',                      // distancia a lo largo del rayo al Sol
  '      float valid = (i < uOccN && t > 0.0 && t < sunDist) ? 1.0 : 0.0;',
  '      float miss = length(d - L * t);',           // distancia al eje Sol-punto
  '      float rO = uOccR[i];',
  // penumbra aproximada: el Sol subtende ~0,0047 rad desde 1 UA
  '      float s = (1.0 - smoothstep(rO * 0.55, rO * 1.45, miss)) * valid;',
  '      shade *= 1.0 - 0.94 * s;',
  '    }',
  // --- sombra de los anillos sobre el planeta (inversa de la de FS_RING) ---
  '    if (uRingOn > 0.5) {',
  '      vec3 ax = normalize(uRingAxis);',
  '      float dn = dot(toSun, ax);',
  '      if (abs(dn) > 1e-5) {',
  '        float tt = dot(uPlanetPos - vWorld, ax) / dn;',   // cruce del plano del anillo (fraccion del rayo)
  '        if (tt > 0.0 && tt < 1.0) {',
  '          vec3 q = vWorld + toSun * tt;',
  '          vec3 pq = q - uPlanetPos;',
  '          float rr = length(pq - ax * dot(pq, ax)) / max(uPlanetR, 1e-9);',
  '          float inBand = smoothstep(uRingInner - 0.04, uRingInner + 0.04, rr)',
  '                       * (1.0 - smoothstep(uRingOuter - 0.04, uRingOuter + 0.04, rr));',
  '          shade *= 1.0 - uRingOpacity * inBand;',
  '        }',
  '      }',
  '    }',
  '    diff *= shade;',
  '    col = tx.rgb * (0.030 + diff * 1.15);',      // 0.030 = luz ambiental minima
  // --- capa de nubes animadas (Tierra) ---
  '    float cl = 0.0;',
  '    if (uCloudOn > 0.5) {',
  '      vec2 cuv = vec2(fract(vUV.x + uCloudShift), vUV.y);',
  '      cl = texture2D(uClouds, cuv).a;',          // el alfa de la textura es la cobertura
  '      vec3 cloudCol = vec3(1.02, 1.03, 1.06) * (0.055 + diff * 1.18);',
  '      col = mix(col, cloudCol, cl * 0.92);',
  '    }',
  '    if (uNightOn > 0.5) {',
  '      float nmask = smoothstep(0.18, -0.22, ndl) * (1.0 - cl * 0.85);',  // las nubes tapan las ciudades
  '      col += texture2D(uNight, vUV).rgb * nmask * 1.7;',   // luces urbanas en el lado nocturno
  '      vec3 V = normalize(uCam - vWorld);',
  '      vec3 H = normalize(L + V);',
  '      float spec = pow(max(dot(N, H), 0.0), 70.0) * tx.a;', // brillo especular oceanico
  '      col += vec3(0.55, 0.66, 0.85) * spec * smoothstep(0.06, -0.28, ndl) * (1.0 - cl);',
  '    }',
  '  }',
  '  col = col / (1.0 + col * 0.30);',              // compresion tipo pelicula
  '  col *= uExposure;',
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

const FS_ATMO = [
  'precision highp float;',
  'varying vec3 vWorld;', 'varying vec3 vNormal;', 'varying vec2 vUV;',
  'uniform vec3 uCam;', 'uniform vec3 uSunPos;', 'uniform vec3 uColor;',
  'uniform float uPower;', 'uniform float uStrength;',
  'void main(){',
  '  vec3 N = normalize(vNormal);',
  '  vec3 V = normalize(uCam - vWorld);',
  '  float f = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), uPower);',   // fresnel de borde
  '  vec3 L = normalize(uSunPos - vWorld);',
  '  float lit = clamp(dot(N, L) * 0.85 + 0.42, 0.0, 1.35);',
  '  gl_FragColor = vec4(uColor * f * lit * uStrength, 1.0);',
  '}'
].join('\n');

const FS_RING = [
  'precision highp float;',
  'varying vec3 vWorld;', 'varying vec3 vNormal;', 'varying vec2 vUV;',
  'uniform sampler2D uTex;', 'uniform vec3 uCam;', 'uniform vec3 uSunPos;',
  'uniform vec3 uPlanetPos;', 'uniform vec3 uRingNormal;',
  'uniform float uPlanetR;', 'uniform float uBright;', 'uniform float uAlpha;',
  'void main(){',
  '  vec4 t = texture2D(uTex, vec2(vUV.x, 0.5));',
  '  if (t.a < 0.004) discard;',
  '  vec3 V = normalize(uCam - vWorld);',
  '  vec3 n = normalize(uRingNormal);',
  '  float edge = abs(dot(n, V));',
  '  float thick = 0.18 + 0.82 * smoothstep(0.0, 0.16, edge);',        // más denso al mirar de canto
  '  float lit = clamp(abs(dot(n, normalize(uSunPos - vWorld))) * 0.75 + 0.42, 0.12, 1.25);',
  '  vec3 toP = vWorld - uPlanetPos;',
  '  vec3 axis = normalize(uSunPos - uPlanetPos);',
  '  vec3 perp = toP - axis * dot(toP, axis);',
  '  float behind = smoothstep(0.0, 0.15, -dot(toP, axis));',          // ¿está tras el planeta desde el Sol?
  '  float shadow = smoothstep(uPlanetR * 0.92, uPlanetR * 1.12, length(perp));',
  '  lit *= mix(1.0, shadow, behind);',
  '  gl_FragColor = vec4(t.rgb * lit * uBright, t.a * thick * uAlpha);',
  '}'
].join('\n');

const VS_LINE = [
  'attribute vec3 aPos;', 'attribute vec4 aColor;',
  'uniform mat4 uVP;', 'varying vec4 vColor;',
  'void main(){ vColor = aColor; gl_Position = uVP * vec4(aPos, 1.0); }'
].join('\n');
const FS_LINE = [
  'precision mediump float;', 'varying vec4 vColor;',
  'void main(){ gl_FragColor = vColor; }'
].join('\n');

const VS_POINT = [
  'attribute vec3 aPos;', 'attribute vec4 aColor;', 'attribute float aSize;',
  'uniform mat4 uVP;', 'varying vec4 vColor;',
  'void main(){',
  '  vColor = aColor;',
  '  gl_PointSize = clamp(aSize, 1.0, 48.0);',
  '  gl_Position = uVP * vec4(aPos, 1.0);',
  '}'
].join('\n');
const FS_POINT = [
  'precision mediump float;', 'varying vec4 vColor;',
  'void main(){',
  '  vec2 d = gl_PointCoord - vec2(0.5);',
  '  float r = length(d) * 2.0;',
  '  float a = clamp(1.0 - r, 0.0, 1.0);',
  '  a = a * a * (3.0 - 2.0 * a);',
  '  gl_FragColor = vec4(vColor.rgb * vColor.a * a, vColor.a * a);',
  '}'
].join('\n');

const VS_BILL = [
  'attribute vec2 aQuad;',
  'uniform mat4 uVP;', 'uniform vec3 uCenter;', 'uniform vec2 uSize;',
  'uniform vec3 uRight;', 'uniform vec3 uUp;',
  'varying vec2 vUV;',
  'void main(){',
  '  vec3 p = uCenter + uRight * (aQuad.x * uSize.x) + uUp * (aQuad.y * uSize.y);',
  '  vUV = aQuad * 0.5 + 0.5;',
  '  gl_Position = uVP * vec4(p, 1.0);',
  '}'
].join('\n');
const FS_BILL = [
  'precision mediump float;', 'varying vec2 vUV;',
  'uniform sampler2D uTex;', 'uniform vec3 uColor;', 'uniform float uIntensity;',
  'void main(){',
  '  vec4 t = texture2D(uTex, vUV);',
  '  gl_FragColor = vec4(t.rgb * uColor * uIntensity * t.a, t.a * uIntensity);',
  '}'
].join('\n');

const VS_SKY = [
  'attribute vec3 aPos;', 'attribute vec3 aNormal;', 'attribute vec2 aUV;',
  'uniform mat4 uVP;', 'varying vec2 vUV;', 'varying vec3 vDir;',
  'void main(){ vUV = aUV; vDir = aPos; gl_Position = uVP * vec4(aPos * 1.0, 1.0); }'
].join('\n');
const FS_SKY = [
  'precision mediump float;', 'varying vec2 vUV;', 'varying vec3 vDir;',
  'uniform sampler2D uTex;', 'uniform float uBright;',
  'void main(){',
  '  vec3 t = texture2D(uTex, vUV).rgb;',
  '  gl_FragColor = vec4(t * uBright, 1.0);',
  '}'
].join('\n');

const R = {
  gl: null, canvas: null, W: 0, H: 0, dpr: 1,
  progs: Object.create(null), buf: Object.create(null), tex: Object.create(null),
  view: mat4(), proj: mat4(), vp: mat4(),
  sphereHi: null, sphereLo: null, quad: null,
  ok: false,

  init(canvas) {
    this.canvas = canvas;
    const opts = { alpha: false, antialias: true, depth: true, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return false;
    this.gl = gl;
    this.progs.body = this.program(VS_BODY, FS_BODY, ['aPos', 'aNormal', 'aUV']);
    this.progs.atmo = this.program(VS_BODY, FS_ATMO, ['aPos', 'aNormal', 'aUV']);
    this.progs.ring = this.program(VS_BODY, FS_RING, ['aPos', 'aNormal', 'aUV']);
    this.progs.line = this.program(VS_LINE, FS_LINE, ['aPos', 'aColor']);
    this.progs.point = this.program(VS_POINT, FS_POINT, ['aPos', 'aColor', 'aSize']);
    this.progs.bill = this.program(VS_BILL, FS_BILL, ['aQuad']);
    this.progs.sky = this.program(VS_SKY, FS_SKY, ['aPos', 'aNormal', 'aUV']);
    if (!this.progs.body || !this.progs.point) return false;
    this.sphereHi = this.makeSphere(48, 32);
    this.sphereLo = this.makeSphere(20, 12);
    this.quad = this.buffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.008, 0.010, 0.018, 1);
    this.ok = true;
    return true;
  },

  program(vsSrc, fsSrc, attribs) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) { console.error('VS:', gl.getShaderInfoLog(vs), vsSrc); return null; }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) { console.error('FS:', gl.getShaderInfoLog(fs), fsSrc); return null; }
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('LINK:', gl.getProgramInfoLog(p)); return null; }
    gl.deleteShader(vs); gl.deleteShader(fs);
    const o = { p: p, a: Object.create(null), u: Object.create(null) };
    for (const name of attribs) o.a[name] = gl.getAttribLocation(p, name);
    const nu = gl.getProgramParameters ? null : null;
    const maxU = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < maxU; i++) {
      const info = gl.getActiveUniform(p, i);
      o.u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return o;
  },

  buffer(data, target, usage) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(target, b); gl.bufferData(target, data, usage);
    return b;
  },
  texture(canvas, wrap) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  },

  makeSphere(segs, rings) {
    const pos = [], nor = [], uv = [], idx = [];
    for (let j = 0; j <= rings; j++) {
      const lat = Math.PI / 2 - (j / rings) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i <= segs; i++) {
        const lon = (i / segs) * TAU - Math.PI;
        const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = sl;
        pos.push(x, y, z); nor.push(x, y, z);
        uv.push(i / segs, 0.5 - lat / Math.PI);
      }
    }
    const row = segs + 1;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const gl = this.gl;
    return {
      pos: this.buffer(new Float32Array(pos), gl.ARRAY_BUFFER, gl.STATIC_DRAW),
      nor: this.buffer(new Float32Array(nor), gl.ARRAY_BUFFER, gl.STATIC_DRAW),
      uv: this.buffer(new Float32Array(uv), gl.ARRAY_BUFFER, gl.STATIC_DRAW),
      idx: this.buffer(new Uint16Array(idx), gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW),
      count: idx.length
    };
  },
  makeRingMesh(inner, outer, segs, radial) {
    const gl = this.gl, pos = [], nor = [], uv = [], idx = [];
    for (let k = 0; k <= radial; k++) {
      const t = k / radial, r = inner + (outer - inner) * t;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * TAU;
        pos.push(r * Math.cos(a), r * Math.sin(a), 0);
        nor.push(0, 0, 1);
        uv.push(t, 0.5);
      }
    }
    const row = segs + 1;
    for (let k = 0; k < radial; k++) {
      for (let i = 0; i < segs; i++) {
        const a = k * row + i, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    return {
      pos: this.buffer(new Float32Array(pos), gl.ARRAY_BUFFER, gl.STATIC_DRAW),
      nor: this.buffer(new Float32Array(nor), gl.ARRAY_BUFFER, gl.STATIC_DRAW),
      uv: this.buffer(new Float32Array(uv), gl.ARRAY_BUFFER, gl.STATIC_DRAW),
      idx: this.buffer(new Uint16Array(idx), gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW),
      count: idx.length
    };
  },

  bindAttribs(prog, mesh) {
    const gl = this.gl;
    const bind = (loc, buf, size) => {
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind(prog.a.aPos, mesh.pos, 3);
    if (prog.a.aNormal >= 0) bind(prog.a.aNormal, mesh.nor, 3);
    if (prog.a.aUV >= 0) bind(prog.a.aUV, mesh.uv, 2);
  },
  disableAttribs(prog) {
    const gl = this.gl;
    for (const k in prog.a) { const l = prog.a[k]; if (l >= 0) gl.disableVertexAttribArray(l); }
  },
  resize() {
    const gl = this.gl, c = this.canvas;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(c.clientWidth * this.dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * this.dpr));
    if (w !== c.width || h !== c.height) { c.width = w; c.height = h; }
    this.W = w; this.H = h;
    gl.viewport(0, 0, w, h);
  }
};
