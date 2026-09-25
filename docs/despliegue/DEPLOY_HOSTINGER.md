# Despliegue en una VPS de Hostinger con dominio propio

Guía paso a paso para poner **TCV LogiSuite ERP** en producción en una VPS de
Hostinger, incluyendo la asociación de un nombre de dominio con HTTPS.

Resultado final: la aplicación accesible en `https://tudominio.com`, corriendo
de forma permanente detrás de Nginx, con certificado SSL gratuito.

> Esta guía complementa a `DEPLOY.md` (la guía general). Acá se detallan los
> pasos específicos del panel de Hostinger (hPanel) y la configuración del DNS.

---

## Antes de empezar necesitás

- Una **VPS de Hostinger** (se recomienda el plan KVM 2 o superior para
  producción holgada; KVM 1 alcanza para empezar).
- Un **nombre de dominio** (puede ser de Hostinger o de otro registrador).
- El proyecto, ya sea el ZIP `TCV_LogiSuite_ERP.zip` o un repositorio Git.

---

## 1. Crear/configurar la VPS en hPanel

1. Iniciá sesión en hPanel y entrá a **VPS** en el menú superior.
2. Al crear la VPS, cuando te pida la plantilla de sistema operativo, elegí
   **Ubuntu 24.04 LTS**. (Hostinger ofrece plantillas que pre-instalan Node,
   PM2 y Nginx, pero esta guía asume Ubuntu limpio para que tengas control total.)
3. Definí una **contraseña de root** fuerte y anotala.
4. Una vez creada, entrá a **VPS → Administrar** y, en la pantalla *Overview*,
   anotá la **dirección IP** del servidor (la vas a necesitar para el dominio).

## 2. Conectarte a la VPS

Tenés dos opciones:

**Opción A — Browser terminal (la más simple, sin instalar nada):**
En hPanel → VPS → Administrar, hacé clic en el botón **Terminal** (arriba a la
derecha). Se abre una terminal en el navegador, ya autenticada como root.
(Permití las ventanas emergentes de `hpanel.hostinger.com` si el navegador las bloquea.)

**Opción B — SSH desde tu computadora:**
```bash
ssh root@TU_IP_DE_VPS
```
La contraseña es la de root que definiste. (En la terminal la contraseña no se
ve mientras la tipeás, es normal.)

## 3. Preparar el servidor

Actualizar el sistema y crear un usuario sin privilegios (más seguro que usar root):

```bash
apt update && apt upgrade -y
adduser erp
usermod -aG sudo erp
su - erp
```

## 4. Instalar Node.js, MySQL y Nginx

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# MySQL y Nginx
sudo apt install -y mysql-server nginx

# Asegurar MySQL (definí la contraseña de root y quitá accesos de prueba)
sudo mysql_secure_installation
```

Verificá las versiones:
```bash
node -v    # debe ser 20.x o superior
mysql --version
nginx -v
```

## 5. Subir el proyecto

**Con Git (recomendado):**
```bash
cd ~
git clone TU_REPOSITORIO tcv-logisuite-erp
cd tcv-logisuite-erp
```

**O subiendo el ZIP por SSH (desde tu computadora):**
```bash
# En tu computadora:
scp TCV_LogiSuite_ERP.zip erp@TU_IP:/home/erp/
# De vuelta en la VPS:
sudo apt install -y unzip
unzip TCV_LogiSuite_ERP.zip && cd tcv-logisuite-erp
```

Instalar dependencias (solo producción):
```bash
npm install --omit=dev
```

## 6. Configurar las variables de entorno

```bash
cp .env.example .env
nano .env
```

Completá especialmente:
- `DB_PASSWORD`: una contraseña fuerte para la base.
- `AUTH_SECRET`: generala con `openssl rand -hex 48` y pegá el resultado.
- `CORS_ORIGIN`: tu dominio, ej. `https://tudominio.com`.
- `HOST=127.0.0.1` (Node solo escucha local; Nginx hace de puente).

Guardá con `Ctrl+O`, `Enter`, y salí con `Ctrl+X`.

## 7. Crear la base de datos

```bash
bash deploy/setup-db.sh
```

Esto crea la base, el usuario MySQL y carga el esquema con los datos iniciales,
incluyendo los usuarios `admin/admin123` y `demo/demo123`.
**Cambiá esas contraseñas apenas entres** desde el panel de administración.

## 8. Probar que arranca

```bash
npm start
```
Si ves `✓ TCV LogiSuite ERP corriendo en http://127.0.0.1:3000`, está bien.
Cortá con `Ctrl+C`.

## 9. Mantenerlo corriendo con PM2

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup     # ejecutá el comando que imprime, para que arranque solo al reiniciar
```

Comandos útiles: `pm2 status`, `pm2 logs tcv-logisuite-erp`, `pm2 restart tcv-logisuite-erp`.

## 10. Configurar Nginx como reverse proxy

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/tcv-erp
sudo nano /etc/nginx/sites-available/tcv-erp   # reemplazá erp.midominio.com por tudominio.com
sudo ln -s /etc/nginx/sites-available/tcv-erp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t            # verificar que la config es válida
sudo systemctl reload nginx
```

