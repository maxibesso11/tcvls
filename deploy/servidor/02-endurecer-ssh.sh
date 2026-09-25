#!/usr/bin/env bash
# ============================================================
# 02 — SSH solo con clave: sin contraseñas y sin root
# ============================================================
# Desactiva el ingreso por SSH con contraseña y el ingreso directo como root.
# Desde ahí solo se entra con la clave SSH del usuario administrador creado
# con 01-crear-usuario-admin.sh, y se administra con 'sudo'.
#
# Las sesiones abiertas NO se cortan. Solo se recarga la configuración de SSH:
# no reinicia el ERP, ni Nginx, ni MySQL.
#
# Uso (como root), DESPUÉS de haber probado en otra terminal que
# 'ssh <usuario>@<IP>' y 'sudo whoami' funcionan:
#   bash 02-endurecer-ssh.sh <usuario>
#
# Para deshacerlo (por ejemplo desde la consola web de Hostinger):
#   rm /etc/ssh/sshd_config.d/00-tcv-seguridad.conf && systemctl reload ssh
# ============================================================
set -euo pipefail

USUARIO="${1:-}"
YA_PROBADO="${2:-}"   # --ya-probe: omite la confirmación interactiva
ARCHIVO=/etc/ssh/sshd_config.d/00-tcv-seguridad.conf

fallar() { echo "✗ $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fallar "Correlo como root (o con sudo)."
[[ -n "$USUARIO" ]] || fallar "Uso: bash $0 <usuario-administrador>"

# ---- Controles para no quedarse afuera ----
id "$USUARIO" &>/dev/null || fallar "El usuario $USUARIO no existe. Corré primero 01-crear-usuario-admin.sh."
id -nG "$USUARIO" | tr ' ' '\n' | grep -qx sudo || fallar "$USUARIO no está en el grupo sudo: no podrías administrar el servidor."
[[ "$(passwd -S "$USUARIO" | awk '{print $2}')" == "P" ]] || fallar "$USUARIO no tiene contraseña para sudo. Corré: passwd $USUARIO"
CLAVES="/home/$USUARIO/.ssh/authorized_keys"
[[ -s "$CLAVES" ]] && grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp)' "$CLAVES" \
  || fallar "$USUARIO no tiene ninguna clave SSH autorizada en $CLAVES."
grep -qiE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config \
  || fallar "/etc/ssh/sshd_config no incluye sshd_config.d/*.conf; revisalo a mano antes de seguir."

if [[ "$YA_PROBADO" != "--ya-probe" ]]; then
  echo "Vas a desactivar el ingreso por contraseña y el ingreso como root."
  echo "¿Ya probaste en OTRA terminal que 'ssh $USUARIO@<IP>' entra con tu clave"
  read -r -p "y que 'sudo whoami' responde root? Escribí SI para continuar: " RESPUESTA
  [[ "$RESPUESTA" == "SI" ]] || fallar "Cancelado. No se cambió nada."
fi

# ---- Configuración ----
# El nombre empieza con 00- a propósito: sshd usa el PRIMER valor que
# encuentra, y así esta configuración gana sobre otras (por ejemplo la de
# cloud-init, que en Ubuntu suele habilitar las contraseñas).
[[ -f "$ARCHIVO" ]] && cp -p "$ARCHIVO" "$ARCHIVO.anterior"
cat > "$ARCHIVO" <<'CONF'
# Gestionado por TCV LogiSuite (deploy/servidor/02-endurecer-ssh.sh)
# Ingreso solo con clave SSH; root no entra por SSH (se usa sudo).
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
PermitRootLogin no
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
CONF
chmod 644 "$ARCHIVO"

deshacer() {
  if [[ -f "$ARCHIVO.anterior" ]]; then mv "$ARCHIVO.anterior" "$ARCHIVO"; else rm -f "$ARCHIVO"; fi
}

if ! sshd -t; then
  deshacer
  fallar "La configuración de SSH no es válida; se deshizo el cambio."
fi

# Verificar la configuración EFECTIVA (otra regla podría pisar la nuestra)
EFECTIVA="$(sshd -T 2>/dev/null)"
for esperado in "passwordauthentication no" "kbdinteractiveauthentication no" "permitrootlogin no"; do
  if ! grep -qx "$esperado" <<<"$EFECTIVA"; then
    deshacer
    fallar "Otra configuración de SSH pisa '$esperado'. Revisá /etc/ssh/sshd_config y sshd_config.d/. Se deshizo el cambio."
  fi
done

# Recargar SSH sin cortar las sesiones abiertas
if [[ -d /run/systemd/system ]]; then
  if systemctl is-active --quiet ssh; then systemctl reload ssh; fi
else
  pkill -HUP -o -x sshd || true   # sin systemd (por ejemplo, un contenedor de prueba)
fi
rm -f "$ARCHIVO.anterior"

echo "✓ SSH endurecido: solo clave, sin contraseña y sin root."
echo
echo "Probá YA desde tu PC, sin cerrar esta sesión:"
echo "   ssh $USUARIO@<IP>          # debe entrar con la clave"
echo "   ssh root@<IP>              # debe ser rechazado"
echo "Si algo falla, desde esta sesión deshacé con:"
echo "   rm $ARCHIVO && systemctl reload ssh"
