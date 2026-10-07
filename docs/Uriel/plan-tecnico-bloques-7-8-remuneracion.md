# Plan técnico: IVA en compras, administrador de empresa y remuneración mixta

> Copia en Markdown del plan técnico del 28/09/2026. La carga de comprobantes
> desde una foto está en [fase2-carga-de-comprobantes.md](fase2-carga-de-comprobantes.md).

## Resumen

Los tres pendientes pueden desarrollarse en paralelo en ramas separadas, porque tocan tablas distintas. El único archivo que comparten es `dashboard.rutas.js` (la rentabilidad), así que conviene fijar el orden de integración y los números de migración desde el principio.

| Pendiente | Qué resuelve | Tablas | Migración | Estimación |
|---|---|---|---|---|
| Bloque 7 · IVA en compras | Guardar neto, IVA, tipo y número del comprobante del proveedor en consumos y gastos; base de los libros de IVA | `CONSUMOS_COMBUSTIBLE`, `CONSUMOS_GENERALES`, `GASTOS_ADMINISTRATIVOS`, `CUENTA` | 027 | 6 h (plan del MVP) + 2 h por el formulario con desglose |
| Bloque 8 · Administrador de empresa | Rol `ADMIN_EMPRESA`: gestiona usuarios, certificado ARCA y datos fiscales de su propia empresa | `USUARIOS` | 028 | 4 h (plan del MVP) + 3 h de tests de permisos |
| Remuneración mixta | Sueldo fijo mensual más porcentaje o monto por km en el mismo chofer | `CHOFERES`, nueva `LIQUIDACIONES_SUELDO` | 029 | 8–10 h (estimación propia; fuera del alcance) |

**Orden de integración sugerido:** Bloque 8 primero (no toca cálculos), después remuneración mixta (cambia la rentabilidad) y por último Bloque 7, que también puede cambiar la rentabilidad si se decide medir los costos sin IVA. Las tres llevan tests antes de mergear a `dev`, sobre la base de `backend/test/integracion/`.

El plan parte de `dev` actualizado, que incluye el cambio en la rentabilidad (sueldo = lo liquidado por viaje más el fijo prorrateado).

---

## Bloque 7 · IVA discriminado en compras

Los tres registros de compra guardan solo un importe total (`monto`, o litros × precio en combustible). Se agregan los datos del comprobante del proveedor **sin cambiar el significado de `monto`**: sigue siendo el total que se le debe al proveedor, así que la cuenta corriente, el dashboard y los movimientos automáticos no cambian.

**Base de datos (migración 027).** Las mismas columnas en `CONSUMOS_COMBUSTIBLE`, `CONSUMOS_GENERALES` y `GASTOS_ADMINISTRATIVOS`:

| Columna | Tipo | Para qué |
|---|---|---|
| `comprobante_tipo` | ENUM `FACTURA`, `NOTA_DEBITO`, `NOTA_CREDITO`, `TICKET`, `RECIBO`, `SIN_COMPROBANTE`, `NO_INFORMADO` | Qué documento respalda el gasto |
| `comprobante_letra` | CHAR(1) `A`, `B`, `C`, `M` o NULL | Solo la A y la M dan crédito fiscal |
| `comprobante_punto_venta` | INT | Parte del número `PPPP-NNNNNNNN` |
| `comprobante_numero` | INT | Parte del número |
| `neto_gravado` | DECIMAL(12,2) | Base del IVA |
| `iva_alicuota` | DECIMAL(5,2) | 21, 10,5, 27, 5, 2,5 o 0 |
| `iva` | DECIMAL(12,2) | Crédito fiscal |
| `no_gravado` | DECIMAL(12,2) | Conceptos no gravados (en combustible, el impuesto a los combustibles) |
| `exento` | DECIMAL(12,2) | Operaciones exentas |
| `percepciones` | DECIMAL(12,2) | Total de percepciones sufridas (el detalle queda para la segunda entrega) |

