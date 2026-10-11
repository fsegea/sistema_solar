#!/usr/bin/env node
/* tools/browser_probe.js — FPS y coste real de frame en Chromium headless via CDP.
 *
 * No usa Playwright ni dependencias: Chrome con --remote-debugging-port y el
 * WebSocket global de Node. Mide con requestAnimationFrame en tiempo real (el
 * --virtual-time-budget del smoke distorsiona el FPS: alli sale 97 y 0,0 ms).
 *
 * Criterios: 0 errores/avisos de consola, frame <= UMFREME ms (el presupuesto de
 * 60 Hz es 16,7 ms), fps >= UMFPS, dibujados (planetas + cinturones) >= 5000.
 * Salida: una linea.  Salir con 1 si algo falla.
 *
 *   node tools/browser_probe.js [--frame 16.7] [--fps 20]
 *
 * Ojo: en headless con SwiftShader (GL por software) el fps real sale ~36 con
 * 5630 cuerpos aunque el frame tarde 2,7 ms; el limite de fps es una red de
 * seguridad contra una regresion brutal, no la medida de 60 Hz. La medida de
 * 60 Hz es Sim.msFrame.
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = Number(process.env.CDP_PORT || 9333);
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const UMFPS = Number(arg('--fps', 20));
const UMFREME = Number(arg('--frame', 16.7));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'solar-cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});

  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  process.on('exit', cleanup);

  // esperar al endpoint de DevTools
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    await sleep(250);
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch (e) {}
  }
  if (!version) { cleanup(); console.log('FAIL browser_probe: Chrome no expone DevTools'); process.exit(1); }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0; const pending = new Map(); const consoleMsgs = [];
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') consoleMsgs.push(m.params.type + ': ' + (m.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' '));
    if (m.method === 'Runtime.exceptionThrown') consoleMsgs.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: 'file://' + path.join(ROOT, 'index.html') }, sessionId);

  // dejar que el arranque termine y el bucle se estabilice
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const r = await send('Runtime.evaluate', { expression: '!!(window.SOLAR && window.SOLAR.Sim && document.querySelector("#loading.done"))', returnByValue: true }, sessionId);
    if (r.result && r.result.value === true) break;
  }

  const probe = `(async () => {
    const S = window.SOLAR;
    const fps = await new Promise(res => { let n = 0; const t0 = performance.now();
      const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n * 1000 / (performance.now() - t0)); };
      requestAnimationFrame(tick); });
    return { fps: Math.round(fps * 10) / 10, frame: S.Sim.msFrame, physics: S.Sim.msPhysics,
             simfps: Math.round(S.Sim.fps * 10) / 10, bodies: S.Sim.totalBodies, drawn: S.Sim.drawnCount + S.Sim.belts.visibleCount };
  })()`;
  const r = await send('Runtime.evaluate', { expression: probe, awaitPromise: true, returnByValue: true }, sessionId);
  const v = r.result && r.result.value;
  const errs = consoleMsgs.filter(m => m.startsWith('error') || m.startsWith('warning') || m.startsWith('exception'));
  cleanup();

  if (!v) { console.log('FAIL browser_probe: la pagina no devolvio metricas (' + consoleMsgs.slice(0, 2).join(' | ') + ')'); process.exit(1); }
  const problems = [];
  if (errs.length) problems.push('consola: ' + errs.length + ' (' + errs[0].slice(0, 90) + ')');
  if (v.frame > UMFREME) problems.push('frame ' + v.frame.toFixed(1) + ' ms > ' + UMFREME + ' ms');
  if (v.fps < UMFPS) problems.push('fps ' + v.fps + ' < ' + UMFPS);
  if (v.drawn < 5000) problems.push('dibujados ' + v.drawn + ' < 5000');

  const linea = 'fps ' + v.fps + ' (HUD ' + v.simfps + ') · frame ' + v.frame.toFixed(1) + ' ms · fisica ' + v.physics.toFixed(1) + ' ms · cuerpos ' + v.bodies + ' · dibujados ' + v.drawn;
  if (problems.length) { console.log('FAIL browser_probe: ' + problems.join(' | ') + '  [' + linea + ']'); process.exit(1); }
  console.log('OK   browser_probe: 0 errores de consola · ' + linea);
}

main().catch(e => { console.log('FAIL browser_probe: ' + e.message); process.exit(1); });
