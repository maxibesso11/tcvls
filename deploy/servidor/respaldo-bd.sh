#!/usr/bin/env bash
# ============================================================
# Respaldo de la base de datos del ERP (lo instala 03-configurar-respaldos.sh
# como /usr/local/sbin/tcv-respaldo-bd y lo corre cron todos los días).
# ============================================================
# - Volcado consistente sin frenar el sistema (--single-transaction).
# - Comprimido; se verifica que el archivo esté completo antes de conservarlo.
# - Junto a cada respaldo guarda la cantidad de filas de cada tabla
#   (<archivo>.conteos) para poder verificarlo después al restaurarlo.
# - Retención: los diarios de los últimos DIAS_DIARIOS días, y el primero de
#   cada mes durante DIAS_MENSUALES días.
# Configuración: /etc/tcv-respaldo.conf · credenciales: /etc/tcv-respaldo.cnf
# ============================================================
set -euo pipefail

CONF=/etc/tcv-respaldo.conf
CNF=/etc/tcv-respaldo.cnf
# shellcheck source=/dev/null
source "$CONF"   # BD, DIR_RESPALDOS, DIAS_DIARIOS, DIAS_MENSUALES

log() { echo "[$(date '+%F %T')] $*"; }
umask 027

FECHA="$(date +%Y%m%d_%H%M%S)"
DESTINO="$DIR_RESPALDOS/${BD}_${FECHA}.sql.gz"
PARCIAL="$DESTINO.parcial"
trap 'rm -f "$PARCIAL" "$PARCIAL.conteos"' EXIT
trap 'log "✗ Falló el respaldo de $BD (ver el error anterior). No se generó archivo."' ERR

sql() { mysql --defaults-extra-file="$CNF" -N -B -e "$1" </dev/null; }

# 1. Filas por tabla, justo antes del volcado (para verificar la restauración)
sql "SELECT table_name FROM information_schema.tables
      WHERE table_schema = '$BD' AND table_type = 'BASE TABLE' ORDER BY table_name" |
while read -r tabla; do
  echo "$tabla $(sql "SELECT COUNT(*) FROM \`$BD\`.\`$tabla\`")"
done > "$PARCIAL.conteos"

# 2. Volcado comprimido (pipefail: si mysqldump falla, falla todo)
mysqldump --defaults-extra-file="$CNF" --single-transaction --quick --no-tablespaces \
  --triggers --default-character-set=utf8mb4 "$BD" | gzip -9 > "$PARCIAL"

# 3. Verificar que el archivo esté sano y completo
gzip -t "$PARCIAL"
zcat "$PARCIAL" | tail -n 1 | grep -q 'Dump completed' \
  || { log "✗ El volcado quedó incompleto; no se conserva."; exit 1; }

mv "$PARCIAL" "$DESTINO"
mv "$PARCIAL.conteos" "$DESTINO.conteos"
chgrp sudo "$DESTINO" "$DESTINO.conteos" 2>/dev/null || true
date '+%F %T' > "$DIR_RESPALDOS/ULTIMO_OK"
log "✓ Respaldo $(basename "$DESTINO") ($(du -h "$DESTINO" | cut -f1), $(wc -l < "$DESTINO.conteos") tablas)"

# 4. Retención
find "$DIR_RESPALDOS" -maxdepth 1 -name "${BD}_*.sql.gz" -mtime +"$DIAS_DIARIOS" | while read -r viejo; do
  dia="$(basename "$viejo" | sed -E "s/^${BD}_[0-9]{6}([0-9]{2})_.*/\1/")"
  if [[ "$dia" == "01" && -n "$(find "$viejo" -mtime -"$DIAS_MENSUALES")" ]]; then
    continue   # primer respaldo del mes: se conserva más tiempo
  fi
  rm -f "$viejo" "$viejo.conteos"
  log "• Eliminado por antigüedad: $(basename "$viejo")"
done