Más un índice único lógico por (empresa, proveedor, tipo, letra, punto de venta, número) controlado en el servicio, porque la misma factura no puede cargarse dos veces aunque sea en tablas distintas. Y `CUENTA.condicion_iva_id` (id de ARCA), que comparte con el Bloque 4: el libro de compras necesita la condición del proveedor.

**Regla de consistencia**, validada en el servidor: `neto_gravado + iva + no_gravado + exento + percepciones = total` con tolerancia de $0,01 (en combustible, el total es litros × precio, que puede tener más decimales). Con letra B, C o ticket el IVA va en cero: el importe no se discrimina y no genera crédito fiscal.

**Migración de los registros existentes.** No hay forma de saber el IVA de lo ya cargado, así que no se inventa: quedan como `NO_INFORMADO`, con `neto_gravado = total` e `iva = 0`. No suman crédito fiscal y aparecen en un listado "pendientes de completar" para que el cliente los corrija si tiene el comprobante. La migración cierra con un `SELECT` de control (cantidad por tabla y suma de totales antes y después, que tiene que dar igual).

**Backend.**

- Nuevo `modulos/gastos/comprobanteCompra.js` con funciones puras: normalizar, validar la suma y la coherencia letra/IVA, y calcular IVA desde neto y alícuota.
- Los `beforeCreate`/`beforeUpdate` de los tres registros (hoy en `consumos.hooks.js` y `gastosAdministrativos.hooks.js`) llaman a esa validación y al control de duplicados, dentro de la transacción del CRUD (`req.db`).
- Se suman los campos nuevos a `fields` en `tablas.js`. Los movimientos de cuenta corriente siguen usando el total.
- Una vista `V_COMPRAS_FISCALES` que une las tres tablas con el CUIT y la condición del proveedor, lista para el Libro IVA Compras de la segunda entrega.

**Frontend.** El formulario genérico de `vistas/crud.js` hoy no tiene campos dependientes ni calculados. Se agrega un grupo reutilizable "Comprobante del proveedor" (tipo, letra, número, neto, alícuota, IVA, no gravado, exento, percepciones) que calcula el IVA al escribir el neto, deshabilita el IVA con letra B/C/ticket y muestra la diferencia contra el total antes de guardar. Se declara en `nucleo/modulos.js` con una propiedad `grupoFiscal: true` en los tres módulos.

**Tests.** Unitarios de `comprobanteCompra.js` (suma, tolerancia, letra B sin IVA, redondeo) y de integración: crear un consumo con desglose deja el movimiento por el total; un duplicado se rechaza en otra tabla; un registro migrado queda `NO_INFORMADO` con los totales intactos.

---

## Bloque 8 · Administrador de empresa

Hoy hay dos roles: `ADMIN` (plataforma: ve todas las empresas, usuarios, módulos y certificados, pero no opera datos) y `USUARIO` (opera los datos de su empresa). Se agrega un tercero, `ADMIN_EMPRESA`, que **opera como un `USUARIO` y además administra su propia empresa**. La empresa siempre sale del token, nunca de la URL ni del cuerpo del pedido.

| Acción | `ADMIN` | `ADMIN_EMPRESA` | `USUARIO` |
|---|---|---|---|
| Operar viajes, cuentas, facturación | No | Sí, su empresa | Sí, su empresa |
| Ver y crear empresas, activar módulos | Sí | No | No |
| Usuarios | Todos | Solo los de su empresa, con rol `USUARIO` o `ADMIN_EMPRESA` | No |
| Certificado ARCA | Cualquier empresa | Solo el suyo | No |
| Datos fiscales de la empresa (condición IVA, IIBB, inicio de actividades, punto de venta) | Cualquier empresa | Solo los suyos | No |
| Nombre, CUIT, estado activa/inactiva | Sí | No | No |

**Base de datos (migración 028).** `USUARIOS.rol` pasa a `ENUM('ADMIN', 'ADMIN_EMPRESA', 'USUARIO')`. Sin cambios en los datos existentes: el admin de plataforma decide a quién promover.

**Backend.**

