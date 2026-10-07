# Arquitectura de TCV LogiSuite ERP

Monolito Node.js + Express con base MySQL y una SPA en JavaScript puro.
El repositorio se divide en dos partes: **`backend/`** (servidor, lógica y base
de datos) y **`frontend/`** (lo que se sirve al navegador).

## Recorrido de una petición

```
Navegador (frontend/js)  →  Nginx  →  server.js  →  backend/server.js
   →  backend/src/app.js  (CORS, JSON, landing, estáticos de frontend/)
   →  backend/src/rutas.js (monta /api/*)
        →  middleware/autenticacion.js  (token válido y empresa asignada)
        →  middleware/modulos.js         (módulo activo para la empresa)
        →  lib/crudFactory.js  o  un router de modulos/<dominio>/
              →  hooks / servicios del dominio  →  MySQL (config/db.js)
```

- **Landing** en `/` (`frontend/landing.html`); **sistema** en cualquier otra ruta
  (`frontend/index.html`, navegación por `#hash`).
- **Multiempresa:** `id_empresa` lo fija siempre el servidor a partir del token;
  todas las consultas filtran por él.

## Backend (`backend/`)

| Carpeta | Responsabilidad | Ejemplos |
|---------|-----------------|----------|
| `server.js` | Arranque: carga `.env`, abre el puerto, cierre ordenado (SIGTERM/SIGINT) | — |
| `src/app.js` | Construye la app Express | CORS, `trust proxy`, estáticos |
| `src/rutas.js` | Único lugar donde se montan las rutas `/api/*` y sus protecciones | orden de montaje |
| `src/config/` | Solo configuración y constantes | `db.js`, `modulos.js`, `constantes.js` |
| `src/middleware/` | Filtros previos a las rutas | `requiereAutenticacion`, `requiereModulo` |
| `src/lib/` | Utilidades transversales sin reglas de negocio | `crudFactory.js`, `paginacion.js`, `seguridad/` |
| `src/integraciones/` | Servicios externos | ARCA (CAE), certificados (CSR con node-forge) |
| `src/modulos/<dominio>/` | Todo lo de un dominio de negocio | rutas, servicio, hooks, cálculos, PDF |
| `database/` | Esquema, migraciones y datos de prueba | ver abajo |
| `test/` | Tests con `node:test` | `npm test` |

### Dominios (`src/modulos/`)

| Dominio | Archivos | Qué resuelve |
|---------|----------|--------------|
| `tablas.js` | — | Declara las tablas CRUD: campos, filtros, orden y hooks |
| `auth/` | `auth.rutas.js` | Login, datos de la sesión, tema |
| `admin/` | `admin.rutas.js`, `certificados.rutas.js`, `usuarios.servicio.js`, `certificados.servicio.js` | Empresas, módulos por empresa; reglas de usuarios y certificados ARCA compartidas con `empresa/` (parametrizadas por alcance) |
| `empresa/` | `empresa.rutas.js` | Panel "Mi empresa" del rol `ADMIN_EMPRESA`: sus usuarios, certificado ARCA y datos fiscales, nunca de otra empresa |
| `multiempresa/` | `multiempresa.rutas.js` | Panel "Mi multiempresa" del rol `ADMIN_MULTIEMPRESA`: usuarios, certificado ARCA y datos fiscales de la empresa que esté operando (elegida con la cabecera `X-Empresa-Id`, validada contra `USUARIOS_EMPRESAS`), nunca de una empresa no asignada |
| `choferes/` | `choferes.hooks.js` | Valida la remuneración mixta (sueldo fijo y/o variable) al guardar un chofer |
| `cuentas/` | `cuentas.hooks.js`, `cuentas.servicio.js`, `movimientos.servicio.js`, `liquidacionSueldos.servicio.js`, `cuentasCorrientes.rutas.js`, `cuentasCorrientes.pdf.js` | Cuenta del chofer sincronizada, validación de proveedores, movimientos automáticos con origen, liquidación mensual del sueldo fijo, saldos y resumen PDF |
| `viajes/` | `viajes.hooks.js`, `viajes.servicio.js`, `viajes.calculos.js` | Liquidación al chofer (FINALIZADO, solo la parte variable de su remuneración) y débito al pagador (FACTURADO), por un único camino; foto del equipo en cada viaje |
| `equipos/` | `equipos.historial.js`, `equipos.hooks.js`, `equipos.rutas.js` | Historial de composición (camión, acoplado y chofer por período) y su consulta y corrección |
| `gastos/` | `consumos.hooks.js`, `gastosAdministrativos.hooks.js`, `comprobanteCompra.js`, `comprobanteDuplicado.servicio.js` | Crédito al proveedor por cada consumo o gasto; comprobante del proveedor (IVA discriminado) validado y sin duplicados entre las tres tablas |
| `facturacion/` | `facturacion.rutas.js`, `facturacion.servicio.js`, `facturacion.pdf.js` | Factura A, nota de crédito, numeración, CAE, PDF |
| `dashboard/` | `dashboard.rutas.js`, `dashboard.consultas.js`, `dashboard.calculos.js` | KPIs, alertas, métricas y prorrateo del sueldo fijo por días asignados (rentabilidad por equipo) |
| `stock/` | `stock.rutas.js` | Depósitos y traspaso masivo |
| `asesoria/` | `asesoria.rutas.js` | Formulario público de la landing (correo SMTP) |

