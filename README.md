# TCV LogiSuite ERP

Sistema ERP multiempresa de gestión logística y de transporte.
Backend en **Node.js + Express**, base de datos **MySQL** y frontend responsivo
en **HTML, CSS y JavaScript** puro (sin frameworks ni bundler).

- Cómo está organizado el código: **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**
- Reglas para escribir código nuevo: **[docs/CONVENCIONES.md](docs/CONVENCIONES.md)**

---

## Requisitos

- Node.js 18 o superior
- MySQL 8 (o MariaDB 10.4+)

## Instalación local

```bash
# 1. Instalar dependencias
npm install

# 2. Crear la base de datos, las tablas y los datos iniciales
#    ⚠ Este script BORRA la base si ya existía: solo para instalaciones nuevas.
mysql -u root -p < backend/database/esquema/init_db.sql

# 3. Configurar las credenciales
cp .env.example .env
# Editar .env con tu usuario y contraseña de MySQL

# 4. Iniciar el servidor (siempre desde la raíz del proyecto)
npm start
```

Abrir **http://localhost:3000** (landing comercial) o **http://localhost:3000/app** (sistema).
Usuarios iniciales: `admin` / `admin123` (administrador global) y `demo` / `demo123`.

Para desarrollo con recarga automática: `npm run dev`

### Comandos útiles

| Comando | Qué hace |
|---------|----------|
| `npm start` | Levanta el servidor (`server.js` → `backend/server.js`) |
| `npm run dev` | Igual, con recarga automática (nodemon) |
| `npm test` | Tests de las reglas de cálculo (viajes y facturación) |
| `npm run verificar` | Revisa la sintaxis de todos los `.js` y que los `require` del backend resuelvan |
| `npm run smoke -- --guardar foto.json` / `--comparar foto.json` | Prueba de humo de la API: guarda o compara las respuestas de todos los endpoints (ver `scripts/smoke-test.js`) |

---

## Estructura del proyecto

```
tcv-logisuite-erp/
├── backend/                  # Servidor (Node.js + Express)
│   ├── server.js             # Punto de entrada: abre el puerto y cierre ordenado
│   ├── src/
│   │   ├── app.js            # Arma Express: CORS, JSON, landing, estáticos, SPA
│   │   ├── rutas.js          # Monta todas las rutas /api/*
│   │   ├── config/           # db.js, modulos.js, constantes.js (IVA, paginación, sesión)
│   │   ├── middleware/       # autenticación y módulos habilitados por empresa
│   │   ├── lib/              # crudFactory, paginación, seguridad (credenciales, cifrado)
│   │   ├── integraciones/    # ARCA (factura electrónica) y certificados
│   │   └── modulos/          # Un dominio de negocio por carpeta
│   │       ├── tablas.js     # Registro de las tablas CRUD
│   │       ├── auth/  admin/  asesoria/  stock/
│   │       ├── cuentas/      # hooks, servicio, cuentas corrientes y su PDF
│   │       ├── viajes/       # hooks y cálculos de importes
│   │       ├── gastos/       # consumos y gastos administrativos
│   │       ├── facturacion/  # rutas, servicio y PDF de factura
│   │       └── dashboard/    # rutas y piezas de SQL
│   ├── database/
│   │   ├── esquema/          # init_db.sql (instalación NUEVA, destructivo)
│   │   ├── migraciones/      # 001…022 para actualizar producción sin perder datos
│   │   └── datos_prueba/     # datos masivos y su generador
│   └── test/                 # Tests (node:test)
├── frontend/                 # Se sirve tal cual: /css, /js, /img
│   ├── index.html            # SPA (sistema)
│   ├── landing.html          # Landing comercial
│   ├── css/styles.css
│   └── js/
│       ├── api.js            # Cliente HTTP
│       ├── nucleo/           # módulos, utilidades, navegación, sesión
│       ├── vistas/           # dashboard, métricas, facturación, cuentas, CRUD, admin…
│       └── app.js            # Arranque
├── deploy/                   # nginx.conf, erp.service, setup-db.sh
├── docs/                     # Arquitectura, convenciones y guías de operación
├── scripts/                  # smoke-test.js, verificar-requires.js
├── server.js                 # Lanzador (compatibilidad con PM2/systemd)
├── ecosystem.config.js       # PM2
└── .env.example              # Plantilla de configuración
```

---

## API REST

Todas las rutas de datos exigen sesión (`Authorization: Bearer <token>`), un
usuario con empresa asignada y el módulo activo para esa empresa.

