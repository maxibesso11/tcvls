#!/usr/bin/env bash
# ============================================================
# Despliegue de una versión nueva del ERP en el servidor (Docker).
#
#   sudo /opt/tcvls/deploy/desplegar.sh            # última versión de main
#   sudo /opt/tcvls/deploy/desplegar.sh <rama>     # otra rama (pruebas)
#
# Pasos (se detiene en el primero que falle):
#   1. Respaldo de la base (tcv-respaldo-bd).
#   2. Trae el código de GitHub como el usuario tcvls (dueño de la carpeta).
#   3. Construye la imagen de la app etiquetada con el commit.
#   4. Aplica las migraciones pendientes (backend/database/migrar.js).
#   5. Reemplaza el contenedor de la app y espera a que responda sano.
#   6. Si la app nueva no levanta, vuelve a la imagen anterior.
#      Ojo: las migraciones del paso 4 NO se deshacen solas; si hiciera
#      falta, se restaura el respaldo del paso 1.
#
# El corte de servicio es de unos segundos (el reinicio del contenedor).
# ============================================================
set -euo pipefail

RAMA="${1:-main}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USUARIO_APP=tcvls
REGISTRO="$DIR/.version-desplegada"

log()    { echo "[$(date '+%F %T')] $*"; }
fallar() { log "✗ $*"; exit 1; }
compose() { docker compose --project-directory "$DIR" "$@"; }
como_app() { sudo -H -u "$USUARIO_APP" "$@"; }

[[ $EUID -eq 0 ]] || fallar "Correlo con sudo."
[[ -f "$DIR/.env" ]] || fallar "Falta $DIR/.env."

ANTERIOR="$(cat "$REGISTRO" 2>/dev/null || echo latest)"

log "1/5 Respaldo previo"
/usr/local/sbin/tcv-respaldo-bd || fallar "El respaldo falló: no se despliega sin respaldo."

log "2/5 Código de la rama $RAMA"
como_app git -C "$DIR" fetch --prune origin
como_app git -C "$DIR" checkout -q "$RAMA"
como_app git -C "$DIR" merge --ff-only -q "origin/$RAMA" || fallar "La copia local tiene cambios propios; no se puede avanzar solo."
NUEVA="$(como_app git -C "$DIR" rev-parse --short HEAD)"
log "    versión $NUEVA ($(como_app git -C "$DIR" log -1 --format=%s))"

log "3/5 Imagen tcvls-app:$NUEVA"
TAG="$NUEVA" compose build app

log "4/5 Migraciones"
TAG="$NUEVA" compose run --rm --no-deps app node backend/database/migrar.js

log "5/5 Arranque"
TAG="$NUEVA" compose up -d app
for _ in $(seq 1 30); do
  estado="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null || echo desconocido)"
  [[ "$estado" == healthy ]] && break
  sleep 3
done

if [[ "$estado" != healthy ]]; then
  log "✗ La versión $NUEVA no respondió sana ($estado). Últimas líneas del log:"
  compose logs --tail 30 app || true
  log "↩ Volviendo a la versión $ANTERIOR"
  TAG="$ANTERIOR" compose up -d app
  exit 1
fi

echo "$NUEVA" > "$REGISTRO"
log "✓ Desplegada la versión $NUEVA (la anterior era $ANTERIOR)."
log "  Para volver atrás: sudo TAG=$ANTERIOR docker compose --project-directory $DIR up -d app"
