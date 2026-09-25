#!/usr/bin/env bash
# ============================================================
# 01 — Crear un usuario administrador (sin trabajar como root)
# ============================================================
# Crea un usuario con permisos de administrador (grupo sudo) y le autoriza tu
# clave SSH pública, para dejar de entrar al servidor como root.
# No toca el ERP ni reinicia ningún servicio. Se puede correr más de una vez.
#
# Uso (como root):
#   bash 01-crear-usuario-admin.sh <usuario> "<clave pública SSH>"
# Ejemplo:
#   bash 01-crear-usuario-admin.sh tcvadmin "ssh-ed25519 AAAAC3Nza... tomas@pc"
#
# La clave pública es el contenido del archivo .pub que genera, en tu PC:
#   ssh-keygen -t ed25519 -C "tu_nombre@pc"
# (en Windows queda en C:\Users\<vos>\.ssh\id_ed25519.pub)
# ============================================================
set -euo pipefail

USUARIO="${1:-}"
CLAVE_PUBLICA="${2:-}"

if [[ $EUID -ne 0 ]]; then echo "✗ Correlo como root (o con sudo)." >&2; exit 1; fi
if [[ -z "$USUARIO" || -z "$CLAVE_PUBLICA" ]]; then
  echo "Uso: bash $0 <usuario> \"<clave pública SSH>\"" >&2; exit 1
fi
if ! [[ "$USUARIO" =~ ^[a-z][a-z0-9_-]{2,31}$ ]]; then
  echo "✗ Nombre de usuario inválido: minúsculas, números, - o _, de 3 a 32 caracteres." >&2; exit 1
fi
if ! [[ "$CLAVE_PUBLICA" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))\ [A-Za-z0-9+/=]+ ]]; then
  echo "✗ Eso no parece una clave pública SSH (debe empezar con ssh-ed25519, ssh-rsa o ecdsa-...)." >&2
  echo "  Pegá el contenido del archivo .pub, no el de la clave privada." >&2
  exit 1
fi

# 1. Usuario (si no existe) dentro del grupo sudo
if id "$USUARIO" &>/dev/null; then
  echo "• El usuario $USUARIO ya existe; se revisa su configuración."
else
  adduser --disabled-password --gecos "" "$USUARIO" >/dev/null
  echo "✓ Usuario $USUARIO creado."
fi
usermod -aG sudo "$USUARIO"
echo "✓ $USUARIO pertenece al grupo sudo (puede administrar con 'sudo')."

# 2. Clave SSH autorizada (sin duplicarla si ya estaba)
DIR_SSH="/home/$USUARIO/.ssh"
install -d -m 700 -o "$USUARIO" -g "$USUARIO" "$DIR_SSH"
touch "$DIR_SSH/authorized_keys"
if grep -qF "$CLAVE_PUBLICA" "$DIR_SSH/authorized_keys"; then
  echo "• La clave ya estaba autorizada."
else
  echo "$CLAVE_PUBLICA" >> "$DIR_SSH/authorized_keys"
  echo "✓ Clave SSH autorizada."
fi
chown "$USUARIO:$USUARIO" "$DIR_SSH/authorized_keys"
chmod 600 "$DIR_SSH/authorized_keys"

# 3. Contraseña para sudo (el login por SSH será solo con la clave)
if [[ "$(passwd -S "$USUARIO" | awk '{print $2}')" != "P" ]]; then
  echo
  echo "Definí la contraseña que va a pedir 'sudo' para $USUARIO"
  echo "(no se usa para entrar por SSH, solo para tareas de administrador):"
  passwd "$USUARIO"
fi

echo
echo "============================================================"
echo " Listo. ANTES de seguir, probá desde tu PC en una terminal NUEVA"
echo " (sin cerrar esta sesión de root):"
echo
echo "   ssh $USUARIO@<IP-del-servidor>"
echo "   sudo whoami        # debe responder: root"
echo
echo " Si las dos cosas funcionan, podés correr 02-endurecer-ssh.sh"
echo "============================================================"
