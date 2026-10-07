# Operación del servidor (VPS con Docker)

Cómo está armado el servidor y las tareas de todos los días. La puesta a punto
inicial (paso de PM2 a Docker, HTTPS, respaldos en Drive y SSH) está en
[MIGRACION_DOCKER.md](MIGRACION_DOCKER.md).

## Cómo está armado

| Qué | Dónde |
|-----|-------|
| App (Node) y base (MySQL 8.0.46) | Contenedores de Docker `tcvls-app-1` y `tcvls-db-1` |
| Configuración | `/opt/tcvls/.env` (solo root), `/opt/tcvls/docker-compose.yml` |
| Datos de MySQL | Volumen de Docker `tcvls_datos-mysql` |
| Imagen de la app | Docker Hub `tcvls/tcvls-app` (privado), versión en `TAG=` del `.env` |
| Nginx (HTTPS, redirección desde HTTP y www) | `/etc/nginx/sites-available/tcvls` + `/etc/nginx/snippets/tcvls-ssl.conf` |
| Certificado | Let's Encrypt, se renueva solo (`certbot renew`) |
| Respaldos | `/var/backups/tcv-bd` y Google Drive `TCV-LogiSuite-respaldos/` (cifrados) |
| Usuario del sistema | `tcvls`: dueño de `/opt/tcvls`; la app corre con su uid, sin root |

En el servidor no hay código fuente ni git: solo la imagen. La app escucha en
`127.0.0.1:3001` y la base no se publica fuera de Docker.

## Publicar y desplegar una versión

1. **[PC]** Con los cambios commiteados (y subidos a GitHub), en Git Bash:

   ```bash
   deploy/publicar-imagen.sh
   ```

   Corre los tests, construye la imagen desde el commit y la sube a Docker Hub.
   Al final imprime el comando del paso 2. Las credenciales están en
   `~/.docker-tcvls/credenciales` (usuario en la primera línea y access token
   Read & Write en la segunda). Son aparte de las de Docker Desktop.

2. **[VPS]**

   ```bash
   sudo /opt/tcvls/deploy/desplegar.sh <COMMIT>
   ```

   Hace un respaldo, baja la imagen, aplica las migraciones pendientes y
   reinicia la app (unos segundos de corte). Si la versión nueva no responde,
   vuelve sola a la anterior.

**Volver a una versión anterior:** `sudo /opt/tcvls/deploy/desplegar.sh <COMMIT anterior>`.
Las migraciones no se deshacen: si una versión nueva cambió la base de forma
incompatible, hay que restaurar el respaldo que se hizo antes de desplegarla.

**Si cambia `docker-compose.yml` o un script de `deploy/`** (no es lo
habitual), copiarlo al servidor como en MIGRACION_DOCKER.md, paso A3.

## Comandos útiles

```bash
cd /opt/tcvls
sudo docker compose ps                        # estado y salud
sudo docker compose logs -f --tail 100 app    # logs de la app (Ctrl+C para salir)
sudo docker compose restart app               # reiniciar la app
sudo docker compose run --rm app node backend/database/migrar.js --estado   # migraciones
sudo docker compose run --rm app node scripts/verificar-entorno.js          # verificar el entorno
sudo docker compose run --rm app node backend/database/alta-cliente.js      # alta de un cliente (ver ALTA_DE_CLIENTE.md)
sudo docker compose run --rm app node scripts/auditar-cuentas.js            # auditoría de cuentas
sudo docker compose exec db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE"'  # consola SQL
```

## Respaldos

| Qué | Cuándo |
|-----|--------|
| Respaldo, cifrado y subida a Drive | Todos los días, 03:30 de Argentina, y antes de cada despliegue |
| Reintento de la subida si falló (cuota de Google) | Cada 3 horas, solo si el último respaldo no está en Drive |
| Verificación: se restaura en una base temporal y se comparan las filas de cada tabla | Domingos, 04:00 de Argentina |
| Retención local | 14 días + el primero de cada mes por 6 meses |
| Retención en Drive | `diarios/` 30 días, `mensuales/` 400 días |

```bash
sudo tail -n 20 /var/log/tcv-respaldo-bd.log        # últimos respaldos y verificaciones
sudo cat /var/backups/tcv-bd/ULTIMO_OK /var/backups/tcv-bd/ULTIMO_SUBIDO
sudo tcv-respaldo-bd                                 # respaldo manual
sudo tcv-verificar-respaldo                          # verificar el último ahora
```

`ULTIMO_SUBIDO` dice cuándo se subió y qué archivo. Si no es el último
respaldo local, la subida está pendiente: el cron la reintenta cada 3 horas, o
se fuerza con `sudo tcv-respaldo-bd --reintentar-subida`. Si falla varios días
seguidos, mirá el log. Puede ser la cuota compartida de rclone (solución:
MIGRACION_DOCKER.md, paso B2-bis) o que se haya revocado el acceso (se rehace
con el paso B2).

### Restaurar sobre la base del sistema

Reemplaza todos los datos actuales. Antes, un respaldo manual.

```bash
sudo tcv-respaldo-bd
cd /opt/tcvls
sudo docker compose stop app
zcat /var/backups/tcv-bd/<archivo>.sql.gz | sudo docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 "$MYSQL_DATABASE"'
sudo docker compose start app
```

### Recuperar un respaldo desde Google Drive (por ejemplo, si se perdió el servidor)

**[PC]** Hace falta la clave privada de respaldos (`AGE-SECRET-KEY-1…`), que
está en el gestor de contraseñas.

```powershell
winget install FiloSottile.age
# guardar la clave privada en clave.txt (y borrarlo al terminar)
age -d -i clave.txt tcvdb_AAAAMMDD_HHMMSS.sql.gz.age > tcvdb.sql.gz
```

El `.sql.gz` resultante se carga como en *Restaurar*. El `.conteos` que está
al lado en Drive dice cuántas filas tiene que tener cada tabla.

## Seguridad

- SSH solo con clave, sin contraseñas ni root (`/etc/ssh/sshd_config.d/00-tcv-seguridad.conf`).
  Para agregar a alguien: su clave pública va en `~/.ssh/authorized_keys` de su usuario.
- Firewall (ufw): solo 22, 80 y 443.
- Secretos en `/opt/tcvls/.env` (solo root). **`CERT_SECRET` no se cambia
  nunca** y tiene copia en los gestores de contraseñas.
- Docker Hub: el servidor tiene un token de solo lectura (`sudo docker login`).
  Cada persona que publica tiene su propio token Read & Write, revocable por separado.
