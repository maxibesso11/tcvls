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
| `tablas.js` | — | Declara las 13 tablas CRUD: campos, filtros, orden y hooks |
| `auth/` | `auth.rutas.js` | Login, datos de la sesión, tema |
| `admin/` | `admin.rutas.js`, `certificados.rutas.js` | Empresas, usuarios, módulos por empresa, certificados ARCA |
| `cuentas/` | `cuentas.hooks.js`, `cuentas.servicio.js`, `movimientos.servicio.js`, `cuentasCorrientes.rutas.js`, `cuentasCorrientes.pdf.js` | Cuenta del chofer sincronizada, validación de proveedores, movimientos automáticos con origen, saldos y resumen PDF |
| `viajes/` | `viajes.hooks.js`, `viajes.servicio.js`, `viajes.calculos.js` | Liquidación al chofer (FINALIZADO) y débito al pagador (FACTURADO), por un único camino |
| `gastos/` | `consumos.hooks.js`, `gastosAdministrativos.hooks.js` | Crédito al proveedor por cada consumo o gasto |
| `facturacion/` | `facturacion.rutas.js`, `facturacion.servicio.js`, `facturacion.pdf.js` | Factura A, nota de crédito, numeración, CAE, PDF |
| `dashboard/` | `dashboard.rutas.js`, `dashboard.consultas.js` | KPIs, alertas y métricas |
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
- **Módulos por empresa** en `config/modulos.js`: dependencias y obligatorios
  (Cuentas y Facturación siempre activos).

### Seguridad

| Qué | Dónde |
|-----|-------|
| Arranque bloqueado si faltan `AUTH_SECRET`/`CERT_SECRET` o son débiles | `lib/seguridad/configuracion.js` (lo llama `server.js`) |
| Sesión: token firmado en `Authorization: Bearer` (nunca en la URL); en cada pedido se verifica que el usuario siga activo y que su `version_sesion` coincida | `middleware/autenticacion.js` |
| Contraseña temporal (instalación inicial o asignada por el admin): hay que cambiarla antes de operar | `debe_cambiar_contrasena` + `PUT /api/auth/contrasena` |
| Límite de intentos de login: 5 por usuario e IP y 20 por IP, cada 15 min | `lib/seguridad/limiteIntentos.js` |
| Cabeceras HTTP (CSP, nosniff, anti-iframe, HSTS con HTTPS) | `middleware/seguridad.js` |
| Errores: los de negocio (`ErrorNegocio`) y los de validación de MySQL se muestran con un mensaje claro; el resto va al log con un código y el navegador recibe solo ese código | `lib/errores.js` (`responderError`) |
| Descargas protegidas (PDF, CSR) con `fetch` y cabecera | `frontend/js/api.js → descargarArchivo` |
| Texto de usuarios insertado en HTML siempre con `esc()` | `frontend/js/nucleo/utilidades.js` |

La puesta a punto del servidor (usuario administrador, SSH solo con clave,
respaldos) está en `docs/operacion/SERVIDOR.md`.

## Frontend (`frontend/`)

Se sirve como carpeta estática: `frontend/css/styles.css` es `/css/styles.css`.
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
| `esquema/init_db.sql` | Crea la base desde cero con datos iniciales. **Ejecuta `DROP DATABASE`** | Solo instalación nueva o pruebas |
| `migraciones/` | Cambios incrementales 001…024 | Actualizar producción sin perder datos |
| `datos_prueba/` | ~5.600 filas coherentes y su generador | Pruebas y demos |

## Verificación

- `npm test` — reglas de cálculo.
- `npm run test:integracion` — circuito viaje → facturación → cuenta corriente
  contra un MySQL **descartable** (recrea la base con `init_db.sql`; exige
  `TEST_DB_PERMITIR_BORRADO=1` y `TEST_DB_*`).
- `npm run verificar` — sintaxis y `require` del backend.
- `npm run smoke` — foto de todas las respuestas de la API para comparar antes
  y después de un cambio (con `--con-escritura` solo contra una base de prueba).