- **Servicios compartidos:** la lógica de usuarios y certificados sale de `admin.rutas.js` y `certificados.rutas.js` a `modulos/admin/usuarios.servicio.js` y `certificados.servicio.js`, con un parámetro de alcance (`{ idEmpresa }` fijo o todas). Así el admin de plataforma y el de empresa usan las mismas reglas: validación de contraseña, cambio obligatorio al primer ingreso, cierre de sesiones al reasignar contraseña. También reduce el SQL en rutas señalado en el reanálisis.
- **Nuevas rutas `/api/empresa/*`** (módulo `modulos/empresa/empresa.rutas.js`): `GET/POST/PUT/DELETE /usuarios`, `GET /certificado`, `POST /certificado/generar`, `GET /certificado/csr`, `POST /certificado`, `DELETE /certificado`, `GET/PUT /datos-fiscales`.
- **Middleware:** `requiereRol(...roles)` reemplaza a `requiereAdmin`, y `alcanceEmpresaPropia` fija `req.idEmpresaObjetivo = req.usuario.id_empresa`. `requiereEmpresa` sigue dejando pasar a `ADMIN_EMPRESA` porque tiene empresa.
- **Reglas de seguridad:** un usuario de otra empresa responde 404 (no 403, para no confirmar que existe); no puede crear ni promover a `ADMIN`; no puede cambiar el `id_empresa` de nadie; no puede desactivarse ni eliminarse a sí mismo; `/api/admin/*` y `/api/certificados/*` siguen siendo solo de `ADMIN`.

**Frontend.** Grupo nuevo "Mi empresa" en el menú (Usuarios, Certificado ARCA, Datos fiscales), visible solo para `ADMIN_EMPRESA`. Las pantallas reutilizan las de `vistas/admin.js` apuntando a `/api/empresa/*`, sin el selector de empresa. En la administración global, el alta de usuario ofrece el rol nuevo.

**Tests de integración** (nuevo `backend/test/integracion/adminEmpresa.test.js`, sobre `entorno.js`). El seed tiene una sola empresa, así que el test crea una segunda con el admin de plataforma:

- [ ] Un `ADMIN_EMPRESA` lista y crea usuarios solo de su empresa.
- [ ] Editar, eliminar o reasignar contraseña a un usuario de otra empresa → 404.
- [ ] Crear o promover a `ADMIN` → rechazado; `id_empresa` en el cuerpo → ignorado.
- [ ] `/api/admin/*` y `/api/certificados/:otraEmpresa` → 403.
- [ ] Gestiona su certificado; la clave privada nunca aparece en ninguna respuesta.
- [ ] Un `USUARIO` común → 403 en todo `/api/empresa/*`.
- [ ] Sigue operando viajes y cuentas de su empresa como antes.
- [ ] Desactivar a un `ADMIN_EMPRESA` corta su sesión en el acto (misma regla que ya prueba `seguridad.test.js`).

---

## Remuneración mixta de choferes

Hoy cada chofer tiene un solo `tipo_remuneracion` (`POR KM`, `PORCENTAJE` o `FIJA`) y un solo `remuneracion`. El caso que planteó Maxi (por ejemplo, $1.000.000 fijos al mes más 10% de cada viaje en lugar del 20%) necesita las dos partes a la vez. La propuesta separa la remuneración en **una parte fija mensual y una parte variable por viaje**, cada una opcional.

**Base de datos (migración 029).**

| Columna en `CHOFERES` | Tipo | Reemplaza a |
|---|---|---|
| `sueldo_fijo_mensual` | DECIMAL(12,2) NULL | `remuneracion` cuando el tipo era `FIJA` |
| `variable_tipo` | ENUM(`PORCENTAJE`, `POR KM`) NULL | `tipo_remuneracion` cuando no era `FIJA` |
| `variable_valor` | DECIMAL(10,2) NULL | `remuneracion` cuando no era `FIJA` |

