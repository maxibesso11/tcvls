# Datos de prueba masivos para testing

Este directorio incluye un generador de datos sintéticos para probar el
rendimiento del sistema con un gran volumen de información.

## Archivos

- `generar_datos_prueba.py` — generador de datos coherentes (Python 3, sin dependencias).
- `datos_prueba_masivos.sql` — datos ya generados con factor x50 (~5.600 filas).

## Cómo generar los datos

```bash
# Factor x50 (por defecto), empresa 1
python3 generar_datos_prueba.py --factor 50 --empresa 1 > datos_prueba_masivos.sql

# Otro volumen (ej. x100) u otra empresa
python3 generar_datos_prueba.py --factor 100 --empresa 2 > datos_masivos_e2.sql
```

## Cómo cargarlos en MySQL

Los datos se **agregan** a los que ya existan (no borran nada). Para una prueba
limpia, primero cargá el esquema base (`init_db.sql`) y luego estos datos:

```bash
mysql -u erp_user -p erp_3_abril < datos_prueba_masivos.sql
```

> Importante: el generador asigna todos los datos a la empresa indicada con
> `--empresa`. Esa empresa debe existir previamente (la #1 "3 de Abril SAS"
> viene en el esquema base).

## Qué genera (factor x50)

| Tabla                  | Filas aprox. |
|------------------------|-------------:|
| CHOFERES               | 250 |
| UNIDADES               | 500 |
| EQUIPO                 | 250 |
| VIAJES                 | 450 |
| CONSUMOS_COMBUSTIBLE   | 300 |
| CONSUMOS_GENERALES     | 250 |
| CUENTA                 | 764 |
| MOVIMIENTOS            | 1205 |
| STOCK                  | 500 |
| MANTENIMIENTOS         | 250 |
| VENCIMIENTOS           | 300 |
| CUBIERTAS              | 350 |
| GASTOS_ADMINISTRATIVOS | 250 |
| **TOTAL**              | **~5.600** |

## Coherencia garantizada

Los datos respetan las reglas de negocio del sistema:
- Cada chofer tiene su cuenta tipo CHOFER (enlazada por CUIL).
- Cada proveedor/cliente existe como CUENTA antes de ser usado.
- Los consumos y gastos generan el movimiento de crédito al proveedor.
- Los viajes FACTURADO generan facturación al pagador (con IVA 21% y comisión
  si corresponde); los FINALIZADO generan la liquidación del chofer.
- Patentes, CUIL y nombres son únicos por empresa.

Esto permite probar no solo la velocidad, sino que los cálculos (saldos de
cuentas corrientes, rentabilidad, dashboard) den resultados con sentido.

## Resultado de la prueba de rendimiento

Cargando las ~5.600 filas y ejecutando las consultas más pesadas del
dashboard, los tiempos son muy bajos (milisegundos), porque el esquema tiene
los índices apropiados (`id_empresa`, `id_equipo`, fechas, etc.). El sistema
está preparado para crecer bastante más que este volumen sin degradarse.