### Cómo funciona el CRUD genérico

`lib/crudFactory.js` recibe la definición de una tabla (de `modulos/tablas.js`)
y genera `GET / GET :id / POST / PUT / DELETE` con búsqueda, filtros, orden y
paginación. Las reglas de negocio se enganchan con **hooks**:

| Hook | Cuándo corre | Si devuelve un texto |
|------|--------------|----------------------|
| `beforeCreate(data, req)` | Antes de insertar | Se responde 400 con ese mensaje |
| `beforeUpdate(id, data, anterior, req)` | Antes de actualizar | 400 |
| `beforeDelete(registro, req)` | Antes de borrar | 400 |
| `afterCreate(registro, req)` / `afterUpdate(registroCompleto, anterior, req)` / `afterDelete(registro, req)` | Después de escribir, **en la misma transacción** | Si lanzan un error, se deshace todo (el registro y sus efectos) y se responde 500 con un mensaje claro |

- La escritura y los hooks `after*` corren en **una transacción**. Los hooks
  deben escribir con **`req.db`** (la conexión de esa transacción), nunca con
  `pool`: una escritura por fuera no se deshace y puede quedar bloqueada.
- `afterUpdate` recibe el **registro completo** (anterior + cambios), no solo
  los campos enviados: una edición parcial no pierde datos.

Ejemplo: `viajes.hooks.js` valida el pagador y el estado antes de guardar, y
después reconcilia los movimientos de la cuenta del chofer y del cliente
(`viajes.servicio.js`).

### Reglas de negocio centrales

- **Convención contable** en `MOVIMIENTOS`: monto > 0 = crédito a favor del
  titular; monto < 0 = débito (el titular adeuda).
- **Movimientos automáticos** (facturación y liquidación de viajes, consumos,
  gastos, facturas manuales y notas de crédito): se crean y se reemplazan solo
  con `cuentas/movimientos.servicio.js`, que guarda la referencia a su
  documento en `origen_tipo` + `origen_id`. **Nunca** se buscan por el texto
  del concepto (el concepto se puede editar a mano). Los movimientos cargados
  a mano (recibos, ajustes) tienen origen `NULL`.
- **Viaje ↔ cuenta del cliente:** `viajes.servicio.js → reconciliarMovimientos`
  es el único camino, tanto al editar el viaje como al facturarlo desde
  Facturación. Con factura formal, el débito es el total de la factura, así la
  nota de crédito lo compensa exacto.
- **IVA 21 %**, paginación (50 por página, máx. 200) y duración de la sesión
  (12 h) están en `config/constantes.js`.
- **Importes de un viaje** en `viajes/viajes.calculos.js` (funciones puras con tests).
- **Historial de equipos** (`EQUIPO_HISTORIAL`): cada período dice qué camión,
  acoplado y chofer tuvo un equipo, desde y hasta cuándo. Editar un equipo cierra
  el período vigente y abre otro (con la fecha real del cambio si se indica).
  La **foto** de cada viaje (`VIAJES.id_chofer`, `id_unidad_principal`,
  `id_unidad_secundaria`) sale del historial según su fecha de origen:
  corregir el historial recalcula viajes y liquidaciones
  (`equipos.historial.js → refotografiarViajes`). La rentabilidad asigna los
  consumos generales al equipo que tenía la unidad en la fecha del consumo.
- **Módulos por empresa** en `config/modulos.js`: dependencias y obligatorios
  (Cuentas y Facturación siempre activos).

### Seguridad

