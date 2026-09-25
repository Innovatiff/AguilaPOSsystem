#!/usr/bin/env bash
# Pruebas de extremo a extremo (Playwright + emuladores de Firebase).
#   npm run test:e2e                # todos los escenarios
#   npm run test:e2e -- movil       # solo uno (nombre del archivo sin .cjs)
# Requisitos: npm install (trae playwright) y `npx playwright install chromium`.
# El sitio se sirve desde una copia temporal con js/config.js apuntando a los
# emuladores: el config.js real del equipo no se toca.
set -euo pipefail
cd "$(dirname "$0")/../.."
SITIO="$(mktemp -d)"
trap 'rm -rf "$SITIO"' EXIT
tar --exclude=./node_modules --exclude=./.git --exclude=./pruebas --exclude='*.log' -cf - . | tar -xf - -C "$SITIO"
cp pruebas/e2e/config.emulador.js "$SITIO/js/config.js"
export SITIO_E2E="$SITIO"
npx firebase emulators:exec --only auth,firestore --project demo-aguilapos "bash pruebas/e2e/dentro.sh $*"