---

## 11. Asociar el nombre de dominio (apuntar el DNS a la VPS)

Acá conectás tu dominio con la IP de la VPS. El procedimiento depende de dónde
esté registrado el dominio.

### Caso A — El dominio está registrado en Hostinger

1. En hPanel, andá a **Dominios** en la barra lateral y hacé clic en **DNS**
   (o **Dominios → Portfolio de dominios → Administrar** junto a tu dominio, y
   luego **DNS / Nameservers**).
2. En la sección de registros DNS, **borrá los registros A, AAAA o CNAME
   existentes** que tengan en su nombre `@`, `www` o `cloudflare-resolve-to`.
3. Creá dos registros **A** nuevos apuntando a la IP de tu VPS:

   | Tipo | Nombre (Host) | Apunta a (Valor) | TTL |
   |------|---------------|------------------|-----|
   | A    | `@`           | `TU_IP_DE_VPS`   | 3600 |
   | A    | `www`         | `TU_IP_DE_VPS`   | 3600 |

   > El `@` es el dominio raíz (tudominio.com) y `www` es el subdominio
   > (www.tudominio.com). Si el editor de Hostinger lo permite, también podés
   > usar un CNAME `www` que apunte a `@` en lugar del segundo registro A.

4. Importante: si tenés activado el **CDN de Hostinger**, desactivalo para el
   dominio raíz, porque interfiere con el registro A.

### Caso B — El dominio está registrado en otro proveedor

Tenés dos opciones; la más simple es **no transferir nada** y solo editar el DNS
en tu registrador actual:

1. Entrá al panel de tu registrador (GoDaddy, Namecheap, etc.) y abrí la
   configuración de **DNS** del dominio.
2. Borrá los registros A, AAAA o CNAME existentes para `@` y `www`.
3. Creá los mismos dos registros A de la tabla de arriba, apuntando a la IP
   de tu VPS.

### Verificar la propagación

Los cambios de DNS pueden tardar **hasta 24 horas** en propagarse (normalmente
mucho menos). Para comprobar desde la VPS:

```bash
dig +short tudominio.com
```
Si devuelve la IP de tu VPS, el dominio ya apunta correctamente.

---

## 12. Activar HTTPS con Certbot (SSL gratis de Let's Encrypt)

> En una VPS, el SSL **no** viene automático como en el hosting compartido: lo
> instalás vos. Hacelo recién cuando el `dig` del paso anterior ya devuelva tu IP.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tudominio.com -d www.tudominio.com
```

Certbot obtiene el certificado, configura HTTPS en Nginx y agrega la redirección
de HTTP a HTTPS automáticamente. La renovación es automática.

## 13. Firewall

Podés usar el firewall visual de Hostinger (hPanel → VPS → Seguridad → Firewall)
o `ufw` desde la terminal:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Permití solo: **SSH (22)**, **HTTP (80)** y **HTTPS (443)**.
No abras el 3306 (MySQL) ni el 3000 (Node): quedan accesibles solo dentro de la VPS.

---

## Listo

Entrá a `https://tudominio.com` y deberías ver la pantalla de login de
TCV LogiSuite ERP. Ingresá con `admin` / `admin123`, y lo primero que conviene
hacer es **cambiar las contraseñas** de los usuarios de prueba desde el panel
de administración.

---

## Mantenimiento rápido

**Actualizar la aplicación (con Git):**
```bash
cd ~/tcv-logisuite-erp
git pull
npm install --omit=dev
pm2 restart tcv-logisuite-erp
```

**Respaldo de la base (recomendado programarlo con cron):**
```bash
mysqldump -u erp_user -p erp_3_abril > respaldo_$(date +%F).sql
```

**Ver el estado de salud:**
```bash
curl http://127.0.0.1:3000/api/health
# Debe responder: {"servidor":"OK","base_de_datos":"OK"}
```

> Tip: Hostinger ofrece respaldos automáticos de la VPS como opción de pago en
> el checkout, además de snapshots manuales. Conviene tener al menos uno de los
> dos mecanismos activos.

---

## Lista de verificación final

- [ ] La VPS corre Ubuntu y la app arranca con `npm start`.
- [ ] PM2 mantiene la app viva y la levanta al reiniciar (`pm2 save` + `pm2 startup`).
- [ ] Nginx hace de reverse proxy y `nginx -t` da OK.
- [ ] El registro A del dominio apunta a la IP de la VPS (verificado con `dig`).
- [ ] HTTPS activo (Certbot) y HTTP redirige a HTTPS.
- [ ] Firewall activo; solo SSH, HTTP y HTTPS expuestos.
- [ ] Contraseñas de `admin` y `demo` cambiadas.
- [ ] `AUTH_SECRET` y `DB_PASSWORD` propios y fuertes; `.env` fuera del repositorio.
- [ ] Respaldos configurados (cron de mysqldump y/o backups de Hostinger).
