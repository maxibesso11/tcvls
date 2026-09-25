# Puesta a punto del servidor (VPS)

Tres scripts dejan el servidor en condiciones básicas de seguridad y con
respaldos automáticos. Están en `deploy/servidor/`.

- **No reinician el ERP, ni Nginx, ni MySQL.** Solo el paso 2 recarga la
  configuración de SSH, y eso no corta las sesiones abiertas.
- Se pueden correr más de una vez.

| Paso | Script | Qué hace |
|------|--------|----------|
| 1 | `01-crear-usuario-admin.sh` | Crea un usuario administrador (grupo `sudo`) que entra con tu clave SSH |
| 2 | `02-endurecer-ssh.sh` | SSH solo con clave: sin contraseñas y sin ingreso directo de root |
| 3 | `03-configurar-respaldos.sh` | Respaldo diario de la base, verificación semanal y retención |

> **Regla de oro:** no cierres nunca la sesión de root en la que estás
> trabajando hasta haber probado, en **otra** terminal, que el acceso nuevo
> funciona. Si algo sale mal, siempre queda la **consola web del panel de
> Hostinger** (VPS → terminal del navegador), que no depende de SSH.

---

## Paso 0 — Tu clave SSH (en tu PC, una sola vez)

En PowerShell:

```powershell
ssh-keygen -t ed25519 -C "tu_nombre@pc"      # Enter para aceptar la ruta; poné una frase de paso
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copiá la línea que empieza con `ssh-ed25519`: es tu clave **pública** y se puede
compartir. El otro archivo (`id_ed25519`, sin `.pub`) es la **privada** y no sale
nunca de tu PC.

## Llevar los scripts al servidor

Como root en el VPS, sin tocar el código que está corriendo:

```bash
cd /root/tcvls && git fetch origin
mkdir -p /root/tcv-servidor
git archive origin/dev deploy/servidor | tar -x -C /root/tcv-servidor --strip-components=2
ls /root/tcv-servidor
```

`git fetch` solo descarga; no cambia los archivos de `/root/tcvls`. Si el repositorio
pide credenciales, copiá la carpeta desde tu PC:
`scp -r deploy/servidor root@<IP>:/root/tcv-servidor`.

## Paso 1 — Usuario administrador

```bash
bash /root/tcv-servidor/01-crear-usuario-admin.sh tcvadmin "ssh-ed25519 AAAA...tu clave pública..."
```

Te pide una contraseña para `sudo`. Se usa para las tareas de administrador,
no para entrar por SSH. **Probá en una terminal nueva de tu PC:**

```bash
ssh tcvadmin@<IP>
sudo whoami          # tiene que responder: root
```

## Paso 2 — SSH solo con clave

Solo si el paso 1 funcionó:

```bash
bash /root/tcv-servidor/02-endurecer-ssh.sh tcvadmin
```

El script no avanza si el usuario no tiene clave cargada, no está en `sudo` o
no tiene contraseña para `sudo`. Te pide confirmar escribiendo `SI`. Verifica la
configuración con `sshd -t` y además comprueba la configuración **efectiva**: en
Ubuntu, el archivo de cloud-init suele habilitar las contraseñas. Si algo no
cierra, deshace el cambio solo.

**Probá en otra terminal:** `ssh tcvadmin@<IP>` entra; `ssh root@<IP>` es rechazado.

Para deshacerlo (desde la sesión abierta o la consola web de Hostinger):

```bash
rm /etc/ssh/sshd_config.d/00-tcv-seguridad.conf && systemctl reload ssh
```

Desde acá, para administrar: `ssh tcvadmin@<IP>` y `sudo -i` cuando haga falta ser root.

## Paso 3 — Respaldos automáticos

```bash
sudo bash /root/tcv-servidor/03-configurar-respaldos.sh /root/tcvls/.env
```

Lee el nombre de la base de `DB_NAME` del `.env` y deja todo esto:

| Qué | Dónde |
|-----|-------|
| Usuario de MySQL de **solo lectura** para respaldar | `tcv_respaldo` (credenciales en `/etc/tcv-respaldo.cnf`, solo root) |
| Respaldos comprimidos + cantidad de filas de cada tabla | `/var/backups/tcv-bd/` (legibles por root y el grupo `sudo`) |
| Respaldo diario | 03:30 de Argentina (06:30 UTC) |
| Verificación semanal: restaura el último en una base temporal y compara las filas | Domingos 04:00 de Argentina |
| Registro | `/var/log/tcv-respaldo-bd.log` (rota por mes) |
| Retención | 14 días de diarios + el primero de cada mes por 6 meses |

Al terminar corre un respaldo y su verificación en el momento. Tiene que
decir `✓ Restauración verificada`.

### Operación diaria

```bash
sudo tail -n 20 /var/log/tcv-respaldo-bd.log     # últimos respaldos y verificaciones
sudo cat /var/backups/tcv-bd/ULTIMO_OK             # fecha del último respaldo correcto
sudo tcv-respaldo-bd                               # respaldo manual (por ejemplo, antes de un deploy)
sudo tcv-verificar-respaldo                        # verificar el último respaldo ahora
```

**Copia fuera del servidor.** Un respaldo que vive solo en el servidor no sirve
si se pierde el servidor. Desde tu PC, periódicamente:

```bash
scp "tcvadmin@<IP>:/var/backups/tcv-bd/*.gz" .
```

Pendiente de definir con el cliente: automatizar esta copia a un almacenamiento
externo (Google Drive, S3 o similar).

**Restaurar** sobre la base del sistema (reemplaza los datos actuales; hacer
antes un respaldo manual):

```bash
zcat /var/backups/tcv-bd/<archivo>.sql.gz | sudo mysql <DB_NAME>
```

---

## Pendiente, con autorización del cliente

Estos cambios afectan al servicio en producción. Se hacen en una ventana acordada.

### HTTPS

El certificado ya existe y se renueva solo (`certbot renew --dry-run` da OK),
pero Nginx no lo usa y el puerto 443 no está abierto.

```bash
sudo certbot install --nginx --cert-name tcvlogisuite.com    # agrega el bloque 443 y la redirección
sudo nginx -t && sudo systemctl reload nginx
```

Además hay que abrir el 443 en el firewall del panel de Hostinger, si está
activo. La recarga de Nginx no corta el servicio.

### El ERP corriendo como usuario sin privilegios

Hoy PM2 y la app corren como `root` desde `/root/tcvls`. Conviene moverlos a un
usuario de servicio el día del próximo deploy, porque implica reiniciar el proceso.

---

## Checklist del próximo deploy (versión de la rama `dev`)

1. **Respaldo manual** (`sudo tcv-respaldo-bd`) y copia a tu PC.
2. **`.env`**: la versión nueva **no arranca** sin estos secretos:
   - `CERT_SECRET` nuevo (`openssl rand -hex 48`). Guardalo también fuera del
     servidor: si se pierde, no se pueden descifrar los certificados fiscales.
   - `AUTH_SECRET` de al menos 32 caracteres. Para ver el largo actual:
     `awk -F= '/^AUTH_SECRET=/{print length($2)}' /root/tcvls/.env`.
     Si es más corto, reemplazalo (todos vuelven a iniciar sesión una vez).
3. **Migraciones 017 a 024**, en orden (ver `docs/operacion/ACTUALIZAR_SIN_PERDER_DATOS.md`).
   La 023 muestra un resumen: la lista final de movimientos sin vincular tiene que quedar vacía.
4. Actualizar el código, `npm ci --omit=dev` y reiniciar PM2.
5. Avisar a los usuarios que el sistema pasa a **/app** (la raíz muestra la página comercial).
