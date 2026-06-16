# TCV LogiSuite ERP

Sistema ERP multiempresa de gestión logística y de transporte.
Backend en **Node.js + Express**, base de datos **MySQL** y frontend responsivo
en **HTML, CSS y JavaScript** puro.

> Las tablas de la base de datos respetan exactamente el esquema definido
> previamente (12 tablas). El sistema solo realiza consultas sobre ellas,
> sin modificar su estructura.

---

## Requisitos

- Node.js 18 o superior
- MySQL 8 (o MariaDB 10.4+)

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Crear la base de datos, las tablas y los datos de prueba
#    (un solo script hace todo, y recrea la base si ya existía)
mysql -u root -p < database/init_db.sql

# 3. Configurar las credenciales
cp .env.example .env
# Editar .env con tu usuario y contraseña de MySQL

# 4. Iniciar el servidor
npm start
```

Abrir **http://localhost:3000** en el navegador.

Para desarrollo con recarga automática: `npm run dev`

---

## Estructura del proyecto

```
tcv-logisuite-erp/
├── server.js                  # Servidor Express principal
├── config/
│   └── db.js                  # Pool de conexiones MySQL
├── database/
├── database/
│   ├── init_db.sql            # Instalación completa: BD + 12 tablas + datos de prueba
│   └── historico_migraciones/ # Migraciones incrementales (referencia histórica)
├── routes/
│   ├── crudFactory.js         # Generador de rutas CRUD reutilizable
│   ├── tablas.js              # Definición de las 12 tablas
│   └── dashboard.js           # Métricas y KPIs (consultas agregadas)
└── public/
    ├── index.html             # SPA con sidebar y modal
    ├── css/styles.css         # Diseño responsivo
    └── js/
        ├── api.js             # Cliente HTTP
        └── app.js             # Vistas, formularios y dashboard
```

---

## API REST

Cada tabla expone las mismas operaciones:

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/api/{recurso}`       | Listar (con `?q=` para buscar) |
| GET    | `/api/{recurso}/:id`   | Obtener uno |
| POST   | `/api/{recurso}`       | Crear |
| PUT    | `/api/{recurso}/:id`   | Actualizar |
| DELETE | `/api/{recurso}/:id`   | Eliminar |

Recursos disponibles: `choferes`, `unidades`, `equipos`, `viajes`,
`consumos-combustible`, `consumos-generales`, `cuentas`, `movimientos`,
`stock`, `mantenimientos`, `vencimientos`, `cubiertas`.

### Endpoints de métricas

| Ruta | Devuelve |
|------|----------|
| `/api/dashboard/kpis` | Viajes activos, ingresos, costos, ganancia, margen, rendimiento global |
| `/api/dashboard/alertas` | Carnets, vencimientos y mantenimientos próximos (30 días) o vencidos, y choferes con más de 6 días sin descanso |
| `/api/dashboard/rendimiento-equipos` | Km/litro y costo por km de cada equipo |
| `/api/dashboard/rendimiento-choferes` | Viajes e ingresos generados por chofer |
| `/api/dashboard/ingresos-mensuales` | Ingresos de los últimos 12 meses (gráfico) |
| `/api/dashboard/saldos-cuentas` | Saldo de cuenta corriente por titular |
| `/api/dashboard/clientes-top` | Ranking de pagadores por facturación |
| `/api/cuentas-corrientes` | Resumen de todas las cuentas: créditos, débitos, saldo final y condición (DEUDOR / ACREEDOR / SALDADA). Admite `?q=` para buscar |
| `/api/cuentas-corrientes/:id` | Detalle de una cuenta con saldo parcial acumulado movimiento a movimiento |
| `/api/cuentas-corrientes/:id/pdf` | Resumen de cuenta descargable en PDF |
| `/api/health` | Estado del servidor y la conexión a MySQL |

> El cálculo de ingresos respeta el tipo de tarifa: `tarifa × resultado`
> para POR KM y POR TONELADA, y `tarifa` directa para UNICA.

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

