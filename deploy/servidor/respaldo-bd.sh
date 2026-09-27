#!/usr/bin/env bash
# ============================================================
# Respaldo diario de la base del ERP (MySQL en Docker).
# Se instala como /usr/local/sbin/tcv-respaldo-bd y lo corre cron como root
# (ver docs/operacion/SERVIDOR.md → Respaldos).
# ============================================================
# 1. Registra la cantidad de filas de cada tabla (<archivo>.conteos), para
#    poder verificar después que la restauración está completa.
# 2. Vuelca la base sin frenar el sistema (--single-transaction), comprimido,
#    y comprueba que el archivo esté sano y completo antes de conservarlo.
# 3. Lo cifra con la clave PÚBLICA de age (el servidor no puede descifrarlo)
#    y sube la copia cifrada a Google Drive con rclone.
# 4. Retención local (DIAS_DIARIOS + el primero de cada mes por
#    DIAS_MENSUALES) y en Drive (diarios/ y mensuales/).
#
# Configuración: /etc/tcv-respaldo.conf
# Si la subida a Drive falla (por ejemplo, cuota de Google agotada), el
# respaldo local queda igual, el script termina bien (un deploy no se frena
# por eso) y lo avisa en /var/log/tcv-respaldo-bd.log. La subida se
# reintenta con:
#   tcv-respaldo-bd --reintentar-subida   (cron cada 3 horas: sube el último
#                                          respaldo local si todavía no está en Drive)
# ============================================================
set -euo pipefail

# shellcheck source=/dev/null
source "${TCV_RESPALDO_CONF:-/etc/tcv-respaldo.conf}"
# DIR_PROYECTO, DIR_RESPALDOS, DIAS_DIARIOS, DIAS_MENSUALES,
# CLAVE_PUBLICA_AGE, RCLONE_CONFIG, RCLONE_DESTINO, DIAS_DRIVE_DIARIOS, DIAS_DRIVE_MENSUALES

log() { echo "[$(date '+%F %T')] $*"; }
umask 027

