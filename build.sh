#!/bin/bash
# Ensambla index.html a partir de src/ y comprueba la sintaxis del JS
set -e
cd "$(dirname "$0")"
OUT=index.html
cat src/01_shell.html > $OUT
for f in src/02_core.js src/04_textures.js src/05_gl.js src/06_scene.js src/07_ui.js src/09_tour.js src/08_boot.js; do
  echo "" >> $OUT
  cat "$f" >> $OUT
done
printf '\n</script>\n</body>\n</html>\n' >> $OUT
TMP=$(mktemp /tmp/solar_XXXX.js)
sed -n '/^<script>$/,/^<\/script>$/p' $OUT | sed '1d;$d' > "$TMP"
node --check "$TMP" && echo "sintaxis JS: OK"
rm -f "$TMP"
echo "tamano: $(wc -c < $OUT) bytes, $(wc -l < $OUT) lineas"
