#!/usr/bin/env bash
# ============================================================
# Script para crear la base de datos vacía y el usuario MySQL. Ejecutar en la VPS con privilegios de MySQL:
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

echo "✓ Base y usuario de MySQL listos (la base está vacía)."
echo "  Siguiente paso: instalar las tablas y crear el administrador de plataforma:"
echo "    node backend/database/instalar.js"
echo "  y después dar de alta al primer cliente: node backend/database/alta-cliente.js"
echo "  (ver docs/operacion/ALTA_DE_CLIENTE.md)"
