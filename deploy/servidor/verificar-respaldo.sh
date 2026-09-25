#!/usr/bin/env bash
# ============================================================
# Verificación de un respaldo: lo RESTAURA en una base temporal y compara la
# cantidad de filas de cada tabla con las registradas al respaldar. Después
# borra la base temporal. No toca la base del sistema.
# (lo instala 03-configurar-respaldos.sh como /usr/local/sbin/tcv-verificar-respaldo)
#
# Uso (como root):
#   tcv-verificar-respaldo              # verifica el último respaldo
#   tcv-verificar-respaldo <archivo>    # verifica uno en particular
#
# Usa el acceso de root a MySQL por socket (el predeterminado en Ubuntu).
# ============================================================
set -euo pipefail

# shellcheck source=/dev/null
source /etc/tcv-respaldo.conf   # BD, DIR_RESPALDOS

log() { echo "[$(date '+%F %T')] $*"; }

ARCHIVO="${1:-$(ls -1t "$DIR_RESPALDOS"/"${BD}"_*.sql.gz 2>/dev/null | head -n 1)}"
[[ -n "$ARCHIVO" && -f "$ARCHIVO" ]] || { log "✗ No hay respaldos para verificar en $DIR_RESPALDOS."; exit 1; }
[[ -f "$ARCHIVO.conteos" ]] || { log "✗ Falta $ARCHIVO.conteos (el registro de filas del respaldo)."; exit 1; }

mysql -e 'SELECT 1' >/dev/null 2>&1 \
  || { log "✗ root no puede conectarse a MySQL por socket; no se puede verificar."; exit 1; }

TEMPORAL="tcv_verificacion_$(date +%s)"
trap 'mysql -e "DROP DATABASE IF EXISTS \`$TEMPORAL\`" >/dev/null 2>&1 || true' EXIT

mysql -e "CREATE DATABASE \`$TEMPORAL\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
if ! zcat "$ARCHIVO" 2>/dev/null | mysql --default-character-set=utf8mb4 "$TEMPORAL" 2>/dev/null; then
  log "✗ El respaldo $(basename "$ARCHIVO") NO se puede restaurar (archivo dañado o incompleto)."
  exit 1
fi

DIFERENCIAS=0
while read -r tabla esperado; do
  obtenido="$(mysql -N -B -e "SELECT COUNT(*) FROM \`$TEMPORAL\`.\`$tabla\`" </dev/null 2>/dev/null || echo 'FALTA')"
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
