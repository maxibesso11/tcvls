#!/usr/bin/env bash
# ============================================================
# Script para crear la base de datos, el usuario MySQL y cargar
# el esquema inicial. Ejecutar en la VPS con privilegios de MySQL:
#   bash deploy/setup-db.sh
# Pide la contraseña de root de MySQL.
# ============================================================
set -e

# Leer variables del .env si existe
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -E '^DB_' | xargs)
fi

DB_NAME="${DB_NAME:-erp_3_abril}"
DB_USER="${DB_USER:-erp_user}"
DB_PASSWORD="${DB_PASSWORD:-cambiar_password}"

echo "→ Creando base de datos '$DB_NAME' y usuario '$DB_USER'…"

sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "→ Cargando el esquema y los datos iniciales…"
sudo mysql "${DB_NAME}" < database/init_db.sql

echo "✓ Base de datos lista. Usuario admin/admin123 y demo/demo123 creados."
echo "  IMPORTANTE: cambiá esas contraseñas desde el panel de administración."
