# Actualizar producción sin perder datos

Tus datos reales viven en la base **MySQL** (`erp_3_abril`), no en la carpeta
del código. Por eso podés reemplazar el código sin tocar los datos. Lo único
que modifica la base son las **migraciones**, y solo hay que correr las que
falten. Seguí estos pasos en orden.

> Regla de oro: **primero el respaldo, después todo lo demás.** Con el respaldo
> hecho, cualquier error se deshace en minutos.

---

## Paso 0 — Respaldo de la base (imprescindible)

Antes de tocar nada, guardá una copia completa de la base:

```bash
mysqldump -u TU_USUARIO -p erp_3_abril > respaldo_$(date +%Y%m%d_%H%M).sql
```

Verificá que el archivo se creó y **no está vacío**:

```bash
ls -lh respaldo_*.sql
```

Debe pesar bastante más que unos pocos KB. Guardá una copia de ese archivo en
otro lugar (otra carpeta, un pendrive, la nube). Si algo sale mal, restaurás con:

```bash
mysql -u TU_USUARIO -p erp_3_abril < respaldo_AAAAMMDD_HHMM.sql
```

---

## Paso 1 — Averiguar en qué versión está tu base

No hace falta adivinar: preguntémosle a la base qué columnas y tablas ya tiene.
Entrá al cliente MySQL:

```bash
mysql -u TU_USUARIO -p erp_3_abril
```

Y pegá esta consulta. Devuelve, para cada migración, si YA está aplicada:

```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='erp_3_abril' AND table_name='USUARIOS' AND column_name='tema')            AS mig_013_tema,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='erp_3_abril' AND table_name='EMPRESAS' AND column_name='iniciales')        AS mig_014_iniciales,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='erp_3_abril' AND table_name='EQUIPO' AND column_name='peso_tara')          AS mig_015_pesos,
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema='erp_3_abril' AND table_name='MODULOS_EMPRESA')                             AS mig_016_modulos,
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema='erp_3_abril' AND table_name='FACTURAS')                                    AS mig_017_facturas,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='erp_3_abril' AND table_name='FACTURAS' AND column_name='clase')            AS mig_017b_notas_credito,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='erp_3_abril' AND table_name='FACTURA_ITEMS' AND column_name='unidad')      AS mig_017c_unidad,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='erp_3_abril' AND table_name='VIAJES' AND column_name='id_chofer')          AS mig_018_chofer_viaje;
```

**Cómo leer el resultado:** cada columna da `1` (ya aplicada) o `0` (falta).
La primera que dé `0` es por donde tenés que empezar. Ejemplos:

- Todo `1` → estás al día, solo actualizás el código (Paso 3).
- `mig_016_modulos = 0` en adelante → te faltan de la 016 para arriba.
- `mig_017_facturas = 1` pero `mig_017b_notas_credito = 0` → tenés facturación
  vieja: te falta el **script de reparación** (ver Paso 2, caso especial).

Salí del cliente con `exit;` y anotá desde qué número tenés que aplicar.

---

## Paso 2 — Aplicar solo las migraciones que faltan (en orden)

Desde la carpeta del proyecto nuevo, corré **en orden** solo las que te falten.
Por ejemplo, si la detección mostró que tenés hasta la 014 aplicada:

```bash
cd carpeta-del-proyecto-nuevo/database/historico_migraciones

mysql -u TU_USUARIO -p erp_3_abril < migracion_015_pesos_equipo.sql
mysql -u TU_USUARIO -p erp_3_abril < migracion_016_modulos_empresa.sql
mysql -u TU_USUARIO -p erp_3_abril < migracion_017_facturacion.sql
mysql -u TU_USUARIO -p erp_3_abril < migracion_018_chofer_viaje.sql
```

Aplicá únicamente las posteriores a tu versión. Si te falta desde la 016, arrancás
en la 016; si te falta solo la 018, corrés solo esa. **Nunca** corras `init_db.sql`
sobre la base de producción: ese script recrea todo desde cero y borra los datos.

Las migraciones ya incluyen el relleno de los datos existentes (por ejemplo, la
016 activa los módulos de tu empresa actual, y la 018 asigna a los viajes viejos
el chofer actual de su equipo), así que no perdés información.

### Caso especial: facturación instalada a medias

Si en el Paso 1 viste `FACTURAS = 1` pero `clase = 0` o `unidad = 0` (o si al
facturar te daba el error "factura_items doesn't exist"), en lugar de la 017
corré el script de reparación, que es seguro y solo agrega lo que falta:

```bash
mysql -u TU_USUARIO -p erp_3_abril < reparar_facturacion.sql
```

Puede mostrar algún error de "columna duplicada" en las líneas de columnas que ya
tenías: es esperable, ignoralo, el resto se aplica igual.

---

## Paso 3 — Actualizar el código

El código nuevo reemplaza al viejo, pero la **configuración** (que tiene la clave
de la base y los secretos) NO debe pisarse. Por eso se conserva el archivo `.env`.

```bash
# 1. Frená el sistema en ejecución
pm2 stop tcv-logisuite    # o el nombre que tenga tu proceso (pm2 list para verlo)

# 2. Guardá tu configuración actual (¡tiene la contraseña de la base!)
cp carpeta-vieja/.env  /tmp/env-produccion-respaldo

# 3. Copiá el proyecto nuevo (descomprimí el ZIP en una carpeta nueva)
#    y llevá tu .env al proyecto nuevo
cp /tmp/env-produccion-respaldo  carpeta-nueva/.env

# 4. Instalá dependencias por si hay nuevas
cd carpeta-nueva
npm install --production

# 5. Arrancá el sistema desde la carpeta nueva
pm2 start server.js --name tcv-logisuite
pm2 save
```

> Tu archivo `.env` apunta a la misma base `erp_3_abril`, así que el sistema
> nuevo abre exactamente los mismos datos que ya tenías.

---

## Paso 4 — Verificar

1. Entrá al sistema y revisá que tus datos estén: viajes, cuentas, facturas.
2. Probá una acción nueva (por ejemplo, emitir una factura o ver el detalle de
   una cuenta corriente).
3. Si algo se ve raro en pantalla, forzá la recarga con **Ctrl + F5** (el
   navegador puede tener guardada la versión vieja de la interfaz).

Si todo está bien, borrá la carpeta vieja recién cuando estés seguro (dejala unos
días por las dudas). El respaldo del Paso 0 conservalo igual.

---

## Si algo sale mal

Restaurá la base desde el respaldo y volvé a arrancar el código viejo:

```bash
mysql -u TU_USUARIO -p erp_3_abril < respaldo_AAAAMMDD_HHMM.sql
pm2 start carpeta-vieja/server.js --name tcv-logisuite
```

Volvés al estado exacto de antes de empezar. Por eso el respaldo del Paso 0 es
innegociable.

---

## Resumen en una línea

**Respaldo → detectar versión → correr solo las migraciones que faltan →
reemplazar código conservando el `.env` → verificar.** Los datos nunca se tocan
porque viven en MySQL; las migraciones solo agregan columnas y tablas nuevas,
con su relleno para lo ya cargado.