**Filtros por equipo**
- Viajes y consumos de combustible se filtran directamente por equipo
  (columna `id_equipo`).
- Mantenimientos, vencimientos y cubiertas se filtran por equipo a través
  de las unidades que lo componen (principal y secundaria), mediante una
  subconsulta sobre EQUIPO — sin modificar el esquema.
- El selector de equipo muestra patente principal y chofer para
  identificarlos fácilmente, y se combina con el buscador de texto.
- Stock se filtra por depósito mediante un selector con todos los
  depósitos registrados. El depósito es un concepto flexible: puede ser
  un lugar físico ("Depósito Central Córdoba") o un equipo que lleva
  elementos a bordo ("Equipo #1 · AB123CD"). Al cargar stock, el campo
  Depósito sugiere los depósitos existentes y los equipos de la flota
  para mantener los nombres consistentes.

**Recibos en cuenta corriente**
- Desde el detalle de una cuenta se puede registrar un RECIBO: un
  movimiento cuyo concepto se genera como "RECIBO N° xxxx — detalle".
- Cada movimiento de la cuenta puede editarse o eliminarse sin salir
  de la vista, y el saldo parcial se recalcula al instante.
- Los recibos se distinguen con una insignia en el extracto y aparecen
  en el PDF como cualquier otro movimiento.
- Se apoya en la relación foránea ya existente
  MOVIMIENTOS.id_cuenta → CUENTA.id_cuenta (no requirió cambios de esquema).

**Dashboard**
- KPIs: viajes activos, ingresos totales, pendiente de cobro, ganancia neta,
  margen, rendimiento global de combustible y tamaño de flota.
- Alertas automáticas: carnets por vencer, documentación y mantenimientos
  próximos o vencidos, y control de jornadas de descanso de choferes.
- Gráfico de ingresos mensuales, ranking de clientes y tablas de rendimiento
  por equipo y por chofer.

**Módulos CRUD (los 12 del esquema)**
- Alta, edición y baja con formularios en modal.
- Búsqueda en tiempo real en cada tabla.
- Selectores inteligentes para claves foráneas: al crear un equipo solo se
  ofrecen unidades PRINCIPALES para el campo principal y SECUNDARIAS para
  el secundario.
- Insignias de color según estado (viajes, pagos, tipos de cuenta, cubiertas).
- Protección de integridad: si un registro está referenciado por otra tabla,
  el sistema avisa en lugar de fallar.

**Diseño**
- Responsivo: sidebar fija en escritorio, menú deslizable en móvil.
- Paleta propia: verde pizarra + ámbar ruta.
- Sin frameworks de frontend: HTML, CSS y JS puro, fácil de mantener.

---

## Despliegue en producción (VPS)

Para poner el sistema en un servidor VPS (Node + MySQL + Nginx + HTTPS),
seguí la guía paso a paso en **[DEPLOY.md](DEPLOY.md)**. Para Hostinger específicamente (con dominio y HTTPS), ver **[DEPLOY_HOSTINGER.md](DEPLOY_HOSTINGER.md)**.

Archivos de apoyo para el deploy:
- `.env.example` — plantilla de variables de entorno (copiar a `.env`).
- `ecosystem.config.js` — configuración de PM2 (gestor de procesos).
- `deploy/nginx.conf` — reverse proxy de Nginx.
- `deploy/erp.service` — servicio systemd (alternativa a PM2).
- `deploy/setup-db.sh` — script para crear la base de datos y cargar el esquema.

Resumen rápido:

```bash
npm install --omit=dev          # instalar dependencias
cp .env.example .env            # configurar entorno (DB, AUTH_SECRET, dominio)
bash deploy/setup-db.sh         # crear base de datos y datos iniciales
pm2 start ecosystem.config.js   # arrancar la app de forma permanente
# luego configurar Nginx + Certbot (ver DEPLOY.md)
```
