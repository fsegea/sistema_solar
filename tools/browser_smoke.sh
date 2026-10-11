#!/usr/bin/env bash
# browser_smoke.sh — automatiza los criterios "abre sin errores de consola" y
# "el bucle de animacion corre con >=5000 cuerpos", sin dependencias externas.
#
# Criterios de fallo:
#   1. stderr contiene CONSOLE(  -> cualquier mensaje de consola de la pagina
#      (incluye "Uncaught ..." y los avisos del propio frame())
#   2. el DOM no tiene <div id="loading" class="done">  -> el arranque no termino
#   3. #mbodies < 5000
#   4. #fps = "-"  -> el bucle requestAnimationFrame nunca llego a correr
set -u
cd "$(dirname "$0")/.." || exit 1

CHROME="${CHROME:-google-chrome}"
command -v "$CHROME" >/dev/null 2>&1 || { echo "SKIP browser_smoke: $CHROME no esta disponible"; exit 0; }
./build.sh >/dev/null 2>&1 || { echo "FAIL browser_smoke: build.sh"; exit 1; }

DOM=$(mktemp); ERR=$(mktemp)
trap 'rm -f "$DOM" "$ERR"' EXIT

timeout 120 "$CHROME" --headless=new --no-sandbox --enable-unsafe-swiftshader \
  --use-angle=swiftshader --virtual-time-budget=25000 --enable-logging=stderr \
  --dump-dom "file://$PWD/index.html" >"$DOM" 2>"$ERR"
rc=$?
[ $rc -eq 0 ] || { echo "FAIL browser_smoke: chrome salio con $rc"; exit 1; }

hud() { grep -o "<b id=\"$1\">[^<]*" "$DOM" | head -1 | sed 's/.*>//'; }
bodies=$(hud mbodies); fps=$(hud fps)
bodies=${bodies:-0}; fps=${fps:-}

fail=""
cons=$(grep -cE "CONSOLE[:(]" "$ERR")
[ "$cons" -ne 0 ] && fail="$fail consola($cons): $(grep -m2 -E 'CONSOLE[:(]' "$ERR" | sed 's/.*CONSOLE[:(][0-9]*\]//' | tr '\n' ' ')"
grep -q 'id="loading" class="done"' "$DOM" || fail="$fail loading-no-done"
[ "${bodies%%.*}" -ge 5000 ] 2>/dev/null || fail="$fail cuerpos=$bodies"
[ -n "$fps" ] && [ "$fps" != "–" ] && [ "$fps" != "-" ] || fail="$fail fps=parado"

if [ -n "$fail" ]; then
  echo "FAIL browser_smoke:$fail"
  exit 1
fi
echo "OK   browser_smoke: 0 errores de consola · loading done · cuerpos $bodies · fps $fps · frame $(hud mframe) · fisica $(hud mphysics)"
