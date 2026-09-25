# Guía de despliegue en una VPS

Guía paso a paso para poner el ERP en producción en un servidor VPS
(Ubuntu 22.04 / 24.04 o Debian). El resultado final: la aplicación
corriendo de forma permanente detrás de Nginx con HTTPS.

## Arquitectura

```
Internet → Nginx (puertos 80/443, HTTPS) → Node.js (puerto interno 3000) → MySQL
```

Nginx recibe el tráfico público, maneja el certificado SSL y reenvía las
peticiones a la aplicación Node, que solo escucha en localhost. MySQL
guarda los datos. PM2 (o systemd) mantiene Node corriendo y lo reinicia
si se cae o si se reinicia el servidor.

---

## 1. Preparar la VPS

Conectarse por SSH y actualizar el sistema:

```bash
ssh root@TU_IP_DE_VPS
apt update && apt upgrade -y
```

Crear un usuario sin privilegios para la aplicación (más seguro que usar root):

```bash
adduser erp
usermod -aG sudo erp
su - erp
```

## 2. Instalar Node.js, MySQL y Nginx

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# MySQL y Nginx
sudo apt install -y mysql-server nginx

# Asegurar MySQL (define contraseña de root y quita accesos de prueba)
sudo mysql_secure_installation
```

Verificar las versiones:

```bash
node -v    # debe ser >= 18
mysql --version
nginx -v
```

## 3. Subir el proyecto

Opción A — con Git (recomendado):

```bash
cd ~
git clone TU_REPOSITORIO tcv-logisuite-erp
cd tcv-logisuite-erp
```

Opción B — con SCP desde tu máquina (subiendo el ZIP):

```bash
# En tu computadora:
scp TCV_LogiSuite_ERP.zip erp@TU_IP:/home/erp/
# En la VPS:
unzip TCV_LogiSuite_ERP.zip && cd tcv-logisuite-erp
```

Instalar dependencias (solo las de producción):

```bash
npm install --omit=dev
```

## 4. Configurar las variables de entorno

```bash
cp .env.example .env
nano .env
```

Completar especialmente:
- `DB_PASSWORD`: una contraseña fuerte para el usuario de la base.
- `AUTH_SECRET`: generar con `openssl rand -hex 48` y pegar el resultado.
- `CORS_ORIGIN`: tu dominio, ej. `https://erp.midominio.com`.
- `HOST=127.0.0.1` (Node solo escucha local; Nginx hace de puente).

## 5. Crear la base de datos

El script automatiza la creación de la base, el usuario y la carga del esquema:

```bash
bash deploy/setup-db.sh
```

Esto deja dos usuarios iniciales: `admin` / `admin123` (administrador) y
`demo` / `demo123` (usuario de la empresa de ejemplo).
**Cambiá esas contraseñas apenas entres**, desde el panel de administración.

## 6. Probar que arranca

```bash
npm start
```

Si ves `✓ ERP corriendo en http://127.0.0.1:3000`, está bien. Cortá con Ctrl+C.

## 7. Mantenerlo corriendo con PM2

PM2 mantiene la app viva y la levanta sola al reiniciar la VPS:

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup           # ejecutá el comando que imprime, para arranque automático
```

Comandos útiles:

```bash
pm2 status            # ver estado
pm2 logs tcv-logisuite-erp   # ver logs en vivo
pm2 restart tcv-logisuite-erp
pm2 stop tcv-logisuite-erp
```

> Alternativa sin PM2: usar systemd con el archivo `deploy/erp.service`
> (instrucciones dentro del propio archivo).

## 8. Configurar Nginx como reverse proxy

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/erp
sudo nano /etc/nginx/sites-available/erp     # reemplazar erp.midominio.com
sudo ln -s /etc/nginx/sites-available/erp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # quitar el sitio por defecto
sudo nginx -t          # verificar que la config es válida
sudo systemctl reload nginx
```

En este punto, entrando a `http://erp.midominio.com` ya debería verse el login.

## 9. Activar HTTPS con Certbot (gratis, Let's Encrypt)

Primero apuntá el dominio a la IP de la VPS (registro A en tu DNS). Luego:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erp.midominio.com
```

Certbot obtiene el certificado, configura HTTPS y redirige HTTP→HTTPS
automáticamente. La renovación es automática.

## 10. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

No abras el puerto 3306 (MySQL) ni el 3000 (Node) al exterior: ambos
quedan accesibles solo dentro de la VPS.

---

## Mantenimiento

**Actualizar la aplicación** (con Git):

```bash
cd ~/tcv-logisuite-erp
git pull
npm install --omit=dev
pm2 restart tcv-logisuite-erp
```

**Aplicar una migración de base de datos** (cuando se agrega una):

```bash
mysql -u erp_user -p erp_3_abril < backend/database/migraciones/migracion_XXX.sql
```

**Respaldos de la base** (programar con cron):

```bash
mysqldump -u erp_user -p erp_3_abril > respaldo_$(date +%F).sql
```

Ejemplo de respaldo diario automático a las 3 AM (editá con `crontab -e`):

```
0 3 * * * mysqldump -u erp_user -pTU_PASS erp_3_abril > /home/erp/respaldos/erp_$(date +\%F).sql
```

**Ver el estado de salud** del sistema:

```bash
curl http://127.0.0.1:3000/api/health
# Debe responder: {"servidor":"OK","base_de_datos":"OK"}
```

---

## Lista de verificación de seguridad

- [ ] Cambiar las contraseñas de `admin` y `demo` apenas entrar.
- [ ] `AUTH_SECRET` es una cadena larga y aleatoria (no la de ejemplo).
- [ ] `DB_PASSWORD` es fuerte y el `.env` no está en el repositorio.
- [ ] HTTPS activo (Certbot) y HTTP redirige a HTTPS.
- [ ] Firewall (ufw) activo; solo SSH y Nginx expuestos.
- [ ] Node escucha en `127.0.0.1`, no en `0.0.0.0`.
- [ ] Respaldos automáticos de la base configurados.