| Qué | Dónde |
|-----|-------|
| Arranque bloqueado si faltan `AUTH_SECRET`/`CERT_SECRET` o son débiles | `lib/seguridad/configuracion.js` (lo llama `server.js`) |
| Roles: `ADMIN` (plataforma, todas las empresas), `ADMIN_MULTIEMPRESA` (como `ADMIN_EMPRESA` pero para un subconjunto de empresas asignado por el `ADMIN`, nunca crea ni da de baja empresas), `ADMIN_EMPRESA` (opera como `USUARIO` y además administra usuarios/certificado/datos fiscales de su propia empresa) y `USUARIO` (opera su empresa) | `requiereRol`/`requiereAdmin`/`alcanceEmpresaPropia` en `middleware/autenticacion.js`; `resolverEmpresaMultiempresa` en `middleware/alcanceMultiempresa.js` |
| Sesión: token firmado en `Authorization: Bearer` (nunca en la URL); en cada pedido se verifica que el usuario siga activo y que su `version_sesion` coincida (también se incrementa al cambiar el rol o la empresa de alguien) | `middleware/autenticacion.js` |
| Contraseña temporal (instalación inicial o asignada por el admin): hay que cambiarla antes de operar | `debe_cambiar_contrasena` + `PUT /api/auth/contrasena` |
| Límite de intentos de login: 5 por usuario e IP y 20 por IP, cada 15 min | `lib/seguridad/limiteIntentos.js` |
| Cabeceras HTTP (CSP, nosniff, anti-iframe, HSTS con HTTPS) | `middleware/seguridad.js` |
| Errores: los de negocio (`ErrorNegocio`) y los de validación de MySQL se muestran con un mensaje claro; el resto va al log con un código y el navegador recibe solo ese código | `lib/errores.js` (`responderError`) |
| Descargas protegidas (PDF, CSR) con `fetch` y cabecera | `frontend/js/api.js → descargarArchivo` |
| Texto de usuarios insertado en HTML siempre con `esc()` | `frontend/js/nucleo/utilidades.js` |

El servidor (Docker, despliegue desde Docker Hub, respaldos cifrados en Google
Drive, HTTPS y SSH) está documentado en `docs/operacion/SERVIDOR.md`.

## Frontend (`frontend/`)

Se sirve como carpeta estática: `frontend/stylo/main.css` es `/stylo/main.css` (único CSS que carga `index.html`; solo `@import`). Los valores viven en `base/tokens.css` y `base/temas.css`; los componentes en `componentes/`, el esqueleto en `layout/` y lo específico de cada pantalla en `vistas/`. Los gráficos son SVG propios (`js/nucleo/graficos.js`), sin librerías.
No hay bundler: los archivos se cargan con `<script>` en el orden de `index.html`
y **todas las funciones son globales**, porque el HTML generado usa
`onclick="nombreDeFuncion(...)"`.

| Archivo | Contenido |
|---------|-----------|
| `js/api.js` | Cliente HTTP (`API.*`), token en `localStorage` (`erp_token`) |
| `js/nucleo/modulos.js` | Catálogo de vistas CRUD: campos, columnas, etiquetas |
| `js/nucleo/utilidades.js` | `$`, formatos, rangos de fechas, toasts, cachés |
| `js/nucleo/navegacion.js` | Ruteo por `#hash` y menú lateral |
| `js/vistas/*.js` | Una vista por archivo: dashboard, métricas, facturación, cuentas corrientes, viajes, stock, CRUD genérico, apariencia, admin |
| `js/nucleo/sesion.js` | Login, temas, módulos visibles |
| `js/app.js` | Arranque (va último) |

## Base de datos (`backend/database/`)

| Carpeta | Uso | Cuándo |
|---------|-----|--------|
| `esquema/esquema.sql` | Todas las tablas, sin datos. Lo aplica `instalar.js` sobre una base **vacía** (no borra nada) | Instalación limpia de un cliente |
| `instalar.js` · `alta-cliente.js` | Instalación (tablas + administrador de plataforma) y alta de cada cliente (empresa + su administrador) | [ALTA_DE_CLIENTE.md](operacion/ALTA_DE_CLIENTE.md) |
| `migraciones/` | Cambios incrementales 001…026, aplicados por `migrar.js` (tabla `MIGRACIONES`) | Actualizar producción sin perder datos |
| `datos_prueba/` | `datos_basicos.sql` (empresa de ejemplo y usuarios `admin`/`demo`, solo desarrollo y tests) y ~5.600 filas coherentes con su generador | Pruebas y demos |

## Verificación

- `npm test` — reglas de cálculo.
- `npm run test:integracion` — circuito viaje → facturación → cuenta corriente
  contra un MySQL **descartable** (recrea la base con `esquema.sql` + `datos_basicos.sql`; exige
  `TEST_DB_PERMITIR_BORRADO=1` y `TEST_DB_*`).
- `npm run verificar` — sintaxis y `require` del backend.
- `npm run verificar-entorno` — secretos, base, esquema, migraciones y respaldos (lo mismo que comprueba el servidor al arrancar).
- `npm run smoke` — foto de todas las respuestas de la API para comparar antes
  y después de un cambio (con `--con-escritura` solo contra una base de prueba).
