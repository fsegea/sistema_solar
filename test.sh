#!/usr/bin/env bash
# test.sh — puerta de verificacion del repo.
#   ./test.sh                 Node: build + check.js + puerta de rendimiento   (~2 s)
#   ./test.sh --with-browser  anade smoke de consola y probe de FPS reales     (~15 s)
cd "$(dirname "$0")" || exit 1
./build.sh >/dev/null 2>&1 || { echo "build.sh: ERROR de sintaxis"; exit 1; }
node tools/check.js || exit 1
node tools/perf_check.js --iters 120 | tail -2
rc=${PIPESTATUS[0]}
if [ "${1:-}" = "--with-browser" ]; then
  ./tools/browser_smoke.sh || rc=1
  node tools/browser_probe.js || rc=1
fi
exit $rc
