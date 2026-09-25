#!/usr/bin/env bash
# Corre dentro de `firebase emulators:exec`: levanta el servidor estático sobre la
# copia del sitio y ejecuta los escenarios pedidos (o todos).
set -u
cd "$(dirname "$0")/../.."
if curl -sf http://127.0.0.1:5500/ >/dev/null 2>&1; then
  echo "El puerto 5500 ya está ocupado: cierra ese servidor antes de correr las pruebas." >&2
  exit 1
fi
# Se lanza el binario directamente (no vía npx) para que $! sea el servidor y se pueda apagar.
node node_modules/http-server/bin/http-server -p 5500 -s -c-1 "$SITIO_E2E" >/dev/null 2>&1 &
PID_HTTP=$!
for i in $(seq 1 40); do curl -sf http://127.0.0.1:5500/ >/dev/null 2>&1 && break; sleep 0.25; done
ESTADO=0
if [ "$#" -gt 0 ]; then ESCENARIOS=("$@"); else ESCENARIOS=(acceso gestion productos captura imprimir movil); fi
for escenario in "${ESCENARIOS[@]}"; do
  node "pruebas/e2e/${escenario%.cjs}.cjs" || ESTADO=1
done
kill $PID_HTTP 2>/dev/null
wait $PID_HTTP 2>/dev/null
exit $ESTADO
