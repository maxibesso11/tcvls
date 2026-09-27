# Actualización a Docker, HTTPS y respaldos en Drive — paso a paso

Guía para pasar el servidor de la versión v01 (Node con PM2 como root y MySQL
del sistema) a la versión nueva en Docker. Se hace una sola vez. Después, la
operación diaria está en [SERVIDOR.md](SERVIDOR.md).

**Cómo usar esta guía**

- Los comandos se corren en el VPS, conectado como `tcvls`, salvo los que
  dicen **[PC]**, que van en tu computadora (Git Bash o PowerShell).
- Después de cada bloque hay un **✔ Esperado**. Si la salida no coincide,
  pará ahí.
- En los comandos, `<IP>` es la IP del VPS y `<COMMIT>` es la versión que
  imprime `publicar-imagen.sh`.
- **Nada de las fases A y B corta el servicio.** El corte es solo la fase C
  (unos 20 minutos), y tiene su vuelta atrás.

| Fase | Qué | ¿Corta el servicio? |
|------|-----|---------------------|
| A | Respaldo, Docker, carpeta del sistema, `.env`, imagen y ensayo con una copia | No |
| B | Respaldos diarios cifrados en Google Drive | No |
| C | Corte: datos finales, migraciones, Nginx con HTTPS | Sí (~20 min) |
| D | SSH solo con clave | No |
| E | Pendientes posteriores | No |

---

## Fase A — Preparación

### A1. Respaldo de la base actual

```bash
sudo install -d -m 750 -o root -g sudo /var/backups/tcv-bd
sudo sh -c 'mysqldump --single-transaction --routines --triggers --default-character-set=utf8mb4 tcvdb | gzip > /var/backups/tcv-bd/previo_docker_$(date +%Y%m%d_%H%M).sql.gz'
sudo sh -c 'zcat /var/backups/tcv-bd/previo_docker_*.sql.gz | tail -n 1'
sudo ls -lh /var/backups/tcv-bd/
```

✔ Esperado: `-- Dump completed on …` y un archivo de unos 50 KB o más.

**[PC]** Guardá una copia fuera del servidor:

```bash
scp "tcvls@<IP>:/var/backups/tcv-bd/previo_docker_*.sql.gz" .
```

Si `scp` no puede leerlo por permisos, en el VPS:
`sudo cp /var/backups/tcv-bd/previo_docker_*.sql.gz ~ && sudo chown tcvls ~/previo_docker_*.sql.gz`
y copiá desde `~`. Después borralo de `~`.