Cada tabla expone las mismas operaciones:

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/api/{recurso}`       | Listar paginado (`?q=`, `?pagina=`, `?por_pagina=`, filtros) |
| GET    | `/api/{recurso}/:id`   | Obtener uno |
| POST   | `/api/{recurso}`       | Crear |
| PUT    | `/api/{recurso}/:id`   | Actualizar |
| DELETE | `/api/{recurso}/:id`   | Eliminar |

Recursos: `choferes`, `unidades`, `equipos`, `viajes`, `consumos-combustible`,
`consumos-generales`, `gastos-administrativos`, `cuentas`, `movimientos`,
`stock`, `mantenimientos`, `vencimientos`, `cubiertas`.

### Otros endpoints

| Ruta | Devuelve |
|------|----------|
| `POST /api/auth/login`, `GET /api/auth/yo`, `PUT /api/auth/tema` | Sesión y preferencias del usuario |
| `/api/dashboard/kpis` | Viajes activos, ingresos, costos, ganancia, margen, rendimiento global |
| `/api/dashboard/alertas` | Carnets, vencimientos y mantenimientos próximos o vencidos; choferes sin descanso |
| `/api/dashboard/rendimiento-equipos` · `rendimiento-choferes` | Km/litro, costo por km, viajes e ingresos por chofer |
| `/api/dashboard/ingresos-mensuales` · `clientes-top` | Ingresos de 12 meses y ranking de pagadores |
| `/api/dashboard/consumos-por-equipo` · `ingresos-por-viaje` · `rentabilidad-equipos` · `gastos-administrativos` | Métricas con detalle (`?detalle=1`, fechas y equipo) |
| `/api/cuentas-corrientes` · `/:id` · `/:id/pdf` | Saldos por cuenta, detalle con saldo parcial y PDF |
| `/api/facturacion` · `/viajes-facturables` · `/desde-viaje/:id` · `/manual` · `/:id/nota-credito` · `/:id/pdf` | Facturas A y notas de crédito |
| `/api/stock/depositos` · `/api/stock/mover-deposito` | Depósitos y traspaso masivo |
| `/api/admin/*` · `/api/certificados/*` | Empresas, usuarios, módulos y certificados ARCA (solo ADMIN) |
| `POST /api/asesoria` | Formulario de contacto de la landing (público) |
| `/api/health` | Estado del servidor y la conexión a MySQL |

> El cálculo de ingresos respeta el tipo de tarifa: `tarifa × resultado`
> para POR KM y POR TONELADA, y `tarifa` directa para UNICA. Las reglas están
> en `backend/src/modulos/viajes/viajes.calculos.js`.

---

## Funcionalidades

**Cuentas corrientes**
- Resumen general: todos los movimientos agrupados por cuenta, comparando
  créditos contra débitos para obtener el saldo final.
- Condición automática: saldo positivo = ACREEDOR (la empresa adeuda al
  titular), saldo negativo = DEUDOR (el titular adeuda a la empresa),
  saldo cero = SALDADA.
- Buscador de cuentas por nombre, CUIL o tipo con filtrado en vivo.
- Detalle por cuenta con saldo parcial acumulado movimiento a movimiento.
- Resumen de cuenta descargable en PDF con membrete de la empresa,
  datos del titular, tabla de movimientos y saldo final.
- Recibos: desde el detalle se registra un movimiento "RECIBO N° xxxx — detalle";
  cada movimiento puede editarse o eliminarse sin salir de la vista.

**Viajes y facturación**
- Avance secuencial de estado: EN CURSO → EN DESTINO → FINALIZADO → FACTURADO.
- Al FINALIZAR se liquida al chofer en su cuenta; al FACTURAR se debita al
  pagador (sin facturar, líquido producto o factura formal, con comisión e IVA).
- Factura A y nota de crédito con numeración correlativa y PDF; con ARCA
  habilitado se solicita el CAE (ver `docs/facturacion/`).

**Filtros por equipo y depósitos**
- Viajes y consumos de combustible se filtran directamente por equipo.
- Mantenimientos, vencimientos y cubiertas se filtran por equipo a través
  de sus unidades (principal y secundaria).
- Stock se filtra por depósito (lugar físico o equipo con elementos a bordo)
  y permite mover todo un depósito a otro.

**Dashboard**
- KPIs, alertas automáticas, ingresos mensuales, ranking de clientes y
  rendimiento por equipo y por chofer, con vistas ampliadas por métrica.

**Módulos CRUD**
- Alta, edición y baja con formularios en modal, búsqueda en tiempo real,
  paginación, selectores inteligentes para claves foráneas e insignias de estado.
- Protección de integridad: si un registro está referenciado por otra tabla,
  el sistema avisa en lugar de fallar.

**Multiempresa**
- Cada usuario opera solo los datos de su empresa; el ADMIN gestiona
  empresas, usuarios y qué módulos tiene activos cada empresa.

**Diseño**
- Responsivo: sidebar fija en escritorio, menú deslizable en móvil.
- Temas de color por usuario.

---

## Despliegue en producción (VPS)

- Guía general: **[docs/despliegue/DEPLOY.md](docs/despliegue/DEPLOY.md)**
- Hostinger con dominio y HTTPS: **[docs/despliegue/DEPLOY_HOSTINGER.md](docs/despliegue/DEPLOY_HOSTINGER.md)**
- Actualizar una instalación existente sin perder datos: **[docs/operacion/ACTUALIZAR_SIN_PERDER_DATOS.md](docs/operacion/ACTUALIZAR_SIN_PERDER_DATOS.md)**
- Factura electrónica ARCA: **[docs/facturacion/HABILITAR_FACTURACION_ARCA.md](docs/facturacion/HABILITAR_FACTURACION_ARCA.md)**

Archivos de apoyo para el deploy:
- `.env.example` — plantilla de variables de entorno (copiar a `.env` en la raíz).
- `ecosystem.config.js` — configuración de PM2 (gestor de procesos).
- `deploy/nginx.conf` — reverse proxy de Nginx.
- `deploy/erp.service` — servicio systemd (alternativa a PM2).
- `deploy/setup-db.sh` — crea la base de datos y carga el esquema (instalación nueva).

Resumen rápido:

```bash
npm install --omit=dev          # instalar dependencias
cp .env.example .env            # configurar entorno (DB, AUTH_SECRET, CERT_SECRET, dominio)
bash deploy/setup-db.sh         # crear base de datos y datos iniciales (instalación nueva)
pm2 start ecosystem.config.js   # arrancar la app de forma permanente
# luego configurar Nginx + Certbot (ver docs/despliegue/DEPLOY.md)
```