compose() { docker compose --project-directory "$DIR_PROYECTO" "$@"; }
# Ejecuta un comando de MySQL dentro del contenedor, como root de MySQL
# (la contraseña se toma del entorno del propio contenedor).
en_bd() { compose exec -T db sh -c "MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" $1"; }

# Sube a Drive un respaldo local (cifrado) y su .conteos. Registra en
# ULTIMO_SUBIDO la fecha y el archivo. Devuelve error si la subida falla.
subir_a_drive() {
  local archivo="$1" cifrado
  cifrado="$(mktemp "${TMPDIR:-/tmp}/tcv-respaldo.XXXXXX")"
  age -R "$CLAVE_PUBLICA_AGE" -o "$cifrado" "$archivo" || { rm -f "$cifrado"; return 1; }
  local RC=(rclone --config "$RCLONE_CONFIG" --retries 3 --low-level-retries 10)
  local nombre; nombre="$(basename "$archivo")"
  local ok=0
  "${RC[@]}" copyto "$cifrado" "$RCLONE_DESTINO/diarios/$nombre.age"     && "${RC[@]}" copy "$archivo.conteos" "$RCLONE_DESTINO/diarios/" || ok=1
  # Primer respaldo de cada mes: también a mensuales/
  if [[ $ok -eq 0 && "$nombre" =~ _[0-9]{6}01_ ]]; then
    "${RC[@]}" copyto "$cifrado" "$RCLONE_DESTINO/mensuales/$nombre.age"       && "${RC[@]}" copy "$archivo.conteos" "$RCLONE_DESTINO/mensuales/" || ok=1
  fi
  rm -f "$cifrado"
  [[ $ok -eq 0 ]] || return 1
  "${RC[@]}" delete --min-age "${DIAS_DRIVE_DIARIOS}d" "$RCLONE_DESTINO/diarios/" || true
  "${RC[@]}" delete --min-age "${DIAS_DRIVE_MENSUALES}d" "$RCLONE_DESTINO/mensuales/" || true
  printf '%s %s
' "$(date '+%F %T')" "$nombre" > "$DIR_RESPALDOS/ULTIMO_SUBIDO"
  log "✓ Copia cifrada subida a $RCLONE_DESTINO/diarios/$nombre.age"
}

# Modo reintento: sube el último respaldo local si todavía no está en Drive.
if [[ "${1:-}" == "--reintentar-subida" ]]; then
  ultimo="$(ls -1t "$DIR_RESPALDOS"/*.sql.gz 2>/dev/null | head -n 1)"
  [[ -n "$ultimo" ]] || exit 0
  subido="$(awk '{print $3}' "$DIR_RESPALDOS/ULTIMO_SUBIDO" 2>/dev/null || true)"
  [[ "$subido" == "$(basename "$ultimo")" ]] && exit 0
  log "↻ Reintentando la subida de $(basename "$ultimo")"
  subir_a_drive "$ultimo" || { log "⚠ La subida volvió a fallar; se reintenta en la próxima pasada."; exit 1; }
  exit 0
fi

BD="$(en_bd 'printf %s "$MYSQL_DATABASE"')"
[[ "$BD" =~ ^[A-Za-z0-9_]+$ ]] || { log "✗ No se pudo leer el nombre de la base del contenedor db."; exit 1; }

FECHA="$(date +%Y%m%d_%H%M%S)"
DESTINO="$DIR_RESPALDOS/${BD}_${FECHA}.sql.gz"
PARCIAL="$DESTINO.parcial"
trap 'rm -f "$PARCIAL" "$PARCIAL.conteos"' EXIT
trap 'log "✗ Falló el respaldo de $BD (ver el error anterior)."' ERR

# 1. Filas por tabla, justo antes del volcado
compose exec -T db sh -s "$BD" > "$PARCIAL.conteos" <<'CONTAR'
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
for t in $(mysql -uroot -N -B -e "SELECT table_name FROM information_schema.tables
            WHERE table_schema = '$1' AND table_type = 'BASE TABLE' ORDER BY table_name"); do
  echo "$t $(mysql -uroot -N -B -e "SELECT COUNT(*) FROM \`$1\`.\`$t\`")"
done
CONTAR
[[ -s "$PARCIAL.conteos" ]] || { log "✗ No se pudieron contar las filas de $BD."; exit 1; }

# 2. Volcado comprimido (pipefail: si mysqldump falla, falla todo)
en_bd "mysqldump -uroot --single-transaction --quick --no-tablespaces --triggers --routines \
        --default-character-set=utf8mb4 '$BD'" | gzip -9 > "$PARCIAL"
gzip -t "$PARCIAL"
zcat "$PARCIAL" | tail -n 1 | grep -q 'Dump completed' \
  || { log "✗ El volcado quedó incompleto; no se conserva."; exit 1; }

mv "$PARCIAL" "$DESTINO"
mv "$PARCIAL.conteos" "$DESTINO.conteos"
chgrp sudo "$DESTINO" "$DESTINO.conteos" 2>/dev/null || true
date '+%F %T' > "$DIR_RESPALDOS/ULTIMO_OK"
log "✓ Respaldo local $(basename "$DESTINO") ($(du -h "$DESTINO" | cut -f1), $(wc -l < "$DESTINO.conteos") tablas)"

# 3. Retención local
find "$DIR_RESPALDOS" -maxdepth 1 -name "${BD}_*.sql.gz" -mtime +"$DIAS_DIARIOS" | while read -r viejo; do
  dia="$(basename "$viejo" | sed -E "s/^${BD}_[0-9]{6}([0-9]{2})_.*/\1/")"
  if [[ "$dia" == "01" && -n "$(find "$viejo" -mtime -"$DIAS_MENSUALES")" ]]; then
    continue   # primer respaldo del mes: se conserva más tiempo
  fi
  rm -f "$viejo" "$viejo.conteos"
  log "• Eliminado por antigüedad: $(basename "$viejo")"
done

# 4. Copia cifrada en Google Drive. Si falla, el respaldo local ya está hecho:
# se avisa y lo reintenta el cron (--reintentar-subida).
trap - ERR
if ! subir_a_drive "$DESTINO"; then
  log "⚠ Respaldo local OK, pero falló la subida a Drive. Se reintenta automáticamente (tcv-respaldo-bd --reintentar-subida)."
fi