Migración de los choferes existentes: `FIJA` → `sueldo_fijo_mensual = remuneracion`; `PORCENTAJE` y `POR KM` → `variable_tipo` y `variable_valor`. Las columnas viejas quedan una versión más como respaldo y se eliminan en la migración siguiente, cuando el control de antes y después haya dado igual en producción.

**Liquidación por viaje** (`viajes.calculos.js`). `calcularLiquidacionChofer` pasa a leer solo la parte variable: la fórmula no cambia (porcentaje del monto del viaje, o km × valor si la tarifa es por km; si no, queda marcada como incompleta). Un chofer solo con fijo sigue sin liquidación por viaje, igual que hoy.

**Sueldo fijo en la cuenta corriente.** Hoy un chofer `FIJA` no genera ningún movimiento automático: el sueldo se carga a mano. Para que el mixto no quede a medias, se agrega una acción **"Liquidar sueldos fijos del mes"** que crea un movimiento por chofer y período (`AAAA-MM`), registrado en la tabla nueva `LIQUIDACIONES_SUELDO` (empresa, chofer, período, monto, único por chofer y período) y enlazado con el `origen_tipo`/`origen_id` que ya usan los movimientos automáticos. Correrla dos veces no duplica nada.

**Rentabilidad por equipo** (`dashboard.rutas.js`). La fórmula se mantiene — sueldo = liquidaciones variables de los viajes del equipo + fijo prorrateado — con dos ajustes:

1. El fijo sale de `sueldo_fijo_mensual` de cualquier chofer, no solo de los `FIJA`, así el mixto suma las dos partes.
2. Se prorratea por los días que cada chofer estuvo asignado al equipo según `EQUIPO_HISTORIAL`, no por el chofer actual. Si un equipo cambió de chofer a mitad de mes, cada uno aporta solo sus días. Queda en una función pura `sueldoFijoProrrateado(sueldo, periodos, desde, hasta)` con sus tests.

La métrica no usa los movimientos de `LIQUIDACIONES_SUELDO` para el fijo: usa siempre el prorrateo, así un mes sin liquidar todavía no aparece más rentable de lo que es.

**Frontend.** El formulario de choferes reemplaza "Tipo de remuneración" y "Remuneración" por tres campos: sueldo fijo mensual, tipo variable (ninguno, porcentaje, por km) y valor variable. Requiere al menos una de las dos partes. La vista de rentabilidad muestra el sueldo separado en fijo y variable.

**Tests.** Unitarios de `calcularLiquidacionChofer` con choferes mixtos (actualizando los casos existentes de `viajes.calculos.test.js`, que hoy usan `tipo_remuneracion`) y de `sueldoFijoProrrateado` con cambio de chofer a mitad de período. De integración: un chofer mixto con un viaje finalizado genera solo la liquidación variable; la acción mensual crea el fijo una sola vez; la rentabilidad suma ambas partes.

---

## Migraciones, orden de trabajo y riesgos

Los números de migración se reservan ahora para que las tres ramas no choquen. Cada migración actualiza también `init_db.sql` (esquema y fila en `MIGRACIONES`) y, si corresponde, el generador de datos de prueba.

| Rama | Migración | Archivos principales | Se integra a `dev` |
|---|---|---|---|
| `feature/admin-empresa` | `migracion_028_rol_admin_empresa.sql` | `middleware/autenticacion.js`, `modulos/admin/*.servicio.js`, `modulos/empresa/`, `vistas/admin.js`, `nucleo/sesion.js` | 1° |
| `feature/remuneracion-mixta` | `migracion_029_remuneracion_mixta.sql` | `viajes.calculos.js`, `viajes.servicio.js`, `dashboard.rutas.js`, `tablas.js`, `nucleo/modulos.js` | 2° |
| `feature/iva-compras` | `migracion_027_iva_compras.sql` | `gastos/comprobanteCompra.js`, hooks de gastos, `tablas.js`, `vistas/crud.js`, `nucleo/modulos.js` | 3° |

