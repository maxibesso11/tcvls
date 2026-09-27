#!/usr/bin/env bash
# ============================================================
# Verificación de un respaldo: lo RESTAURA en una base temporal (dentro del
# mismo contenedor de MySQL) y compara las filas de cada tabla con las
# registradas al respaldar. Después borra la base temporal; la base del
# sistema no se toca. Se instala como /usr/local/sbin/tcv-verificar-respaldo
# y cron la corre los domingos (ver docs/operacion/SERVIDOR.md).
#
# Uso (como root):
#   tcv-verificar-respaldo              # el último respaldo
#   tcv-verificar-respaldo <archivo>    # uno en particular (.sql.gz)
# ============================================================
set -euo pipefail

# shellcheck source=/dev/null
source "${TCV_RESPALDO_CONF:-/etc/tcv-respaldo.conf}"   # DIR_PROYECTO, DIR_RESPALDOS

log() { echo "[$(date '+%F %T')] $*"; }
compose() { docker compose --project-directory "$DIR_PROYECTO" "$@"; }
mysql_root() { compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$@"' sh "$@"; }

ARCHIVO="${1:-$(ls -1t "$DIR_RESPALDOS"/*.sql.gz 2>/dev/null | head -n 1)}"
[[ -n "$ARCHIVO" && -f "$ARCHIVO" ]] || { log "✗ No hay respaldos para verificar en $DIR_RESPALDOS."; exit 1; }
[[ -f "$ARCHIVO.conteos" ]] || { log "✗ Falta $ARCHIVO.conteos (el registro de filas del respaldo)."; exit 1; }

TEMPORAL="tcv_verificacion_$(date +%s)"
trap 'mysql_root -e "DROP DATABASE IF EXISTS \`$TEMPORAL\`" >/dev/null 2>&1 || true' EXIT

mysql_root -e "CREATE DATABASE \`$TEMPORAL\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
if ! zcat "$ARCHIVO" | mysql_root --default-character-set=utf8mb4 "$TEMPORAL"; then
  log "✗ El respaldo $(basename "$ARCHIVO") NO se puede restaurar (archivo dañado o incompleto)."
  exit 1
fi

DIFERENCIAS=0
while read -r tabla esperado; do
  obtenido="$(mysql_root -N -B -e "SELECT COUNT(*) FROM \`$TEMPORAL\`.\`$tabla\`" </dev/null 2>/dev/null || echo 'FALTA')"
  if [[ "$obtenido" != "$esperado" ]]; then
    log "✗ $tabla: se esperaban $esperado filas y se restauraron $obtenido"
    DIFERENCIAS=$((DIFERENCIAS + 1))
  fi
done < "$ARCHIVO.conteos"

TABLAS="$(wc -l < "$ARCHIVO.conteos")"
if [[ $DIFERENCIAS -eq 0 ]]; then
  log "✓ Restauración verificada: $(basename "$ARCHIVO") — $TABLAS tablas con todas sus filas."
else
  log "✗ Restauración con diferencias en $DIFERENCIAS de $TABLAS tablas: $(basename "$ARCHIVO")"
  exit 1
fi
