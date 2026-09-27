# Migraciones de la base de datos

Estos archivos documentan los cambios incrementales que se aplicaron
sobre la base de datos a lo largo del desarrollo. **Ya no son necesarios
para una instalación nueva**: el archivo `../esquema/init_db.sql` contiene el
esquema final consolidado con todas estas modificaciones ya incorporadas.

Se conservan como referencia histórica y para actualizar instancias en
producción que quedaron en una versión intermedia, sin recrear la base
ni perder datos.

| Migración | Cambio |
|-----------|--------|
| 001 | numero_remito en VIAJES |
| 002 | sincronización CHOFERES → CUENTA |
| 003 | movimientos automáticos por consumos |
| 004 | remuneracion y tipo_remuneracion en CHOFERES |
| 005 | movimientos automáticos por viajes facturados |
| 006 | liquidación de choferes por viajes finalizados |
| 007 | identificador y fecha_colocacion en CUBIERTAS |
| 008 | eliminación de estado_pago y fecha_facturado de VIAJES |
| 009 | ampliación del campo concepto en MOVIMIENTOS |
| 010 | comision en VIAJES |
| 011 | tabla GASTOS_ADMINISTRATIVOS |
| 012 | multiempresa: EMPRESAS, USUARIOS con id_empresa y roles |
| 013 | tema de apariencia por usuario |
| 014 | iniciales de la empresa |
| 015 | peso_tara y peso_bruto en EQUIPO |
| 016 | tabla MODULOS_EMPRESA + activación para empresas existentes |
| 017 | facturación: datos fiscales en EMPRESAS, FACTURAS y FACTURA_ITEMS |
| 018 | foto del chofer en VIAJES (id_chofer) + relleno histórico |
| 019 | plazo de pago de clientes en CUENTA (plazo_pago_dias) |
| 020 | modo de facturación del viaje (modo_facturacion) + relleno |
| 021 | certificados de facturación ARCA por empresa (CERTIFICADOS_ARCA) |
| 022 | facturación pasa a ser requisito de viajes (activa donde falta) |
| 023 | referencia formal de cada movimiento automático a su origen (origen_tipo, origen_id) + relleno |
| 024 | seguridad de usuarios: cambio obligatorio de contraseña y versión de sesión |
| 025 | foto del camión y el acoplado en cada viaje (id_unidad_principal, id_unidad_secundaria) |
| 026 | historial de composición de los equipos (EQUIPO_HISTORIAL), armado desde las fotos de los viajes |
| reparar_facturacion | repara instalaciones de facturación a medias (ver abajo) |

## Cómo actualizar una base: `migrar.js`

Desde la 025, las migraciones se aplican con `backend/database/migrar.js`, que
registra cada una en la tabla `MIGRACIONES` y corre solo las pendientes, en
orden. `deploy/desplegar.sh` lo hace solo en cada despliegue.

```bash
node backend/database/migrar.js --estado      # qué hay aplicado y qué falta
node backend/database/migrar.js               # aplica las pendientes
# Base con migraciones aplicadas a mano antes de existir el registro
# (por ejemplo, hasta la 016): las marca como aplicadas y sigue con el resto.
node backend/database/migrar.js --registrar-hasta 016
```

(En Docker: `sudo docker compose run --rm app node backend/database/migrar.js …`.)

Una migración nueva: archivo `migracion_NNN_descripcion.sql` en esta carpeta,
el cambio incorporado a `../esquema/init_db.sql` y su nombre agregado al
`INSERT INTO MIGRACIONES` del final de ese archivo.

## Cómo se actualizaba a mano (instalaciones anteriores al registro)

Aplicá **en orden** las migraciones posteriores a tu versión instalada.
Reemplazá `NOMBRE_BD` por el valor de `DB_NAME` en tu `.env` (en la
instalación original es `erp_3_abril`, pero puede tener otro nombre).
Por ejemplo, si tu base quedó en la 014:

```bash
mysql -u erp_user -p NOMBRE_BD < migracion_015_pesos_equipo.sql
mysql -u erp_user -p NOMBRE_BD < migracion_016_modulos_empresa.sql
mysql -u erp_user -p NOMBRE_BD < migracion_017_facturacion.sql
mysql -u erp_user -p NOMBRE_BD < migracion_018_chofer_viaje.sql
```

Las migraciones incluyen los rellenos necesarios para los datos ya
cargados (la 016 activa los módulos de las empresas existentes; la 018
asigna a los viajes históricos el chofer actual de su equipo; la 023
vincula cada movimiento automático con su viaje, consumo, gasto o factura).

La 023 muestra al final un resumen por tipo de origen y la lista de
movimientos que parecen automáticos pero no se pudieron vincular (por
ejemplo, porque alguien editó el concepto a mano). Esa lista debería quedar
vacía; si no, revisá esos movimientos antes de seguir.

## Caso especial: facturación instalada a medias

Si instalaste el módulo de facturación con una versión **anterior** de la
migración 017 (síntomas: error "factura_items doesn't exist", o errores
por las columnas `clase`, `id_factura_asociada` o `unidad`), corré:

```bash
mysql -u erp_user -p NOMBRE_BD < reparar_facturacion.sql
```

Es seguro correrlo más de una vez: crea solo lo que falta y no borra
datos. Los `ALTER TABLE` sobre columnas que ya existen dan un error de
"columna duplicada" que puede ignorarse; el resto del script se aplica
igual si se ejecuta sentencia por sentencia.

Las facturas emitidas antes de estos cambios quedan como clase FACTURA
y conservan su numeración: el correlativo continúa donde estaba.
