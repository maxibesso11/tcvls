#!/usr/bin/env bash
# ============================================================
# Despliega una versión de la app en el servidor (Docker Hub → Docker).
# En el servidor no hay código fuente ni git: solo la imagen.
#
#   sudo /opt/tcvls/deploy/desplegar.sh <commit>     # versión publicada
#   sudo /opt/tcvls/deploy/desplegar.sh latest       # la última publicada
#
# Pasos (se detiene en el primero que falle):
#   1. Respaldo de la base (tcv-respaldo-bd).
#   2. Baja la imagen <TCV_IMAGEN>:<versión> de Docker Hub.
#   3. Aplica las migraciones pendientes (vienen dentro de la imagen).
#   4. Reemplaza el contenedor de la app y espera a que responda sano.
#   5. Si no levanta, vuelve a la versión anterior.
#      Ojo: las migraciones NO se deshacen solas; si hiciera falta, se
#      restaura el respaldo del paso 1.
# El corte de servicio es de unos segundos (el reinicio del contenedor).
# ============================================================
set -euo pipefail

VERSION="${1:-}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()    { echo "[$(date '+%F %T')] $*"; }
fallar() { log "✗ $*"; exit 1; }
compose() { docker compose --project-directory "$DIR" "$@"; }

[[ $EUID -eq 0 ]] || fallar "Correlo con sudo."
[[ -n "$VERSION" ]] || fallar "Indicá la versión: el commit que imprimió publicar-imagen.sh, o latest."
[[ -f "$DIR/.env" ]] || fallar "Falta $DIR/.env."
grep -qE '^TCV_IMAGEN=.+' "$DIR/.env" || fallar "Falta TCV_IMAGEN en $DIR/.env (ej. TCV_IMAGEN=usuario/tcvls-app)."

# La versión en producción queda en el .env (TAG=), así cualquier comando de
# docker compose usa esa y no "latest".
ANTERIOR="$(grep -E '^TAG=' "$DIR/.env" | tail -n 1 | cut -d= -f2- | tr -d ' \r' || true)"

log "1/4 Respaldo previo"
/usr/local/sbin/tcv-respaldo-bd || fallar "El respaldo falló: no se despliega sin respaldo."

log "2/4 Imagen versión $VERSION"
TAG="$VERSION" compose pull app

log "3/4 Migraciones"
TAG="$VERSION" compose run --rm --no-deps app node backend/database/migrar.js

log "4/4 Arranque"
TAG="$VERSION" compose up -d --no-build app
estado=desconocido
for _ in $(seq 1 30); do
  estado="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null || echo desconocido)"
  [[ "$estado" == healthy ]] && break
  sleep 3
done

if [[ "$estado" != healthy ]]; then
  log "✗ La versión $VERSION no respondió sana ($estado). Últimas líneas del log:"
  compose logs --tail 30 app || true
  if [[ -n "$ANTERIOR" ]]; then
    log "↩ Volviendo a la versión $ANTERIOR"
    TAG="$ANTERIOR" compose up -d --no-build app
  fi
  exit 1
fi

if grep -qE '^TAG=' "$DIR/.env"; then
  sed -i -E "s/^TAG=.*/TAG=$VERSION/" "$DIR/.env"
else
  printf '\n# Versión desplegada (la actualiza deploy/desplegar.sh)\nTAG=%s\n' "$VERSION" >> "$DIR/.env"
fi
log "✓ Desplegada la versión $VERSION${ANTERIOR:+ (la anterior era $ANTERIOR)}."
[[ -n "$ANTERIOR" ]] && log "  Para volver atrás: sudo $DIR/deploy/desplegar.sh $ANTERIOR"
exit 0
