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
| reparar_facturacion | repara instalaciones de facturación a medias (ver abajo) |

## Cómo actualizar una base en producción

Aplicá **en orden** las migraciones posteriores a tu versión instalada.
Por ejemplo, si tu base quedó en la 014:

```bash
mysql -u erp_user -p erp_3_abril < migracion_015_pesos_equipo.sql
mysql -u erp_user -p erp_3_abril < migracion_016_modulos_empresa.sql
mysql -u erp_user -p erp_3_abril < migracion_017_facturacion.sql
mysql -u erp_user -p erp_3_abril < migracion_018_chofer_viaje.sql
```

Las migraciones incluyen los rellenos necesarios para los datos ya
cargados (la 016 activa los módulos de las empresas existentes; la 018
asigna a los viajes históricos el chofer actual de su equipo).

## Caso especial: facturación instalada a medias

Si instalaste el módulo de facturación con una versión **anterior** de la
migración 017 (síntomas: error "factura_items doesn't exist", o errores
por las columnas `clase`, `id_factura_asociada` o `unidad`), corré:

```bash
mysql -u erp_user -p erp_3_abril < reparar_facturacion.sql
```

Es seguro correrlo más de una vez: crea solo lo que falta y no borra
datos. Los `ALTER TABLE` sobre columnas que ya existen dan un error de
"columna duplicada" que puede ignorarse; el resto del script se aplica
igual si se ejecuta sentencia por sentencia.

Las facturas emitidas antes de estos cambios quedan como clase FACTURA
y conservan su numeración: el correlativo continúa donde estaba.