### A2. Instalar Docker (repositorio oficial)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin age rclone
sudo docker run --rm hello-world
docker compose version; age --version; rclone version | head -n 1
```

✔ Esperado: `Hello from Docker!` y las versiones (compose v2, age 1.1, rclone 1.60).

> No agregues `tcvls` al grupo `docker`: ese grupo equivale a ser root. Los
> comandos de Docker se corren con `sudo`.
> Docker publica la app solo en `127.0.0.1:3001` y la base no se publica, así
> que el firewall (ufw) no necesita cambios.

### A3. Carpeta del sistema

En el servidor queda solo la configuración. La app viene en la imagen de Docker.

```bash
sudo install -d -o tcvls -g tcvls -m 750 /opt/tcvls /opt/tcvls/deploy /opt/tcvls/deploy/servidor
```

**[PC]** En Git Bash, desde la carpeta del repositorio en tu computadora (rama `dev` actualizada). El VPS no necesita git: estos archivos se copian una sola vez:

```bash
scp docker-compose.yml tcvls@<IP>:/opt/tcvls/
scp deploy/desplegar.sh deploy/nginx.conf deploy/nginx-ssl.conf tcvls@<IP>:/opt/tcvls/deploy/
scp deploy/servidor/respaldo-bd.sh deploy/servidor/verificar-respaldo.sh tcvls@<IP>:/opt/tcvls/deploy/servidor/
```

En el VPS:

```bash
chmod 750 /opt/tcvls/deploy/desplegar.sh /opt/tcvls/deploy/servidor/*.sh
sed -i 's/\r$//' /opt/tcvls/docker-compose.yml /opt/tcvls/deploy/*.sh /opt/tcvls/deploy/*.conf /opt/tcvls/deploy/servidor/*.sh
ls -la /opt/tcvls /opt/tcvls/deploy /opt/tcvls/deploy/servidor
```

✔ Esperado: todo con dueño `tcvls`. El `sed` quita los fines de línea de
Windows por si Git los convirtió.

### A4. Configuración (`.env`)

Se conservan `AUTH_SECRET` (tiene 61 caracteres: nadie pierde la sesión) y el
nombre de la base. Se generan contraseñas nuevas para MySQL y el
`CERT_SECRET` que exige la versión nueva.

```bash
sudo bash -c '
umask 077
AUTH=$(grep -E "^AUTH_SECRET=" /root/tcvls/.env | cut -d= -f2-)
cat > /opt/tcvls/.env <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1

DB_NAME=tcvdb
DB_USER=tcvuser
DB_PASSWORD=$(openssl rand -hex 24)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)

AUTH_SECRET=$AUTH
CERT_SECRET=$(openssl rand -hex 48)

CORS_ORIGIN=https://tcvlogisuite.com
ARCA_HABILITADO=0
ARCA_PRODUCCION=0

TCV_UID=$(id -u tcvls)
TCV_GID=$(id -g tcvls)
APP_PUERTO=3001
TZ=UTC
TCV_IMAGEN=tcvls/tcvls-app
TAG=latest
EOF
chown root:root /opt/tcvls/.env; chmod 600 /opt/tcvls/.env'
sudo grep -E '^(DB_NAME|TCV_UID|TCV_GID|TCV_IMAGEN)=' /opt/tcvls/.env
sudo awk -F= '/^(AUTH_SECRET|CERT_SECRET|DB_PASSWORD|MYSQL_ROOT_PASSWORD)=/{print $1, "largo:", length($2)}' /opt/tcvls/.env
```

✔ Esperado: `TCV_UID=1001`, `TCV_GID=1001`; `AUTH_SECRET` 61, `CERT_SECRET` 96,
las otras dos 48.

**Guardá el `CERT_SECRET` en tu gestor de contraseñas** (y compartilo con
Maxi). Si se pierde, no se pueden descifrar los certificados fiscales de ARCA.

```bash
sudo grep '^CERT_SECRET=' /opt/tcvls/.env
```

### A5. Publicar la imagen **[PC]**

1. En Docker Hub (cuenta `tcvls`) → *Account settings → Personal access
   tokens*, creá dos tokens:
   - `pc-<tu nombre>`, permiso **Read & Write**, para publicar.
   - `servidor`, permiso **Read-only**, para el VPS (se usa en A6).
2. **En tu PC, no en el VPS.** Se usa la copia del repositorio con la que
   trabajás (en el VPS no hay código ni git: recibe la imagen ya armada).
   En Git Bash, guardá el token Read & Write que acabás de crear. Es la
   única vez que se carga; el script lo lee de ese archivo en cada
   publicación, sin tocar tu sesión de Docker Desktop:

```bash
mkdir -p ~/.docker-tcvls
read -rsp 'Pegá el token Read & Write y Enter: ' TOKEN; echo
printf 'tcvls\n%s\n' "$TOKEN" > ~/.docker-tcvls/credenciales; unset TOKEN
chmod 600 ~/.docker-tcvls/credenciales
```

   (`read -s` no muestra el token ni lo deja en el historial de la terminal.)

3. Publicá la imagen desde la carpeta del repositorio en tu PC (Docker
   Desktop tiene que estar abierto):

```bash
cd ~/VSC-Proyectos/tcvls        # o donde tengas el repo
git checkout dev && git pull
deploy/publicar-imagen.sh
```

✔ Esperado: al final, `✓ Publicada tcvls/tcvls-app:<COMMIT>`. Anotá el `<COMMIT>`.

### A6. Acceso del servidor a Docker Hub

```bash
sudo docker login -u tcvls
# Password: pegá el token de SOLO LECTURA
```

✔ Esperado: `Login Succeeded`. La credencial queda en
`/root/.docker/config.json`, solo legible por root.

### A7. Ensayo con una copia de los datos (sin corte)

La app nueva se levanta en paralelo, en el puerto 3001, con una copia de la
base. La versión actual sigue atendiendo en el 3000. Todo lo que hagas en el
ensayo se descarta en la fase C.

```bash
cd /opt/tcvls
sudo docker compose pull
sudo docker compose up -d db
sudo docker compose ps          # repetir hasta que db diga (healthy)
```

Cargar la copia (el respaldo de A1) y aplicar las migraciones 017 a 026:

```bash
sudo sh -c 'zcat /var/backups/tcv-bd/previo_docker_*.sql.gz' | sudo docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 "$MYSQL_DATABASE"'
sudo docker compose run --rm app node backend/database/migrar.js --registrar-hasta 016
```

✔ Esperado: `Registradas como ya aplicadas: 16`, después `✓` de la 017 a la
026 y `Listo: 10 migración(es) aplicada(s).` En la 023, el resumen por origen.
En la 025 y la 026, las verificaciones en `0`.

```bash
sudo docker compose run --rm app node scripts/auditar-cuentas.js
sudo docker compose up -d app
sleep 15; sudo docker compose ps; curl -s 127.0.0.1:3001/api/health; echo
```

✔ Esperado:
- En la auditoría, la empresa 1 con 1 diferencia y la empresa 2 con 13: son los
  centavos de consumos ya conocidos. Cualquier otro tipo de diferencia (FALTANTE,
  DUPLICADO, HUERFANO) es para frenar y revisar.
- La app `(healthy)` y `{"servidor":"OK","base_de_datos":"OK"}`.

**[PC]** Probala en el navegador por un túnel SSH (no queda expuesta a internet):

```bash
ssh -N -L 3001:127.0.0.1:3001 tcvls@<IP>
```

Abrí `http://localhost:3001/app` y entrá con tu usuario de siempre. Revisá:
- el tablero;
- viajes filtrados por equipo, con la columna Equipo;
- **Equipos → Historial**;
- cuentas corrientes y el PDF de alguna cuenta.

Cortá el túnel con Ctrl+C.

---

## Fase B — Respaldos diarios cifrados en Google Drive

### B1. Clave de cifrado

Los respaldos se cifran con una clave **pública** que queda en el servidor. La
**privada**, la única que descifra, queda solo en los gestores de contraseñas
tuyo y de Maxi. Ni quien entre al servidor ni quien entre al Drive puede leer
los respaldos.

```bash
sudo age-keygen -o /root/tcv-respaldos-clave.txt
sudo cat /root/tcv-respaldos-clave.txt
```

Copiá **las tres líneas** (la privada empieza con `AGE-SECRET-KEY-1…`) a tu
gestor de contraseñas como *"TCV – clave de respaldos"* y pasásela a Maxi por
un medio seguro. Después:

```bash
sudo sh -c "grep -o 'age1[0-9a-z]*' /root/tcv-respaldos-clave.txt > /etc/tcv-respaldo.age.pub"
sudo cat /etc/tcv-respaldo.age.pub
sudo shred -u /root/tcv-respaldos-clave.txt
```

✔ Esperado: una línea que empieza con `age1…`. La privada ya no está en el
servidor.

### B2. Enlazar Google Drive

**[PC]** En PowerShell:

```powershell
winget install Rclone.Rclone
# Cerrá y abrí la terminal, y después:
rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"
```

Se abre el navegador: entrá con **la cuenta de Google del sistema** y
aceptá. El permiso es `drive.file`: rclone solo ve los archivos que crea él, no
el resto del Drive. La terminal imprime un código entre `Paste the following
into your remote machine --->` y `<---End paste`. Las versiones actuales de
rclone lo imprimen en base64 (empieza con `eyJ`); las viejas, como JSON
(empieza con `{`). Copialo entero. **Es la llave de acceso al Drive: no lo
pegues en chats ni lo guardes en archivos.**

En el VPS, esto arma `/etc/tcv-rclone.conf` con ese código. El rclone 1.60 del
servidor necesita el JSON, así que si viene en base64 se decodifica. Al pegarlo
no se muestra:

```bash
read -rsp 'Pegá el código de rclone authorize y Enter: ' CODIGO; echo
CODIGO=$(printf '%s' "$CODIGO" | tr -d ' \r\n')
case "$CODIGO" in
  '{'*) TOKEN="$CODIGO" ;;
  *)    TOKEN=$(printf '%s' "$CODIGO" | base64 -d | python3 -c 'import sys, json; print(json.load(sys.stdin).get("token", ""))') ;;
esac
unset CODIGO
[ -n "$TOKEN" ] && printf '[gdrive]\ntype = drive\nscope = drive.file\ntoken = %s\n' "$TOKEN" | sudo tee /etc/tcv-rclone.conf > /dev/null && echo "✓ configuración guardada"
unset TOKEN
sudo chmod 600 /etc/tcv-rclone.conf
sudo grep -c access_token /etc/tcv-rclone.conf
```

✔ Esperado: `✓ configuración guardada` y `1`.

```bash
sudo rclone --config /etc/tcv-rclone.conf mkdir gdrive:TCV-LogiSuite-respaldos
sudo rclone --config /etc/tcv-rclone.conf lsd gdrive:
```

✔ Esperado: aparece `TCV-LogiSuite-respaldos`, y la carpeta se ve en el Drive
de esa cuenta.

### B3. Programar los respaldos

```bash
sudo install -m 750 -o root -g root /opt/tcvls/deploy/servidor/respaldo-bd.sh /usr/local/sbin/tcv-respaldo-bd
sudo install -m 750 -o root -g root /opt/tcvls/deploy/servidor/verificar-respaldo.sh /usr/local/sbin/tcv-verificar-respaldo

sudo tee /etc/tcv-respaldo.conf > /dev/null <<'EOF'
# Respaldos del ERP (ver docs/operacion/SERVIDOR.md)
DIR_PROYECTO=/opt/tcvls
DIR_RESPALDOS=/var/backups/tcv-bd
DIAS_DIARIOS=14
DIAS_MENSUALES=186
CLAVE_PUBLICA_AGE=/etc/tcv-respaldo.age.pub
RCLONE_CONFIG=/etc/tcv-rclone.conf
RCLONE_DESTINO=gdrive:TCV-LogiSuite-respaldos
DIAS_DRIVE_DIARIOS=30
DIAS_DRIVE_MENSUALES=400
EOF

sudo tee /etc/cron.d/tcv-respaldo-bd > /dev/null <<'EOF'
# Respaldos del ERP. Horario en UTC: 06:30 UTC = 03:30 de Argentina.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 6 * * * root /usr/local/sbin/tcv-respaldo-bd >> /var/log/tcv-respaldo-bd.log 2>&1
0 7 * * 0 root /usr/local/sbin/tcv-verificar-respaldo >> /var/log/tcv-respaldo-bd.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/tcv-respaldo-bd

sudo tee /etc/logrotate.d/tcv-respaldo-bd > /dev/null <<'EOF'
/var/log/tcv-respaldo-bd.log {
    monthly
    rotate 12
    compress
    missingok
    notifempty
}
EOF
```

Prueba ahora mismo. Durante el ensayo respalda la copia; después del corte, la
base real:

```bash
sudo tcv-respaldo-bd
sudo tcv-verificar-respaldo
sudo rclone --config /etc/tcv-rclone.conf ls gdrive:TCV-LogiSuite-respaldos
```

✔ Esperado: `✓ Respaldo local …`, `✓ Copia cifrada subida …`,
`✓ Restauración verificada … 21 tablas con todas sus filas`, y en Drive un
`.sql.gz.age` y un `.conteos` dentro de `diarios/`.

---

## Fase C — Corte (ventana acordada)

A partir de C1 el sistema no está disponible hasta C5 (unos 20 minutos).

### C1. Frenar la versión actual

```bash
sudo pm2 stop tcv-logisuite-erp
sudo pm2 list
```

✔ Esperado: `stopped`. El sitio responde `502`: nadie puede cargar datos.

### C2. Respaldo final de la base actual

```bash
sudo sh -c 'mysqldump --single-transaction --routines --triggers --default-character-set=utf8mb4 tcvdb | gzip > /var/backups/tcv-bd/corte_$(date +%Y%m%d_%H%M).sql.gz'
sudo sh -c 'ls -lh /var/backups/tcv-bd/corte_*.sql.gz; zcat /var/backups/tcv-bd/corte_*.sql.gz | tail -n 1'
```

✔ Esperado: `-- Dump completed on …`.

### C3. Base nueva con los datos finales

Se descarta el ensayo: `down -v` borra **solo** el volumen de MySQL de Docker.
La base del sistema (`tcvdb` en el MySQL de Ubuntu) no se toca.

```bash
cd /opt/tcvls
sudo docker compose down -v
sudo docker compose up -d db
sudo docker compose ps          # repetir hasta (healthy)
sudo sh -c 'zcat /var/backups/tcv-bd/corte_*.sql.gz' | sudo docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 "$MYSQL_DATABASE"'
sudo docker compose run --rm app node backend/database/migrar.js --registrar-hasta 016
sudo docker compose run --rm app node scripts/auditar-cuentas.js
sudo docker compose up -d app
sleep 15; sudo docker compose ps; curl -s 127.0.0.1:3001/api/health; echo
```

✔ Esperado: lo mismo que en A7.

### C4. Nginx con HTTPS

```bash
sudo grep -E '^(authenticator|webroot_path)' /etc/letsencrypt/renewal/tcvlogisuite.com.conf
sudo cp /opt/tcvls/deploy/nginx-ssl.conf /etc/nginx/snippets/tcvls-ssl.conf
sudo cp /opt/tcvls/deploy/nginx.conf /etc/nginx/sites-available/tcvls
sudo ln -s /etc/nginx/sites-available/tcvls /etc/nginx/sites-enabled/tcvls
sudo rm /etc/nginx/sites-enabled/tcv-erp      # solo el enlace; la config vieja queda en sites-available
sudo nginx -t && sudo systemctl reload nginx
```

✔ Esperado: `syntax is ok` y `test is successful`. Anotá el `authenticator` de
la primera línea para C6.

En el panel de Hostinger, en *VPS → Seguridad → Firewall*, si hay reglas
activas, verificá que el **443/TCP** esté permitido. El ufw del servidor ya lo
permite.

### C5. Verificar

**[PC]**

```bash
curl -sI http://tcvlogisuite.com | head -n 3            # 301 → https://tcvlogisuite.com/
curl -sI http://www.tcvlogisuite.com | head -n 3        # 301 → https://tcvlogisuite.com/
curl -sI https://www.tcvlogisuite.com | head -n 3       # 301 → https://tcvlogisuite.com/
curl -s https://tcvlogisuite.com/api/health; echo       # {"servidor":"OK","base_de_datos":"OK"}
curl -sI https://tcvlogisuite.com/app | grep -i strict  # Strict-Transport-Security
```

En el navegador, entrá a `https://tcvlogisuite.com/app` (candado), iniciá sesión
y revisá lo mismo que en A7. **La raíz `/` ahora muestra la landing comercial;
el sistema está en `/app`.** Avisale a los usuarios.

**Si algo falla acá, volvé atrás** (ver *Vuelta atrás* abajo). Si todo está
bien, el sistema ya está en servicio.

### C6. Cerrar el corte

Primer despliegue "oficial", para probar el circuito completo (respaldo, pull,
migraciones sin pendientes y reinicio):

```bash
sudo /opt/tcvls/deploy/desplegar.sh <COMMIT>
```

✔ Esperado: `✓ Desplegada la versión <COMMIT>`. En el `.env` queda `TAG=<COMMIT>`.

Renovación del certificado:

```bash
sudo certbot renew --dry-run
```

Si falla y en C4 el authenticator era `standalone`, pasalo a webroot, que
funciona con Nginx andando:

```bash
sudo certbot reconfigure --cert-name tcvlogisuite.com --webroot -w /var/www/html
sudo certbot renew --dry-run
```

Que la versión vieja no vuelva a arrancar sola si el servidor se reinicia.
**No se borra nada**: queda como respaldo unos días.

```bash
systemctl list-unit-files | grep -i pm2
sudo systemctl disable pm2-root        # el nombre que muestre el comando anterior
```

### Vuelta atrás (antes de que se carguen datos nuevos)

La base vieja quedó intacta desde C1, así que volver es inmediato:

```bash
sudo rm /etc/nginx/sites-enabled/tcvls
sudo ln -s /etc/nginx/sites-available/tcv-erp /etc/nginx/sites-enabled/tcv-erp
sudo nginx -t && sudo systemctl reload nginx
sudo pm2 start tcv-logisuite-erp
sudo docker compose --project-directory /opt/tcvls stop app
```

Si los usuarios ya cargaron datos en la versión nueva, no vuelvas atrás así,
porque se perderían: consultame primero.

---

## Fase D — SSH solo con clave

Hacelo con el sistema ya andando y sin apuro. **No cierres la sesión en la que
estás** hasta probar el acceso en otra terminal. Si algo sale mal, siempre queda
la consola web del panel de Hostinger.

1. Que tu clave (y la de Maxi, si entra como `tcvls`) esté cargada:

   ```bash
   cat ~/.ssh/authorized_keys
   ```

   Si Maxi entra con su usuario `mbesso`, su clave va en
   `/home/mbesso/.ssh/authorized_keys`.

2. **[PC]** En otra terminal, probá que entrás **con la clave**:

   ```bash
   ssh -o PreferredAuthentications=publickey tcvls@<IP> 'echo OK con clave'
   ```

3. Solo si el paso 2 dio `OK con clave`:

   ```bash
   sudo tee /etc/ssh/sshd_config.d/00-tcv-seguridad.conf > /dev/null <<'EOF'
   # Acceso solo con clave SSH y sin ingreso directo de root.
   # (El prefijo 00- gana sobre 50-cloud-init.conf, que habilita contraseñas.)
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin no
   EOF
   sudo sshd -t && sudo sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
   ```

   ✔ Esperado: las tres en `no`.

4. Aplicar (no corta las sesiones abiertas) y probar desde **[PC]**:

   ```bash
   sudo systemctl reload ssh
   ```

   ```bash
   ssh tcvls@<IP> 'echo OK'                                      # entra
   ssh -o PubkeyAuthentication=no tcvls@<IP>                     # Permission denied
   ssh root@<IP>                                                 # Permission denied
   ```

Para deshacerlo: `sudo rm /etc/ssh/sshd_config.d/00-tcv-seguridad.conf && sudo systemctl reload ssh`.

---

## Fase E — Pendientes posteriores

- **Reconstrucción de los equipos afectados.** Cuando la empresa confirme las
  fechas, se arma el JSON y se corre `scripts/reemplazar-historial-equipo.js`:
  primero la vista previa y después `--aplicar`. Ver el encabezado del script.
- **Prueba de restauración desde Drive.** Bajar un `.age`, descifrarlo con la
  clave privada y cargarlo en una base de prueba (ver SERVIDOR.md).
- **A la semana, si todo anda:** borrar la app vieja de PM2
  (`sudo pm2 delete tcv-logisuite-erp && sudo pm2 save`), apagar el MySQL de
  Ubuntu (`sudo systemctl disable --now mysql`) y archivar `/root/tcvls`,
  incluidos sus dos respaldos sueltos (`erp_*.sql.gz`).