La 027 se integra última aunque tenga el número más bajo: `migrar.js` aplica todas las que no figuran en `MIGRACIONES`, así que en una base con la 028 y la 029 ya aplicadas corre la 027 sin problema, porque las tres tocan tablas distintas.

Riesgos:

- **Migración de datos en producción.** La 027 y la 029 modifican registros existentes. Se prueban primero sobre una copia del respaldo diario, con los `SELECT` de control (cantidades y sumas iguales antes y después), y en producción se corren justo después de un respaldo.
- **Cambio de rol con sesión abierta.** El rol viaja en el token. Promover o degradar a un usuario tiene que incrementar `version_sesion` para que el cambio aplique en el acto, igual que ya pasa al desactivarlo.
- **Conflictos en `tablas.js` y `nucleo/modulos.js`.** Las ramas 2 y 3 editan los mismos archivos en bloques distintos; el conflicto es de texto, no de lógica, pero hay que resolverlo con cuidado.
- **Rentabilidad.** Remuneración mixta cambia cómo se calcula el sueldo; si además se decide medir costos sin IVA (ver decisiones), el Bloque 7 vuelve a cambiarla. Conviene tomar una foto del endpoint `rentabilidad-equipos` antes de cada rama con `scripts/smoke-test.js` para explicar al cliente cada diferencia.
- **Formulario genérico.** Agregar campos dependientes a `vistas/crud.js` afecta a todos los módulos; se hace detrás de una propiedad opcional (`grupoFiscal`) para que el resto no cambie.

---

## Fase 2 · Carga de comprobantes desde una foto

Propuesta para la segunda entrega, sobre la estructura del Bloque 7. Detalle completo en [fase2-carga-de-comprobantes.md](fase2-carga-de-comprobantes.md).

- **Nivel 1 · QR de ARCA + adjunto (1–2 días):** el navegador lee el QR de la RG 4892 y precarga CUIT, tipo, letra, punto de venta, número, fecha y total; la foto se guarda como respaldo en un volumen propio de Docker.
- **Nivel 2 · Extracción con IA (2–3 días + pruebas):** un modelo con visión precarga neto, IVA, percepciones, litros y precio; siempre con confirmación humana, desactivado por defecto y con límite mensual por empresa.

---

## Decisiones pendientes

| # | Decisión | Quién | Propuesta del plan |
|---|---|---|---|
| 1 | ¿Una sola alícuota por comprobante de compra alcanza, o hace falta desglose por alícuota (21% y 10,5% en la misma factura)? | Contador | Una alícuota para el MVP; la tabla de desglose entra con el Libro IVA Compras |
| 2 | En combustible, ¿el impuesto a los combustibles va a `no_gravado` o se agrega una columna propia para impuestos internos? | Contador | `no_gravado` |
| 3 | Las métricas de rentabilidad, ¿miden los costos con IVA (como hoy) o sin IVA? Los ingresos ya se muestran sin IVA, así que hoy la rentabilidad queda subestimada para un Responsable Inscripto. | Maxi y contador | Sin IVA cuando el comprobante es A o M, con IVA en el resto |
| 4 | ¿El administrador de empresa puede activar o desactivar módulos? El plan del MVP dice "sin acceso a información de plataforma"; los módulos hoy funcionan como licencia. | Maxi | No |
| 5 | ¿Modelo de instalación compartido o una instalación por cliente? El plan del MVP estima 4 h para el Bloque 8 con una instalación por cliente y 8 a 10 h más con el modelo compartido. El diseño de este documento sirve para los dos. | Maxi y Tomás | El diseño de este plan, que ya contempla el compartido |
| 6 | ¿Tiene que existir siempre al menos un `ADMIN_EMPRESA` activo por empresa? | Maxi | Sí: no se puede desactivar ni degradar al último |
| 7 | Sueldo fijo: ¿se liquida con la acción mensual propuesta o se sigue cargando a mano en la cuenta del chofer? ¿El variable de un mixto se calcula sobre el monto del viaje con o sin comisión? | Maxi | Acción mensual; el variable sobre el monto sin descontar la comisión, como hoy |
