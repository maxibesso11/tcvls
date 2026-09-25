#!/usr/bin/env bash
# ============================================================
# 03 — Respaldos automáticos de la base de datos
# ============================================================
# Deja programado un respaldo diario de la base del ERP y una verificación
# semanal que lo restaura en una base temporal. No detiene el sistema ni lo
# reinicia. Se puede correr más de una vez (renueva la configuración).
#
#   - Usuario de MySQL propio y de solo lectura: tcv_respaldo
#     (sus credenciales quedan en /etc/tcv-respaldo.cnf, solo legibles por root)
#   - Respaldos en /var/backups/tcv-bd (root y el grupo sudo pueden leerlos)
#   - Diario a las 03:30 de Argentina; verificación los domingos a las 04:00
#   - Registro en /var/log/tcv-respaldo-bd.log
#   - Retención: 14 días de diarios + el primero de cada mes por 6 meses
#
# Uso (como root):
#   bash 03-configurar-respaldos.sh [ruta del .env del ERP]
#   (por defecto /root/tcvls/.env; de ahí toma DB_NAME)
# ============================================================
set -euo pipefail

ENV_ERP="${1:-/root/tcvls/.env}"
DIR_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR_RESPALDOS=/var/backups/tcv-bd
USUARIO_BD=tcv_respaldo

fallar() { echo "✗ $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fallar "Correlo como root (o con sudo)."
[[ -f "$ENV_ERP" ]] || fallar "No encuentro el .env del ERP en $ENV_ERP (pasá la ruta como argumento)."
BD="$(grep -E '^DB_NAME=' "$ENV_ERP" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"' \r')"
[[ -n "$BD" ]] || fallar "No hay DB_NAME en $ENV_ERP."
[[ "$BD" =~ ^[A-Za-z0-9_]+$ ]] || fallar "Nombre de base inesperado: $BD"
mysql -e 'SELECT 1' >/dev/null 2>&1 || fallar "root no puede conectarse a MySQL por socket (sudo mysql)."
mysql -N -e "SELECT 1 FROM information_schema.schemata WHERE schema_name = '$BD'" | grep -q 1 \
  || fallar "La base $BD no existe."

# 1. Usuario de MySQL de solo lectura para los respaldos (contraseña nueva en cada corrida)
CLAVE="$(openssl rand -hex 24)"
mysql <<SQL
CREATE USER IF NOT EXISTS '$USUARIO_BD'@'localhost' IDENTIFIED BY '$CLAVE';
ALTER USER '$USUARIO_BD'@'localhost' IDENTIFIED BY '$CLAVE';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON \`$BD\`.* TO '$USUARIO_BD'@'localhost';
FLUSH PRIVILEGES;
SQL
umask 077
cat > /etc/tcv-respaldo.cnf <<CNF
[client]
user=$USUARIO_BD
password=$CLAVE
host=localhost
CNF
chmod 600 /etc/tcv-respaldo.cnf
echo "✓ Usuario de MySQL $USUARIO_BD (solo lectura sobre $BD)."

# 2. Configuración
umask 022
cat > /etc/tcv-respaldo.conf <<CONF
# Configuración de los respaldos del ERP (deploy/servidor/03-configurar-respaldos.sh)
BD=$BD
DIR_RESPALDOS=$DIR_RESPALDOS
DIAS_DIARIOS=14
DIAS_MENSUALES=186
CONF
install -d -m 750 -o root -g sudo "$DIR_RESPALDOS"

# 3. Scripts
install -m 750 -o root -g root "$DIR_SCRIPTS/respaldo-bd.sh" /usr/local/sbin/tcv-respaldo-bd
install -m 750 -o root -g root "$DIR_SCRIPTS/verificar-respaldo.sh" /usr/local/sbin/tcv-verificar-respaldo

# 4. Programación (el servidor está en UTC: 06:30 UTC = 03:30 de Argentina)
cat > /etc/cron.d/tcv-respaldo-bd <<'CRON'
# Respaldos del ERP (deploy/servidor/03-configurar-respaldos.sh). Horario en UTC.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 6 * * * root /usr/local/sbin/tcv-respaldo-bd >> /var/log/tcv-respaldo-bd.log 2>&1
0 7 * * 0 root /usr/local/sbin/tcv-verificar-respaldo >> /var/log/tcv-respaldo-bd.log 2>&1
CRON
chmod 644 /etc/cron.d/tcv-respaldo-bd

cat > /etc/logrotate.d/tcv-respaldo-bd <<'ROTAR'
/var/log/tcv-respaldo-bd.log {
    monthly
    rotate 12
    compress
    missingok
    notifempty
}
ROTAR
echo "✓ Respaldo diario y verificación semanal programados."

# 5. Primer respaldo y su verificación, ahora mismo
echo
/usr/local/sbin/tcv-respaldo-bd | tee -a /var/log/tcv-respaldo-bd.log
/usr/local/sbin/tcv-verificar-respaldo | tee -a /var/log/tcv-respaldo-bd.log

echo
echo "============================================================"
echo " Respaldos en $DIR_RESPALDOS · registro en /var/log/tcv-respaldo-bd.log"
echo " Copia fuera del servidor (desde tu PC, con el usuario administrador):"
echo "   scp '<usuario>@<IP>:$DIR_RESPALDOS/*.gz' ."
echo " Restaurar un respaldo sobre la base del sistema (¡reemplaza los datos!):"
echo "   zcat <archivo>.sql.gz | sudo mysql $BD"
echo "============================================================"
