# Migraciones históricas

Estos archivos documentan los cambios incrementales que se aplicaron
sobre la base de datos a lo largo del desarrollo. **Ya no son necesarios
para una instalación nueva**: el archivo `../init_db.sql` contiene el
esquema final consolidado con todas estas modificaciones ya incorporadas.

Se conservan únicamente como referencia histórica y por si alguna
instancia en producción quedó en una versión intermedia y necesita
actualizarse paso a paso en lugar de recrearse desde cero.

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
